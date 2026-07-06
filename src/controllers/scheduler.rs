//! Scheduler console API. Reads the Loco `scheduler.yaml` and correlates each
//! tagged job with recent queue activity.

use crate::{queue, scheduler_config};
use loco_rs::prelude::*;
use serde::Serialize;

#[derive(Serialize)]
struct SchedulerResponse {
    #[serde(flatten)]
    config: scheduler_config::SchedulerConfig,
    recent: Vec<queue::Job>,
}

async fn index(State(ctx): State<AppContext>) -> Result<Response> {
    let config = scheduler_config::load();

    // Best-effort correlation: recent queue rows sharing any scheduled job's tag.
    let mut tags: Vec<String> = config.jobs.iter().flat_map(|j| j.tags.clone()).collect();
    tags.sort();
    tags.dedup();
    let recent = queue::recent_by_tags(&ctx.db, &tags, 50)
        .await
        .unwrap_or_default();

    format::json(SchedulerResponse { config, recent })
}

pub fn routes() -> Routes {
    Routes::new().prefix("/api/scheduler").add("/", get(index))
}
