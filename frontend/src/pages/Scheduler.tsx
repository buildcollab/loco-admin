import { Link, useLoaderData } from "react-router";
import { api, type Job, type ScheduledJob, type SchedulerData } from "../api";
import { Alert, Card, Empty, StatusBadge, Tag } from "../ui";
import { formatDate, formatNumber, relativeTime, truncate } from "../format";

export async function schedulerLoader(): Promise<SchedulerData> {
  return api.scheduler();
}

export function Scheduler() {
  const data = useLoaderData() as SchedulerData;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Scheduler</h1>
          <div className="subtitle">
            {data.exists ? (
              <>{formatNumber(data.jobs.length)} scheduled job{data.jobs.length === 1 ? "" : "s"} · <code>{data.path}</code></>
            ) : (
              "Reading from a Loco scheduler.yaml"
            )}
          </div>
        </div>
      </div>

      {data.error ? <Alert tone="err" title="Could not parse scheduler config">{data.error}</Alert> : null}

      {!data.exists ? (
        <Card>
          <Empty title="No scheduler config found">
            <div className="muted">Set <code>SCHEDULER_CONFIG_PATH</code> to your Loco <code>scheduler.yaml</code> (looked in <code>{data.path}</code>).</div>
          </Empty>
        </Card>
      ) : data.jobs.length === 0 ? (
        <Card><Empty title="No jobs defined" /></Card>
      ) : (
        <div className="stack">
          {data.jobs.map((job) => (
            <JobCard key={job.name} job={job} recent={data.recent.filter((r) => r.tags.some((t) => job.tags.includes(t)))} />
          ))}
        </div>
      )}
    </div>
  );
}

function JobCard({ job, recent }: { job: ScheduledJob; recent: Job[] }) {
  return (
    <Card
      title={
        <span className="row">
          {job.name}
          {job.run_on_start ? <span className="pill" style={{ color: "#a9c2ff" }}>run on start</span> : null}
          <span className="pill">{job.shell ? "shell" : "task"}</span>
        </span>
      }
      subtitle={job.is_english ? "English schedule (evaluated by Loco)" : job.parse_error ? "Unparseable schedule" : job.schedule}
    >
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div className="stack" style={{ gap: 12 }}>
          <Field label="Command"><code className="pre" style={{ display: "block", padding: "8px 10px" }}>{job.run || "—"}</code></Field>
          <Field label="Schedule">
            <code className="mono">{job.schedule || "—"}</code>
            {job.parse_error ? <div className="alert err" style={{ marginTop: 6 }}>{job.parse_error}</div> : null}
          </Field>
          {job.tags.length ? <Field label="Tags"><div className="row">{job.tags.map((t) => <Tag key={t}>{t}</Tag>)}</div></Field> : null}
        </div>
        <div className="stack" style={{ gap: 12 }}>
          <Field label="Next runs">
            {job.next_runs.length ? (
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {job.next_runs.map((d) => (
                  <li key={d} className="between" style={{ fontSize: 12, padding: "2px 0" }}>
                    <span>{formatDate(d)}</span>
                    <span className="faint tabular">{relativeTime(d)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="faint" style={{ fontSize: 12 }}>
                {job.is_english ? "English schedules are evaluated by Loco at runtime." : "No upcoming runs could be computed."}
              </div>
            )}
          </Field>
          {job.tags.length ? (
            <Field label="Recent queue activity">
              {recent.length ? (
                <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {recent.slice(0, 4).map((r) => (
                    <li key={r.id} className="between" style={{ fontSize: 12, padding: "2px 0" }}>
                      <Link to={`/jobs/${encodeURIComponent(r.id)}`} style={{ color: "#a9c2ff" }}>{truncate(r.name, 22)}</Link>
                      <span className="row"><StatusBadge status={r.status} /><span className="faint">{relativeTime(r.created_at)}</span></span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="faint" style={{ fontSize: 12 }}>No recent jobs share these tags.</div>
              )}
            </Field>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="faint" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
