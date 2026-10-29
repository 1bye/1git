use crate::{Theme, overlay};
use rake::gpui::{self, accesskit, prelude::*, px};
use std::time::Duration;

/// A noninteractive hint shown after hover or immediately when its control gains focus.
/// Keep the control's accessible name meaningful without this supplementary text.
#[derive(IntoElement)]
pub struct Tooltip {
    /// Stable identity; hint state is released when this wrapper unmounts.
    pub id: gpui::ElementId,
    /// Supplementary description, also exposed to assistive technology.
    pub text: gpui::SharedString,
    /// Optional display-only shortcut hint; the owner installs the actual shortcut.
    pub shortcut: Option<gpui::SharedString>,
    /// Delay before pointer hover opens the hint. Keyboard focus is immediate.
    pub delay: Duration,
    /// The wrapped control; avoid putting unrelated controls in the same tooltip.
    pub children: Vec<gpui::AnyElement>,
}

impl Tooltip {
    /// Wrap a control with a compact hint and a 350 ms pointer delay.
    #[must_use]
    pub fn new(id: impl Into<gpui::ElementId>, text: impl Into<gpui::SharedString>) -> Self {
        Self {
            id: id.into(),
            text: text.into(),
            shortcut: None,
            delay: Duration::from_millis(350),
            children: Vec::new(),
        }
    }
}

impl std::fmt::Debug for Tooltip {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Tooltip")
            .field("id", &self.id)
            .field("text", &self.text)
            .field("shortcut", &self.shortcut)
            .finish_non_exhaustive()
    }
}

struct Hint {
    focus: gpui::FocusHandle,
    bounds: overlay::AnchorBounds,
    hovered: bool,
    focused: bool,
    visible: bool,
    dismissed: bool,
    timer: gpui::Task<()>,
    _subscriptions: Vec<gpui::Subscription>,
}

impl Hint {
    fn new(window: &mut gpui::Window, cx: &mut gpui::Context<Self>) -> Self {
        let focus = cx.focus_handle();
        let entered = cx.on_focus_in(&focus, window, |_, _, cx| cx.notify());
        let left = cx.on_focus_out(&focus, window, |_, _, _, cx| cx.notify());

        let activation = cx.observe_window_activation(window, |this, window, cx| {
            if !window.is_window_active() {
                this.hovered = false;
                this.focused = false;
                this.hide(cx);
            }
        });

        let owner_window = window.window_handle().window_id();
        let weak = cx.weak_entity();

        let escape = cx.intercept_keystrokes(move |event, window, cx| {
            if window.window_handle().window_id() != owner_window
                || event.keystroke.key != "escape"
                || event.keystroke.modifiers.modified()
            {
                return;
            }

            let _ = weak.update(cx, |this, cx| {
                if this.visible {
                    this.dismiss(cx);
                    window.prevent_default();
                    cx.stop_propagation();
                }
            });
        });

        Self {
            focus,
            bounds: Default::default(),
            hovered: false,
            focused: false,
            visible: false,
            dismissed: false,
            timer: gpui::Task::ready(()),
            _subscriptions: vec![entered, left, activation, escape],
        }
    }

    fn sync_focus(&mut self, focused: bool) {
        if self.focused == focused {
            return;
        }

        self.focused = focused;
        self.timer = gpui::Task::ready(());

        if focused {
            self.visible = !self.dismissed;
        } else {
            self.visible = false;
            self.dismissed = false;
        }
    }

    fn hide(&mut self, cx: &mut gpui::Context<Self>) {
        self.visible = false;
        self.dismissed = false;
        self.timer = gpui::Task::ready(());
        cx.notify();
    }

    fn hover(&mut self, hovered: bool, delay: Duration, cx: &mut gpui::Context<Self>) {
        self.hovered = hovered;
        self.timer = gpui::Task::ready(());

        if !hovered {
            if self.focused {
                return;
            }

            if !self.visible {
                self.hide(cx);

                return;
            }

            // Allow the pointer to cross the gap into the hint without dismissing it.
            self.timer = cx.spawn(async move |this, cx| {
                cx.background_executor()
                    .timer(Duration::from_millis(120))
                    .await;
                let _ = this.update(cx, |this, cx| {
                    if !this.hovered && !this.focused {
                        this.hide(cx);
                    }
                });
            });

            return;
        }

        if self.dismissed || self.visible {
            return;
        }

        self.timer = cx.spawn(async move |this, cx| {
            cx.background_executor().timer(delay).await;
            let _ = this.update(cx, |this, cx| {
                if this.hovered && !this.dismissed {
                    this.visible = true;
                    cx.notify();
                }
            });
        });
    }

    fn dismiss(&mut self, cx: &mut gpui::Context<Self>) {
        self.hide(cx);
        self.dismissed = true;
    }
}

impl RenderOnce for Tooltip {
    fn render(self, window: &mut gpui::Window, cx: &mut gpui::App) -> impl IntoElement {
        let state = window.use_keyed_state(self.id.clone(), cx, Hint::new);

        // Sample current focus so the hint switches in the same frame as the control.
        let focused =
            window.is_window_active() && state.read(cx).focus.contains_focused(window, cx);

        state.update(cx, |this, _| this.sync_focus(focused));
        let (focus, bounds, visible) = {
            let state = state.read(cx);

            (state.focus.clone(), state.bounds.clone(), state.visible)
        };

        let hover = state.clone();
        let dismiss = state.clone();
        let key = state.clone();
        let bubble_hover = state.clone();

        let description = if let Some(shortcut) = &self.shortcut {
            format!("{} ({shortcut})", self.text)
        } else {
            self.text.to_string()
        };

        let root=gpui::div().id(self.id).flex().track_focus(&focus).role(accesskit::Role::Group).aria_description(description)
            .on_hover(move |value,_,cx|hover.update(cx,|this,cx|this.hover(*value,self.delay,cx)))
            .capture_any_mouse_down(move |_,_,cx|dismiss.update(cx,Hint::dismiss))
            .on_mouse_down_out({let state=state.clone();

                move |_,_,cx|{if state.read(cx).visible {state.update(cx,Hint::dismiss);}}})
            .capture_key_down(move |event,window,cx|{
                if event.keystroke.key=="escape" && !event.keystroke.modifiers.modified() && key.read(cx).visible {
                    key.update(cx,Hint::dismiss);window.prevent_default();cx.stop_propagation();
                } else if matches!(event.keystroke.key.as_str(),"enter"|"space"|"down"|"up") {
                    key.update(cx,Hint::dismiss);
                }
            }).children(self.children)
            .when(visible && !self.text.is_empty(),|s|s.child(overlay::floating(bounds.clone(),move |anchor,window,cx| {
                let Some(anchor)=anchor else {state.update(cx,Hint::hide);

                    return gpui::Empty.into_any_element();};

                let theme=Theme::current();

                let bubble=rake::view! {
                    <div id="hint" role={accesskit::Role::Tooltip} aria-label={self.text.clone()}
                        class="flex flex-col gap-1 border-1 rounded-control px-2 py-1"
                        style={|s|s.max_w((window.viewport_size().width-px(16.)).clamp(px(1.),px(300.))).bg(theme.surface_raised).border_color(theme.line).shadow_md().occlude().on_hover(move |value,_,cx|bubble_hover.update(cx,|this,cx|this.hover(*value,Duration::ZERO,cx)))}>
                        <p class="text-body" style={|s|s.text_color(theme.ink)}>{self.text}</p>
                        if let Some(shortcut)=self.shortcut {<p class="text-caption" style={|s|s.text_color(theme.muted_ink)}>{shortcut}</p>}
                    </div>
                };

                gpui::anchored().position(anchor.bottom_left()).offset(gpui::point(px(0.),px(6.)))
                    .snap_to_window_with_margin(gpui::Edges::all(px(8.))).child(bubble).into_any_element()
            })));

        overlay::track(root, bounds)
    }
}

#[cfg(all(test, feature = "test-support"))]
mod tests {
    use super::*;
    use gpui::InputEvent as _;

    fn setup() -> (
        gpui::TestAppContext,
        gpui::WindowHandle<Hint>,
        gpui::Entity<Hint>,
    ) {
        let mut cx = gpui::TestAppContext::single();

        let window = cx.open_window(gpui::size(px(400.), px(300.)), |window, cx| {
            window.activate_window();

            Hint::new(window, cx)
        });

        let entity = window.update(&mut cx, |_, _, cx| cx.entity()).unwrap();

        (cx, window, entity)
    }

    impl Render for Hint {
        fn render(
            &mut self,
            _: &mut gpui::Window,
            _: &mut gpui::Context<Self>,
        ) -> impl IntoElement {
            gpui::div()
        }
    }

    fn advance(cx: &mut gpui::TestAppContext, millis: u64) {
        cx.run_until_parked();
        cx.executor().advance_clock(Duration::from_millis(millis));
        cx.run_until_parked();
    }

    #[test]
    fn hover_delay_is_cancellable_and_crossing_to_the_bubble_preserves_visibility() {
        let (mut cx, _, hint) = setup();

        hint.update(&mut cx, |this, cx| {
            this.hover(true, Duration::from_millis(350), cx)
        });
        advance(&mut cx, 200);
        assert!(!hint.read_with(&cx, |hint, _| hint.visible));
        hint.update(&mut cx, |this, cx| this.hover(false, Duration::ZERO, cx));
        advance(&mut cx, 500);
        assert!(!hint.read_with(&cx, |hint, _| hint.visible));
        hint.update(&mut cx, |this, cx| {
            this.hover(true, Duration::from_millis(350), cx)
        });
        advance(&mut cx, 350);
        assert!(hint.read_with(&cx, |hint, _| hint.visible));
        hint.update(&mut cx, |this, cx| this.hover(false, Duration::ZERO, cx));
        advance(&mut cx, 60);
        hint.update(&mut cx, |this, cx| this.hover(true, Duration::ZERO, cx));
        advance(&mut cx, 200);
        assert!(hint.read_with(&cx, |hint, _| hint.visible));
        hint.update(&mut cx, |this, cx| this.hover(false, Duration::ZERO, cx));
        advance(&mut cx, 120);
        assert!(!hint.read_with(&cx, |hint, _| hint.visible));
    }

    #[test]
    fn focus_switches_replace_hints_and_clear_activation_dismissal_after_blur() {
        let (mut cx, _, hint) = setup();

        hint.update(&mut cx, |this, cx| {
            this.sync_focus(true);
            assert!(this.visible);
            this.dismiss(cx);
            assert!(!this.visible);
            this.sync_focus(false);
            assert!(!this.visible);
            this.sync_focus(true);
            assert!(this.visible);
            this.sync_focus(false);
            assert!(!this.visible);
        });
    }

    #[test]
    fn escape_dismisses_a_hover_hint_without_taking_focus() {
        let (mut cx, window, hint) = setup();

        hint.update(&mut cx, |this, cx| this.hover(true, Duration::ZERO, cx));
        advance(&mut cx, 1);
        assert!(hint.read_with(&cx, |hint, _| hint.visible));
        cx.update_window(window.into(), |_, window, cx| {
            window.dispatch_event(
                gpui::KeyDownEvent {
                    keystroke: gpui::Keystroke::parse("escape").unwrap(),
                    is_held: false,
                    prefer_character_input: false,
                }
                .to_platform_input(),
                cx,
            );
        })
        .unwrap();
        cx.run_until_parked();
        assert!(!hint.read_with(&cx, |hint, _| hint.visible));
        hint.update(&mut cx, |this, cx| this.hover(true, Duration::ZERO, cx));
        advance(&mut cx, 10);
        assert!(!hint.read_with(&cx, |hint, _| hint.visible));
    }
}
