import { parsePrometheus, type PromFamily } from "./prometheus";
import type { LocoServer } from "~/lib/servers/types";

/**
 * Loco's built-in health endpoints. Every Loco server exposes these at the root
 * (they are not nested under the API prefix):
 *   /_ping       — liveness (does not touch dependencies)
 *   /_health     — can it connect to DB / Redis
 *   /_readiness  — active checks of DB, queue provider and cache
 * Each returns `{"ok": true|false}`.
 */
const PROBES = [
  { key: "ping", path: "/_ping" },
  { key: "health", path: "/_health" },
  { key: "readiness", path: "/_readiness" },
] as const;

export type ProbeKey = (typeof PROBES)[number]["key"];

export interface ProbeResult {
  key: ProbeKey;
  path: string;
  ok: boolean;
  status: number;
  latencyMs: number | null;
  error?: string;
}

export interface PrometheusResult {
  ok: boolean;
  path: string;
  error?: string;
  families: PromFamily[];
  sampleCount: number;
  latencyMs: number | null;
}

export type ServerStatus = "up" | "degraded" | "down";

export interface ServerMetrics {
  server: LocoServer;
  status: ServerStatus;
  /** Round-trip latency of the liveness probe, in ms. */
  latencyMs: number | null;
  probes: ProbeResult[];
  prometheus: PrometheusResult | null;
  collectedAt: Date;
}

interface FetchOutcome {
  res: Response | null;
  latencyMs: number | null;
  error?: string;
}

async function timedFetch(
  url: string,
  timeoutMs: number,
  accept: string,
): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept },
      redirect: "manual",
    });
    return { res, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      res: null,
      latencyMs: null,
      error: aborted
        ? `timed out after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : "request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runProbe(
  server: LocoServer,
  probe: (typeof PROBES)[number],
  timeoutMs: number,
): Promise<ProbeResult> {
  const { res, latencyMs, error } = await timedFetch(
    server.baseUrl + probe.path,
    timeoutMs,
    "application/json, text/plain",
  );
  if (!res) {
    return { key: probe.key, path: probe.path, ok: false, status: 0, latencyMs, error };
  }

  // Loco reports failures via `{"ok": false}` and/or a non-2xx status.
  let ok = res.ok;
  try {
    const body = (await res.json()) as { ok?: unknown };
    if (typeof body?.ok === "boolean") ok = ok && body.ok;
  } catch {
    // Non-JSON body (or empty) — fall back to the HTTP status.
  }
  return { key: probe.key, path: probe.path, ok, status: res.status, latencyMs };
}

async function scrapePrometheus(
  server: LocoServer,
  timeoutMs: number,
): Promise<PrometheusResult | null> {
  if (!server.metricsPath) return null;
  const path = server.metricsPath;
  const { res, latencyMs, error } = await timedFetch(
    server.baseUrl + path,
    timeoutMs,
    "text/plain",
  );
  if (!res) {
    return { ok: false, path, error, families: [], sampleCount: 0, latencyMs };
  }
  if (!res.ok) {
    return {
      ok: false,
      path,
      error: `HTTP ${res.status}`,
      families: [],
      sampleCount: 0,
      latencyMs,
    };
  }
  try {
    const text = await res.text();
    const { families, sampleCount } = parsePrometheus(text);
    return { ok: true, path, families, sampleCount, latencyMs };
  } catch (err) {
    return {
      ok: false,
      path,
      error: err instanceof Error ? err.message : "failed to parse metrics",
      families: [],
      sampleCount: 0,
      latencyMs,
    };
  }
}

function deriveStatus(probes: ProbeResult[]): ServerStatus {
  const ping = probes.find((p) => p.key === "ping");
  if (ping && !ping.ok) return "down";
  // If liveness is fine but a dependency check fails, the server is degraded.
  const dependencyFailing = probes.some(
    (p) => p.key !== "ping" && !p.ok,
  );
  return dependencyFailing ? "degraded" : "up";
}

interface ProbeSummary {
  status: ServerStatus;
  latencyMs: number | null;
  probes: ProbeResult[];
}

/** Run the health probes for a server (no metrics scrape). */
export async function probeServer(
  server: LocoServer,
  timeoutMs: number,
): Promise<ProbeSummary> {
  const probes = await Promise.all(
    PROBES.map((p) => runProbe(server, p, timeoutMs)),
  );
  return {
    status: deriveStatus(probes),
    latencyMs: probes.find((p) => p.key === "ping")?.latencyMs ?? null,
    probes,
  };
}

/** Collect health probes and optional metrics for a single server. */
export async function collectServerMetrics(
  server: LocoServer,
  timeoutMs: number,
): Promise<ServerMetrics> {
  const [probe, prometheus] = await Promise.all([
    probeServer(server, timeoutMs),
    scrapePrometheus(server, timeoutMs),
  ]);

  return {
    server,
    status: probe.status,
    latencyMs: probe.latencyMs,
    probes: probe.probes,
    prometheus,
    collectedAt: new Date(),
  };
}

export interface FleetMember {
  server: LocoServer;
  status: ServerStatus;
  latencyMs: number | null;
}

/** Lightweight health-only probe of every server, for the Overview tile. */
export async function probeAll(
  servers: LocoServer[],
  timeoutMs: number,
): Promise<FleetMember[]> {
  return Promise.all(
    servers.map(async (server) => {
      const { status, latencyMs } = await probeServer(server, timeoutMs);
      return { server, status, latencyMs };
    }),
  );
}

/** Collect metrics for every server concurrently. Never rejects. */
export async function collectAll(
  servers: LocoServer[],
  timeoutMs: number,
): Promise<ServerMetrics[]> {
  return Promise.all(
    servers.map((s) => collectServerMetrics(s, timeoutMs)),
  );
}

export function metricsTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = Number.parseInt(env.METRICS_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 4000;
}
