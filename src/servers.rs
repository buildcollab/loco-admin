//! Servers console: discover other Loco servers and fetch their health,
//! `/_server` manifest and `/_metrics` (the endpoints added in the fork).
//!
//! Discovery is pluggable behind [`Resolver`]; only [`StaticResolver`] (a fixed
//! list from configuration) is implemented today, but dynamic resolvers
//! (Kubernetes, service registries) can be added without touching collection.

use serde::Serialize;
use std::collections::BTreeMap;
use std::time::Duration;

/* --------------------------------------------------------------- resolver */

#[derive(Debug, Clone, Serialize)]
pub struct Server {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub tags: Vec<String>,
    pub metrics_path: Option<String>,
    pub source: String,
}

#[derive(Debug, serde::Deserialize)]
struct RawServer {
    name: String,
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    tags: Option<Vec<String>>,
    #[serde(default)]
    metrics_path: Option<String>,
}

fn slug(name: &str) -> String {
    let s: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() {
        "server".to_string()
    } else {
        s
    }
}

/// Load the static server list from `LOCO_SERVERS` (inline JSON) or
/// `LOCO_SERVERS_FILE` (JSON/YAML: a bare list or `{ servers: [...] }`).
/// Returns `(servers, resolver_error)`.
pub fn resolve() -> (Vec<Server>, Option<String>) {
    let raw = if let Ok(inline) = std::env::var("LOCO_SERVERS") {
        Some(inline)
    } else if let Ok(path) = std::env::var("LOCO_SERVERS_FILE") {
        match std::fs::read_to_string(&path) {
            Ok(s) => Some(s),
            Err(_) => return (Vec::new(), Some(format!("could not read {path}"))),
        }
    } else {
        None
    };

    let Some(raw) = raw else {
        return (Vec::new(), None);
    };

    // serde_yaml parses JSON too, so it covers both env and file formats.
    let list: Vec<RawServer> = match serde_yaml::from_str::<ServersDoc>(&raw) {
        Ok(doc) => doc.into_list(),
        Err(err) => return (Vec::new(), Some(err.to_string())),
    };

    let mut seen = std::collections::HashSet::new();
    let mut servers = Vec::new();
    for r in list {
        let base = r.base_url.or(r.url).unwrap_or_default();
        if base.is_empty() {
            return (Vec::new(), Some(format!("server \"{}\" is missing base_url", r.name)));
        }
        let base_url = base.trim_end_matches('/').to_string();
        let mut id = slug(&r.name);
        let mut n = 2;
        while !seen.insert(id.clone()) {
            id = format!("{}-{}", slug(&r.name), n);
            n += 1;
        }
        servers.push(Server {
            id,
            name: r.name,
            base_url,
            tags: r.tags.unwrap_or_default(),
            metrics_path: r.metrics_path.map(|p| {
                if p.starts_with('/') {
                    p
                } else {
                    format!("/{p}")
                }
            }),
            source: "static".to_string(),
        });
    }
    (servers, None)
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
enum ServersDoc {
    Wrapped { servers: Vec<RawServer> },
    Bare(Vec<RawServer>),
}

impl ServersDoc {
    fn into_list(self) -> Vec<RawServer> {
        match self {
            Self::Wrapped { servers } => servers,
            Self::Bare(list) => list,
        }
    }
}

/* ------------------------------------------------------------- collection */

const HEALTH_PROBES: [(&str, &str); 3] = [
    ("ping", "/_ping"),
    ("health", "/_health"),
    ("readiness", "/_readiness"),
];
const SERVER_INFO_PATH: &str = "/_server";
const DEFAULT_METRICS_PATH: &str = "/_metrics";

#[derive(Debug, Serialize)]
pub struct Probe {
    pub key: String,
    pub path: String,
    pub ok: bool,
    pub status: u16,
    pub latency_ms: Option<u128>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PromSample {
    pub labels: BTreeMap<String, String>,
    pub value: f64,
}

#[derive(Debug, Serialize)]
pub struct PromFamily {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub help: Option<String>,
    pub samples: Vec<PromSample>,
}

#[derive(Debug, Serialize)]
pub struct MetricsResult {
    pub ok: bool,
    pub path: String,
    pub not_found: bool,
    pub error: Option<String>,
    pub families: Vec<PromFamily>,
    pub sample_count: usize,
}

#[derive(Debug, Serialize)]
pub struct ServerInfoResult {
    pub ok: bool,
    pub not_found: bool,
    pub error: Option<String>,
    pub info: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct ServerMetrics {
    pub server: Server,
    pub status: String, // up | degraded | down
    pub latency_ms: Option<u128>,
    pub probes: Vec<Probe>,
    pub server_info: ServerInfoResult,
    pub metrics: MetricsResult,
    pub uptime_seconds: Option<f64>,
}

fn client(timeout: Duration) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .unwrap_or_default()
}

pub fn timeout_ms() -> u64 {
    std::env::var("METRICS_TIMEOUT_MS")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|n| *n > 0)
        .unwrap_or(4000)
}

async fn run_probe(client: &reqwest::Client, base: &str, key: &str, path: &str) -> Probe {
    let start = std::time::Instant::now();
    match client.get(format!("{base}{path}")).send().await {
        Ok(resp) => {
            let status = resp.status();
            let latency = start.elapsed().as_millis();
            let mut ok = status.is_success();
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                if let Some(b) = body.get("ok").and_then(serde_json::Value::as_bool) {
                    ok = ok && b;
                }
            }
            Probe {
                key: key.to_string(),
                path: path.to_string(),
                ok,
                status: status.as_u16(),
                latency_ms: Some(latency),
                error: None,
            }
        }
        Err(err) => Probe {
            key: key.to_string(),
            path: path.to_string(),
            ok: false,
            status: 0,
            latency_ms: None,
            error: Some(short_err(&err)),
        },
    }
}

async fn fetch_server_info(client: &reqwest::Client, base: &str) -> ServerInfoResult {
    match client.get(format!("{base}{SERVER_INFO_PATH}")).send().await {
        Ok(resp) => {
            let status = resp.status();
            if !status.is_success() {
                return ServerInfoResult {
                    ok: false,
                    not_found: status.as_u16() == 404,
                    error: Some(format!("HTTP {}", status.as_u16())),
                    info: None,
                };
            }
            match resp.json::<serde_json::Value>().await {
                Ok(info) => ServerInfoResult {
                    ok: true,
                    not_found: false,
                    error: None,
                    info: Some(info),
                },
                Err(err) => ServerInfoResult {
                    ok: false,
                    not_found: false,
                    error: Some(short_err(&err)),
                    info: None,
                },
            }
        }
        Err(err) => ServerInfoResult {
            ok: false,
            not_found: false,
            error: Some(short_err(&err)),
            info: None,
        },
    }
}

async fn scrape_metrics(client: &reqwest::Client, base: &str, path: &str) -> MetricsResult {
    match client.get(format!("{base}{path}")).send().await {
        Ok(resp) => {
            let status = resp.status();
            if !status.is_success() {
                return MetricsResult {
                    ok: false,
                    path: path.to_string(),
                    not_found: status.as_u16() == 404,
                    error: Some(format!("HTTP {}", status.as_u16())),
                    families: Vec::new(),
                    sample_count: 0,
                };
            }
            match resp.text().await {
                Ok(text) => {
                    let (families, sample_count) = parse_prometheus(&text);
                    MetricsResult {
                        ok: true,
                        path: path.to_string(),
                        not_found: false,
                        error: None,
                        families,
                        sample_count,
                    }
                }
                Err(err) => MetricsResult {
                    ok: false,
                    path: path.to_string(),
                    not_found: false,
                    error: Some(short_err(&err)),
                    families: Vec::new(),
                    sample_count: 0,
                },
            }
        }
        Err(err) => MetricsResult {
            ok: false,
            path: path.to_string(),
            not_found: false,
            error: Some(short_err(&err)),
            families: Vec::new(),
            sample_count: 0,
        },
    }
}

fn short_err(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        "request timed out".to_string()
    } else if err.is_connect() {
        "connection failed".to_string()
    } else {
        err.to_string()
    }
}

fn derive_status(probes: &[Probe]) -> String {
    let ping_ok = probes.iter().find(|p| p.key == "ping").is_some_and(|p| p.ok);
    if !ping_ok {
        return "down".to_string();
    }
    let dep_failing = probes.iter().any(|p| p.key != "ping" && !p.ok);
    if dep_failing {
        "degraded".to_string()
    } else {
        "up".to_string()
    }
}

pub async fn collect_one(server: Server, timeout: Duration) -> ServerMetrics {
    let client = client(timeout);
    let base = server.base_url.clone();

    let probes_fut = futures::future::join_all(
        HEALTH_PROBES
            .iter()
            .map(|(key, path)| run_probe(&client, &base, key, path)),
    );
    let info_fut = fetch_server_info(&client, &base);
    let metrics_path = server
        .metrics_path
        .clone()
        .unwrap_or_else(|| DEFAULT_METRICS_PATH.to_string());
    let metrics_fut = scrape_metrics(&client, &base, &metrics_path);

    let (probes, server_info, metrics) = futures::join!(probes_fut, info_fut, metrics_fut);

    let latency_ms = probes
        .iter()
        .find(|p| p.key == "ping")
        .and_then(|p| p.latency_ms);
    let uptime_seconds = metrics
        .families
        .iter()
        .find(|f| f.name == "loco_uptime_seconds")
        .and_then(|f| f.samples.first())
        .map(|s| s.value);

    ServerMetrics {
        status: derive_status(&probes),
        latency_ms,
        probes,
        server_info,
        metrics,
        uptime_seconds,
        server,
    }
}

pub async fn collect_all(servers: Vec<Server>, timeout: Duration) -> Vec<ServerMetrics> {
    futures::future::join_all(servers.into_iter().map(|s| collect_one(s, timeout))).await
}

/* --------------------------------------------- prometheus text parser */

fn parse_value(token: &str) -> f64 {
    match token {
        "+Inf" => f64::INFINITY,
        "-Inf" => f64::NEG_INFINITY,
        "NaN" => f64::NAN,
        other => other.parse().unwrap_or(f64::NAN),
    }
}

fn parse_labels(inner: &str) -> BTreeMap<String, String> {
    let mut labels = BTreeMap::new();
    let bytes = inner.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // key
        let key_start = i;
        while i < bytes.len() && (bytes[i] == b'_' || bytes[i].is_ascii_alphanumeric()) {
            i += 1;
        }
        if i == key_start {
            i += 1;
            continue;
        }
        let key = &inner[key_start..i];
        while i < bytes.len() && bytes[i] != b'"' {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        i += 1; // opening quote
        let mut value = String::new();
        while i < bytes.len() && bytes[i] != b'"' {
            if bytes[i] == b'\\' && i + 1 < bytes.len() {
                i += 1;
                match bytes[i] {
                    b'n' => value.push('\n'),
                    b'"' => value.push('"'),
                    b'\\' => value.push('\\'),
                    other => value.push(other as char),
                }
            } else {
                value.push(bytes[i] as char);
            }
            i += 1;
        }
        i += 1; // closing quote
        labels.insert(key.to_string(), value);
        while i < bytes.len() && (bytes[i] == b',' || bytes[i] == b' ') {
            i += 1;
        }
    }
    labels
}

const MAX_SAMPLES_PER_FAMILY: usize = 50;

/// Get-or-insert a family, recording first-seen order.
fn family_mut<'a>(
    order: &mut Vec<String>,
    families: &'a mut BTreeMap<String, PromFamily>,
    name: &str,
) -> &'a mut PromFamily {
    if !families.contains_key(name) {
        order.push(name.to_string());
        families.insert(
            name.to_string(),
            PromFamily {
                name: name.to_string(),
                kind: None,
                help: None,
                samples: Vec::new(),
            },
        );
    }
    families.get_mut(name).unwrap()
}

/// Parse Prometheus text exposition format. Returns `(families, total_samples)`.
pub fn parse_prometheus(text: &str) -> (Vec<PromFamily>, usize) {
    // Preserve first-seen family order.
    let mut order: Vec<String> = Vec::new();
    let mut families: BTreeMap<String, PromFamily> = BTreeMap::new();
    let mut sample_count = 0usize;

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix('#') {
            let rest = rest.trim_start();
            if let Some(h) = rest.strip_prefix("HELP ") {
                let mut it = h.splitn(2, ' ');
                if let Some(name) = it.next() {
                    family_mut(&mut order, &mut families, name).help =
                        it.next().map(|s| s.to_string());
                }
            } else if let Some(t) = rest.strip_prefix("TYPE ") {
                let mut it = t.splitn(2, ' ');
                if let Some(name) = it.next() {
                    family_mut(&mut order, &mut families, name).kind =
                        it.next().map(|s| s.trim().to_string());
                }
            }
            continue;
        }

        // <name>[{labels}] <value> [timestamp]
        let (name, labels, rest) = if let Some(brace) = line.find('{') {
            let name = &line[..brace];
            let Some(close) = line.rfind('}') else { continue };
            let labels = parse_labels(&line[brace + 1..close]);
            (name, labels, line[close + 1..].trim())
        } else if let Some(sp) = line.find(' ') {
            (&line[..sp], BTreeMap::new(), line[sp + 1..].trim())
        } else {
            continue;
        };

        let Some(token) = rest.split_whitespace().next() else {
            continue;
        };
        sample_count += 1;
        let fam = family_mut(&mut order, &mut families, name);
        if fam.samples.len() < MAX_SAMPLES_PER_FAMILY {
            fam.samples.push(PromSample {
                labels,
                value: parse_value(token),
            });
        }
    }

    let ordered = order
        .into_iter()
        .filter_map(|n| families.remove(&n))
        .collect();
    (ordered, sample_count)
}
