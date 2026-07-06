//! Background-jobs console API over the Loco `pg_loco_queue` table.

use crate::queue;
use axum::extract::Query;
use loco_rs::prelude::*;
use serde::Deserialize;

async fn list(
    State(ctx): State<AppContext>,
    Query(filters): Query<queue::JobFilters>,
) -> Result<Response> {
    format::json(queue::list(&ctx.db, &filters).await?)
}

async fn stats(State(ctx): State<AppContext>) -> Result<Response> {
    format::json(queue::stats(&ctx.db).await?)
}

async fn facets(State(ctx): State<AppContext>) -> Result<Response> {
    format::json(queue::facets(&ctx.db).await?)
}

async fn get_one(State(ctx): State<AppContext>, Path(id): Path<String>) -> Result<Response> {
    match queue::get(&ctx.db, &id).await? {
        Some(job) => format::json(job),
        None => not_found(),
    }
}

#[derive(Debug, Deserialize)]
struct ActionRequest {
    intent: String,
    #[serde(default)]
    ids: Vec<String>,
    #[serde(default)]
    status: Option<String>,
}

#[derive(serde::Serialize)]
struct ActionResponse {
    ok: bool,
    affected: u64,
    message: String,
}

async fn action(
    State(ctx): State<AppContext>,
    Json(req): Json<ActionRequest>,
) -> Result<Response> {
    let db = &ctx.db;
    let (affected, verb) = match req.intent.as_str() {
        "requeue" => (queue::requeue(db, &req.ids).await?, "Requeued"),
        "cancel" => (queue::cancel(db, &req.ids).await?, "Cancelled"),
        "run-now" => (queue::run_now(db, &req.ids).await?, "Scheduled to run now"),
        "delete" => (queue::delete(db, &req.ids).await?, "Deleted"),
        "requeue-all-failed" => (queue::requeue_all_failed(db).await?, "Requeued failed"),
        "purge-status" => {
            let status = req.status.clone().unwrap_or_default();
            (queue::delete_by_status(db, &status).await?, "Purged")
        }
        other => {
            return format::json(ActionResponse {
                ok: false,
                affected: 0,
                message: format!("Unknown action: {other}"),
            })
        }
    };

    format::json(ActionResponse {
        ok: true,
        affected,
        message: format!("{verb} {affected} job(s)."),
    })
}

pub fn routes() -> Routes {
    Routes::new()
        .prefix("/api/jobs")
        .add("/", get(list))
        .add("/stats", get(stats))
        .add("/facets", get(facets))
        .add("/actions", post(action))
        .add("/{id}", get(get_one))
}
