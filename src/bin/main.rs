// The Loco boot/CLI future is inherently large (it wires up the whole app);
// this nursery lint isn't actionable at the application level.
#![allow(clippy::large_futures)]

use loco_admin::app::App;
use loco_rs::cli;
use migration::Migrator;

#[tokio::main]
async fn main() -> loco_rs::Result<()> {
    cli::main::<App, Migrator>().await
}
