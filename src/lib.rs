// This is an application crate, not a published library. A few pedantic/nursery
// lints are pure style noise here (documenting `# Errors` on internal helpers,
// `#[must_use]` on obvious getters, etc.), so they're allowed crate-wide while
// the substantive lints remain enforced.
#![allow(
    clippy::must_use_candidate,
    clippy::missing_errors_doc,
    clippy::ref_option,
    clippy::option_if_let_else,
    clippy::too_long_first_doc_paragraph
)]

pub mod app;
pub mod channels;
pub mod controllers;
pub mod data;
pub mod initializers;
pub mod mailers;
pub mod models;
pub mod queue;
pub mod scheduler_config;
pub mod servers;
pub mod tasks;
pub mod views;
pub mod workers;
