import { Link, useLoaderData } from "react-router";
import { api, type JobStats, type SchedulerData, type ServersData } from "../api";
import { Alert, Card, Tile } from "../ui";
import { JOB_STATUSES, formatNumber, relativeTime, statusLabel } from "../format";

interface Data {
  stats: JobStats;
  servers: ServersData;
  scheduler: SchedulerData;
}

export async function overviewLoader(): Promise<Data> {
  const [stats, servers, scheduler] = await Promise.all([
    api.jobStats(),
    api.servers().catch(
      () => ({ servers: [], resolver_error: null, configured: false }) as ServersData,
    ),
    api.scheduler().catch(
      () =>
        ({ path: "", exists: false, error: null, jobs: [], recent: [] }) as SchedulerData,
    ),
  ]);
  return { stats, servers, scheduler };
}

const DOT: Record<string, string> = {
  queued: "d-queued",
  processing: "d-processing",
  completed: "d-completed",
  failed: "d-failed",
  cancelled: "d-cancelled",
};

export function Overview() {
  const { stats, servers, scheduler } = useLoaderData() as Data;
  const fleet = {
    total: servers.servers.length,
    up: servers.servers.filter((s) => s.status === "up").length,
    degraded: servers.servers.filter((s) => s.status === "degraded").length,
    down: servers.servers.filter((s) => s.status === "down").length,
  };
  const nextJob = scheduler.jobs[0];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <div className="subtitle">
            {formatNumber(stats.total)} jobs in the queue
          </div>
        </div>
        <Link to="/jobs" className="btn primary">
          Manage jobs
        </Link>
      </div>

      <div className="grid tiles">
        <Tile label="Due now" value={formatNumber(stats.due_now)} dot="d-queued" hint="queued & run_at ≤ now" />
        {JOB_STATUSES.map((s) => (
          <Tile key={s} label={statusLabel(s)} value={formatNumber(stats.by_status[s] ?? 0)} dot={DOT[s]} />
        ))}
      </div>

      <div className="cols-3">
        <Card title="Recurring & queue health" subtitle="From pg_loco_queue">
          <div className="grid tiles">
            <Tile label="Recurring" value={formatNumber(stats.recurring)} hint="interval set" />
            <Tile label="Failed" value={formatNumber(stats.by_status.failed ?? 0)} dot="d-failed" />
            <Tile label="Processing" value={formatNumber(stats.by_status.processing ?? 0)} dot="d-processing" />
          </div>
        </Card>

        <div className="stack">
          {servers.configured ? (
            <Card
              title="Fleet"
              subtitle="Loco servers"
              actions={<Link to="/servers" className="btn ghost sm">View</Link>}
            >
              <div className="between" style={{ marginBottom: 10 }}>
                <span className="value tabular" style={{ fontSize: 26, fontWeight: 600 }}>
                  {formatNumber(fleet.total)}
                </span>
                <span className="muted">server{fleet.total === 1 ? "" : "s"}</span>
              </div>
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                <MiniStat label="Up" value={fleet.up} dot="d-up" />
                <MiniStat label="Degraded" value={fleet.degraded} dot="d-degraded" />
                <MiniStat label="Down" value={fleet.down} dot="d-down" />
              </div>
            </Card>
          ) : null}

          <Card
            title="Scheduler"
            subtitle="From scheduler.yaml"
            actions={<Link to="/scheduler" className="btn ghost sm">Open</Link>}
          >
            {scheduler.exists ? (
              <>
                <Tile label="Scheduled jobs" value={formatNumber(scheduler.jobs.length)} />
                {nextJob ? (
                  <div style={{ marginTop: 12 }}>
                    <div className="faint" style={{ fontSize: 12 }}>Next up</div>
                    <div style={{ fontWeight: 600 }}>{nextJob.name}</div>
                    <div className="muted">
                      {nextJob.next_runs[0] ? relativeTime(nextJob.next_runs[0]) : "not evaluable"}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <Alert tone="info" title="No scheduler config">
                Set <code>SCHEDULER_CONFIG_PATH</code> to your scheduler.yaml.
              </Alert>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div style={{ background: "var(--panel-2)", borderRadius: 9, padding: "8px 6px", textAlign: "center" }}>
      <div className="row" style={{ justifyContent: "center", gap: 6 }}>
        <span className={`dot ${dot}`} />
        <span className="faint" style={{ fontSize: 11 }}>{label}</span>
      </div>
      <div className="tabular" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>
        {formatNumber(value)}
      </div>
    </div>
  );
}
