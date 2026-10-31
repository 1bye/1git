//! Modal composition over retained, window-scoped focus ownership.
mod frame;
mod state;

use crate::{
    ButtonVariant, ControlSize, ControlState, IconButton, IconName, Text, TextRole, Theme, overlay,
};

use frame::{Frame, Hook};
use rake::gpui::{self, accesskit, prelude::*, px};
pub use state::{DialogEvent, DialogHostState, DialogState};

/// Escape, optional outside-click dismissal, or explicit application-only closure.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DialogDismissal {
    /// Escape and the close button dismiss; outside clicks are ignored.
    #[default]
    Escape,
    /// Escape, close button and outside clicks dismiss.
    EscapeAndOutside,
    /// Only application-owned actions can close the dialog; the close button is hidden.
    Explicit,
}

/// Whether user dismissal is available. The host controls input and footer button states separately.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DialogAvailability {
    /// Dismissal follows the configured policy.
    #[default]
    Ready,
    /// Suppress Escape, outside clicks and the close button until application work finishes.
    Busy,
}

/// Visual chrome and placement of a modal interaction surface.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum DialogPresentation {
    /// Centered dialog with title, description and footer chrome.
    #[default]
    Standard,
    /// Centered compact surface with caller-owned heading/content and animated height.
    Compact {
        /// Preferred content height in logical pixels, constrained to the viewport.
        height: gpui::Pixels,
    },
    /// Anchored modal popover with caller-owned content and a dimmed dismissal layer.
    Popover {
        /// Preferred top-left point in window coordinates.
        origin: gpui::Point<gpui::Pixels>,
        /// Preferred animated content height.
        height: gpui::Pixels,
    },
    /// Compact attached surface with caller-owned content.
    Attached {
        /// Preferred top-left point in the window.
        origin: gpui::Point<gpui::Pixels>,
        /// Content height; owners may animate it while retaining dialog focus semantics.
        height: gpui::Pixels,
    },
}

/// Accessible dialog semantics, independent of the footer action's color.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DialogKind {
    /// A form or ordinary modal interaction.
    #[default]
    Standard,
    /// A confirmation that requires the user's attention, announced as an alert dialog.
    Confirmation,
}

/// Window-root modal host. Put application key contexts and background handlers inside `body`.
#[derive(IntoElement)]
pub struct DialogHost {
    /// Retained state created by the window owner.
    pub state: DialogHostState,
    /// Background application content, hidden from accessibility while a dialog is open.
    pub body: gpui::AnyElement,
    /// Dialogs belonging to this host; keep logical dialogs mounted while the host exists.
    pub children: Vec<gpui::AnyElement>,
}

impl std::fmt::Debug for DialogHost {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DialogHost")
            .field("state", &self.state)
            .finish_non_exhaustive()
    }
}

impl RenderOnce for DialogHost {
    fn render(self, _: &mut gpui::Window, cx: &mut gpui::App) -> impl IntoElement {
        let modal = self.state.is_open(cx);
        let root = self.state.root();
        let fallback = self.state.fallback();

        let body = Frame {
            inner: gpui::div()
                .id("body")
                .size_full()
                .track_focus(&fallback)
                .role(accesskit::Role::Group)
                .aria_label("Application")
                .child(self.body),
            hook: Hook::Background(modal),
        };

        let inner = rake::view! {
            <div id="dialog-host" class="relative size-full" focus={&root} tab-navigation={true}
                style={|s|s.child(body).children(self.children)}/>
        };

        Frame {
            inner,
            hook: Hook::Host(self.state),
        }
    }
}

/// Themed modal with title, optional description, scrollable body and footer slots.
/// Create retained state through [`DialogHostState::dialog`] and mount inside [`DialogHost`].
#[derive(IntoElement)]
pub struct Dialog {
    /// Stable identity within the host.
    pub id: gpui::ElementId,
    /// Retained interaction state; one state per logical dialog, mounted once.
    pub state: gpui::Entity<DialogState>,
    /// Required visible and accessible title.
    pub title: gpui::SharedString,
    /// Optional supporting text, also exposed as the dialog description.
    pub description: Option<gpui::SharedString>,
    /// Ordinary form or confirmation semantics.
    pub kind: DialogKind,
    /// Centered dialog chrome or a compact attached surface.
    pub presentation: DialogPresentation,
    /// User dismissal policy; application `close` is always available.
    pub dismissal: DialogDismissal,
    /// Busy suppresses incidental dismissal; the owner supplies disabled/busy footer controls.
    pub availability: DialogAvailability,
    /// Initial target, such as a form input or Cancel action; defaults to the first focusable control.
    pub initial_focus: Option<gpui::FocusHandle>,
    /// Preferred panel width, capped to the window with a 16-pixel margin.
    pub width: gpui::Pixels,
    /// Footer actions, normally Cancel followed by a primary action.
    pub footer: Option<gpui::AnyElement>,
    /// Optional non-focusable trigger preview painted above an attached surface’s backdrop.
    pub trigger_preview: Option<gpui::AnyElement>,
    /// Form or confirmation content. Retained values remain caller-owned.
    pub children: Vec<gpui::AnyElement>,
}

impl Dialog {
    /// Create a 440-pixel standard dialog with Escape dismissal and no footer.
    #[must_use]
    pub fn new(
        id: impl Into<gpui::ElementId>,
        state: &gpui::Entity<DialogState>,
        title: impl Into<gpui::SharedString>,
    ) -> Self {
        Self {
            id: id.into(),
            state: state.clone(),
            title: title.into(),
            description: None,
            kind: DialogKind::Standard,
            presentation: DialogPresentation::Standard,
            dismissal: DialogDismissal::Escape,
            availability: DialogAvailability::Ready,
            initial_focus: None,
            width: px(440.),
            footer: None,
            trigger_preview: None,
            children: Vec::new(),
        }
    }
}

impl std::fmt::Debug for Dialog {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Dialog")
            .field("id", &self.id)
            .field("title", &self.title)
            .field("kind", &self.kind)
            .field("availability", &self.availability)
            .finish_non_exhaustive()
    }
}

impl RenderOnce for Dialog {
    fn render(self, _: &mut gpui::Window, cx: &mut gpui::App) -> impl IntoElement {
        self.state.update(cx, |state, _| {
            state.initial_focus = self.initial_focus.clone();
            state.availability = self.availability;
            state.dismissal = self.dismissal;
        });

        if !self.state.read(cx).is_open() {
            return gpui::Empty.into_any_element();
        }

        // A viewport-sized deferred layer has no trigger and bypasses ancestor scrolling clips.
        overlay::floating(Default::default(), move |_, window, cx| {
            self.layer(window, cx)
        })
        .into_any_element()
    }
}

impl Dialog {
    fn layer(self, window: &mut gpui::Window, cx: &mut gpui::App) -> gpui::AnyElement {
        let theme = Theme::current();
        let viewport = window.viewport_size();
        let busy = self.availability == DialogAvailability::Busy;
        let state = self.state.read(cx);
        let focus = state.focus.clone();
        let first = state.first.clone();
        let last = state.last.clone();
        let key = self.state.clone();
        let outside = self.state.clone();
        let close = self.state.clone();

        let attached = matches!(self.presentation, DialogPresentation::Attached { .. });
        let popover = matches!(self.presentation, DialogPresentation::Popover { .. });
        let compact = !matches!(self.presentation, DialogPresentation::Standard);

        let height = match self.presentation {
            DialogPresentation::Attached { height, .. }
            | DialogPresentation::Compact { height }
            | DialogPresentation::Popover { height, .. } => Some(height),
            DialogPresentation::Standard => None,
        };

        let inset = px(if compact { 16. } else { 32. });

        let panel = rake::view! {
            <div id={self.id} focus={&focus} role={if self.kind==DialogKind::Confirmation {accesskit::Role::AlertDialog}else{accesskit::Role::Dialog}}
                aria-label={self.title.clone()} aria-description={self.description.clone().unwrap_or_default()}
                class="flex flex-col min-h-0 border-1 rounded-control overflow-hidden"
                style={|s|s.w(self.width.max(px(1.))).max_w((viewport.width-inset).max(px(1.))).max_h((viewport.height-inset).max(px(1.)))
                    .bg(theme.surface).text_color(theme.ink).border_color(if compact{Theme::transparent()}else{theme.line}).when(!attached,|s|s.shadow_lg()).occlude()
                    .when(compact,|s|s.border_0().rounded(px(8.)).when_some(height,|s,height|s.h(height.max(px(0.)))))
                    .a11y_synthetic_children(move |builder|{builder.parent_node().set_modal();if busy {builder.parent_node().set_busy();}})}
                on:key-down={move |event:&gpui::KeyDownEvent,window,cx|{
                    if window.default_prevented(){return;}
                    let mut modifiers=event.keystroke.modifiers;modifiers.shift=false;
                    if event.keystroke.key=="escape" && !event.keystroke.modifiers.modified(){key.update(cx,|state,cx|state.dismiss(false,window,cx));}
                    else if event.keystroke.key=="tab" && !modifiers.modified(){key.update(cx,|state,cx|state.navigate(event.keystroke.modifiers.shift,window,cx));}
                    else{return;}
                    window.prevent_default();cx.stop_propagation();
                }}>
                <div id="first" focus={&first} class="size-0"/>
                if !compact {<header class="flex flex-row items-start justify-between gap-3 p-4 shrink-0">
                    <div class="flex flex-col gap-1 min-w-0">
                        <Text role={TextRole::Title} {..Text::new("title",self.title)}/>
                        if let Some(description)=self.description {<p class="text-body" style={|s|s.text_color(theme.muted_ink)}>{description}</p>}
                    </div>
                    if self.dismissal!=DialogDismissal::Explicit {
                        <IconButton size={ControlSize::Small} variant={ButtonVariant::Ghost} state={if busy {ControlState::Disabled}else{ControlState::Enabled}}
                            on_press={Some(Box::new(move |_,window,cx|close.update(cx,|state,cx|state.dismiss(false,window,cx))))}
                            {..IconButton::new("close",IconName::Close,"Close dialog")}/>
                    }
                </header>}
                if compact {<div class="flex flex-col min-h-0 flex-1" style={|s|s.children(self.children)}/> } else {<div class="flex flex-col gap-3 min-h-0 overflow-y-scroll px-4 pb-4" style={|s|s.children(self.children)}/>}
                if let Some(footer)=self.footer {<footer class="flex flex-row flex-wrap items-center justify-end gap-2 px-4 py-3 border-t-1 shrink-0" style={|s|s.border_color(theme.line)}>{footer}</footer>}
                <div id="last" focus={&last} class="size-0"/>
            </div>
        };

        let panel = Frame {
            inner: panel,
            hook: Hook::Surface(self.state.clone()),
        };

        let screen = gpui::div()
            .absolute()
            .left_0()
            .top_0()
            .w(viewport.width)
            .h(viewport.height)
            .child(
                gpui::div()
                    .id("backdrop")
                    .absolute()
                    .inset_0()
                    .bg(gpui::rgba(if popover || attached {
                        0x00000066
                    } else if compact {
                        0x0000005c
                    } else {
                        0x00000070
                    }))
                    .occlude()
                    .on_any_mouse_down(move |_, window, cx| {
                        outside.update(cx, |state, cx| state.dismiss(true, window, cx));
                        window.prevent_default();
                        cx.stop_propagation();
                    })
                    .on_scroll_wheel(|_, _, cx| cx.stop_propagation()),
            )
            .child(match self.presentation {
                DialogPresentation::Standard | DialogPresentation::Compact { .. } => gpui::div()
                    .absolute()
                    .inset_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(panel),
                DialogPresentation::Attached { origin, height }
                | DialogPresentation::Popover { origin, height } => {
                    let width = self.width.min((viewport.width - px(16.)).max(px(1.)));
                    let height = height.min((viewport.height - px(16.)).max(px(1.)));

                    gpui::div()
                        .absolute()
                        .left(
                            origin
                                .x
                                .max(px(8.))
                                .min((viewport.width - width - px(8.)).max(px(8.))),
                        )
                        .top(
                            origin
                                .y
                                .max(px(8.))
                                .min((viewport.height - height - px(8.)).max(px(8.))),
                        )
                        .child(panel)
                }
            });

        screen
            .when_some(self.trigger_preview, |screen, preview| {
                screen.child(preview)
            })
            .into_any_element()
    }
}
