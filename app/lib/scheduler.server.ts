import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { CronExpressionParser } from "cron-parser";
import cronstrue from "cronstrue";
import { parse as parseYaml } from "yaml";
import { schedulerConfigPath } from "~/lib/env.server";

/**
 * A single scheduled job from a Loco `scheduler.yaml`, enriched with a
 * human-readable description and the next few run times.
 */
export interface ScheduledJob {
  name: string;
  run: string;
  shell: boolean;
  runOnStart: boolean;
  schedule: string;
  tags: string[];
  output: string | null;
  humanReadable: string | null;
  nextRuns: Date[];
  parseError: string | null;
  isEnglish: boolean;
}

export interface SchedulerConfig {
  path: string;
  exists: boolean;
  /** Read / YAML parse error, if any. */
  error: string | null;
  defaultOutput: string | null;
  jobs: ScheduledJob[];
}

/**
 * Loco cron detection: an expression that starts with `*` or a digit is treated
 * as a standard cron string; otherwise Loco runs it through `english_to_cron`
 * (e.g. "every 15 minutes"). We can evaluate the former in JS but not the
 * latter, so english schedules are surfaced verbatim without next-run times.
 */
function looksLikeCron(schedule: string): boolean {
  return /^[*\d]/.test(schedule.trim());
}

/**
 * Loco's cron format allows an optional seconds field and an optional trailing
 * year field ("sec min hour dom month dow year"). cron-parser understands 5- or
 * 6-field expressions but not the year field, so drop a 7th field if present.
 */
function normalizeCron(schedule: string): string {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length === 7) return parts.slice(0, 6).join(" ");
  return parts.join(" ");
}

interface ComputedSchedule {
  humanReadable: string | null;
  nextRuns: Date[];
  parseError: string | null;
  isEnglish: boolean;
}

export function computeSchedule(
  schedule: string,
  count = 5,
  from: Date = new Date(),
): ComputedSchedule {
  if (!looksLikeCron(schedule)) {
    return {
      humanReadable: null,
      nextRuns: [],
      parseError: null,
      isEnglish: true,
    };
  }

  const expr = normalizeCron(schedule);
  let humanReadable: string | null = null;
  try {
    humanReadable = cronstrue.toString(expr, { throwExceptionOnParseError: true });
  } catch {
    humanReadable = null;
  }

  try {
    const it = CronExpressionParser.parse(expr, { currentDate: from });
    const nextRuns: Date[] = [];
    for (let i = 0; i < count; i++) {
      nextRuns.push(it.next().toDate());
    }
    return { humanReadable, nextRuns, parseError: null, isEnglish: false };
  } catch (err) {
    return {
      humanReadable,
      nextRuns: [],
      parseError: err instanceof Error ? err.message : "Invalid cron expression",
      isEnglish: false,
    };
  }
}

function asOutput(value: unknown): string | null {
  if (typeof value === "string") return value;
  return null;
}

function coerceTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [];
}

/** Pull the `jobs` map out of either a standalone scheduler file or a Loco config. */
function extractJobsMap(doc: unknown): {
  jobs: Record<string, unknown>;
  defaultOutput: string | null;
} {
  if (!doc || typeof doc !== "object") return { jobs: {}, defaultOutput: null };
  const root = doc as Record<string, unknown>;
  // A full Loco config.yaml nests the scheduler under `scheduler:`.
  const scoped =
    root.scheduler && typeof root.scheduler === "object"
      ? (root.scheduler as Record<string, unknown>)
      : root;
  const jobs =
    scoped.jobs && typeof scoped.jobs === "object"
      ? (scoped.jobs as Record<string, unknown>)
      : {};
  return { jobs, defaultOutput: asOutput(scoped.output) };
}

export async function loadSchedulerConfig(
  now: Date = new Date(),
): Promise<SchedulerConfig> {
  const configured = schedulerConfigPath();
  const path = isAbsolute(configured)
    ? configured
    : resolve(process.cwd(), configured);

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {
      path,
      exists: false,
      error: null,
      defaultOutput: null,
      jobs: [],
    };
  }

  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (err) {
    return {
      path,
      exists: true,
      error: err instanceof Error ? err.message : "Failed to parse YAML",
      defaultOutput: null,
      jobs: [],
    };
  }

  const { jobs: jobsMap, defaultOutput } = extractJobsMap(doc);

  const jobs: ScheduledJob[] = Object.entries(jobsMap).map(([name, value]) => {
    const j = (value ?? {}) as Record<string, unknown>;
    const schedule = String(j.schedule ?? j.cron ?? "");
    const computed = computeSchedule(schedule, 5, now);
    return {
      name,
      run: String(j.run ?? ""),
      shell: Boolean(j.shell),
      runOnStart: Boolean(j.run_on_start),
      schedule,
      tags: coerceTags(j.tags),
      output: asOutput(j.output) ?? defaultOutput,
      ...computed,
    };
  });

  // Surface jobs that are due soonest first.
  jobs.sort((a, b) => {
    const an = a.nextRuns[0]?.getTime() ?? Infinity;
    const bn = b.nextRuns[0]?.getTime() ?? Infinity;
    return an - bn;
  });

  return { path, exists: true, error: null, defaultOutput, jobs };
}
