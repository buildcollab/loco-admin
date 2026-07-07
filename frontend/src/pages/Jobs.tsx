import { useEffect, useState } from "react";
import {
  Link,
  useLoaderData,
  useRevalidator,
  useSearchParams,
  type LoaderFunctionArgs,
} from "react-router";
import { api, type Facets, type Job, type JobPage, type JobStats } from "../api";
import { Alert, Card, Empty, StatusBadge, Tag, cx } from "../ui";
import {
  JOB_STATUSES,
  formatDate,
  formatInterval,
  formatNumber,
  relativeTime,
  statusLabel,
  truncate,
} from "../format";

interface Data {
  page: JobPage;
  stats: JobStats;
  facets: Facets;
}

export async function jobsLoader({ request }: LoaderFunctionArgs): Promise<Data> {
  const qs = new URL(request.url).searchParams.toString();
  const [page, stats, facets] = await Promise.all([
    api.jobs(qs),
    api.jobStats(),
    api.facets(),
  ]);
  return { page, stats, facets };
}

export function Jobs() {
  const { page, stats, facets } = useLoaderData() as Data;
  const [sp] = useSearchParams();
  const revalidator = useRevalidator();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const present = new Set(page.rows.map((r) => r.id));
    setSelected((prev) => new Set([...prev].filter((id) => present.has(id))));
  }, [page.rows]);

  const status = sp.get("status");
  const sort = sp.get("sort") ?? "created_at";
  const dir = sp.get("dir") ?? "desc";

  function withParam(over: Record<string, string | null>): string {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(over)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return `?${next.toString()}`;
  }

  async function run(intent: string, ids?: string[], extra?: { status?: string }) {
    const res = await api.action({ intent, ids, ...extra });
    setMsg(res.message);
    setSelected(new Set());
    revalidator.revalidate();
  }

  const allSelected = page.rows.length > 0 && page.rows.every((r) => selected.has(r.id));
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(page.rows.map((r) => r.id)));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  const tabs = [
    { key: null as string | null, label: "All", count: stats.total },
    ...JOB_STATUSES.map((s) => ({ key: s, label: statusLabel(s), count: stats.by_status[s] ?? 0 })),
  ];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Background Jobs</h1>
          <div className="subtitle">
            {formatNumber(page.total)} job{page.total === 1 ? "" : "s"} match · table{" "}
            <code>pg_loco_queue</code>
          </div>
        </div>
        <Maintenance stats={stats} run={run} />
      </div>

      <div className="tabs">
        {tabs.map((t) => (
          <Link
            key={t.key ?? "all"}
            to={withParam({ status: t.key, page: "1" })}
            className={cx((status ?? null) === t.key && "active")}
          >
            {t.label}
            <span className="count tabular">{formatNumber(t.count)}</span>
          </Link>
        ))}
      </div>

      <form method="get" className="toolbar">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />
        <div className="field">
          <label>Search</label>
          <input type="search" name="q" defaultValue={sp.get("q") ?? ""} placeholder="id or name…" style={{ width: 200 }} />
        </div>
        <div className="field">
          <label>Job name</label>
          <select name="name" defaultValue={sp.get("name") ?? ""} style={{ width: 180 }}>
            <option value="">All jobs</option>
            {facets.names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Tag</label>
          <select name="tag" defaultValue={sp.get("tag") ?? ""} style={{ width: 150 }}>
            <option value="">Any tag</option>
            {facets.tags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Per page</label>
          <select name="page_size" defaultValue={sp.get("page_size") ?? "25"} style={{ width: 90 }}>
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <button type="submit" className="btn primary">Apply</button>
        <Link to="/jobs" className="btn ghost">Reset</Link>
      </form>

      {msg ? <Alert tone="info">{msg}</Alert> : null}

      {selected.size > 0 ? (
        <div className="row" style={{ background: "var(--panel-2)", padding: "8px 12px", borderRadius: 10 }}>
          <strong>{selected.size} selected</strong>
          <button className="btn sm" onClick={() => run("requeue", [...selected])}>Requeue</button>
          <button className="btn sm" onClick={() => run("run-now", [...selected])}>Run now</button>
          <button className="btn sm" onClick={() => run("cancel", [...selected])}>Cancel</button>
          <button className="btn sm danger" onClick={() => confirm(`Delete ${selected.size} job(s)?`) && run("delete", [...selected])}>Delete</button>
          <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      ) : null}

      <Card>
        {page.rows.length === 0 ? (
          <Empty title="No jobs match these filters">
            <div className="muted">Try clearing filters, or check the app has enqueued jobs.</div>
          </Empty>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                  </th>
                  <SortTh label="Job" col="name" sort={sort} dir={dir} withParam={withParam} />
                  <th>Status</th>
                  <SortTh label="Run at" col="run_at" sort={sort} dir={dir} withParam={withParam} />
                  <SortTh label="Created" col="created_at" sort={sort} dir={dir} withParam={withParam} />
                  <th>Tags</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((job) => (
                  <Row key={job.id} job={job} selected={selected.has(job.id)} onToggle={() => toggleOne(job.id)} run={run} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {page.page_count > 1 ? (
        <div className="between muted">
          <span>Page {page.page} / {page.page_count}</span>
          <div className="row">
            {page.page > 1 ? <Link className="btn sm" to={withParam({ page: String(page.page - 1) })}>← Prev</Link> : <span className="btn sm" style={{ opacity: 0.4 }}>← Prev</span>}
            {page.page < page.page_count ? <Link className="btn sm" to={withParam({ page: String(page.page + 1) })}>Next →</Link> : <span className="btn sm" style={{ opacity: 0.4 }}>Next →</span>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SortTh({ label, col, sort, dir, withParam }: { label: string; col: string; sort: string; dir: string; withParam: (o: Record<string, string | null>) => string }) {
  const active = sort === col;
  const nextDir = active && dir === "desc" ? "asc" : "desc";
  return (
    <th>
      <Link to={withParam({ sort: col, dir: nextDir, page: "1" })} style={{ color: "inherit" }}>
        {label} <span style={{ opacity: active ? 1 : 0.3 }}>{active ? (dir === "asc" ? "▲" : "▼") : "▼"}</span>
      </Link>
    </th>
  );
}

function Row({ job, selected, onToggle, run }: { job: Job; selected: boolean; onToggle: () => void; run: (i: string, ids?: string[]) => void }) {
  const interval = formatInterval(job.interval);
  const canCancel = job.status === "queued" || job.status === "processing";
  const canRequeue = job.status === "failed" || job.status === "cancelled";
  return (
    <tr style={selected ? { background: "rgba(47,102,246,0.08)" } : undefined}>
      <td><input type="checkbox" checked={selected} onChange={onToggle} /></td>
      <td>
        <Link to={`/jobs/${encodeURIComponent(job.id)}`} style={{ color: "#a9c2ff", fontWeight: 500 }}>{job.name}</Link>
        <div className="mono faint" style={{ fontSize: 11, marginTop: 2 }}>{truncate(job.id)}</div>
      </td>
      <td>
        <StatusBadge status={job.status} />
        {interval ? <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>every {interval}</div> : null}
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        <div>{relativeTime(job.run_at)}</div>
        <div className="faint" style={{ fontSize: 11 }}>{formatDate(job.run_at)}</div>
      </td>
      <td className="muted" style={{ whiteSpace: "nowrap" }}>{relativeTime(job.created_at)}</td>
      <td>
        <div className="row" style={{ maxWidth: 170 }}>
          {job.tags.length ? job.tags.map((t) => <Tag key={t}>{t}</Tag>) : <span className="faint">—</span>}
        </div>
      </td>
      <td>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          {canRequeue ? <button className="btn ghost sm" onClick={() => run("requeue", [job.id])}>Requeue</button> : null}
          {canCancel ? <button className="btn ghost sm" onClick={() => run("cancel", [job.id])}>Cancel</button> : null}
          <button className="btn ghost sm" style={{ color: "#fda4af" }} onClick={() => confirm(`Delete job ${job.id}?`) && run("delete", [job.id])}>Delete</button>
        </div>
      </td>
    </tr>
  );
}

function Maintenance({ stats, run }: { stats: JobStats; run: (i: string, ids?: string[], e?: { status?: string }) => void }) {
  const [open, setOpen] = useState(false);
  const failed = stats.by_status.failed ?? 0;
  const completed = stats.by_status.completed ?? 0;
  const cancelled = stats.by_status.cancelled ?? 0;
  return (
    <div style={{ position: "relative" }}>
      <button className="btn" onClick={() => setOpen((o) => !o)}>Maintenance ▾</button>
      {open ? (
        <div className="card" style={{ position: "absolute", right: 0, top: "110%", zIndex: 10, width: 240, padding: 6 }}>
          <MItem label={`Requeue all failed (${failed})`} disabled={!failed} onClick={() => { run("requeue-all-failed"); setOpen(false); }} />
          <MItem label={`Purge completed (${completed})`} disabled={!completed} danger onClick={() => { confirm(`Delete all ${completed} completed jobs?`) && run("purge-status", undefined, { status: "completed" }); setOpen(false); }} />
          <MItem label={`Purge cancelled (${cancelled})`} disabled={!cancelled} danger onClick={() => { confirm(`Delete all ${cancelled} cancelled jobs?`) && run("purge-status", undefined, { status: "cancelled" }); setOpen(false); }} />
        </div>
      ) : null}
    </div>
  );
}

function MItem({ label, onClick, disabled, danger }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      className="btn ghost"
      style={{ width: "100%", justifyContent: "flex-start", color: danger ? "#fda4af" : undefined }}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
