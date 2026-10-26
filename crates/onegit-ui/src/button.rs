use gpui::prelude::*;
use gpui::{App, ClickEvent, ColorExt, ElementId, SharedString, Window, div};

use crate::Theme;

type ClickHandler = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

/// Visual weight of a [`Button`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ButtonVariant {
    /// Neutral surface button.
    #[default]
    Secondary,
    /// Accent-filled button for the main action.
    Primary,
}

/// A clickable text button.
#[derive(IntoElement)]
pub struct Button {
    id: ElementId,
    label: SharedString,
    variant: ButtonVariant,
    theme: Theme,
    on_click: Option<ClickHandler>,
}

impl Button {
    /// Creates a secondary button with a stable element ID.
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            variant: ButtonVariant::default(),
            theme: Theme::default(),
            on_click: None,
        }
    }

    /// Sets the visual weight.
    pub fn variant(mut self, variant: ButtonVariant) -> Self {
        self.variant = variant;

        self
    }

    /// Uses colors from `theme` instead of the default palette.
    pub fn theme(mut self, theme: Theme) -> Self {
        self.theme = theme;

        self
    }

    /// Runs `handler` when the button is clicked.
    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Box::new(handler));

        self
    }
}

impl RenderOnce for Button {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let theme = self.theme;

        let (background, hover, foreground) = match self.variant {
            ButtonVariant::Primary => (
                theme.accent,
                theme.accent.opacity(0.85),
                theme.accent_foreground,
            ),
            ButtonVariant::Secondary => (theme.surface, theme.surface_hover, theme.foreground),
        };

        div()
            .id(self.id)
            .px_3()
            .py_1p5()
            .rounded_md()
            .text_sm()
            .bg(background)
            .text_color(foreground)
            .cursor_pointer()
            .hover(move |style| style.bg(hover))
            .child(self.label)
            .when_some(self.on_click, |button, handler| button.on_click(handler))
    }
}
