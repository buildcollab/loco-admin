import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { readFileSync } from "node:fs";
import {
  type ResolvedServer,
  type ServerResolver,
  normalizeMetricsPath,
  slug,
} from "./types";

/**
 * Discovers Loco servers by listing pods through the Kubernetes API.
 *
 * Enabled whenever `K8S_LABEL_SELECTOR` is set. Everything else has sensible
 * in-cluster defaults (service-account token, CA and namespace) but can be
 * overridden for out-of-cluster use / testing via env:
 *
 *   K8S_LABEL_SELECTOR   pod selector, e.g. "app=loco,role=web"   (required)
 *   K8S_NAMESPACE        namespace to search        (default: SA namespace / "default")
 *   K8S_API_SERVER       API server URL             (default: in-cluster from env)
 *   K8S_TOKEN            bearer token               (default: SA token file)
 *   K8S_CA_CERT_PATH     CA bundle for TLS          (default: SA ca.crt if present)
 *   K8S_SKIP_TLS_VERIFY  "1" to skip API TLS verify (default: verify)
 *   K8S_PORT             force the Loco port        (default: pod containerPort / 5150)
 *   K8S_SCHEME           http | https to reach pods (default: http)
 *   K8S_METRICS_PATH     Prometheus path per pod    (optional)
 *   K8S_TIMEOUT_MS       API request timeout        (default: 4000)
 */

const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";

interface K8sConfig {
  apiServer: string;
  namespace: string;
  labelSelector: string;
  token: string | null;
  ca: Buffer | undefined;
  rejectUnauthorized: boolean;
  port: number | null;
  scheme: string;
  metricsPath: string | null;
  timeoutMs: number;
}

function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

export class KubernetesResolver implements ServerResolver {
  readonly kind = "kubernetes";
  readonly label: string;
  private readonly cfg: K8sConfig;

  constructor(cfg: K8sConfig) {
    this.cfg = cfg;
    this.label = `kubernetes (${cfg.namespace}: ${cfg.labelSelector})`;
  }

  static fromEnv(
    env: NodeJS.ProcessEnv = process.env,
  ): KubernetesResolver | null {
    const labelSelector = env.K8S_LABEL_SELECTOR?.trim();
    if (!labelSelector) return null;

    const apiServer =
      env.K8S_API_SERVER?.trim() ||
      (env.KUBERNETES_SERVICE_HOST
        ? `https://${env.KUBERNETES_SERVICE_HOST}:${
            env.KUBERNETES_SERVICE_PORT || "443"
          }`
        : "");
    if (!apiServer) {
      throw new Error(
        "K8S_LABEL_SELECTOR is set but no Kubernetes API server was found. " +
          "Set K8S_API_SERVER, or run in-cluster.",
      );
    }

    const namespace =
      env.K8S_NAMESPACE?.trim() ||
      readIfExists(`${SA_DIR}/namespace`) ||
      "default";
    const token = env.K8S_TOKEN?.trim() || readIfExists(`${SA_DIR}/token`);
    const caPath = env.K8S_CA_CERT_PATH?.trim() || `${SA_DIR}/ca.crt`;
    let ca: Buffer | undefined;
    try {
      ca = readFileSync(caPath);
    } catch {
      ca = undefined;
    }

    const portRaw = env.K8S_PORT ? Number.parseInt(env.K8S_PORT, 10) : NaN;
    const timeoutRaw = env.K8S_TIMEOUT_MS
      ? Number.parseInt(env.K8S_TIMEOUT_MS, 10)
      : NaN;

    return new KubernetesResolver({
      apiServer: apiServer.replace(/\/+$/, ""),
      namespace,
      labelSelector,
      token,
      ca,
      rejectUnauthorized: env.K8S_SKIP_TLS_VERIFY !== "1",
      port: Number.isFinite(portRaw) ? portRaw : null,
      scheme: env.K8S_SCHEME?.trim() || "http",
      metricsPath: normalizeMetricsPath(env.K8S_METRICS_PATH),
      timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 4000,
    });
  }

  async resolve(): Promise<ResolvedServer[]> {
    const url =
      `${this.cfg.apiServer}/api/v1/namespaces/` +
      `${encodeURIComponent(this.cfg.namespace)}/pods` +
      `?labelSelector=${encodeURIComponent(this.cfg.labelSelector)}`;

    const data = await this.getJson(url);
    const items: unknown = (data as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];

    const servers: ResolvedServer[] = [];
    for (const item of items) {
      const pod = item as K8sPod;
      // Only Running pods that have been assigned an IP are reachable.
      if (pod.status?.phase !== "Running" || !pod.status?.podIP) continue;

      const name = pod.metadata?.name ?? pod.status.podIP;
      const port = this.cfg.port ?? firstContainerPort(pod) ?? 5150;

      servers.push({
        id: slug(name),
        name,
        baseUrl: `${this.cfg.scheme}://${pod.status.podIP}:${port}`,
        tags: [this.cfg.namespace],
        metricsPath: this.cfg.metricsPath,
      });
    }
    return servers;
  }

  private getJson(rawUrl: string): Promise<unknown> {
    const { token, ca, rejectUnauthorized, timeoutMs } = this.cfg;
    return new Promise((resolve, reject) => {
      const u = new URL(rawUrl);
      const isHttps = u.protocol === "https:";
      const getter = isHttps ? httpsGet : httpGet;
      const options: Record<string, unknown> = {
        headers: {
          accept: "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        timeout: timeoutMs,
      };
      if (isHttps) {
        options.ca = ca;
        options.rejectUnauthorized = rejectUnauthorized;
      }

      const req = getter(u, options, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            reject(
              new Error(`Kubernetes API ${status}: ${body.slice(0, 200)}`),
            );
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("Invalid JSON from Kubernetes API"));
          }
        });
      });
      req.on("timeout", () =>
        req.destroy(new Error(`Kubernetes API timed out after ${timeoutMs}ms`)),
      );
      req.on("error", reject);
    });
  }
}

/* --------------------------------------------------- minimal pod typings */

interface K8sPod {
  metadata?: { name?: string; labels?: Record<string, string> };
  spec?: { containers?: { ports?: { containerPort?: number; name?: string }[] }[] };
  status?: { phase?: string; podIP?: string };
}

function firstContainerPort(pod: K8sPod): number | null {
  const ports = pod.spec?.containers?.flatMap((c) => c.ports ?? []) ?? [];
  if (ports.length === 0) return null;
  const named = ports.find((p) => p.name === "http");
  return (named ?? ports[0]).containerPort ?? null;
}
