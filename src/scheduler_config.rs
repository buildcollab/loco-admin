//! Reads a Loco `scheduler.yaml` and enriches each job with projected run
//! times. Loco's scheduler is config-driven (the schedule lives in a file, not
//! the database), so the admin app reads the same file the managed app uses.

use chrono::Utc;
use cron::Schedule;
use serde::Serialize;
use std::str::FromStr;

fn config_path() -> String {
    std::env::var("SCHEDULER_CONFIG_PATH").unwrap_or_else(|_| "scheduler.yaml".to_string())
}

#[derive(Debug, Serialize)]
pub struct ScheduledJob {
    pub name: String,
    pub run: String,
    pub shell: bool,
    pub run_on_start: bool,
    pub schedule: String,
    pub tags: Vec<String>,
    pub next_runs: Vec<String>,
    pub is_english: bool,
    pub parse_error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SchedulerConfig {
    pub path: String,
    pub exists: bool,
    pub error: Option<String>,
    pub jobs: Vec<ScheduledJob>,
}

/// Loco treats an expression starting with `*` or a digit as standard cron;
/// anything else is an english expression it converts at runtime.
fn looks_like_cron(schedule: &str) -> bool {
    schedule
        .trim()
        .chars()
        .next()
        .is_some_and(|c| c == '*' || c.is_ascii_digit())
}

/// Loco's cron allows an optional trailing year field which the `cron` crate
/// rejects; `cron` also wants 6 fields (with seconds). Normalise to that.
fn normalize_cron(schedule: &str) -> String {
    let parts: Vec<&str> = schedule.split_whitespace().collect();
    match parts.len() {
        7 => parts[..6].join(" "),
        _ => parts.join(" "),
    }
}

fn compute_next(schedule: &str, count: usize) -> (Vec<String>, bool, Option<String>) {
    if !looks_like_cron(schedule) {
        return (Vec::new(), true, None);
    }
    match Schedule::from_str(&normalize_cron(schedule)) {
        Ok(sched) => {
            let runs = sched
                .upcoming(Utc)
                .take(count)
                .map(|d| d.to_rfc3339())
                .collect();
            (runs, false, None)
        }
        Err(err) => (Vec::new(), false, Some(err.to_string())),
    }
}

/* --------------------------------------------- raw YAML shapes (serde) */

#[derive(Debug, serde::Deserialize)]
struct RawJob {
    #[serde(default)]
    run: String,
    #[serde(default)]
    shell: bool,
    #[serde(default)]
    run_on_start: bool,
    #[serde(default, alias = "cron")]
    schedule: String,
    #[serde(default)]
    tags: Option<Vec<String>>,
}

#[derive(Debug, serde::Deserialize)]
struct RawScheduler {
    #[serde(default)]
    jobs: std::collections::BTreeMap<String, RawJob>,
}

#[derive(Debug, serde::Deserialize)]
struct RawRoot {
    // A full Loco config nests everything under `scheduler:`; a standalone file
    // has `jobs:` at the root. Support both.
    scheduler: Option<RawScheduler>,
    #[serde(default)]
    jobs: std::collections::BTreeMap<String, RawJob>,
}

pub fn load() -> SchedulerConfig {
    let path = config_path();
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => {
            return SchedulerConfig {
                path,
                exists: false,
                error: None,
                jobs: Vec::new(),
            }
        }
    };

    let root: RawRoot = match serde_yaml::from_str(&raw) {
        Ok(r) => r,
        Err(err) => {
            return SchedulerConfig {
                path,
                exists: true,
                error: Some(err.to_string()),
                jobs: Vec::new(),
            }
        }
    };

    let jobs_map = root.scheduler.map_or(root.jobs, |s| s.jobs);
    let mut jobs: Vec<ScheduledJob> = jobs_map
        .into_iter()
        .map(|(name, j)| {
            let (next_runs, is_english, parse_error) = compute_next(&j.schedule, 5);
            ScheduledJob {
                name,
                run: j.run,
                shell: j.shell,
                run_on_start: j.run_on_start,
                schedule: j.schedule,
                tags: j.tags.unwrap_or_default(),
                next_runs,
                is_english,
                parse_error,
            }
        })
        .collect();

    // Soonest-scheduled first.
    jobs.sort_by(|a, b| match (a.next_runs.first(), b.next_runs.first()) {
        (Some(x), Some(y)) => x.cmp(y),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a.name.cmp(&b.name),
    });

    SchedulerConfig {
        path,
        exists: true,
        error: None,
        jobs,
    }
}
