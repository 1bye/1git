use rake::gpui::prelude::*;
use rake::gpui::{AnyView, Context, FocusHandle, Window};
use rake::prelude::*;
use rake::router::MountError;

use onegit_ui::{Button, ButtonVariant, Text, TextRole, TextTone, Theme};

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
        window: &mut Window,
        cx: &mut rake::gpui::App,
    ) -> Result<AnyView, MountError> {
        if rake::theme::try_current::<Theme>().is_none() {
            Theme::dark().install(cx);
        }

        match destination {
            Destination::Home => Ok(cx
                .new(|cx| {
                    let focus = cx.focus_handle();

                    window.focus(&focus, cx);

                    Home { page, focus }
                })
                .into()),
        }
    }
}

struct Home {
    page: PageContext<Destination>,
    focus: FocusHandle,
}

impl Render for Home {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        let navigator = self.page.navigator();

        rake::view! {
            <main class="size-full flex flex-col items-center justify-center gap-4 bg-background text-ink"
                focus={&self.focus} tab-navigation={true}>
                <Text role={TextRole::Heading} {..Text::new("title","1git")}/>
                <Text tone={TextTone::Muted} {..Text::new("subtitle","Your repositories, in focus.")}/>
                <Button variant={ButtonVariant::Primary}
                    on_press={Some(Box::new(move |_, _, _| {
                        drop(navigator.open(Destination::Home, OpenTarget::NewTab));
                    }))} {..Button::new("new-tab","New tab")}/>
            </main>
        }
    }
}
