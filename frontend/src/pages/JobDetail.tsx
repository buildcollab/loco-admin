import {
  Link,
  useLoaderData,
  useNavigate,
  useRevalidator,
  type LoaderFunctionArgs,
} from "react-router";
import { api, type Job } from "../api";
import { Card, StatusBadge, Tag } from "../ui";
import { formatDate, formatInterval, relativeTime } from "../format";

export async function jobLoader({ params }: LoaderFunctionArgs): Promise<Job> {
  return api.job(params.id as string);
}

export function JobDetail() {
  const job = useLoaderData() as Job;
  const revalidator = useRevalidator();
  const navigate = useNavigate();

  const canCancel = job.status === "queued" || job.status === "processing";
  const canRequeue = job.status === "failed" || job.status === "cancelled";

  async function run(intent: string) {
    if (intent === "delete" && !confirm(`Delete job ${job.id}?`)) return;
    await api.action({ intent, ids: [job.id] });
    if (intent === "delete") navigate("/jobs");
    else revalidator.revalidate();
  }

  return (
    <div className="stack">
      <Link to="/jobs" className="muted">← Background Jobs</Link>
      <div className="page-head">
        <div>
          <div className="row">
            <h1>{job.name}</h1>
            <StatusBadge status={job.status} />
          </div>
          <div className="mono faint" style={{ marginTop: 4 }}>{job.id}</div>
        </div>
        <div className="row">
          {canRequeue ? <button className="btn" onClick={() => run("requeue")}>Requeue</button> : null}
          <button className="btn" onClick={() => run("run-now")}>Run now</button>
          {canCancel ? <button className="btn" onClick={() => run("cancel")}>Cancel</button> : null}
          <button className="btn danger" onClick={() => run("delete")}>Delete</button>
        </div>
      </div>

      <div className="cols-3">
        <Card title="Payload" subtitle="task_data (JSONB)" className="">
          <pre className="pre">{JSON.stringify(job.task_data, null, 2)}</pre>
        </Card>
        <Card title="Details">
          <dl style={{ margin: 0 }}>
            <div className="kv"><dt>Status</dt><dd><StatusBadge status={job.status} /></dd></div>
            <div className="kv"><dt>Run at</dt><dd>{formatDate(job.run_at)}<div className="faint" style={{ fontSize: 12 }}>{relativeTime(job.run_at)}</div></dd></div>
            <div className="kv"><dt>Recurring</dt><dd>{job.interval != null ? `every ${formatInterval(job.interval)}` : <span className="faint">one-off</span>}</dd></div>
            <div className="kv"><dt>Created</dt><dd>{formatDate(job.created_at)}</dd></div>
            <div className="kv"><dt>Updated</dt><dd>{formatDate(job.updated_at)}</dd></div>
            <div className="kv"><dt>Tags</dt><dd>{job.tags.length ? <div className="row" style={{ justifyContent: "flex-end" }}>{job.tags.map((t) => <Tag key={t}>{t}</Tag>)}</div> : <span className="faint">none</span>}</dd></div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
