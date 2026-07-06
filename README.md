# loco-admin

An independent admin console for [Loco](https://loco.rs) (`loco-rs`) applications.
It connects to the **same Postgres database** your Loco app uses and gives
operators a UI over the parts of Loco that otherwise only have a CLI:

- **Background Jobs** — browse, filter, and manage the `pg_loco_queue` table
  (requeue, cancel, run-now, delete, and bulk maintenance).
- **Scheduler** — visualise the cron jobs defined in your Loco `scheduler.yaml`,
  including human-readable descriptions and the next scheduled run times.
- **Servers** — fetch health and metrics from a fleet of Loco servers. The
  server list comes from a pluggable resolver (a static config list today).

It is deliberately a separate app (not a Loco plugin) so it can be deployed and
secured independently while pointing at the same data.

## Stack

- [React Router v8](https://reactrouter.com) framework mode (SSR) + React 19
- TypeScript, Vite 8
- Tailwind CSS v4
- [`postgres`](https://github.com/porsager/postgres) for direct SQL access

Server-side loaders/actions talk to Postgres; nothing DB-related ships to the
browser.

## Getting started

```bash
npm install
cp .env.example .env      # then edit DATABASE_URL to match your Loco app
npm run dev               # http://localhost:5173
```

### Configuration

All configuration is via environment variables (see `.env.example`):

| Variable                | Required | Default            | Purpose                                            |
| ----------------------- | -------- | ------------------ | -------------------------------------------------- |
| `DATABASE_URL`          | yes      | —                  | Postgres connection string for the Loco app's DB   |
| `QUEUE_TABLE`           | no       | `pg_loco_queue`    | Loco queue table name                              |
| `SCHEDULER_CONFIG_PATH` | no       | `scheduler.yaml`   | Path to the Loco scheduler config                  |
| `TARGET_LABEL`          | no       | —                  | Label shown in the UI for the target environment   |

## Background jobs

The console reads the Loco Postgres queue table (`pg_loco_queue`), whose status
column is one of `queued`, `processing`, `completed`, `failed`, `cancelled`.

Available operations (all write directly to the queue table):

- **Requeue** a failed/cancelled job (`status → queued`, `run_at → now`).
- **Run now** — bump `run_at` to now so the next poll picks it up.
- **Cancel** a queued/processing job.
- **Delete** a job.
- **Bulk actions** on a selection, plus **Maintenance** shortcuts: requeue all
  failed, purge completed, purge cancelled.

Filter by status, job name, tag, and free-text (id/name); sort and paginate.

## Scheduler

Loco's scheduler is configuration-driven — the schedule lives in a YAML file,
not the database — so the console reads `SCHEDULER_CONFIG_PATH` and renders each
job with its command, cron expression, a human-readable description, and the
next few run times. Jobs that carry tags are cross-referenced against recent
queue activity. English schedules (e.g. "every 15 minutes") are shown verbatim;
Loco evaluates those at runtime so future runs aren't projected.

See `scheduler.example.yaml` for the expected shape.

## Servers

The Servers page fetches health and metrics from other Loco servers. Which
servers to talk to is decided by a **resolver** — the abstraction is pluggable
so discovery can later come from Kubernetes, a service registry, etc. Today one
resolver is implemented:

- **StaticResolver** — a fixed list from configuration, via `LOCO_SERVERS`
  (inline JSON) or `LOCO_SERVERS_FILE` (a JSON/YAML file, either a bare list or
  `{ servers: [...] }`). Each entry has a `name`, a `baseUrl` (or `url`),
  optional `tags`, and an optional `metricsPath`.

For every resolved server the collector probes Loco's built-in health endpoints
— `/_ping`, `/_health`, `/_readiness` — recording status and latency, and
derives an overall **up / degraded / down** state (degraded = live but a
dependency check is failing). If a server sets `metricsPath`, the collector also
scrapes that endpoint and parses the Prometheus text exposition format into
browsable metric families. (Loco has no metrics endpoint out of the box, so
`metricsPath` is opt-in.)

```jsonc
// LOCO_SERVERS
[
  { "name": "web-1", "baseUrl": "http://10.0.0.4:5150", "tags": ["prod"] },
  { "name": "worker-1", "baseUrl": "http://10.0.0.5:5150", "metricsPath": "/metrics" }
]
```

Adding a new resolver later means implementing the `ServerResolver` interface
(`app/lib/servers/types.ts`) and registering it in
`app/lib/servers/registry.server.ts` — the metrics collector and UI need no
changes.

## Local development against a throwaway database

`db/schema.sql` documents the queue table, and `scripts/seed.ts` populates a
spread of sample jobs so you can work without a running Loco worker:

```bash
export DATABASE_URL=postgres://localhost:5432/loco_admin_dev
npm run db:schema     # create pg_loco_queue
npm run db:seed       # insert ~48 sample jobs
npm run dev
```

## Production build

```bash
npm run build
npm run start         # serves ./build with @react-router/serve
```

## Notes

Loco creates `pg_loco_queue` automatically when a worker using the Postgres
queue backend first starts, so in a real deployment you point `DATABASE_URL` at
the existing database and the table is already there.
