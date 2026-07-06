import { KubernetesResolver } from "./kubernetes-resolver";
import { StaticResolver } from "./static-resolver";
import type { LocoServer, ServerResolver } from "./types";

/**
 * Build the set of active resolvers from the environment. Resolvers are tried in
 * registration order; on an id clash the earlier resolver wins.
 */
export function buildResolvers(
  env: NodeJS.ProcessEnv = process.env,
): ServerResolver[] {
  const resolvers: ServerResolver[] = [];

  const staticResolver = StaticResolver.fromEnv(env);
  if (staticResolver) resolvers.push(staticResolver);

  const k8sResolver = KubernetesResolver.fromEnv(env);
  if (k8sResolver) resolvers.push(k8sResolver);

  // Future resolvers (Consul, Nomad, …) register here behind their own config.

  return resolvers;
}

export interface ResolverSummary {
  kind: string;
  label: string;
  count: number;
  /** Set when this resolver failed at runtime; other resolvers still apply. */
  error: string | null;
}

export interface ResolveResult {
  servers: LocoServer[];
  resolvers: ResolverSummary[];
}

/**
 * Run every configured resolver, stamp each server with the resolver that
 * produced it, and merge the results. A resolver that throws at runtime (e.g.
 * the Kubernetes API is unreachable) is isolated: its error is recorded and the
 * other resolvers' servers are still returned.
 */
export async function resolveServers(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolveResult> {
  const resolvers = buildResolvers(env);

  const perResolver = await Promise.all(
    resolvers.map(async (resolver) => {
      try {
        return { resolver, servers: await resolver.resolve(), error: null };
      } catch (err) {
        return {
          resolver,
          servers: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  const byId = new Map<string, LocoServer>();
  const summaries: ResolverSummary[] = [];

  for (const { resolver, servers, error } of perResolver) {
    let count = 0;
    for (const s of servers) {
      if (byId.has(s.id)) continue;
      byId.set(s.id, { ...s, source: resolver.kind });
      count++;
    }
    summaries.push({
      kind: resolver.kind,
      label: resolver.label,
      count,
      error,
    });
  }

  return {
    servers: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)),
    resolvers: summaries,
  };
}
