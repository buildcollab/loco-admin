import { sql, withDb } from "~/lib/db.server";
import { queueTable } from "~/lib/env.server";
import { JOB_STATUSES, type JobStatus } from "~/lib/format";

/** A row of the Loco `pg_loco_queue` table, normalised for the UI. */
export interface JobRow {
  id: string;
  name: string;
  task_data: unknown;
  status: string;
  run_at: Date;
  interval: number | null;
  created_at: Date;
  updated_at: Date;
  tags: string[];
}

function table() {
  // queueTable() is validated to be a safe identifier; sql() quotes it.
  return sql(queueTable());
}

function normalize(row: Record<string, unknown>): JobRow {
  return {
    id: String(row.id),
    name: String(row.name),
    task_data: row.task_data ?? null,
    status: String(row.status),
    run_at: row.run_at as Date,
    interval: row.interval == null ? null : Number(row.interval),
    created_at: row.created_at as Date,
    updated_at: row.updated_at as Date,
    tags: Array.isArray(row.tags) ? (row.tags as unknown[]).map(String) : [],
  };
}

/* ------------------------------------------------------------------ reads */

export interface StatusCounts {
  total: number;
  byStatus: Record<string, number>;
  dueNow: number;
  recurring: number;
}

export async function getStatusCounts(): Promise<StatusCounts> {
  return withDb(async () => {
    const rows = await sql<{ status: string; n: number }[]>`
      SELECT status, count(*)::int AS n
      FROM ${table()}
      GROUP BY status
    `;
    const byStatus: Record<string, number> = {};
    for (const s of JOB_STATUSES) byStatus[s] = 0;
    let total = 0;
    for (const r of rows) {
      byStatus[r.status] = r.n;
      total += r.n;
    }

    const [{ due_now }] = await sql<{ due_now: number }[]>`
      SELECT count(*)::int AS due_now
      FROM ${table()}
      WHERE status = 'queued' AND run_at <= NOW()
    `;
    const [{ recurring }] = await sql<{ recurring: number }[]>`
      SELECT count(*)::int AS recurring
      FROM ${table()}
      WHERE interval IS NOT NULL
    `;

    return { total, byStatus, dueNow: due_now, recurring };
  });
}

export interface CompletionBucket {
  hour: Date;
  completed: number;
  failed: number;
}

/** Hourly completed/failed counts over the last 24h, for the overview chart. */
export async function getRecentThroughput(): Promise<CompletionBucket[]> {
  return withDb(async () => {
    const rows = await sql<
      { hour: Date; completed: number; failed: number }[]
    >`
      SELECT
        date_trunc('hour', updated_at) AS hour,
        count(*) FILTER (WHERE status = 'completed')::int AS completed,
        count(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM ${table()}
      WHERE updated_at >= NOW() - INTERVAL '24 hours'
        AND status IN ('completed', 'failed')
      GROUP BY 1
      ORDER BY 1
    `;
    return rows.map((r) => ({
      hour: r.hour,
      completed: r.completed,
      failed: r.failed,
    }));
  });
}

export interface JobFilters {
  status?: string;
  name?: string;
  tag?: string;
  q?: string;
  page: number;
  pageSize: number;
  sort: SortColumn;
  dir: "asc" | "desc";
}

export type SortColumn =
  | "run_at"
  | "created_at"
  | "updated_at"
  | "name"
  | "status";

const SORT_COLUMNS: SortColumn[] = [
  "run_at",
  "created_at",
  "updated_at",
  "name",
  "status",
];

export function parseSort(value: string | null): SortColumn {
  return SORT_COLUMNS.includes(value as SortColumn)
    ? (value as SortColumn)
    : "created_at";
}

function buildWhere(f: JobFilters) {
  const conds: ReturnType<typeof sql>[] = [];
  if (f.status && JOB_STATUSES.includes(f.status as JobStatus)) {
    conds.push(sql`status = ${f.status}`);
  }
  if (f.name) {
    conds.push(sql`name = ${f.name}`);
  }
  if (f.tag) {
    // Use sql.json so postgres.js binds a real jsonb array; interpolating a
    // pre-stringified value gets double-encoded into a jsonb *string*.
    conds.push(sql`tags @> ${sql.json([f.tag])}`);
  }
  if (f.q) {
    const like = `%${f.q}%`;
    conds.push(sql`(id ILIKE ${like} OR name ILIKE ${like})`);
  }
  if (conds.length === 0) return sql``;
  return conds.reduce(
    (acc, cond, i) => (i === 0 ? sql`WHERE ${cond}` : sql`${acc} AND ${cond}`),
    sql``,
  );
}

export interface JobPage {
  rows: JobRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export async function listJobs(f: JobFilters): Promise<JobPage> {
  return withDb(async () => {
    const where = buildWhere(f);
    const offset = (f.page - 1) * f.pageSize;
    const dir = f.dir === "asc" ? sql`ASC` : sql`DESC`;

    const rows = await sql<Record<string, unknown>[]>`
      SELECT id, name, task_data, status, run_at, interval,
             created_at, updated_at, tags
      FROM ${table()}
      ${where}
      ORDER BY ${sql(f.sort)} ${dir} NULLS LAST, id ASC
      LIMIT ${f.pageSize} OFFSET ${offset}
    `;

    const [{ total }] = await sql<{ total: number }[]>`
      SELECT count(*)::int AS total FROM ${table()} ${where}
    `;

    return {
      rows: rows.map(normalize),
      total,
      page: f.page,
      pageSize: f.pageSize,
      pageCount: Math.max(1, Math.ceil(total / f.pageSize)),
    };
  });
}

export async function getJob(id: string): Promise<JobRow | null> {
  return withDb(async () => {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT id, name, task_data, status, run_at, interval,
             created_at, updated_at, tags
      FROM ${table()}
      WHERE id = ${id}
      LIMIT 1
    `;
    return rows[0] ? normalize(rows[0]) : null;
  });
}

export async function distinctNames(): Promise<string[]> {
  return withDb(async () => {
    const rows = await sql<{ name: string }[]>`
      SELECT DISTINCT name FROM ${table()} ORDER BY name LIMIT 500
    `;
    return rows.map((r) => r.name);
  });
}

export async function distinctTags(): Promise<string[]> {
  return withDb(async () => {
    const rows = await sql<{ tag: string }[]>`
      SELECT DISTINCT jsonb_array_elements_text(tags) AS tag
      FROM ${table()}
      WHERE tags IS NOT NULL AND jsonb_typeof(tags) = 'array'
      ORDER BY tag
      LIMIT 500
    `;
    return rows.map((r) => r.tag);
  });
}

/** Recent queue rows whose tags overlap any of the given tags. */
export async function recentJobsByTags(
  tags: string[],
  limit = 5,
): Promise<JobRow[]> {
  if (tags.length === 0) return [];
  return withDb(async () => {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT id, name, task_data, status, run_at, interval,
             created_at, updated_at, tags
      FROM ${table()}
      WHERE tags ?| ${tags}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map(normalize);
  });
}

/* --------------------------------------------------------------- mutations */

export async function requeueJobs(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  return withDb(async () => {
    const res = await sql`
      UPDATE ${table()}
      SET status = 'queued', run_at = NOW(), updated_at = NOW()
      WHERE id = ANY(${ids})
    `;
    return res.count;
  });
}

export async function cancelJobs(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  return withDb(async () => {
    const res = await sql`
      UPDATE ${table()}
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = ANY(${ids}) AND status IN ('queued', 'processing')
    `;
    return res.count;
  });
}

export async function runNowJobs(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  return withDb(async () => {
    const res = await sql`
      UPDATE ${table()}
      SET run_at = NOW(), status = 'queued', updated_at = NOW()
      WHERE id = ANY(${ids})
    `;
    return res.count;
  });
}

export async function deleteJobs(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  return withDb(async () => {
    const res = await sql`
      DELETE FROM ${table()} WHERE id = ANY(${ids})
    `;
    return res.count;
  });
}

/** Bulk purge every job in a terminal status (completed / cancelled / failed). */
export async function deleteByStatus(status: string): Promise<number> {
  if (!JOB_STATUSES.includes(status as JobStatus)) return 0;
  return withDb(async () => {
    const res = await sql`
      DELETE FROM ${table()} WHERE status = ${status}
    `;
    return res.count;
  });
}

/** Requeue every failed job at once. */
export async function requeueAllFailed(): Promise<number> {
  return withDb(async () => {
    const res = await sql`
      UPDATE ${table()}
      SET status = 'queued', run_at = NOW(), updated_at = NOW()
      WHERE status = 'failed'
    `;
    return res.count;
  });
}
