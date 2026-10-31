use crate::motion::{self, Surface};
use crate::{ControlState, Icon, IconName, IconSize, Theme, focusable};
use rake::gpui::{self, ElementId, SharedString, accesskit, prelude::*, px};

/// Controlled checkbox value; the mixed state selects all on activation.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CheckState {
    /// Nothing selected.
    #[default]
    Unchecked,
    /// Everything selected.
    Checked,
    /// Some items selected.
    Mixed,
}

impl CheckState {
    /// Value requested by the next activation; this never mutates the owner itself.
    #[must_use]
    pub const fn toggled(self) -> Self {
        match self {
            Self::Checked => Self::Unchecked,
            Self::Unchecked | Self::Mixed => Self::Checked,
        }
    }
}

/// Requested controlled value, delivered synchronously on the UI thread.
pub type CheckHandler = Box<dyn Fn(&CheckState, &mut gpui::Window, &mut gpui::App)>;

/// Accessible three-state checkbox with independent application-owned selection.
#[derive(IntoElement)]
pub struct Checkbox {
    /// Stable root identity.
    pub id: ElementId,
    /// Accessible label, even when the visible label is hidden.
    pub label: SharedString,
    /// Whether the label is shown beside the box.
    pub show_label: bool,
    /// Owner-supplied value.
    pub checked: CheckState,
    /// Owner-supplied availability.
    pub state: ControlState,
    /// Callback requesting a new value; the caller updates and notifies its entity.
    pub on_change: Option<CheckHandler>,
}

impl Checkbox {
    /// Create an unchecked, enabled checkbox with a visible label.
    #[must_use]
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            show_label: true,
            checked: CheckState::Unchecked,
            state: ControlState::Enabled,
            on_change: None,
        }
    }
}

impl std::fmt::Debug for Checkbox {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Checkbox")
            .field("id", &self.id)
            .field("label", &self.label)
            .field("checked", &self.checked)
            .field("state", &self.state)
            .finish_non_exhaustive()
    }
}

impl RenderOnce for Checkbox {
    fn render(self, _: &mut gpui::Window, _: &mut gpui::App) -> impl IntoElement {
        let theme = Theme::current();
        let enabled = self.state.is_interactive();
        let filled = self.checked != CheckState::Unchecked;
        let next = self.checked.toggled();

        let toggled = match self.checked {
            CheckState::Unchecked => accesskit::Toggled::False,
            CheckState::Checked => accesskit::Toggled::True,
            CheckState::Mixed => accesskit::Toggled::Mixed,
        };

        let rest = Surface {
            opacity: if enabled { 1. } else { 0.5 },
            ..Surface::new(Theme::transparent())
        };

        let box_paint = Surface {
            border: if filled { theme.primary } else { theme.line },
            ink: theme.on_primary,
            ..Surface::new(if filled {
                theme.primary
            } else {
                Theme::transparent()
            })
        };

        motion::surface(
            self.id.clone(),
            rest,
            Surface {
                background: theme.hover,
                ..rest
            },
            Surface {
                background: theme.pressed,
                ..rest
            },
            enabled,
            move |paint| {
                rake::view! {
                    <button id={self.id} disabled={!enabled} aria-label={self.label.clone()}
                        class="flex flex-row items-center justify-start gap-2 px-1 shrink-0"
                        style={|s| focusable(s).h(px(24.)).when(!self.show_label,|s|s.w(px(24.)).px(px(0.)).justify_center()).border_color(Theme::transparent())
                            .role(accesskit::Role::CheckBox).aria_toggled(toggled)
                            .text_color(paint.ink).bg(paint.background).opacity(paint.opacity)}
                        on:click={move |_, window, cx| {
                            cx.stop_propagation();
                            if let Some(handler)=&self.on_change {handler(&next,window,cx);}
                        }}>
                        {motion::surface("box-motion".into(), box_paint, box_paint, box_paint, false, move |paint| rake::view! {
                        <span class="size-[12px] border-1 rounded-[3px] items-center justify-center shrink-0"
                            style={|s| s.border_color(paint.border).bg(paint.background).text_color(paint.ink)}>
                            if filled {
                                <Icon name={if self.checked==CheckState::Mixed {IconName::Minus} else {IconName::Check}}
                                    size={IconSize::Small} {..Icon::new("mark",IconName::Check)}/>
                            }
                        </span>
                        })}
                        if self.show_label { <p class="text-body" wrap={false} ellipsis={true}>{self.label}</p> }
                    </button>
                }
            },
        )
    }
}
