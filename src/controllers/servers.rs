//! Servers console API. Resolves the configured Loco servers and fetches their
//! health, `/_server` manifest and `/_metrics`.

use crate::servers;
use loco_rs::prelude::*;
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
struct ServersResponse {
    servers: Vec<servers::ServerMetrics>,
    resolver_error: Option<String>,
    configured: bool,
}

async fn index(State(_ctx): State<AppContext>) -> Result<Response> {
    let (list, resolver_error) = servers::resolve();
    let configured = !list.is_empty() || resolver_error.is_some();
    let timeout = Duration::from_millis(servers::timeout_ms());
    let metrics = servers::collect_all(list, timeout).await;

    format::json(ServersResponse {
        servers: metrics,
        resolver_error,
        configured,
    })
}

pub fn routes() -> Routes {
    Routes::new().prefix("/api/servers").add("/", get(index))
}
