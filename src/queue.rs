//! Data access for the Loco Postgres background-job queue (`pg_loco_queue`).
//!
//! The admin app connects to the *same* database a managed Loco app uses and
//! reads/writes its queue table directly. The table is created by loco-rs
//! (`src/bgworker/pg.rs`) and is not a model in this app, so everything here is
//! raw SQL run through the shared `sea_orm` connection.

use loco_rs::prelude::*;
use sea_orm::{ConnectionTrait, DbBackend, FromQueryResult, Statement, Value};
use serde::{Deserialize, Serialize};

/// Name of the Loco Postgres queue table. Overridable via `QUEUE_TABLE` for
/// apps that customised it; validated to a safe identifier.
pub fn table() -> String {
    let raw = std::env::var("QUEUE_TABLE").unwrap_or_else(|_| "pg_loco_queue".to_string());
    if raw.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') && !raw.is_empty() {
        raw
    } else {
        "pg_loco_queue".to_string()
    }
}

pub const STATUSES: [&str; 5] = ["queued", "processing", "completed", "failed", "cancelled"];

fn is_status(s: &str) -> bool {
    STATUSES.contains(&s)
}

/// One row of `pg_loco_queue`, shaped for the API.
#[derive(Debug, Serialize)]
pub struct Job {
    pub id: String,
    pub name: String,
    pub task_data: serde_json::Value,
    pub status: String,
    pub run_at: DateTimeUtc,
    pub interval: Option<i64>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
    pub tags: Vec<String>,
}

/// Intermediate row matching the SQL column types before normalisation.
#[derive(FromQueryResult)]
struct JobRaw {
    id: String,
    name: String,
    task_data: serde_json::Value,
    status: String,
    run_at: DateTimeUtc,
    interval: Option<i64>,
    created_at: DateTimeUtc,
    updated_at: DateTimeUtc,
    tags: Option<serde_json::Value>,
}

fn to_tags(value: Option<serde_json::Value>) -> Vec<String> {
    match value {
        Some(serde_json::Value::Array(items)) => items
            .into_iter()
            .filter_map(|v| match v {
                serde_json::Value::String(s) => Some(s),
                other => Some(other.to_string()),
            })
            .collect(),
        _ => Vec::new(),
    }
}

impl From<JobRaw> for Job {
    fn from(r: JobRaw) -> Self {
        Self {
            id: r.id,
            name: r.name,
            task_data: r.task_data,
            status: r.status,
            run_at: r.run_at,
            interval: r.interval,
            created_at: r.created_at,
            updated_at: r.updated_at,
            tags: to_tags(r.tags),
        }
    }
}

const SELECT_COLS: &str =
    "id, name, task_data, status, run_at, interval, created_at, updated_at, tags";

/// Filters accepted by the jobs list endpoint.
#[derive(Debug, Default, Deserialize)]
pub struct JobFilters {
    pub status: Option<String>,
    pub name: Option<String>,
    pub tag: Option<String>,
    pub q: Option<String>,
    pub page: Option<u64>,
    pub page_size: Option<u64>,
    pub sort: Option<String>,
    pub dir: Option<String>,
}

fn sort_column(sort: &Option<String>) -> &'static str {
    match sort.as_deref() {
        Some("run_at") => "run_at",
        Some("updated_at") => "updated_at",
        Some("name") => "name",
        Some("status") => "status",
        _ => "created_at",
    }
}

/// Build the shared `WHERE` clause and its bound values from the filters.
fn build_where(f: &JobFilters) -> (String, Vec<Value>) {
    let mut clauses: Vec<String> = Vec::new();
    let mut values: Vec<Value> = Vec::new();

    if let Some(status) = f.status.as_ref().filter(|s| is_status(s)) {
        values.push(status.clone().into());
        clauses.push(format!("status = ${}", values.len()));
    }
    if let Some(name) = f.name.as_ref().filter(|s| !s.is_empty()) {
        values.push(name.clone().into());
        clauses.push(format!("name = ${}", values.len()));
    }
    if let Some(tag) = f.tag.as_ref().filter(|s| !s.is_empty()) {
        values.push(serde_json::json!([tag]).into());
        clauses.push(format!("tags @> ${}", values.len()));
    }
    if let Some(q) = f.q.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        values.push(format!("%{q}%").into());
        let idx = values.len();
        clauses.push(format!("(id ILIKE ${idx} OR name ILIKE ${idx})"));
    }

    if clauses.is_empty() {
        (String::new(), values)
    } else {
        (format!("WHERE {}", clauses.join(" AND ")), values)
    }
}

#[derive(Debug, Serialize)]
pub struct JobPage {
    pub rows: Vec<Job>,
    pub total: i64,
    pub page: u64,
    pub page_size: u64,
    pub page_count: u64,
}

pub async fn list(db: &impl ConnectionTrait, f: &JobFilters) -> Result<JobPage> {
    let page = f.page.unwrap_or(1).max(1);
    let page_size = f.page_size.unwrap_or(25).clamp(10, 100);
    let offset = (page - 1) * page_size;
    let col = sort_column(&f.sort);
    let dir = if f.dir.as_deref() == Some("asc") { "ASC" } else { "DESC" };
    let tbl = table();

    let (where_sql, mut values) = build_where(f);

    // Total (uses the same filter bindings).
    let count_sql = format!("SELECT count(*)::bigint AS total FROM {tbl} {where_sql}");
    let total: i64 = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            &count_sql,
            values.clone(),
        ))
        .await?
        .and_then(|r| r.try_get::<i64>("", "total").ok())
        .unwrap_or(0);

    // Page of rows. LIMIT/OFFSET are appended as trailing params.
    values.push((page_size as i64).into());
    let limit_idx = values.len();
    values.push((offset as i64).into());
    let offset_idx = values.len();
    let rows_sql = format!(
        "SELECT {SELECT_COLS} FROM {tbl} {where_sql} \
         ORDER BY {col} {dir} NULLS LAST, id ASC LIMIT ${limit_idx} OFFSET ${offset_idx}"
    );
    let rows = JobRaw::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        &rows_sql,
        values,
    ))
    .all(db)
    .await?
    .into_iter()
    .map(Job::from)
    .collect();

    let page_count = ((total as u64).max(1) + page_size - 1) / page_size;
    Ok(JobPage {
        rows,
        total,
        page,
        page_size,
        page_count: page_count.max(1),
    })
}

pub async fn get(db: &impl ConnectionTrait, id: &str) -> Result<Option<Job>> {
    let tbl = table();
    let sql = format!("SELECT {SELECT_COLS} FROM {tbl} WHERE id = $1 LIMIT 1");
    let row = JobRaw::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        &sql,
        [id.into()],
    ))
    .one(db)
    .await?;
    Ok(row.map(Job::from))
}

#[derive(Debug, Serialize)]
pub struct Stats {
    pub total: i64,
    pub by_status: std::collections::BTreeMap<String, i64>,
    pub due_now: i64,
    pub recurring: i64,
}

pub async fn stats(db: &impl ConnectionTrait) -> Result<Stats> {
    let tbl = table();
    let mut by_status: std::collections::BTreeMap<String, i64> =
        STATUSES.iter().map(|s| ((*s).to_string(), 0)).collect();

    let rows = db
        .query_all_raw(Statement::from_string(
            DbBackend::Postgres,
            format!("SELECT status, count(*)::bigint AS n FROM {tbl} GROUP BY status"),
        ))
        .await?;
    let mut total = 0i64;
    for r in rows {
        let status: String = r.try_get("", "status").unwrap_or_default();
        let n: i64 = r.try_get("", "n").unwrap_or(0);
        total += n;
        by_status.insert(status, n);
    }

    let due_now: i64 = db
        .query_one_raw(Statement::from_string(
            DbBackend::Postgres,
            format!("SELECT count(*)::bigint AS n FROM {tbl} WHERE status = 'queued' AND run_at <= NOW()"),
        ))
        .await?
        .and_then(|r| r.try_get::<i64>("", "n").ok())
        .unwrap_or(0);

    let recurring: i64 = db
        .query_one_raw(Statement::from_string(
            DbBackend::Postgres,
            format!("SELECT count(*)::bigint AS n FROM {tbl} WHERE interval IS NOT NULL"),
        ))
        .await?
        .and_then(|r| r.try_get::<i64>("", "n").ok())
        .unwrap_or(0);

    Ok(Stats {
        total,
        by_status,
        due_now,
        recurring,
    })
}

#[derive(Debug, Serialize)]
pub struct Facets {
    pub names: Vec<String>,
    pub tags: Vec<String>,
}

pub async fn facets(db: &impl ConnectionTrait) -> Result<Facets> {
    let tbl = table();
    let names = db
        .query_all_raw(Statement::from_string(
            DbBackend::Postgres,
            format!("SELECT DISTINCT name FROM {tbl} ORDER BY name LIMIT 500"),
        ))
        .await?
        .into_iter()
        .filter_map(|r| r.try_get::<String>("", "name").ok())
        .collect();
    let tags = db
        .query_all_raw(Statement::from_string(
            DbBackend::Postgres,
            format!(
                "SELECT DISTINCT jsonb_array_elements_text(tags) AS tag FROM {tbl} \
                 WHERE tags IS NOT NULL AND jsonb_typeof(tags) = 'array' ORDER BY tag LIMIT 500"
            ),
        ))
        .await?
        .into_iter()
        .filter_map(|r| r.try_get::<String>("", "tag").ok())
        .collect();
    Ok(Facets { names, tags })
}

/// Recent rows whose tags overlap any of the given tags (scheduler correlation).
pub async fn recent_by_tags(
    db: &impl ConnectionTrait,
    tags: &[String],
    limit: u64,
) -> Result<Vec<Job>> {
    if tags.is_empty() {
        return Ok(Vec::new());
    }
    let tbl = table();
    let sql = format!(
        "SELECT {SELECT_COLS} FROM {tbl} WHERE tags ?| $1 ORDER BY created_at DESC LIMIT {limit}"
    );
    // Postgres `?|` needs a text[]; pass the tag list as an array value.
    let arr = Value::Array(
        sea_orm::sea_query::ArrayType::String,
        Some(Box::new(tags.iter().map(|t| Value::from(t.clone())).collect())),
    );
    let rows = JobRaw::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        &sql,
        [arr],
    ))
    .all(db)
    .await?
    .into_iter()
    .map(Job::from)
    .collect();
    Ok(rows)
}

/* ------------------------------------------------------------- mutations */

async fn exec(db: &impl ConnectionTrait, sql: String, values: Vec<Value>) -> Result<u64> {
    let res = db
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            &sql,
            values,
        ))
        .await?;
    Ok(res.rows_affected())
}

pub async fn requeue(db: &impl ConnectionTrait, ids: &[String]) -> Result<u64> {
    if ids.is_empty() {
        return Ok(0);
    }
    let tbl = table();
    exec(
        db,
        format!("UPDATE {tbl} SET status = 'queued', run_at = NOW(), updated_at = NOW() WHERE id = ANY($1)"),
        vec![ids_value(ids)],
    )
    .await
}

pub async fn cancel(db: &impl ConnectionTrait, ids: &[String]) -> Result<u64> {
    if ids.is_empty() {
        return Ok(0);
    }
    let tbl = table();
    exec(
        db,
        format!("UPDATE {tbl} SET status = 'cancelled', updated_at = NOW() WHERE id = ANY($1) AND status IN ('queued','processing')"),
        vec![ids_value(ids)],
    )
    .await
}

pub async fn run_now(db: &impl ConnectionTrait, ids: &[String]) -> Result<u64> {
    if ids.is_empty() {
        return Ok(0);
    }
    let tbl = table();
    exec(
        db,
        format!("UPDATE {tbl} SET run_at = NOW(), status = 'queued', updated_at = NOW() WHERE id = ANY($1)"),
        vec![ids_value(ids)],
    )
    .await
}

pub async fn delete(db: &impl ConnectionTrait, ids: &[String]) -> Result<u64> {
    if ids.is_empty() {
        return Ok(0);
    }
    let tbl = table();
    exec(
        db,
        format!("DELETE FROM {tbl} WHERE id = ANY($1)"),
        vec![ids_value(ids)],
    )
    .await
}

pub async fn requeue_all_failed(db: &impl ConnectionTrait) -> Result<u64> {
    let tbl = table();
    exec(
        db,
        format!("UPDATE {tbl} SET status = 'queued', run_at = NOW(), updated_at = NOW() WHERE status = 'failed'"),
        vec![],
    )
    .await
}

pub async fn delete_by_status(db: &impl ConnectionTrait, status: &str) -> Result<u64> {
    if !is_status(status) {
        return Ok(0);
    }
    let tbl = table();
    exec(
        db,
        format!("DELETE FROM {tbl} WHERE status = $1"),
        vec![status.into()],
    )
    .await
}

fn ids_value(ids: &[String]) -> Value {
    Value::Array(
        sea_orm::sea_query::ArrayType::String,
        Some(Box::new(ids.iter().map(|s| Value::from(s.clone())).collect())),
    )
}
