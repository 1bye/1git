use super::{
    ToastKind, ToastState,
    motion::MovingCard,
    state::{Config, Entry},
};
use crate::{
    Button, ButtonVariant, ControlSize, Icon, IconButton, IconName, Text, TextTone, Theme, overlay,
};
use rake::gpui::{self, accesskit, prelude::*, px};

/// Window overlay for one retained notification state. Mount once alongside dialog layers.
/// Cards never take focus automatically; provide the normal application's focus scope as fallback.
#[derive(Debug, IntoElement)]
pub struct ToastHost {
    /// Stable host identity, retained across ordinary rerenders.
    pub id: gpui::ElementId,
    /// Window-owned notification state, created once outside render.
    pub state: gpui::Entity<ToastState>,
    /// Mounted normal application focus scope; used when a focused last toast is dismissed.
    pub focus_fallback: gpui::FocusHandle,
    /// Pause expiration and hide actions/dismiss controls while a modal owns interaction.
    pub paused: bool,
    /// Preferred card width; clamped to the window with 16-pixel margins.
    pub width: gpui::Pixels,
}
impl ToastHost {
    /// Create a bottom-right host with 340-pixel cards and active interaction.
    #[must_use]
    pub fn new(
        id: impl Into<gpui::ElementId>,
        state: &gpui::Entity<ToastState>,
        focus_fallback: &gpui::FocusHandle,
    ) -> Self {
        Self {
            id: id.into(),
            state: state.clone(),
            focus_fallback: focus_fallback.clone(),
            paused: false,
            width: px(340.),
        }
    }
}
struct Mount {
    state: gpui::WeakEntity<ToastState>,
    window: gpui::AnyWindowHandle,
    id: gpui::EntityId,
    _subscription: gpui::Subscription,
}
impl RenderOnce for ToastHost {
    fn render(self, window: &mut gpui::Window, cx: &mut gpui::App) -> impl IntoElement {
        let state = self.state.clone();
        let mount = window.use_keyed_state(self.id, cx, move |window, cx| {
            cx.on_release(|mount: &mut Mount, cx| {
                let _ = mount.window.update(cx, |_, window, cx| {
                    let _ = mount
                        .state
                        .update(cx, |state, cx| state.unmount(mount.id, window, cx));
                });
            })
            .detach();
            let subscription = cx.observe(&state, |_, _, cx| cx.notify());
            Mount {
                state: state.downgrade(),
                window: window.window_handle(),
                id: cx.entity_id(),
                _subscription: subscription,
            }
        });
        self.state.update(cx, |state, cx| {
            state.configure(
                Config {
                    fallback: self.focus_fallback,
                    paused: self.paused,
                    width: self.width,
                    mount: mount.entity_id(),
                },
                window,
                cx,
            )
        });
        if self.state.read(cx).is_empty() && self.state.read(cx).exiting.is_empty() {
            return gpui::Empty.into_any_element();
        }
        overlay::floating(Default::default(), move |_, window, _| {
            let viewport = window.viewport_size();
            gpui::div()
                .absolute()
                .left_0()
                .top_0()
                .w(viewport.width)
                .h(viewport.height)
                .flex()
                .flex_col()
                .items_end()
                .justify_end()
                .p(px(16.))
                .child(self.state)
                .into_any_element()
        })
        .into_any_element()
    }
}
impl Render for ToastState {
    fn render(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let focused = self.focus.contains_focused(window, cx);
        self.sync_focus(focused, cx);
        self.remember_focus(window, cx);
        let config = self
            .config
            .as_ref()
            .expect("ToastState renders through a ToastHost")
            .clone();
        let key = cx.entity();
        let mut entries: Vec<_> = self
            .entries
            .iter()
            .map(|entry| (entry, false))
            .chain(self.exiting.iter().map(|(entry, _)| (entry, true)))
            .collect();
        entries.sort_by_key(|(entry, _)| entry.id);
        let items: Vec<_> = entries
            .into_iter()
            .map(|(entry, exiting)| self.card(entry, exiting, &config, cx))
            .collect();
        gpui::div()
            .id("notifications")
            .track_focus(&self.focus)
            .role(accesskit::Role::Group)
            .aria_label("Notifications")
            .w(config.width.max(px(1.)))
            .max_w((window.viewport_size().width - px(32.)).max(px(1.)))
            .max_h((window.viewport_size().height - px(32.)).max(px(1.)))
            // Occlude at the stack so child controls share the host hover region.
            .occlude()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap(px(8.))
            .flex_shrink_0()
            .on_hover(cx.listener(|this, value: &bool, _, cx| this.hover(*value, cx)))
            .on_key_down(move |event, window, cx| {
                if event.keystroke.key == "escape" && !event.keystroke.modifiers.modified() {
                    let id = key
                        .read(cx)
                        .entries
                        .iter()
                        .find(|entry| entry.focus.contains_focused(window, cx))
                        .map(|entry| entry.id);
                    if let Some(id) = id {
                        key.update(cx, |state, cx| {
                            state.dismiss(id, window, cx);
                        });
                        window.prevent_default();
                        cx.stop_propagation();
                    }
                }
            })
            .children(items)
    }
}

impl ToastState {
    fn card(
        &self,
        entry: &Entry,
        exiting: bool,
        config: &Config,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::AnyElement {
        let theme = Theme::current();
        let id = entry.id;
        let error = entry.toast.kind == ToastKind::Error;
        let (icon, tone) = match entry.toast.kind {
            ToastKind::Success => (IconName::Check, TextTone::Success),
            ToastKind::Error => (IconName::Alert, TextTone::Danger),
            ToastKind::Progress => (IconName::Working, TextTone::Accent),
        };
        let dragging = self.dragging(id);
        let dismiss = cx.entity();
        let action = cx.entity();
        let description = entry.toast.description.clone();
        let announcement = description.as_ref().map_or_else(
            || entry.toast.title.to_string(),
            |text| format!("{}: {text}", entry.toast.title),
        );
        let exit_height = entry
            .presentation
            .borrow()
            .bounds
            .map(|bounds| bounds.size.height);
        let card = rake::view! {
            <div id="surface" role={if exiting {accesskit::Role::Group} else if error {accesskit::Role::Alert} else {accesskit::Role::Status}}
                aria-label={announcement} class="flex flex-row items-start gap-2 p-3 border-1 rounded-control shrink-0 min-w-0"
                style={|s| s.w_full().bg(theme.surface_raised).border_color(if dragging {theme.focus_ring} else {theme.line}).text_color(theme.ink).shadow_md().when(exiting, |s| s.min_h(exit_height.unwrap_or(px(0.))))
                    .a11y_synthetic_children(move |builder| {
                        let node = builder.parent_node();
                        if exiting { node.set_hidden(); } else {
                            node.set_live(if error {accesskit::Live::Assertive} else {accesskit::Live::Polite});
                            node.set_live_atomic();
                        }
                    })}>
                <div class="mt-0.5 shrink-0" style={|s| s.text_color(tone.color(&theme))}><Icon {..Icon::new("status", icon)}/></div>
                <div class="flex flex-col gap-1 flex-1 min-w-0">
                    <Text max_lines={Some(2)} {..Text::new("title", entry.toast.title.clone())}/>
                    if let Some(text) = description {<Text tone={TextTone::Muted} max_lines={Some(3)} {..Text::new("description", text)}/>}
                    if !exiting && !config.paused && let Some(handler) = &entry.toast.action {
                        <div class="flex flex-row" style={|s| s.on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())}>
                            <Button size={ControlSize::Small} variant={ButtonVariant::Secondary} focus={Some(entry.action.clone())}
                                on_press={Some(Box::new(move |_, window, cx| {
                                    let handler = action.update(cx, |state, cx| state.take_action(id, window, cx));
                                    if let Some(handler) = handler {(handler.on_press)(window, cx);}
                                }))} {..Button::new("action", handler.label.clone())}/>
                        </div>
                    }
                </div>
                if !exiting && !config.paused {
                    <div style={|s| s.on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())}>
                        <IconButton size={ControlSize::Small} focus={Some(entry.dismiss.clone())}
                            on_press={Some(Box::new(move |_, window, cx| {dismiss.update(cx, |state, cx| {state.dismiss(id, window, cx);});}))}
                            {..IconButton::new("dismiss", IconName::Close, format!("Dismiss {}", entry.toast.title))}/>
                    </div>
                }
            </div>
        };
        let start = cx.entity();
        let child = gpui::div()
            .id("gesture")
            .debug_selector(move || format!("toast-{id:?}"))
            .w_full()
            .flex_shrink_0()
            .when(!exiting, |s| s.track_focus(&entry.focus))
            .when(!exiting && !config.paused, |s| {
                s.cursor(if dragging {
                    gpui::CursorStyle::ClosedHand
                } else {
                    gpui::CursorStyle::OpenHand
                })
                .on_mouse_down_all(move |event, phase, hitbox, window, cx| {
                    if phase == gpui::DispatchPhase::Bubble
                        && event.button == gpui::MouseButton::Left
                        && hitbox.is_hovered(window)
                    {
                        start.update(cx, |state, cx| state.start_drag(id, event.position, cx));
                        window.capture_pointer(hitbox.id);
                        window.prevent_default();
                    }
                })
            })
            .child(card)
            .into_any_element();
        MovingCard {
            id: id.element(),
            toast: id,
            state: (!exiting && !config.paused).then(|| cx.entity()),
            presentation: entry.presentation.clone(),
            child,
        }
        .into_any_element()
    }
}
