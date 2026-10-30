//! Native 1git repository review, staging and commits on Rake with background Git operations.

mod routes;
mod workspace;

rake::theme!(onegit_ui::Theme);

use rake::prelude::*;

pub use routes::Destination;

/// Build the native application with a local repository workspace.
pub fn application() -> App<Destination> {
    App::new("dev.1git.rust")
        .workspace_chrome(false)
        .control(rake::control::ControlConfig::FromEnvironment)
        .window_options(rake::gpui::WindowOptions {
            window_bounds: Some(rake::gpui::WindowBounds::Windowed(rake::gpui::Bounds {
                origin: rake::gpui::point(rake::gpui::px(100.), rake::gpui::px(80.)),
                size: rake::gpui::size(rake::gpui::px(1080.), rake::gpui::px(740.)),
            })),
            window_min_size: Some(rake::gpui::size(rake::gpui::px(640.), rake::gpui::px(480.))),
            titlebar: Some(rake::gpui::TitlebarOptions {
                title: Some("1git".into()),
                ..Default::default()
            }),
            ..Default::default()
        })
        .routes(routes::AppRoutes)
}

#[rake::app]
fn app() -> App<Destination> {
    application()
}
