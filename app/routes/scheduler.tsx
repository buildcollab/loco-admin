import { Link } from "react-router";
import type { Route } from "./+types/scheduler";
import {
  loadSchedulerConfig,
  type ScheduledJob,
} from "~/lib/scheduler.server";
import { recentJobsByTags, type JobRow } from "~/lib/jobs.server";
import {
  Alert,
  Card,
  CardHeader,
  StatusBadge,
  Tag,
  EmptyState,
  cn,
} from "~/components/ui";
import { formatDate, formatNumber, relativeTime, truncate } from "~/lib/format";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Scheduler · loco-admin" }];
}

export async function loader(_: Route.LoaderArgs) {
  const now = new Date();
  const config = await loadSchedulerConfig(now);

  // Best-effort: correlate scheduled jobs with recent queue rows by tag. If the
  // DB is unreachable we still render the schedule itself.
  const allTags = [...new Set(config.jobs.flatMap((j) => j.tags))];
  let recent: JobRow[] = [];
  try {
    recent = await recentJobsByTags(allTags, 50);
  } catch {
    recent = [];
  }

  return { config, recent, now };
}

export default function Scheduler({ loaderData }: Route.ComponentProps) {
  const { config, recent, now } = loaderData;
  const nowMs = new Date(now).getTime();

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Scheduler
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {config.exists ? (
            <>
              {formatNumber(config.jobs.length)} scheduled job
              {config.jobs.length === 1 ? "" : "s"} · reading{" "}
              <code className="text-xs">{config.path}</code>
            </>
          ) : (
            <>Reading from a Loco scheduler.yaml</>
          )}
        </p>
      </header>

      {config.error ? (
        <Alert tone="error" title="Could not parse scheduler config">
          <span className="font-mono text-xs">{config.error}</span>
        </Alert>
      ) : null}

      {!config.exists ? (
        <Card>
          <EmptyState
            title="No scheduler config found"
            description={
              <>
                Set <code>SCHEDULER_CONFIG_PATH</code> to point at your Loco{" "}
                <code>scheduler.yaml</code> (or a full <code>config/*.yaml</code>{" "}
                with a <code>scheduler:</code> section). Looked in{" "}
                <code className="break-all">{config.path}</code>.
              </>
            }
          >
            <pre className="scroll-x mt-2 max-w-xl rounded-lg bg-slate-950 p-4 text-left font-mono text-xs text-slate-200">
{`scheduler:
  output: stdout
  jobs:
    write_content:
      run: "echo hello"
      shell: true
      schedule: "0 */5 * * * *"
      tags: ["reporting"]`}
            </pre>
          </EmptyState>
        </Card>
      ) : config.jobs.length === 0 ? (
        <Card>
          <EmptyState
            title="No jobs defined"
            description="The scheduler config was found but defines no jobs."
          />
        </Card>
      ) : (
        <div className="grid gap-4">
          {config.jobs.map((job) => (
            <SchedulerJobCard
              key={job.name}
              job={job}
              nowMs={nowMs}
              recent={recent.filter((r) =>
                r.tags.some((t) => job.tags.includes(t)),
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SchedulerJobCard({
  job,
  nowMs,
  recent,
}: {
  job: ScheduledJob;
  nowMs: number;
  recent: JobRow[];
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {job.name}
            {job.runOnStart ? (
              <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-700 dark:bg-brand-600/20 dark:text-brand-200">
                run on start
              </span>
            ) : null}
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                job.shell
                  ? "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                  : "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
              )}
            >
              {job.shell ? "shell" : "task"}
            </span>
          </span>
        }
        subtitle={
          job.humanReadable ??
          (job.isEnglish
            ? "English schedule (evaluated by Loco)"
            : job.parseError
              ? "Unparseable schedule"
              : undefined)
        }
      />
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div className="space-y-3">
          <Field label="Command">
            <code className="scroll-x block max-w-full rounded-md bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100">
              {job.run || "—"}
            </code>
          </Field>
          <Field label="Schedule">
            <code className="font-mono text-xs text-slate-700 dark:text-slate-200">
              {job.schedule || "—"}
            </code>
            {job.parseError ? (
              <p className="mt-1 text-xs text-rose-500">{job.parseError}</p>
            ) : null}
          </Field>
          {job.tags.length > 0 ? (
            <Field label="Tags">
              <div className="flex flex-wrap gap-1">
                {job.tags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
            </Field>
          ) : null}
        </div>

        <div className="space-y-3">
          <Field label="Next runs">
            {job.nextRuns.length > 0 ? (
              <ul className="space-y-1">
                {job.nextRuns.map((d, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="text-slate-700 dark:text-slate-200">
                      {formatDate(d)}
                    </span>
                    <span className="tabular text-slate-400">
                      {relativeTime(d, nowMs)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-400">
                {job.isEnglish
                  ? "English schedules are evaluated by Loco at runtime and can't be projected here."
                  : "No upcoming runs could be computed."}
              </p>
            )}
          </Field>

          {job.tags.length > 0 ? (
            <Field label="Recent queue activity">
              {recent.length > 0 ? (
                <ul className="space-y-1">
                  {recent.slice(0, 4).map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <Link
                        to={`/jobs/${encodeURIComponent(r.id)}`}
                        className="truncate text-brand-700 hover:underline dark:text-brand-300"
                      >
                        {truncate(r.name, 22)}
                      </Link>
                      <span className="flex items-center gap-2">
                        <StatusBadge status={r.status} />
                        <span className="text-slate-400">
                          {relativeTime(r.created_at, nowMs)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400">
                  No recent queued jobs share these tags.
                </p>
              )}
            </Field>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </div>
      {children}
    </div>
  );
}
