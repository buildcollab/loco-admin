import { Link } from "react-router";
import type { Route } from "./+types/home";
import {
  getRecentThroughput,
  getStatusCounts,
} from "~/lib/jobs.server";
import { loadSchedulerConfig } from "~/lib/scheduler.server";
import { resolveServers } from "~/lib/servers/registry.server";
import { metricsTimeoutMs, probeAll } from "~/lib/metrics/collect.server";
import { targetLabel } from "~/lib/env.server";
import {
  Alert,
  Card,
  CardHeader,
  StatTile,
  buttonClass,
  cn,
} from "~/components/ui";
import {
  JOB_STATUSES,
  formatNumber,
  relativeTime,
  statusMeta,
} from "~/lib/format";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Overview · loco-admin" }];
}

/** Resilient fleet health for the Overview tile — never throws. */
async function overviewFleet() {
  try {
    const { servers, resolvers } = await resolveServers();
    if (resolvers.length === 0) {
      return { configured: false, total: 0, up: 0, degraded: 0, down: 0 };
    }
    // Keep the dashboard snappy even if a server is unreachable.
    const members = await probeAll(servers, Math.min(metricsTimeoutMs(), 2500));
    return {
      configured: true,
      total: servers.length,
      up: members.filter((m) => m.status === "up").length,
      degraded: members.filter((m) => m.status === "degraded").length,
      down: members.filter((m) => m.status === "down").length,
    };
  } catch {
    return { configured: false, total: 0, up: 0, degraded: 0, down: 0 };
  }
}

export async function loader(_: Route.LoaderArgs) {
  const now = new Date();
  const [counts, throughput, scheduler, fleet] = await Promise.all([
    getStatusCounts(),
    getRecentThroughput(),
    loadSchedulerConfig(now),
    overviewFleet(),
  ]);

  // Roll the sparse hourly data into a dense 24-slot series on the server so the
  // chart renders identically on server and client (no Date use in the view).
  const buckets: { label: string; completed: number; failed: number }[] = [];
  const byHour = new Map(
    throughput.map((b) => [new Date(b.hour).getUTCHours(), b]),
  );
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600_000);
    const key = d.getUTCHours();
    const found = byHour.get(key);
    buckets.push({
      label: `${String(d.getHours()).padStart(2, "0")}:00`,
      completed: found?.completed ?? 0,
      failed: found?.failed ?? 0,
    });
  }

  return {
    counts,
    buckets,
    scheduler: {
      exists: scheduler.exists,
      jobCount: scheduler.jobs.length,
      nextJob: scheduler.jobs[0]
        ? {
            name: scheduler.jobs[0].name,
            nextRun: scheduler.jobs[0].nextRuns[0] ?? null,
          }
        : null,
    },
    fleet,
    target: targetLabel(),
    generatedAt: now,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { counts, buckets, scheduler, fleet, target, generatedAt } = loaderData;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
            Overview
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {target ? (
              <>
                Connected to{" "}
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {target}
                </span>{" "}
                ·{" "}
              </>
            ) : null}
            {formatNumber(counts.total)} jobs in the queue
          </p>
        </div>
        <Link to="/jobs" className={buttonClass("primary")}>
          Manage jobs
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile
          label="Due now"
          value={formatNumber(counts.dueNow)}
          accent="bg-brand-500"
          hint="queued & run_at ≤ now"
        />
        {JOB_STATUSES.map((s) => (
          <StatTile
            key={s}
            label={statusMeta(s).label}
            value={formatNumber(counts.byStatus[s] ?? 0)}
            accent={statusMeta(s).dot}
          />
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Throughput (last 24h)"
            subtitle="Completed vs failed jobs, by hour"
          />
          <div className="p-4">
            {counts.byStatus.completed || counts.byStatus.failed ? (
              <ThroughputChart buckets={buckets} />
            ) : (
              <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                No completed or failed jobs recorded in the last 24 hours.
              </p>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          {fleet.configured ? <FleetCard fleet={fleet} /> : null}
          <Card>
          <CardHeader title="Scheduler" subtitle="From scheduler.yaml" />
          <div className="space-y-4 p-4">
            {scheduler.exists ? (
              <>
                <StatTile
                  label="Scheduled jobs"
                  value={formatNumber(scheduler.jobCount)}
                />
                {scheduler.nextJob ? (
                  <div className="text-sm">
                    <div className="text-slate-500 dark:text-slate-400">
                      Next up
                    </div>
                    <div className="mt-0.5 font-medium text-slate-800 dark:text-slate-100">
                      {scheduler.nextJob.name}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">
                      {scheduler.nextJob.nextRun
                        ? relativeTime(scheduler.nextJob.nextRun, generatedAt.getTime())
                        : "schedule not evaluable"}
                    </div>
                  </div>
                ) : null}
                <Link
                  to="/scheduler"
                  className={buttonClass("secondary", "w-full")}
                >
                  Open scheduler
                </Link>
              </>
            ) : (
              <Alert tone="info" title="No scheduler config found">
                Point <code>SCHEDULER_CONFIG_PATH</code> at your Loco{" "}
                <code>scheduler.yaml</code> to see scheduled jobs here.
              </Alert>
            )}
          </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function FleetCard({
  fleet,
}: {
  fleet: { total: number; up: number; degraded: number; down: number };
}) {
  const rows: { label: string; value: number; dot: string }[] = [
    { label: "Up", value: fleet.up, dot: "bg-emerald-500" },
    { label: "Degraded", value: fleet.degraded, dot: "bg-amber-500" },
    { label: "Down", value: fleet.down, dot: "bg-rose-500" },
  ];
  return (
    <Card>
      <CardHeader
        title="Fleet"
        subtitle="Loco servers"
        actions={
          <Link
            to="/servers"
            className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
          >
            View
          </Link>
        }
      />
      <div className="p-4">
        <div className="flex items-end justify-between">
          <span className="text-2xl font-semibold tabular text-slate-900 dark:text-slate-50">
            {formatNumber(fleet.total)}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            server{fleet.total === 1 ? "" : "s"}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {rows.map((r) => (
            <div
              key={r.label}
              className="rounded-lg bg-slate-50 px-2 py-1.5 text-center dark:bg-slate-800/60"
            >
              <div className="flex items-center justify-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 rounded-full", r.dot)} />
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {r.label}
                </span>
              </div>
              <div className="tabular mt-0.5 text-lg font-semibold text-slate-800 dark:text-slate-100">
                {formatNumber(r.value)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function ThroughputChart({
  buckets,
}: {
  buckets: { label: string; completed: number; failed: number }[];
}) {
  const max = Math.max(1, ...buckets.map((b) => b.completed + b.failed));
  return (
    <div>
      <div className="flex h-40 items-end gap-1">
        {buckets.map((b, i) => {
          const total = b.completed + b.failed;
          const h = (total / max) * 100;
          const failedShare = total > 0 ? (b.failed / total) * 100 : 0;
          return (
            <div
              key={i}
              className="group relative flex h-full flex-1 flex-col justify-end"
              title={`${b.label} — ${b.completed} completed, ${b.failed} failed`}
            >
              <div
                className="w-full overflow-hidden rounded-t bg-emerald-400/80 dark:bg-emerald-500/60"
                style={{ height: `${Math.max(h, total > 0 ? 4 : 0)}%` }}
              >
                <div
                  className="w-full bg-rose-400/90 dark:bg-rose-500/70"
                  style={{ height: `${failedShare}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
        <span>{buckets[0]?.label}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> completed
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-rose-400" /> failed
          </span>
        </span>
        <span>{buckets[buckets.length - 1]?.label}</span>
      </div>
    </div>
  );
}
