use rake::gpui::prelude::*;
use rake::gpui::{AnyView, Context, Window, div};
use rake::prelude::*;
use rake::router::MountError;

use onegit_ui::{Button, ButtonVariant, Theme};

/// Every screen the application can open in a tab.
#[derive(Clone, Route)]
pub enum Destination {
    /// Repository library.
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
        _window: &mut Window,
        cx: &mut rake::gpui::App,
    ) -> Result<AnyView, MountError> {
        match destination {
            Destination::Home => Ok(cx.new(|_| Home { page }).into()),
        }
    }
}

struct Home {
    page: PageContext<Destination>,
}

impl Render for Home {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        let theme = Theme::default();
        let navigator = self.page.navigator();

        div()
            .size_full()
            .flex()
            .flex_col()
            .justify_center()
            .items_center()
            .gap_4()
            .bg(theme.background)
            .text_color(theme.foreground)
            .child(div().text_3xl().child("1git"))
            .child(div().text_color(theme.muted).child("Rust + GPUI on Rake"))
            .child(
                Button::new("new-tab", "New tab")
                    .variant(ButtonVariant::Primary)
                    .on_click(move |_, _, _| {
                        drop(navigator.open(Destination::Home, OpenTarget::NewTab));
                    }),
            )
    }
}
