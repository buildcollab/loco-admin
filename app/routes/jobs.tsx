import { useEffect, useState } from "react";
import {
  Form,
  Link,
  useFetcher,
  useSearchParams,
} from "react-router";
import type { Route } from "./+types/jobs";
import {
  cancelJobs,
  deleteByStatus,
  deleteJobs,
  distinctNames,
  distinctTags,
  getStatusCounts,
  listJobs,
  parseSort,
  requeueAllFailed,
  requeueJobs,
  runNowJobs,
  type JobRow,
  type SortColumn,
} from "~/lib/jobs.server";
import {
  Card,
  StatusBadge,
  Tag,
  buttonClass,
  cn,
  EmptyState,
} from "~/components/ui";
import {
  JOB_STATUSES,
  formatDate,
  formatInterval,
  formatNumber,
  relativeTime,
  statusMeta,
  truncate,
} from "~/lib/format";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Background Jobs · loco-admin" }];
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const sp = url.searchParams;

  const filters = {
    status: sp.get("status") ?? undefined,
    name: sp.get("name") ?? undefined,
    tag: sp.get("tag") ?? undefined,
    q: sp.get("q")?.trim() || undefined,
    page: Math.max(1, Number.parseInt(sp.get("page") ?? "1", 10) || 1),
    pageSize: clamp(Number.parseInt(sp.get("pageSize") ?? "25", 10) || 25, 10, 100),
    sort: parseSort(sp.get("sort")),
    dir: (sp.get("dir") === "asc" ? "asc" : "desc") as "asc" | "desc",
  };

  const [page, names, tags, counts] = await Promise.all([
    listJobs(filters),
    distinctNames(),
    distinctTags(),
    getStatusCounts(),
  ]);

  return { page, names, tags, counts, filters, now: new Date() };
}

export async function action({ request }: Route.ActionArgs) {
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const ids = fd.getAll("ids").map(String).filter(Boolean);

  try {
    switch (intent) {
      case "requeue": {
        const n = await requeueJobs(ids);
        return { ok: true, message: `Requeued ${n} job${n === 1 ? "" : "s"}.` };
      }
      case "cancel": {
        const n = await cancelJobs(ids);
        return { ok: true, message: `Cancelled ${n} job${n === 1 ? "" : "s"}.` };
      }
      case "run-now": {
        const n = await runNowJobs(ids);
        return {
          ok: true,
          message: `Scheduled ${n} job${n === 1 ? "" : "s"} to run now.`,
        };
      }
      case "delete": {
        const n = await deleteJobs(ids);
        return { ok: true, message: `Deleted ${n} job${n === 1 ? "" : "s"}.` };
      }
      case "requeue-all-failed": {
        const n = await requeueAllFailed();
        return {
          ok: true,
          message: `Requeued ${n} failed job${n === 1 ? "" : "s"}.`,
        };
      }
      case "purge-status": {
        const status = String(fd.get("status") ?? "");
        const n = await deleteByStatus(status);
        return {
          ok: true,
          message: `Purged ${n} ${status} job${n === 1 ? "" : "s"}.`,
        };
      }
      default:
        return { ok: false, message: `Unknown action: ${intent}` };
    }
  } catch (err) {
    // Re-throw Response (e.g. DB down → 503) so the error boundary handles it.
    if (err instanceof Response) throw err;
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Action failed.",
    };
  }
}

export default function Jobs({ loaderData }: Route.ComponentProps) {
  const { page, names, tags, counts, filters, now } = loaderData;
  const [searchParams] = useSearchParams();
  const nowMs = new Date(now).getTime();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Drop selections for rows that are no longer on the page after revalidation.
  useEffect(() => {
    const present = new Set(page.rows.map((r) => r.id));
    setSelected((prev) => {
      const next = new Set<string>();
      for (const id of prev) if (present.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [page.rows]);

  function withParam(overrides: Record<string, string | null>): string {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return `?${next.toString()}`;
  }

  const allOnPageSelected =
    page.rows.length > 0 && page.rows.every((r) => selected.has(r.id));

  function toggleAll() {
    setSelected((prev) => {
      if (allOnPageSelected) return new Set();
      return new Set(page.rows.map((r) => r.id));
    });
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
            Background Jobs
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {formatNumber(page.total)} job{page.total === 1 ? "" : "s"} match ·
            table <code className="text-xs">pg_loco_queue</code>
          </p>
        </div>
        <MaintenanceMenu counts={counts.byStatus} />
      </header>

      <StatusTabs
        counts={counts}
        current={filters.status ?? null}
        withParam={withParam}
      />

      <FilterBar names={names} tags={tags} filters={filters} />

      {selected.size > 0 ? (
        <BulkBar ids={[...selected]} onClear={() => setSelected(new Set())} />
      ) : null}

      <Card className="overflow-hidden">
        {page.rows.length === 0 ? (
          <EmptyState
            title="No jobs match these filters"
            description="Try clearing the status or search filters, or check that the Loco app has enqueued jobs."
          />
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
                      checked={allOnPageSelected}
                      onChange={toggleAll}
                      aria-label="Select all on page"
                    />
                  </th>
                  <SortHeader label="Job" column="name" filters={filters} withParam={withParam} />
                  <th className="px-3 py-2.5">Status</th>
                  <SortHeader label="Run at" column="run_at" filters={filters} withParam={withParam} />
                  <SortHeader label="Created" column="created_at" filters={filters} withParam={withParam} />
                  <th className="px-3 py-2.5">Tags</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {page.rows.map((job) => (
                  <JobTableRow
                    key={job.id}
                    job={job}
                    nowMs={nowMs}
                    selected={selected.has(job.id)}
                    onToggle={() => toggleOne(job.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Pagination page={page} withParam={withParam} />
    </div>
  );
}

/* ------------------------------------------------------------- status tabs */

function StatusTabs({
  counts,
  current,
  withParam,
}: {
  counts: Route.ComponentProps["loaderData"]["counts"];
  current: string | null;
  withParam: (o: Record<string, string | null>) => string;
}) {
  const tabs: { key: string | null; label: string; count: number }[] = [
    { key: null, label: "All", count: counts.total },
    ...JOB_STATUSES.map((s) => ({
      key: s,
      label: statusMeta(s).label,
      count: counts.byStatus[s] ?? 0,
    })),
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {tabs.map((t) => {
        const active = (current ?? null) === t.key;
        return (
          <Link
            key={t.key ?? "all"}
            to={withParam({ status: t.key, page: "1" })}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium transition",
              active
                ? "bg-brand-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
            )}
          >
            {t.label}
            <span
              className={cn(
                "tabular rounded-full px-1.5 text-xs",
                active
                  ? "bg-white/20"
                  : "bg-white text-slate-500 dark:bg-slate-900 dark:text-slate-400",
              )}
            >
              {formatNumber(t.count)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- filter bar */

function FilterBar({
  names,
  tags,
  filters,
}: {
  names: string[];
  tags: string[];
  filters: Route.ComponentProps["loaderData"]["filters"];
}) {
  return (
    <Form method="get" className="flex flex-wrap items-end gap-3">
      {/* Preserve status/sort/dir across a filter change. */}
      {filters.status ? (
        <input type="hidden" name="status" value={filters.status} />
      ) : null}
      <input type="hidden" name="sort" value={filters.sort} />
      <input type="hidden" name="dir" value={filters.dir} />

      <label className="flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
        Search
        <input
          type="search"
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder="id or name…"
          className="w-56 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
        Job name
        <select
          name="name"
          defaultValue={filters.name ?? ""}
          className="w-48 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="">All jobs</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
        Tag
        <select
          name="tag"
          defaultValue={filters.tag ?? ""}
          className="w-40 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="">Any tag</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
        Per page
        <select
          name="pageSize"
          defaultValue={String(filters.pageSize)}
          className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2">
        <button type="submit" className={buttonClass("primary")}>
          Apply
        </button>
        <Link to="/jobs" className={buttonClass("ghost")}>
          Reset
        </Link>
      </div>
    </Form>
  );
}

/* ------------------------------------------------------------- sort headers */

function SortHeader({
  label,
  column,
  filters,
  withParam,
}: {
  label: string;
  column: SortColumn;
  filters: Route.ComponentProps["loaderData"]["filters"];
  withParam: (o: Record<string, string | null>) => string;
}) {
  const active = filters.sort === column;
  const nextDir = active && filters.dir === "desc" ? "asc" : "desc";
  return (
    <th className="px-3 py-2.5">
      <Link
        to={withParam({ sort: column, dir: nextDir, page: "1" })}
        className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200"
      >
        {label}
        <span className={cn("text-[10px]", active ? "opacity-100" : "opacity-30")}>
          {active ? (filters.dir === "asc" ? "▲" : "▼") : "▼"}
        </span>
      </Link>
    </th>
  );
}

/* ---------------------------------------------------------------- table row */

function JobTableRow({
  job,
  nowMs,
  selected,
  onToggle,
}: {
  job: JobRow;
  nowMs: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const interval = formatInterval(job.interval);
  return (
    <tr
      className={cn(
        "align-top transition hover:bg-slate-50 dark:hover:bg-slate-800/40",
        selected && "bg-brand-50/60 dark:bg-brand-600/10",
      )}
    >
      <td className="px-3 py-3">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select job ${job.id}`}
        />
      </td>
      <td className="px-3 py-3">
        <Link
          to={`/jobs/${encodeURIComponent(job.id)}`}
          className="font-medium text-brand-700 hover:underline dark:text-brand-300"
        >
          {job.name}
        </Link>
        <div className="mt-0.5 font-mono text-[11px] text-slate-400">
          {truncate(job.id, 26)}
        </div>
      </td>
      <td className="px-3 py-3">
        <StatusBadge status={job.status} />
        {interval ? (
          <div className="mt-1 text-[11px] text-slate-400">every {interval}</div>
        ) : null}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <div className="text-slate-700 dark:text-slate-200">
          {relativeTime(job.run_at, nowMs)}
        </div>
        <div className="text-[11px] text-slate-400">{formatDate(job.run_at)}</div>
      </td>
      <td className="px-3 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400">
        {relativeTime(job.created_at, nowMs)}
      </td>
      <td className="px-3 py-3">
        <div className="flex max-w-[180px] flex-wrap gap-1">
          {job.tags.length === 0 ? (
            <span className="text-slate-300 dark:text-slate-600">—</span>
          ) : (
            job.tags.map((t) => <Tag key={t}>{t}</Tag>)
          )}
        </div>
      </td>
      <td className="px-3 py-3">
        <RowActions job={job} />
      </td>
    </tr>
  );
}

function RowActions({ job }: { job: JobRow }) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const canCancel = job.status === "queued" || job.status === "processing";
  const canRequeue = job.status === "failed" || job.status === "cancelled";

  function submit(intent: string) {
    fetcher.submit({ intent, ids: job.id }, { method: "post" });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {canRequeue ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => submit("requeue")}
          className={buttonClass("ghost", "px-2 py-1 text-xs")}
          title="Requeue this job"
        >
          Requeue
        </button>
      ) : null}
      {canCancel ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => submit("cancel")}
          className={buttonClass("ghost", "px-2 py-1 text-xs")}
          title="Cancel this job"
        >
          Cancel
        </button>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (confirm(`Delete job ${job.id}? This cannot be undone.`))
            submit("delete");
        }}
        className={buttonClass("ghost", "px-2 py-1 text-xs text-rose-600 dark:text-rose-400")}
        title="Delete this job"
      >
        Delete
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- bulk bar */

function BulkBar({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onClear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  function submit(intent: string, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    const fd = new FormData();
    fd.set("intent", intent);
    for (const id of ids) fd.append("ids", id);
    fetcher.submit(fd, { method: "post" });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 dark:border-brand-500/30 dark:bg-brand-600/10">
      <span className="text-sm font-medium text-brand-800 dark:text-brand-200">
        {ids.length} selected
      </span>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => submit("requeue")} className={buttonClass("secondary", "text-xs")}>
          Requeue
        </button>
        <button type="button" disabled={busy} onClick={() => submit("run-now")} className={buttonClass("secondary", "text-xs")}>
          Run now
        </button>
        <button type="button" disabled={busy} onClick={() => submit("cancel")} className={buttonClass("secondary", "text-xs")}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => submit("delete", `Delete ${ids.length} job(s)? This cannot be undone.`)}
          className={buttonClass("danger", "text-xs")}
        >
          Delete
        </button>
      </div>
      <button type="button" onClick={onClear} className={buttonClass("ghost", "ml-auto text-xs")}>
        Clear
      </button>
      {fetcher.data?.message ? (
        <span className="w-full text-xs text-brand-700 dark:text-brand-300">
          {fetcher.data.message}
        </span>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- maintenance */

function MaintenanceMenu({ counts }: { counts: Record<string, number> }) {
  const fetcher = useFetcher<typeof action>();
  const [open, setOpen] = useState(false);
  const busy = fetcher.state !== "idle";
  const failed = counts.failed ?? 0;
  const completed = counts.completed ?? 0;
  const cancelled = counts.cancelled ?? 0;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={buttonClass("secondary")}
      >
        Maintenance
        <span className="text-xs opacity-60">▾</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-10 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-2 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <MaintItem
            label={`Requeue all failed (${failed})`}
            disabled={busy || failed === 0}
            onClick={() =>
              fetcher.submit({ intent: "requeue-all-failed" }, { method: "post" })
            }
          />
          <MaintItem
            label={`Purge completed (${completed})`}
            disabled={busy || completed === 0}
            danger
            onClick={() => {
              if (confirm(`Delete all ${completed} completed jobs?`))
                fetcher.submit(
                  { intent: "purge-status", status: "completed" },
                  { method: "post" },
                );
            }}
          />
          <MaintItem
            label={`Purge cancelled (${cancelled})`}
            disabled={busy || cancelled === 0}
            danger
            onClick={() => {
              if (confirm(`Delete all ${cancelled} cancelled jobs?`))
                fetcher.submit(
                  { intent: "purge-status", status: "cancelled" },
                  { method: "post" },
                );
            }}
          />
          {fetcher.data?.message ? (
            <p className="px-2 pt-1 text-xs text-slate-500 dark:text-slate-400">
              {fetcher.data.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MaintItem({
  label,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center rounded-lg px-2 py-1.5 text-left transition disabled:opacity-40",
        danger
          ? "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
          : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
      )}
    >
      {label}
    </button>
  );
}

/* --------------------------------------------------------------- pagination */

function Pagination({
  page,
  withParam,
}: {
  page: Route.ComponentProps["loaderData"]["page"];
  withParam: (o: Record<string, string | null>) => string;
}) {
  if (page.pageCount <= 1) return null;
  const start = (page.page - 1) * page.pageSize + 1;
  const end = Math.min(page.total, page.page * page.pageSize);
  return (
    <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
      <span>
        {formatNumber(start)}–{formatNumber(end)} of {formatNumber(page.total)}
      </span>
      <div className="flex items-center gap-2">
        {page.page > 1 ? (
          <Link
            to={withParam({ page: String(page.page - 1) })}
            className={buttonClass("secondary", "text-xs")}
          >
            ← Prev
          </Link>
        ) : (
          <span className={buttonClass("secondary", "pointer-events-none text-xs opacity-40")}>
            ← Prev
          </span>
        )}
        <span className="tabular">
          Page {page.page} / {page.pageCount}
        </span>
        {page.page < page.pageCount ? (
          <Link
            to={withParam({ page: String(page.page + 1) })}
            className={buttonClass("secondary", "text-xs")}
          >
            Next →
          </Link>
        ) : (
          <span className={buttonClass("secondary", "pointer-events-none text-xs opacity-40")}>
            Next →
          </span>
        )}
      </div>
    </div>
  );
}
