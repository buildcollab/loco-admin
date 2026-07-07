# loco-admin

An admin console for [Loco](https://loco.rs) (`loco-rs`) applications, built **as
a Loco app itself** on the [buildcollab/loco](https://github.com/buildcollab/loco)
fork. It connects to the **same Postgres database** a managed Loco app uses and
talks to other Loco servers over HTTP to give operators three consoles:

- **Background Jobs** — browse, filter and manage the `pg_loco_queue` table
  (requeue, run-now, cancel, delete, and bulk maintenance).
- **Scheduler** — visualise the cron jobs in a Loco `scheduler.yaml`, with the
  next projected run times and correlation to recent queue activity.
- **Servers** — fetch health and metrics from a fleet of Loco servers, using the
  fork's `/_server` (JSON manifest) and `/_metrics` (Prometheus) endpoints.

## Stack

- **Backend:** Rust + Loco (the `buildcollab/loco` fork), `sea-orm` for DB access,
  `reqwest` for server probes. JSON APIs under `/api/*`.
- **Frontend:** React 19 + React Router (SPA), built with rsbuild and served by
  Loco as static assets.

The backend is pinned to Rust 1.95 (`rust-toolchain.toml`) to match the fork's
MSRV, and depends on the fork by git rev in `Cargo.toml`.

## Running

```sh
# 1. Build the frontend (Loco serves frontend/dist)
cd frontend && npm install && npm run build && cd ..

# 2. Point at the target app's database and start
DATABASE_URL=postgres://user:pass@host:5432/target_db \
  cargo loco start
```

Open http://localhost:5150.

### Configuration (env)

| Variable                | Purpose                                                        |
| ----------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`          | Postgres of the managed Loco app (its `pg_loco_queue` table)  |
| `QUEUE_TABLE`           | Queue table name (default `pg_loco_queue`)                    |
| `SCHEDULER_CONFIG_PATH` | Path to the Loco `scheduler.yaml` (default `scheduler.yaml`)  |
| `LOCO_SERVERS`          | Servers console: inline JSON list (see below)                 |
| `LOCO_SERVERS_FILE`     | Servers console: path to a JSON/YAML list                     |
| `METRICS_TIMEOUT_MS`    | Per-request timeout when probing servers (default 4000)       |

`LOCO_SERVERS` example:

```json
[
  { "name": "web-1", "base_url": "http://10.0.0.4:5150", "tags": ["prod"] },
  { "name": "worker-1", "url": "http://10.0.0.5:5150", "metrics_path": "/_metrics" }
]
```

## API

The React frontend is a thin client over these JSON endpoints:

- `GET /api/jobs?status=&name=&tag=&q=&page=&page_size=&sort=&dir=` — job page
- `GET /api/jobs/stats` · `GET /api/jobs/facets` · `GET /api/jobs/{id}`
- `POST /api/jobs/actions` — `{ intent, ids?, status? }` (requeue / cancel /
  run-now / delete / requeue-all-failed / purge-status)
- `GET /api/scheduler` — parsed schedule + projected runs + recent activity
- `GET /api/servers` — resolved servers with health, `/_server` and `/_metrics`

## Servers console & the fork

For each configured server the collector probes the built-in `/_ping`,
`/_health` and `/_readiness` endpoints (status + latency → up / degraded / down),
then fetches the fork's `/_server` manifest (name, version, environment, build
info, route count) and scrapes `/_metrics` (parsed from the Prometheus text
format, including the fork's `loco_build_info`, `loco_routes_total` and
`loco_uptime_seconds`). Because loco-admin is itself built on the fork, it also
exposes `/_server` and `/_metrics` and can monitor itself.
