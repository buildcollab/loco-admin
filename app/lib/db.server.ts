import postgres from "postgres";
import { databaseUrl } from "~/lib/env.server";

/**
 * A single shared postgres connection pool. In development Vite reloads modules
 * on every change, so we stash the client on `globalThis` to avoid exhausting
 * connections with a new pool per reload.
 */
declare global {
  // eslint-disable-next-line no-var
  var __locoAdminSql: ReturnType<typeof postgres> | undefined;
}

function create() {
  return postgres(databaseUrl(), {
    max: 8,
    idle_timeout: 20,
    connect_timeout: 10,
    // The admin app only reads/writes existing Loco tables; disable notice noise.
    onnotice: () => {},
  });
}

export const sql: ReturnType<typeof postgres> =
  globalThis.__locoAdminSql ?? create();

if (process.env.NODE_ENV !== "production") {
  globalThis.__locoAdminSql = sql;
}

/** Wrap a query so a connection failure becomes a friendly 503 error page. */
export async function withDb<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown database error";
    throw new Response(
      `Could not reach the database. Check DATABASE_URL and that Postgres is ` +
        `running.\n\n${message}`,
      { status: 503 },
    );
  }
}
