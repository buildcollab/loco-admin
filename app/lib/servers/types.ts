/**
 * Server discovery abstraction.
 *
 * A `ServerResolver` knows how to produce the list of Loco servers the admin
 * app should talk to. The only implementation today is {@link StaticResolver},
 * which reads a fixed list from configuration, but the interface is designed so
 * dynamic resolvers (Kubernetes endpoints, Consul/service-registry lookups,
 * etc.) can be added later without touching the metrics/UI layers.
 */

/** A single Loco server the admin app can reach. */
export interface LocoServer {
  /** Stable slug derived from the name; used in URLs and as a dedupe key. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Base URL with no trailing slash, e.g. `http://10.0.0.4:5150`. */
  baseUrl: string;
  /** Free-form labels (environment, region, role…). */
  tags: string[];
  /**
   * Path to a Prometheus-style metrics endpoint on this server, if it exposes
   * one (Loco has none by default). When set, the collector scrapes it.
   */
  metricsPath: string | null;
  /** The resolver kind that produced this entry (e.g. "static"). */
  source: string;
}

/** A server as returned by a resolver, before the registry stamps `source`. */
export type ResolvedServer = Omit<LocoServer, "source">;

export interface ServerResolver {
  /** Short machine identifier, e.g. "static", "kubernetes". */
  readonly kind: string;
  /** A human label describing how this resolver is configured (for the UI). */
  readonly label: string;
  resolve(): Promise<ResolvedServer[]>;
}

/** Turn an arbitrary name into a URL-safe, stable slug. */
export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "server"
  );
}

/** Normalise a base URL: require http(s), strip any trailing slash. */
export function normalizeBaseUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported protocol in baseUrl: ${input}`);
  }
  return url.toString().replace(/\/+$/, "");
}

/** Ensure a metrics path has a single leading slash, or return null. */
export function normalizeMetricsPath(
  input: string | null | undefined,
): string | null {
  if (!input || !input.trim()) return null;
  const p = input.trim();
  return p.startsWith("/") ? p : `/${p}`;
}
