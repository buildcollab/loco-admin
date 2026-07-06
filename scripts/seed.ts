/**
 * Seed a local database with a spread of `pg_loco_queue` rows so the admin app
 * can be developed and verified without a running Loco worker.
 *
 *   DATABASE_URL=postgres://... node --experimental-strip-types scripts/seed.ts
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(url, { onnotice: () => {} });

const NAMES = [
  "SendWelcomeEmail",
  "GenerateReport",
  "ResizeImage",
  "SyncStripeInvoices",
  "CleanupSessions",
  "RebuildSearchIndex",
];
const STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;
const TAG_POOL = ["email", "reporting", "media", "billing", "maintenance"];

function pick<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length];
}

function sampleTags(seed: number): string[] {
  const tags: string[] = [];
  if (seed % 2 === 0) tags.push(pick(TAG_POOL, seed));
  if (seed % 3 === 0) tags.push(pick(TAG_POOL, seed + 2));
  return [...new Set(tags)];
}

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS pg_loco_queue (
      id VARCHAR NOT NULL,
      name VARCHAR NOT NULL,
      task_data JSONB NOT NULL,
      status VARCHAR NOT NULL DEFAULT 'queued',
      run_at TIMESTAMPTZ NOT NULL,
      interval BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      tags JSONB
    )
  `;

  await sql`TRUNCATE pg_loco_queue`;

  const now = Date.now();
  const rows: Record<string, unknown>[] = [];
  const COUNT = 48;

  for (let i = 0; i < COUNT; i++) {
    const status = pick(STATUSES, i);
    const name = pick(NAMES, i);
    // Spread created_at over the last few days, updated within the last 24h for
    // terminal statuses so the throughput chart has data.
    const createdOffset = (i % 20) * 3600_000 * 3;
    const created = new Date(now - createdOffset);
    const updated =
      status === "completed" || status === "failed"
        ? new Date(now - (i % 24) * 3600_000)
        : created;
    // Half the queued jobs are due now, half in the future.
    const runAt =
      status === "queued"
        ? new Date(now + (i % 2 === 0 ? -60_000 : (i % 6) * 3600_000))
        : created;
    const interval = i % 5 === 0 ? (i % 2 === 0 ? 3600_000 : 86_400_000) : null;

    rows.push({
      id: randomUUID(),
      name,
      task_data: sql.json({
        args: { user_id: 1000 + i, attempt: (i % 3) + 1 },
        queue: "default",
      }),
      status,
      run_at: runAt,
      interval,
      created_at: created,
      updated_at: updated,
      tags: sql.json(sampleTags(i)),
    });
  }

  await sql`INSERT INTO pg_loco_queue ${sql(
    rows,
    "id",
    "name",
    "task_data",
    "status",
    "run_at",
    "interval",
    "created_at",
    "updated_at",
    "tags",
  )}`;

  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_loco_queue
  `;
  console.log(`Seeded ${n} jobs into pg_loco_queue.`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
