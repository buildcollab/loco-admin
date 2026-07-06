import { StaticResolver } from "./static-resolver";
import type { LocoServer, ServerResolver } from "./types";

/**
 * Build the set of active resolvers from the environment. Today only the
 * StaticResolver is wired up; future resolvers (Kubernetes, Consul, …) are
 * added here behind their own configuration checks.
 */
export function buildResolvers(
  env: NodeJS.ProcessEnv = process.env,
): ServerResolver[] {
  const resolvers: ServerResolver[] = [];

  const staticResolver = StaticResolver.fromEnv(env);
  if (staticResolver) resolvers.push(staticResolver);

  // Future:
  //   if (env.KUBERNETES_SERVICE_HOST) resolvers.push(new KubernetesResolver(...));
  //   if (env.CONSUL_HTTP_ADDR) resolvers.push(new ConsulResolver(...));

  return resolvers;
}

export interface ResolverSummary {
  kind: string;
  label: string;
  count: number;
}

export interface ResolveResult {
  servers: LocoServer[];
  resolvers: ResolverSummary[];
}

/**
 * Run every configured resolver, stamp each server with the resolver that
 * produced it, and merge the results. If two resolvers surface the same server
 * id the first one wins (resolvers are tried in registration order).
 */
export async function resolveServers(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolveResult> {
  const resolvers = buildResolvers(env);

  const perResolver = await Promise.all(
    resolvers.map(async (r) => {
      const resolved = await r.resolve();
      return { resolver: r, servers: resolved };
    }),
  );

  const byId = new Map<string, LocoServer>();
  const summaries: ResolverSummary[] = [];

  for (const { resolver, servers } of perResolver) {
    let count = 0;
    for (const s of servers) {
      if (byId.has(s.id)) continue;
      byId.set(s.id, { ...s, source: resolver.kind });
      count++;
    }
    summaries.push({ kind: resolver.kind, label: resolver.label, count });
  }

  return {
    servers: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)),
    resolvers: summaries,
  };
}
