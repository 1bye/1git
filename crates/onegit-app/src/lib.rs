//! The 1git application shell: routes, commands and services on Rake.

mod routes;

use rake::prelude::*;

pub use routes::Destination;

/// Builds the application. Native startup and future Web export share it.
pub fn application() -> App<Destination> {
    App::new("dev.1git.rust")
        .control(rake::control::ControlConfig::FromEnvironment)
        .routes(routes::AppRoutes)
}

#[rake::app]
fn app() -> App<Destination> {
    application()
}
