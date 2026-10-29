use crate::Theme;
use rake::gpui::{self, ElementId, SharedString, prelude::*};

/// Paired size/leading presets for compact native typography.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TextRole {
    /// Normal 12/18-pixel content.
    #[default]
    Body,
    /// Secondary 10/14-pixel metadata.
    Caption,
    /// Section title at 14/20 pixels.
    Title,
    /// Page heading at 20/28 pixels.
    Heading,
    /// Monospace content at 11/20 pixels.
    Code,
}

/// Semantic text emphasis, independent of typography size.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TextTone {
    /// Main content.
    #[default]
    Neutral,
    /// Secondary information.
    Muted,
    /// Accent information.
    Accent,
    /// Positive status.
    Success,
    /// Caution status.
    Warning,
    /// Error/destructive status.
    Danger,
}

impl TextTone {
    pub(crate) fn color(self, theme: &Theme) -> gpui::Hsla {
        match self {
            Self::Neutral => theme.ink,
            Self::Muted => theme.muted_ink,
            Self::Accent => theme.accent,
            Self::Success => theme.success,
            Self::Warning => theme.warning,
            Self::Danger => theme.danger,
        }
    }
}

/// A themed paragraph with a full accessible label and optional visual ellipsis.
#[derive(Debug, IntoElement)]
pub struct Text {
    /// Stable root identity, scoped beneath its parent.
    pub id: ElementId,
    /// Full content, including Unicode.
    pub content: SharedString,
    /// Size, line height and default weight.
    pub role: TextRole,
    /// Semantic foreground color.
    pub tone: TextTone,
    /// Optional visible line limit; accessibility retains the full text.
    pub max_lines: Option<usize>,
}

impl Text {
    /// Construct wrapping body text with a stable identity.
    #[must_use]
    pub fn new(id: impl Into<ElementId>, content: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            content: content.into(),
            role: TextRole::Body,
            tone: TextTone::Neutral,
            max_lines: None,
        }
    }
}

impl RenderOnce for Text {
    fn render(self, _: &mut gpui::Window, _: &mut gpui::App) -> impl IntoElement {
        let theme = Theme::current();
        let color = self.tone.color(&theme);
        // Rake's paragraph owns wrapping and preserves the complete accessible name.
        let limit = self.max_lines.unwrap_or(usize::MAX).max(1);

        rake::view! {
            <p id={self.id} class={match self.role {
                    TextRole::Body => "min-w-0 text-body",
                    TextRole::Caption => "min-w-0 text-caption",
                    TextRole::Title => "min-w-0 text-title",
                    TextRole::Heading => "min-w-0 text-heading",
                    TextRole::Code => "min-w-0 text-code font-mono",
                }}
                style={|s| s.text_color(color)
                    .when(matches!(self.role,TextRole::Heading|TextRole::Title),|s|
                        s.role(gpui::accesskit::Role::Heading)
                            .aria_level(if self.role==TextRole::Heading {1} else {2})
                            .aria_label(self.content.clone()))}
                max-lines={limit} ellipsis={self.max_lines.is_some()}>
                {self.content}
            </p>
        }
    }
}
