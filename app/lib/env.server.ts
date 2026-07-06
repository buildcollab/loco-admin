/**
 * Centralised, validated access to environment configuration. Import this from
 * other `*.server.ts` modules only — never from client code.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Response(
      `Missing required environment variable: ${name}. ` +
        `Set it in your .env file (see .env.example).`,
      { status: 500 },
    );
  }
  return value;
}

/**
 * The Postgres connection string for the Loco application's database. The admin
 * app connects read/write to the same database the Loco app uses so it can
 * manage the background-job queue.
 */
export function databaseUrl(): string {
  return required("DATABASE_URL");
}

/**
 * Name of the Loco Postgres background-job queue table. Loco defaults to
 * `pg_loco_queue`; override only if the app customised it.
 */
export function queueTable(): string {
  const raw = process.env.QUEUE_TABLE?.trim() || "pg_loco_queue";
  // Guard against injection since this is interpolated as an identifier.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(raw)) {
    throw new Response(
      `Invalid QUEUE_TABLE value: ${raw}. Must be a valid SQL identifier.`,
      { status: 500 },
    );
  }
  return raw;
}

/**
 * Path to the Loco `scheduler.yaml` config that describes cron jobs. Defaults
 * to `./scheduler.yaml` relative to the process working directory.
 */
export function schedulerConfigPath(): string {
  return process.env.SCHEDULER_CONFIG_PATH?.trim() || "scheduler.yaml";
}

/** Optional human label for the environment the admin app is pointed at. */
export function targetLabel(): string | null {
  return process.env.TARGET_LABEL?.trim() || null;
}
