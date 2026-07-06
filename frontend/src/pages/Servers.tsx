import { useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { api, type PromFamily, type ServerMetrics, type ServersData } from "../api";
import { Alert, Card, Empty, Tag, cx } from "../ui";
import { formatDuration, formatMetricValue, formatNumber } from "../format";

export async function serversLoader(): Promise<ServersData> {
  return api.servers();
}

export function Servers() {
  const data = useLoaderData() as ServersData;
  const revalidator = useRevalidator();
  const counts = {
    up: data.servers.filter((s) => s.status === "up").length,
    degraded: data.servers.filter((s) => s.status === "degraded").length,
    down: data.servers.filter((s) => s.status === "down").length,
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Servers</h1>
          <div className="subtitle">Health &amp; metrics from configured Loco servers</div>
        </div>
        <button className="btn" disabled={revalidator.state !== "idle"} onClick={() => revalidator.revalidate()}>
          {revalidator.state !== "idle" ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {data.resolver_error ? <Alert tone="err" title="Server configuration error">{data.resolver_error}</Alert> : null}

      {!data.configured ? (
        <Card>
          <Empty title="No servers configured">
            <div className="muted">Set <code>LOCO_SERVERS</code> (inline JSON) or <code>LOCO_SERVERS_FILE</code>.</div>
            <pre className="pre" style={{ marginTop: 12, textAlign: "left", maxWidth: 560, marginInline: "auto" }}>{`LOCO_SERVERS='[
  {"name":"web-1","base_url":"http://10.0.0.4:5150","tags":["prod"]}
]'`}</pre>
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))", maxWidth: 420 }}>
            <div className="tile"><div className="label"><span className="dot d-up" />Up</div><div className="value tabular">{counts.up}</div></div>
            <div className="tile"><div className="label"><span className="dot d-degraded" />Degraded</div><div className="value tabular">{counts.degraded}</div></div>
            <div className="tile"><div className="label"><span className="dot d-down" />Down</div><div className="value tabular">{counts.down}</div></div>
          </div>
          <div className="stack">
            {data.servers.map((s) => <ServerCard key={s.server.id} m={s} />)}
          </div>
        </>
      )}
    </div>
  );
}

function ServerCard({ m }: { m: ServerMetrics }) {
  const info = m.server_info.info as
    | { name?: string; version?: string; environment?: string; build?: Record<string, string>; routes?: { methods: string[]; uri: string }[] }
    | null;
  return (
    <Card
      title={
        <span className="row">
          {m.server.name}
          <span className={cx("badge", `s-${m.status}`)}><span className={cx("dot", `d-${m.status}`)} />{m.status.charAt(0).toUpperCase() + m.status.slice(1)}</span>
          <span className="pill">{m.server.source}</span>
          {m.server.tags.map((t) => <Tag key={t}>{t}</Tag>)}
        </span>
      }
      subtitle={<span className="mono">{m.server.base_url}</span>}
      actions={
        <span className="faint tabular" style={{ fontSize: 12 }}>
          {m.uptime_seconds != null ? `up ${formatDuration(m.uptime_seconds)} · ` : ""}
          {m.latency_ms != null ? `${m.latency_ms} ms` : ""}
        </span>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          {m.probes.map((p) => (
            <div key={p.key} className="between" style={{ border: "1px solid var(--border)", borderRadius: 9, padding: "8px 11px" }}>
              <div>
                <div className="mono" style={{ fontSize: 12 }}>{p.path}</div>
                <div className="faint" style={{ fontSize: 11 }}>{p.error ? p.error : `${p.status ? `HTTP ${p.status}` : "no response"}${p.latency_ms != null ? ` · ${p.latency_ms} ms` : ""}`}</div>
              </div>
              <span style={{ color: p.ok ? "var(--ok)" : "var(--err)", fontSize: 16 }}>{p.ok ? "✓" : "✗"}</span>
            </div>
          ))}
        </div>

        {info ? (
          <div style={{ border: "1px solid var(--border)", borderRadius: 9, padding: "10px 12px" }}>
            <div className="row" style={{ marginBottom: 6 }}>
              <strong>{info.name}</strong>
              <span className="tag">v{info.version}</span>
              <span className="pill">{info.environment}</span>
              {info.build?.loco_version ? <span className="faint" style={{ fontSize: 12 }}>loco {info.build.loco_version}</span> : null}
            </div>
            {info.build ? (
              <div className="faint mono" style={{ fontSize: 11 }}>
                {info.build.rustc_version ? `rustc ${info.build.rustc_version} · ` : ""}
                {info.build.profile ?? ""} {info.build.target ? `· ${info.build.target}` : ""}
              </div>
            ) : null}
            {info.routes?.length ? (
              <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>{formatNumber(info.routes.length)} routes registered</div>
            ) : null}
          </div>
        ) : m.server_info.not_found ? (
          <div className="faint" style={{ fontSize: 12 }}>No <code>/_server</code> endpoint (server predates the fork).</div>
        ) : null}

        {m.metrics.ok ? (
          <MetricsPanel families={m.metrics.families} sampleCount={m.metrics.sample_count} path={m.metrics.path} />
        ) : m.metrics.not_found ? (
          <div className="faint" style={{ fontSize: 12 }}>No metrics endpoint (<code>{m.metrics.path}</code>).</div>
        ) : (
          <Alert tone="warn" title="Could not scrape metrics">{m.metrics.path}{m.metrics.error ? ` — ${m.metrics.error}` : ""}</Alert>
        )}
      </div>
    </Card>
  );
}

function MetricsPanel({ families, sampleCount, path }: { families: PromFamily[]; sampleCount: number; path: string }) {
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  const shown = q ? families.filter((f) => f.name.toLowerCase().includes(q)) : families;
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 9 }}>
      <div className="between" style={{ padding: "8px 11px", borderBottom: "1px solid var(--border)" }}>
        <span className="faint" style={{ fontSize: 12 }}>{formatNumber(families.length)} families · {formatNumber(sampleCount)} samples · <code>{path}</code></span>
        <input type="search" placeholder="filter metrics…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 170, padding: "4px 8px", fontSize: 12 }} />
      </div>
      <div style={{ maxHeight: 340, overflow: "auto" }}>
        {shown.length === 0 ? (
          <div className="faint" style={{ padding: 12, fontSize: 12 }}>No families match “{filter}”.</div>
        ) : shown.map((f) => (
          <div key={f.name} style={{ padding: "8px 11px", borderBottom: "1px solid var(--border)" }}>
            <div className="row"><span className="mono" style={{ fontWeight: 600, fontSize: 12 }}>{f.name}</span>{f.type ? <span className="faint" style={{ fontSize: 10, textTransform: "uppercase" }}>{f.type}</span> : null}</div>
            {f.help ? <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>{f.help}</div> : null}
            <div style={{ marginTop: 3 }}>
              {f.samples.map((s, i) => (
                <div key={i} className="between mono" style={{ fontSize: 11 }}>
                  <span className="faint">{seriesLabel(f.name, s.labels)}</span>
                  <span className="tabular">{formatMetricValue(s.value)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function seriesLabel(name: string, labels: Record<string, string>): string {
  const keys = Object.keys(labels);
  if (!keys.length) return name;
  return `${name}{${keys.map((k) => `${k}="${labels[k]}"`).join(", ")}}`;
}
