import { Link, redirect, useFetcher } from "react-router";
import type { Route } from "./+types/job-detail";
import {
  cancelJobs,
  deleteJobs,
  getJob,
  requeueJobs,
  runNowJobs,
} from "~/lib/jobs.server";
import {
  Alert,
  Card,
  CardHeader,
  StatusBadge,
  Tag,
  buttonClass,
} from "~/components/ui";
import {
  formatDate,
  formatInterval,
  prettyJson,
  relativeTime,
} from "~/lib/format";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: loaderData
        ? `${loaderData.job.name} · Jobs · loco-admin`
        : "Job · loco-admin",
    },
  ];
}

export async function loader({ params }: Route.LoaderArgs) {
  const job = await getJob(params.id);
  if (!job) {
    throw new Response(`No job found with id ${params.id}`, { status: 404 });
  }
  return { job, now: new Date() };
}

export async function action({ request, params }: Route.ActionArgs) {
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const id = params.id;

  try {
    switch (intent) {
      case "requeue":
        await requeueJobs([id]);
        return { ok: true, message: "Job requeued." };
      case "cancel":
        await cancelJobs([id]);
        return { ok: true, message: "Job cancelled." };
      case "run-now":
        await runNowJobs([id]);
        return { ok: true, message: "Job scheduled to run now." };
      case "delete":
        await deleteJobs([id]);
        throw redirect("/jobs");
      default:
        return { ok: false, message: `Unknown action: ${intent}` };
    }
  } catch (err) {
    if (err instanceof Response) throw err;
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Action failed.",
    };
  }
}

export default function JobDetail({ loaderData }: Route.ComponentProps) {
  const { job, now } = loaderData;
  const nowMs = new Date(now).getTime();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  const canCancel = job.status === "queued" || job.status === "processing";
  const canRequeue = job.status === "failed" || job.status === "cancelled";

  function submit(intent: string, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    fetcher.submit({ intent }, { method: "post" });
  }

  return (
    <div className="space-y-5">
      <div className="text-sm">
        <Link
          to="/jobs"
          className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          ← Background Jobs
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-xl font-semibold text-slate-900 dark:text-slate-50">
              {job.name}
            </h1>
            <StatusBadge status={job.status} />
          </div>
          <p className="mt-1 font-mono text-xs text-slate-400">{job.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canRequeue ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => submit("requeue")}
              className={buttonClass("secondary")}
            >
              Requeue
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => submit("run-now")}
            className={buttonClass("secondary")}
          >
            Run now
          </button>
          {canCancel ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => submit("cancel")}
              className={buttonClass("secondary")}
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              submit("delete", `Delete job ${job.id}? This cannot be undone.`)
            }
            className={buttonClass("danger")}
          >
            Delete
          </button>
        </div>
      </header>

      {fetcher.data?.message ? (
        <Alert tone={fetcher.data.ok ? "info" : "error"}>
          {fetcher.data.message}
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Details" />
          <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            <Detail label="Status">
              <StatusBadge status={job.status} />
            </Detail>
            <Detail label="Run at">
              <div className="text-slate-800 dark:text-slate-100">
                {formatDate(job.run_at)}
              </div>
              <div className="text-xs text-slate-400">
                {relativeTime(job.run_at, nowMs)}
              </div>
            </Detail>
            <Detail label="Recurring">
              {job.interval != null ? (
                <span>every {formatInterval(job.interval)}</span>
              ) : (
                <span className="text-slate-400">one-off</span>
              )}
            </Detail>
            <Detail label="Created">
              <div className="text-slate-800 dark:text-slate-100">
                {formatDate(job.created_at)}
              </div>
              <div className="text-xs text-slate-400">
                {relativeTime(job.created_at, nowMs)}
              </div>
            </Detail>
            <Detail label="Updated">
              <div className="text-slate-800 dark:text-slate-100">
                {formatDate(job.updated_at)}
              </div>
              <div className="text-xs text-slate-400">
                {relativeTime(job.updated_at, nowMs)}
              </div>
            </Detail>
            <Detail label="Tags">
              {job.tags.length === 0 ? (
                <span className="text-slate-400">none</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {job.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </div>
              )}
            </Detail>
          </dl>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Payload"
            subtitle="task_data (JSONB) passed to the worker"
          />
          <div className="p-4">
            <pre className="scroll-x max-h-[520px] overflow-auto rounded-lg bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-100">
              {prettyJson(job.task_data)}
            </pre>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
