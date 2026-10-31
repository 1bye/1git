use crate::motion::{self, Surface};
use crate::{Icon, IconName, IconSize, Theme, focusable};
use rake::gpui::{self, ClickEvent, ElementId, Hsla, SharedString, prelude::*, px};

/// Native activation callback; invoked for mouse and keyboard activation.
pub type PressHandler = Box<dyn Fn(&ClickEvent, &mut gpui::Window, &mut gpui::App)>;

/// Visual prominence, independent of the action's semantic meaning.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ButtonVariant {
    /// Filled accent action.
    Primary,
    /// Neutral raised action.
    #[default]
    Secondary,
    /// Low-emphasis transparent action.
    Ghost,
    /// Neutral pill action used by native-style confirmation alerts.
    Alert,
}

/// Ordinary or explicitly destructive action appearance.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ButtonTone {
    /// Ordinary action.
    #[default]
    Normal,
    /// Destructive action.
    Danger,
}

/// Shared action geometry in logical pixels.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ControlSize {
    /// Forty-pixel Home library search and view controls.
    Library,
    /// Compact 24-pixel control.
    Small,
    /// Standard 28-pixel control.
    #[default]
    Medium,
    /// Thirty-two-pixel workspace rail control.
    Rail,
    /// Prominent 34-pixel control.
    Large,
}

impl ControlSize {
    /// Control height; icon buttons use the same width.
    #[must_use]
    pub const fn height(self) -> f32 {
        match self {
            Self::Small => 24.,
            Self::Medium => 28.,
            Self::Large => 34.,
            Self::Rail => 32.,
            Self::Library => 40.,
        }
    }

    fn padding(self) -> f32 {
        match self {
            Self::Small => 8.,
            Self::Medium => 10.,
            Self::Large => 14.,
            Self::Rail => 10.,
            Self::Library => 12.,
        }
    }
}

/// Mutually exclusive activation states; busy controls cannot activate again.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ControlState {
    /// Available for pointer and keyboard activation.
    #[default]
    Enabled,
    /// Unavailable and omitted from sequential keyboard navigation.
    Disabled,
    /// Work is already in progress; retains its label and shows a work indicator.
    Busy,
}

impl ControlState {
    /// Whether this control can accept another activation.
    #[must_use]
    pub const fn is_interactive(self) -> bool {
        matches!(self, Self::Enabled)
    }
}

/// Themed action, with explicit identity and markup-friendly typed properties.
#[derive(IntoElement)]
pub struct Button {
    /// Stable identity forwarded to the native button.
    pub id: ElementId,
    /// Visible label; an icon-only action should use [`IconButton`].
    pub label: SharedString,
    /// Visual emphasis.
    pub variant: ButtonVariant,
    /// Action meaning.
    pub tone: ButtonTone,
    /// Control geometry.
    pub size: ControlSize,
    /// Optional explicit logical width, included in size transitions.
    pub width: Option<gpui::Pixels>,
    /// Optional corner radius for native-style alert actions.
    pub radius: Option<gpui::Pixels>,
    /// Availability and work state.
    pub state: ControlState,
    /// Optional decorative leading glyph.
    pub icon: Option<IconName>,
    /// Optional accessible name overriding the visible label.
    pub accessibility_label: Option<SharedString>,
    /// Optional retained focus target, for dialog initial focus or programmatic focus.
    pub focus: Option<gpui::FocusHandle>,
    /// Optional activation callback; availability is enforced before dispatch.
    pub on_press: Option<PressHandler>,
}

impl Button {
    /// Create an enabled, medium secondary action with a required stable ID.
    #[must_use]
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            variant: ButtonVariant::Secondary,
            tone: ButtonTone::Normal,
            size: ControlSize::Medium,
            width: None,
            radius: None,
            state: ControlState::Enabled,
            icon: None,
            accessibility_label: None,
            focus: None,
            on_press: None,
        }
    }

    /// Choose the visual prominence; usable alongside markup properties.
    #[must_use]
    pub fn variant(mut self, variant: ButtonVariant) -> Self {
        self.variant = variant;

        self
    }

    /// Install a native pointer/keyboard activation callback.
    #[must_use]
    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut gpui::Window, &mut gpui::App) + 'static,
    ) -> Self {
        self.on_press = Some(Box::new(handler));

        self
    }
}

impl std::fmt::Debug for Button {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Button")
            .field("id", &self.id)
            .field("label", &self.label)
            .field("variant", &self.variant)
            .field("tone", &self.tone)
            .field("size", &self.size)
            .field("state", &self.state)
            .finish_non_exhaustive()
    }
}

impl RenderOnce for Button {
    fn render(self, window: &mut gpui::Window, cx: &mut gpui::App) -> impl IntoElement {
        let focus = self.focus.clone().unwrap_or_else(|| {
            window
                .use_keyed_state(self.id.clone(), cx, |_, cx| cx.focus_handle())
                .read(cx)
                .clone()
        });

        let theme = Theme::current();
        let enabled = self.state.is_interactive();
        let busy = self.state == ControlState::Busy;
        let icon_only = self.label.is_empty();

        let (background, hover, pressed, foreground): (Hsla, Hsla, Hsla, Hsla) =
            match (self.variant, self.tone) {
                (ButtonVariant::Primary, ButtonTone::Normal) => (
                    theme.primary,
                    theme.primary_hover,
                    theme.primary_pressed,
                    theme.on_primary,
                ),
                (ButtonVariant::Primary, ButtonTone::Danger) => (
                    theme.danger_fill,
                    theme.danger_hover,
                    theme.danger_pressed,
                    theme.on_danger,
                ),
                (ButtonVariant::Alert, tone) => {
                    let dark = theme.appearance == crate::Appearance::Dark;

                    (
                        gpui::rgb_to_hsla(gpui::rgb(if dark { 0x626262 } else { 0xdcdcdc })),
                        gpui::rgb_to_hsla(gpui::rgb(if dark { 0x6b6b6b } else { 0xd2d2d2 })),
                        gpui::rgb_to_hsla(gpui::rgb(if dark { 0x707070 } else { 0xc7c7c7 })),
                        if tone == ButtonTone::Danger {
                            theme.danger
                        } else {
                            theme.ink
                        },
                    )
                }
                (ButtonVariant::Secondary, tone) => (
                    theme.surface_raised,
                    theme.hover,
                    theme.pressed,
                    if tone == ButtonTone::Danger {
                        theme.danger
                    } else {
                        theme.ink
                    },
                ),
                (ButtonVariant::Ghost, tone) => (
                    Theme::transparent(),
                    theme.hover,
                    theme.pressed,
                    if tone == ButtonTone::Danger {
                        theme.danger
                    } else {
                        theme.ink
                    },
                ),
            };

        let label = self
            .accessibility_label
            .unwrap_or_else(|| self.label.clone());

        let glyph = if busy {
            Some(IconName::Working)
        } else {
            self.icon
        };

        let rest = Surface {
            background,
            ink: foreground,
            opacity: if enabled { 1. } else { 0.5 },
            ..Surface::new(background)
        };

        // The inert measurement uses the same native geometry and typography as
        // the live control, without duplicate focus handles or event listeners.
        let icon_size = if self.size == ControlSize::Rail {
            IconSize::Navigation
        } else if self.size == ControlSize::Small {
            IconSize::Small
        } else {
            IconSize::Medium
        };

        let measurement = rake::view! {
            <div class="flex flex-row items-center justify-center gap-1.5 shrink-0 min-w-0 font-medium border-1"
                style={|s| s.h(px(self.size.height()))
                    .px(px(if icon_only {0.} else {self.size.padding()}))
                    .when(icon_only, |s| s.w(px(self.size.height())))
                    .when_some(self.width, |s, width| s.w(width))}>
                if glyph.is_some() { <div style={|s| s.size(px(icon_size.pixels())).flex_shrink_0()}/> }
                if !icon_only {
                    <p class={if self.variant==ButtonVariant::Alert {"text-body min-w-0 font-normal"}else{"text-body min-w-0 font-medium"}} wrap={false} ellipsis={true}>{self.label.clone()}</p>
                }
            </div>
        };

        motion::resize(self.id.clone(), measurement, move |dimensions| {
            motion::surface(
                "surface".into(),
                rest,
                Surface {
                    background: hover,
                    ..rest
                },
                Surface {
                    background: pressed,
                    ..rest
                },
                enabled,
                move |paint| {
                    rake::view! {
                        <button id={self.id} focus={&focus} disabled={!enabled} aria-label={label}
                            aria-description={if busy { "In progress" } else { "" }}
                            class="flex flex-row items-center justify-center gap-1.5 shrink-0 min-w-0 max-w-[100%] font-medium"
                            style={|s| focusable(s).w(dimensions.width).h(dimensions.height)
                                .px(px(if icon_only {0.} else {self.size.padding()}))
                                .bg(paint.background).text_color(paint.ink).border_color(paint.border)
                                .when_some(self.radius, |s,radius|s.rounded(radius))
                                .opacity(paint.opacity)}
                            on:click={move |event, window, cx| {
                                cx.stop_propagation();
                                if let Some(handler)=&self.on_press { handler(event,window,cx); }
                            }}>
                            if let Some(name)=glyph {
                                <Icon name={name} size={icon_size}
                                    {..Icon::new("glyph", name)}/>
                            }
                            if !icon_only {
                                <p class={if self.variant==ButtonVariant::Alert {"text-body min-w-0 font-normal"}else{"text-body min-w-0 font-medium"}} wrap={false} ellipsis={true}>{self.label}</p>
                            }
                        </button>
                    }
                },
            )
        })
    }
}

/// A square action with a required accessible name and the same variants as [`Button`].
#[derive(IntoElement)]
pub struct IconButton {
    /// Stable native control identity.
    pub id: ElementId,
    /// Accessible action name, independent of the decorative glyph.
    pub label: SharedString,
    /// Visible glyph.
    pub icon: IconName,
    /// Visual emphasis.
    pub variant: ButtonVariant,
    /// Action meaning.
    pub tone: ButtonTone,
    /// Square control size.
    pub size: ControlSize,
    /// Activation state.
    pub state: ControlState,
    /// Optional retained focus target for keyboard interaction and restoration.
    pub focus: Option<gpui::FocusHandle>,
    /// Native activation callback.
    pub on_press: Option<PressHandler>,
}

impl IconButton {
    /// Create an enabled medium ghost action. Supply a meaningful accessible label.
    #[must_use]
    pub fn new(id: impl Into<ElementId>, icon: IconName, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            icon,
            variant: ButtonVariant::Ghost,
            tone: ButtonTone::Normal,
            size: ControlSize::Medium,
            state: ControlState::Enabled,
            focus: None,
            on_press: None,
        }
    }
}

impl std::fmt::Debug for IconButton {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IconButton")
            .field("id", &self.id)
            .field("label", &self.label)
            .field("icon", &self.icon)
            .field("state", &self.state)
            .finish_non_exhaustive()
    }
}

impl RenderOnce for IconButton {
    fn render(self, _: &mut gpui::Window, _: &mut gpui::App) -> impl IntoElement {
        rake::view! {
            <Button id={self.id} icon={Some(self.icon)} accessibility_label={Some(self.label)}
                variant={self.variant} tone={self.tone} size={self.size} state={self.state}
                focus={self.focus} on_press={self.on_press} {..Button::new("icon", "")}/>
        }
    }
}
