import { useState } from "react";
import { useRevalidator } from "react-router";
import type { Route } from "./+types/servers";
import { resolveServers } from "~/lib/servers/registry.server";
import {
  collectAll,
  metricsTimeoutMs,
  type ProbeResult,
  type ServerMetrics,
  type ServerStatus,
} from "~/lib/metrics/collect.server";
import type { PromFamily } from "~/lib/metrics/prometheus";
import {
  Alert,
  Card,
  CardHeader,
  StatTile,
  Tag,
  EmptyState,
  buttonClass,
  cn,
} from "~/components/ui";
import { formatDate, formatNumber, relativeTime } from "~/lib/format";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Servers · loco-admin" }];
}

export async function loader(_: Route.LoaderArgs) {
  let resolved;
  try {
    resolved = await resolveServers();
  } catch (err) {
    return {
      configError: err instanceof Error ? err.message : "Invalid server config",
      servers: [],
      resolvers: [],
      metrics: [] as ServerMetrics[],
      now: new Date(),
    };
  }

  const metrics = await collectAll(resolved.servers, metricsTimeoutMs());
  return {
    configError: null as string | null,
    servers: resolved.servers,
    resolvers: resolved.resolvers,
    metrics,
    now: new Date(),
  };
}

const STATUS_META: Record<
  ServerStatus,
  { label: string; badge: string; dot: string }
> = {
  up: {
    label: "Up",
    badge:
      "bg-emerald-100 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20",
    dot: "bg-emerald-500",
  },
  degraded: {
    label: "Degraded",
    badge:
      "bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20",
    dot: "bg-amber-500",
  },
  down: {
    label: "Down",
    badge:
      "bg-rose-100 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20",
    dot: "bg-rose-500",
  },
};

export default function Servers({ loaderData }: Route.ComponentProps) {
  const { configError, servers, resolvers, metrics, now } = loaderData;
  const revalidator = useRevalidator();
  const refreshing = revalidator.state !== "idle";
  const nowMs = new Date(now).getTime();

  const counts = {
    up: metrics.filter((m) => m.status === "up").length,
    degraded: metrics.filter((m) => m.status === "degraded").length,
    down: metrics.filter((m) => m.status === "down").length,
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
            Servers
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Health &amp; metrics from configured Loco servers
            {resolvers.length > 0 ? (
              <>
                {" · "}
                {resolvers.map((r, i) => (
                  <span key={r.kind}>
                    {i > 0 ? ", " : ""}
                    <code className="text-xs">{r.label}</code> ({r.count})
                  </span>
                ))}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            Updated {relativeTime(now, Date.now())}
          </span>
          <button
            type="button"
            onClick={() => revalidator.revalidate()}
            disabled={refreshing}
            className={buttonClass("secondary")}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {configError ? (
        <Alert tone="error" title="Server configuration error">
          <span className="font-mono text-xs">{configError}</span>
        </Alert>
      ) : null}

      {resolvers
        .filter((r) => r.error)
        .map((r) => (
          <Alert key={r.kind} tone="warning" title={`${r.label} failed to resolve`}>
            <span className="font-mono text-xs">{r.error}</span>
          </Alert>
        ))}

      {resolvers.length === 0 && !configError ? (
        <Card>
          <EmptyState
            title="No servers configured"
            description={
              <>
                Add servers with the <code>LOCO_SERVERS</code> environment
                variable (inline JSON) or point <code>LOCO_SERVERS_FILE</code> at
                a JSON/YAML file. More resolvers (Kubernetes, service registries)
                can be added later.
              </>
            }
          >
            <pre className="scroll-x mt-2 max-w-2xl rounded-lg bg-slate-950 p-4 text-left font-mono text-xs text-slate-200">
{`LOCO_SERVERS='[
  {"name":"web-1","baseUrl":"http://10.0.0.4:5150","tags":["prod"]},
  {"name":"worker-1","baseUrl":"http://10.0.0.5:5150","metricsPath":"/metrics"}
]'`}
            </pre>
          </EmptyState>
        </Card>
      ) : null}

      {servers.length > 0 ? (
        <>
          <section className="grid grid-cols-3 gap-3 sm:max-w-md">
            <StatTile label="Up" value={counts.up} accent={STATUS_META.up.dot} />
            <StatTile
              label="Degraded"
              value={counts.degraded}
              accent={STATUS_META.degraded.dot}
            />
            <StatTile
              label="Down"
              value={counts.down}
              accent={STATUS_META.down.dot}
            />
          </section>

          <div className="grid gap-4">
            {metrics.map((m) => (
              <ServerCard key={m.server.id} metrics={m} nowMs={nowMs} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function ServerStatusBadge({ status }: { status: ServerStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        meta.badge,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

function ServerCard({
  metrics,
  nowMs,
}: {
  metrics: ServerMetrics;
  nowMs: number;
}) {
  const { server } = metrics;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {server.name}
            <ServerStatusBadge status={metrics.status} />
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {server.source}
            </span>
            {server.tags.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </span>
        }
        subtitle={
          <span className="font-mono text-xs">{server.baseUrl}</span>
        }
        actions={
          metrics.latencyMs != null ? (
            <span className="tabular text-xs text-slate-500 dark:text-slate-400">
              {metrics.latencyMs} ms
            </span>
          ) : null
        }
      />
      <div className="space-y-4 p-4">
        <div className="grid gap-2 sm:grid-cols-3">
          {metrics.probes.map((p) => (
            <ProbeCell key={p.key} probe={p} />
          ))}
        </div>

        {metrics.prometheus ? (
          <MetricsPanel prometheus={metrics.prometheus} />
        ) : (
          <p className="text-xs text-slate-400">
            No <code>metricsPath</code> configured for this server — showing
            health probes only.
          </p>
        )}

        <p className="text-[11px] text-slate-400">
          Collected {formatDate(metrics.collectedAt)} ·{" "}
          {relativeTime(metrics.collectedAt, nowMs)}
        </p>
      </div>
    </Card>
  );
}

function ProbeCell({ probe }: { probe: ProbeResult }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-lg border px-3 py-2 text-sm",
        probe.ok
          ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/20 dark:bg-emerald-500/5"
          : "border-rose-200 bg-rose-50/60 dark:border-rose-500/20 dark:bg-rose-500/5",
      )}
    >
      <div>
        <div className="font-mono text-xs text-slate-600 dark:text-slate-300">
          {probe.path}
        </div>
        {probe.error ? (
          <div className="text-[11px] text-rose-500">{probe.error}</div>
        ) : (
          <div className="text-[11px] text-slate-400">
            {probe.status ? `HTTP ${probe.status}` : "no response"}
            {probe.latencyMs != null ? ` · ${probe.latencyMs} ms` : ""}
          </div>
        )}
      </div>
      <span
        className={cn(
          "text-lg",
          probe.ok
            ? "text-emerald-500"
            : "text-rose-500",
        )}
        aria-label={probe.ok ? "ok" : "failing"}
      >
        {probe.ok ? "✓" : "✗"}
      </span>
    </div>
  );
}

function formatMetricValue(v: number): string {
  if (Number.isNaN(v)) return "NaN";
  if (v === Number.POSITIVE_INFINITY) return "+Inf";
  if (v === Number.NEGATIVE_INFINITY) return "-Inf";
  if (Number.isInteger(v)) return formatNumber(v);
  // Keep a few significant digits without noise.
  return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function seriesLabel(name: string, labels: Record<string, string>): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) return name;
  const inner = keys.map((k) => `${k}="${labels[k]}"`).join(", ");
  return `${name}{${inner}}`;
}

function MetricsPanel({
  prometheus,
}: {
  prometheus: NonNullable<ServerMetrics["prometheus"]>;
}) {
  const [filter, setFilter] = useState("");

  if (!prometheus.ok) {
    return (
      <Alert tone="warning" title="Could not scrape metrics">
        <span className="font-mono text-xs">
          {prometheus.path}
          {prometheus.error ? ` — ${prometheus.error}` : ""}
        </span>
      </Alert>
    );
  }

  const q = filter.trim().toLowerCase();
  const families = q
    ? prometheus.families.filter((f) => f.name.toLowerCase().includes(q))
    : prometheus.families;

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {formatNumber(prometheus.families.length)} metric families ·{" "}
          {formatNumber(prometheus.sampleCount)} samples ·{" "}
          <code>{prometheus.path}</code>
        </span>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter metrics…"
          className="w-44 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </div>
      <div className="max-h-96 divide-y divide-slate-100 overflow-auto dark:divide-slate-800">
        {families.length === 0 ? (
          <p className="px-3 py-4 text-xs text-slate-400">
            No metric families match “{filter}”.
          </p>
        ) : (
          families.map((f) => <MetricFamily key={f.name} family={f} />)
        )}
      </div>
    </div>
  );
}

function MetricFamily({ family }: { family: PromFamily }) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
          {family.name}
        </span>
        {family.type ? (
          <span className="text-[10px] uppercase text-slate-400">
            {family.type}
          </span>
        ) : null}
      </div>
      {family.help ? (
        <p className="mt-0.5 text-[11px] text-slate-400">{family.help}</p>
      ) : null}
      <div className="mt-1 space-y-0.5">
        {family.samples.map((s, i) => (
          <div
            key={i}
            className="scroll-x flex items-baseline justify-between gap-4 font-mono text-[11px]"
          >
            <span className="truncate text-slate-500 dark:text-slate-400">
              {seriesLabel(family.name, s.labels)}
            </span>
            <span className="tabular shrink-0 text-slate-700 dark:text-slate-200">
              {formatMetricValue(s.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
