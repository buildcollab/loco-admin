-- Reference schema for the Loco Postgres background-job queue.
--
-- Loco (loco-rs) creates this table automatically the first time a worker with
-- the Postgres queue backend starts. It is reproduced here so that:
--   * loco-admin can be developed / verified against a standalone database, and
--   * the exact shape the admin app reads/writes is documented in one place.
--
-- Source: loco-rs `src/bgworker/pg.rs`.

CREATE TABLE IF NOT EXISTS pg_loco_queue (
    id         VARCHAR      NOT NULL,
    name       VARCHAR      NOT NULL,
    task_data  JSONB        NOT NULL,
    status     VARCHAR      NOT NULL DEFAULT 'queued',
    run_at     TIMESTAMPTZ  NOT NULL,
    interval   BIGINT,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    tags       JSONB
);

-- Loco polls with `status = 'queued' AND run_at <= NOW()` under
-- `FOR UPDATE SKIP LOCKED`; these indexes match the admin console's filters too.
CREATE INDEX IF NOT EXISTS idx_pg_loco_queue_status_run_at
    ON pg_loco_queue (status, run_at);
CREATE INDEX IF NOT EXISTS idx_pg_loco_queue_name
    ON pg_loco_queue (name);
CREATE INDEX IF NOT EXISTS idx_pg_loco_queue_created_at
    ON pg_loco_queue (created_at);

-- status is one of: 'queued', 'processing', 'completed', 'failed', 'cancelled'
