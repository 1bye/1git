use rake::gpui::prelude::*;
use rake::gpui::{AnyView, Window};
use rake::prelude::*;
use rake::router::MountError;

use crate::workspace::Workspace;
use onegit_ui::Theme;

/// Every screen the application can open in a tab.
#[derive(Clone, Route)]
pub enum Destination {
    /// Local repository workspace.
    #[route(id = "home", path = "/")]
    Home,
}

/// Mounts a view for each destination.
pub(crate) struct AppRoutes;

impl RouteViews<Destination> for AppRoutes {
    fn mount(
        &self,
        destination: &Destination,
        page: PageContext<Destination>,
        window: &mut Window,
        cx: &mut rake::gpui::App,
    ) -> Result<AnyView, MountError> {
        if rake::theme::try_current::<Theme>().is_none() {
            let theme = match cx.window_appearance() {
                rake::gpui::WindowAppearance::Dark | rake::gpui::WindowAppearance::VibrantDark => {
                    Theme::dark()
                }
                _ => Theme::light(),
            };

            theme.install(cx);
        }

        match destination {
            Destination::Home => Ok(cx
                .new(|cx| {
                    let mut workspace = Workspace::new(window, cx, Some(page.app().tasks()));

                    workspace.load_home(cx);

                    workspace
                })
                .into()),
        }
    }
}
