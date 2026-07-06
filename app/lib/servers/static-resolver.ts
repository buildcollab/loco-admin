import { readFileSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  type ResolvedServer,
  type ServerResolver,
  normalizeBaseUrl,
  normalizeMetricsPath,
  slug,
} from "./types";

/**
 * The raw shape a user writes in config for one server. `baseUrl` and `url` are
 * interchangeable so either reads naturally.
 */
interface RawServer {
  name?: string;
  baseUrl?: string;
  url?: string;
  tags?: string[];
  metricsPath?: string;
}

/**
 * Resolves a fixed list of servers from configuration. The list is supplied
 * either inline as JSON (`LOCO_SERVERS`) or via a JSON/YAML file
 * (`LOCO_SERVERS_FILE`).
 *
 * Example `LOCO_SERVERS`:
 *   [{"name":"web-1","baseUrl":"http://10.0.0.4:5150","tags":["prod"],"metricsPath":"/metrics"}]
 */
export class StaticResolver implements ServerResolver {
  readonly kind = "static";
  readonly label: string;
  private readonly servers: ResolvedServer[];

  constructor(servers: ResolvedServer[], label = "config") {
    this.servers = servers;
    this.label = `static (${label})`;
  }

  async resolve(): Promise<ResolvedServer[]> {
    return this.servers;
  }

  /**
   * Build a StaticResolver from the environment, or return null if no static
   * configuration is present. Throws with a clear message on malformed config.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): StaticResolver | null {
    const inline = env.LOCO_SERVERS?.trim();
    const file = env.LOCO_SERVERS_FILE?.trim();

    if (inline) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(inline);
      } catch (err) {
        throw new Error(
          `LOCO_SERVERS is not valid JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      return new StaticResolver(parseServerList(parsed), "LOCO_SERVERS");
    }

    if (file) {
      const path = isAbsolute(file) ? file : resolvePath(process.cwd(), file);
      let raw: string;
      try {
        raw = readFileSync(path, "utf8");
      } catch {
        throw new Error(`Could not read LOCO_SERVERS_FILE at ${path}`);
      }
      let doc: unknown;
      try {
        // parseYaml also handles JSON, so one path covers both formats.
        doc = parseYaml(raw);
      } catch (err) {
        throw new Error(
          `Could not parse LOCO_SERVERS_FILE (${path}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      // Allow either a bare list or `{ servers: [...] }`.
      const list =
        doc && typeof doc === "object" && "servers" in doc
          ? (doc as { servers: unknown }).servers
          : doc;
      return new StaticResolver(parseServerList(list), path);
    }

    return null;
  }
}

function parseServerList(value: unknown): ResolvedServer[] {
  if (!Array.isArray(value)) {
    throw new Error("Server list must be an array.");
  }
  const seen = new Set<string>();
  return value.map((entry, i) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Server #${i + 1} must be an object.`);
    }
    const raw = entry as RawServer;
    const name = raw.name?.trim();
    if (!name) throw new Error(`Server #${i + 1} is missing a name.`);

    const base = (raw.baseUrl ?? raw.url ?? "").trim();
    if (!base) throw new Error(`Server "${name}" is missing baseUrl.`);

    let baseUrl: string;
    try {
      baseUrl = normalizeBaseUrl(base);
    } catch (err) {
      throw new Error(
        `Server "${name}" has an invalid baseUrl: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    let id = slug(name);
    // Guarantee uniqueness even if two servers share a name.
    if (seen.has(id)) {
      let n = 2;
      while (seen.has(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }
    seen.add(id);

    return {
      id,
      name,
      baseUrl,
      tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
      metricsPath: normalizeMetricsPath(raw.metricsPath),
    };
  });
}
