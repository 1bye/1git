//! Notification lifetimes, native focus and action dispatch on GPUI's deterministic platform.
use onegit_ui::{Button, Theme, Toast, ToastAction, ToastHost, ToastId, ToastKind, ToastState};
use rake::gpui::{self, Focusable, InputEvent as _, prelude::*, px};
use std::time::Duration;

rake::theme!(Theme);

struct Workbench {
    root: gpui::FocusHandle,
    opener: gpui::FocusHandle,
    toasts: gpui::Entity<ToastState>,
    mounted: bool,
    paused: bool,
    actions: usize,
}

impl Render for Workbench {
    fn render(&mut self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> impl IntoElement {
        rake::view! {
            <div class="size-full" focus={&self.root} tab-navigation={true}>
                <Button focus={Some(self.opener.clone())} {..Button::new("opener","Opener")}/>
                if self.mounted {<ToastHost paused={self.paused} {..ToastHost::new("toasts",&self.toasts,&self.root)}/>}
            </div>
        }
    }
}

fn setup() -> (gpui::TestAppContext, gpui::WindowHandle<Workbench>) {
    let mut cx = gpui::TestAppContext::single();

    cx.update(|cx| Theme::dark().install(cx));
    let view = cx.open_window(gpui::size(px(500.), px(400.)), |w, cx| {
        let root = cx.focus_handle();

        w.focus(&root, cx);
        w.activate_window();

        Workbench {
            root,
            opener: cx.focus_handle(),
            toasts: cx.new(|cx| ToastState::new(w, cx)),
            mounted: true,
            paused: false,
            actions: 0,
        }
    });

    draw(&mut cx, view);

    (cx, view)
}

fn draw(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Workbench>) {
    for _ in 0..2 {
        cx.run_until_parked();
        cx.update_window(v.into(), |_, w, cx| w.draw(cx).clear(cx))
            .unwrap();
    }

    cx.run_until_parked();
}

fn advance(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Workbench>, millis: u64) {
    cx.run_until_parked();
    cx.executor().advance_clock(Duration::from_millis(millis));
    draw(cx, v);
}

fn key(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Workbench>, value: &str) {
    cx.update_window(v.into(), |_, w, cx| {
        let keystroke = gpui::Keystroke::parse(value).unwrap();

        w.dispatch_event(
            gpui::KeyDownEvent {
                keystroke: keystroke.clone(),
                is_held: false,
                prefer_character_input: false,
            }
            .to_platform_input(),
            cx,
        );
        w.dispatch_event(gpui::KeyUpEvent { keystroke }.to_platform_input(), cx);
    })
    .unwrap();
    draw(cx, v);
}

fn mouse(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Workbench>, x: f32, y: f32) {
    cx.update_window(v.into(), |_, w, cx| {
        w.dispatch_event(
            gpui::MouseMoveEvent {
                position: gpui::point(px(x), px(y)),
                pressed_button: None,
                modifiers: Default::default(),
            }
            .to_platform_input(),
            cx,
        );
    })
    .unwrap();
    draw(cx, v);
}

fn show(
    cx: &mut gpui::TestAppContext,
    v: gpui::WindowHandle<Workbench>,
    kind: ToastKind,
) -> ToastId {
    let id = v
        .update(cx, |v, w, cx| {
            v.toasts.update(cx, |state, cx| {
                state.show(Toast::new(kind, "Example notification"), w, cx)
            })
        })
        .unwrap();

    draw(cx, v);

    id
}

fn present(cx: &gpui::TestAppContext, v: gpui::WindowHandle<Workbench>, id: ToastId) -> bool {
    v.read_with(cx, |v, cx| v.toasts.read(cx).get(id).is_some())
        .unwrap()
}

#[test]
fn success_expires_while_error_and_progress_remain_and_show_never_moves_focus() {
    let (mut cx, v) = setup();

    key(&mut cx, v, "tab");
    let success = show(&mut cx, v, ToastKind::Success);

    assert!(v.update(&mut cx, |v, w, _| v.opener.is_focused(w)).unwrap());
    advance(&mut cx, v, 4999);
    assert!(present(&cx, v, success));
    advance(&mut cx, v, 1);
    assert!(!present(&cx, v, success));
    let error = show(&mut cx, v, ToastKind::Error);
    let progress = show(&mut cx, v, ToastKind::Progress);

    advance(&mut cx, v, 60000);
    assert!(present(&cx, v, error) && present(&cx, v, progress));
}

#[test]
fn progress_updates_in_place_and_stale_updates_do_not_resurrect_dismissed_cards() {
    let (mut cx, v) = setup();
    let id = show(&mut cx, v, ToastKind::Progress);

    advance(&mut cx, v, 50000);
    v.update(&mut cx, |v, w, cx| {
        v.toasts.update(cx, |s, cx| {
            assert!(s.update(id, Toast::new(ToastKind::Success, "Done"), w, cx));
            assert_eq!(s.len(), 1);
        })
    })
    .unwrap();
    draw(&mut cx, v);
    advance(&mut cx, v, 4000);
    assert!(present(&cx, v, id));
    v.update(&mut cx, |v, w, cx| {
        v.toasts.update(cx, |s, cx| {
            assert!(s.dismiss(id, w, cx));
            assert!(!s.update(id, Toast::new(ToastKind::Error, "Too late"), w, cx));
        })
    })
    .unwrap();
    draw(&mut cx, v);
    assert!(!present(&cx, v, id));
}

#[test]
fn pointer_hover_pauses_and_resumes_the_remaining_duration() {
    let (mut cx, v) = setup();
    let id = show(&mut cx, v, ToastKind::Success);

    advance(&mut cx, v, 1000);
    mouse(&mut cx, v, 300., 360.);
    advance(&mut cx, v, 20000);
    assert!(present(&cx, v, id), "hover must pause expiration");
    mouse(&mut cx, v, 10., 100.);
    advance(&mut cx, v, 3999);
    assert!(present(&cx, v, id));
    advance(&mut cx, v, 1);
    assert!(!present(&cx, v, id));
}

#[test]
fn keyboard_focus_pauses_expiration_and_escape_restores_the_opener() {
    let (mut cx, v) = setup();

    key(&mut cx, v, "tab");
    let id = show(&mut cx, v, ToastKind::Success);

    key(&mut cx, v, "tab");
    assert!(
        v.update(&mut cx, |v, w, cx| v
            .toasts
            .read(cx)
            .focus_handle(cx)
            .contains_focused(w, cx))
            .unwrap()
    );
    advance(&mut cx, v, 20000);
    assert!(present(&cx, v, id));
    key(&mut cx, v, "escape");
    assert!(!present(&cx, v, id));
    assert!(v.update(&mut cx, |v, w, _| v.opener.is_focused(w)).unwrap());
}

#[test]
fn actions_run_once_after_removal_and_can_publish_another_toast() {
    let (mut cx, v) = setup();

    key(&mut cx, v, "tab");
    let id = v
        .update(&mut cx, |v, w, cx| {
            let weak = cx.weak_entity();

            let action = ToastAction::new("Retry", move |w, cx| {
                weak.update(cx, |v, cx| {
                    v.actions += 1;
                    v.toasts.update(cx, |s, cx| {
                        assert!(s.is_empty(), "remove before callback");
                        s.show(Toast::new(ToastKind::Success, "Recovered"), w, cx);
                    });
                    cx.notify();
                })
                .unwrap();
            });

            v.toasts.update(cx, |s, cx| {
                s.show(
                    Toast {
                        action: Some(action),
                        ..Toast::new(ToastKind::Error, "Failed")
                    },
                    w,
                    cx,
                )
            })
        })
        .unwrap();

    draw(&mut cx, v);
    key(&mut cx, v, "tab");
    key(&mut cx, v, "enter");
    assert!(!present(&cx, v, id));
    assert_eq!(v.read_with(&cx, |v, _| v.actions).unwrap(), 1);
    assert_eq!(
        v.read_with(&cx, |v, cx| v.toasts.read(cx).len()).unwrap(),
        1
    );
    key(&mut cx, v, "enter");
    assert_eq!(v.read_with(&cx, |v, _| v.actions).unwrap(), 1);
}

#[test]
fn a_modal_pauses_time_and_removes_toast_controls_from_keyboard_navigation() {
    let (mut cx, v) = setup();

    key(&mut cx, v, "tab");
    v.update(&mut cx, |v, _, cx| {
        v.paused = true;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    let id = show(&mut cx, v, ToastKind::Success);

    advance(&mut cx, v, 20000);
    assert!(present(&cx, v, id));
    key(&mut cx, v, "tab");
    assert!(
        !v.update(&mut cx, |v, w, cx| v
            .toasts
            .read(cx)
            .focus_handle(cx)
            .contains_focused(w, cx))
            .unwrap()
    );
    v.update(&mut cx, |v, _, cx| {
        v.paused = false;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    advance(&mut cx, v, 5000);
    assert!(!present(&cx, v, id));
}

#[test]
fn unmount_pauses_expiration_and_remount_preserves_notifications() {
    let (mut cx, v) = setup();
    let id = show(&mut cx, v, ToastKind::Success);

    advance(&mut cx, v, 1000);
    v.update(&mut cx, |v, _, cx| {
        v.mounted = false;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    advance(&mut cx, v, 20000);
    assert!(present(&cx, v, id));
    v.update(&mut cx, |v, _, cx| {
        v.mounted = true;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    advance(&mut cx, v, 3999);
    assert!(present(&cx, v, id));
    advance(&mut cx, v, 1);
    assert!(!present(&cx, v, id));
}

#[test]
fn bounded_stacks_displace_old_feedback_and_preserve_the_focused_card() {
    let (mut cx, v) = setup();

    key(&mut cx, v, "tab");
    let first = show(&mut cx, v, ToastKind::Error);
    let second = show(&mut cx, v, ToastKind::Error);
    let third = show(&mut cx, v, ToastKind::Error);

    key(&mut cx, v, "tab");
    let fourth = show(&mut cx, v, ToastKind::Progress);

    assert!(present(&cx, v, first));
    assert!(!present(&cx, v, second));
    assert!(present(&cx, v, third) && present(&cx, v, fourth));
    assert_eq!(
        v.read_with(&cx, |v, cx| v.toasts.read(cx).len()).unwrap(),
        3
    );
    cx.update(|cx| Theme::light().install(cx));
    draw(&mut cx, v);
    assert!(present(&cx, v, first));
    key(&mut cx, v, "escape");
    assert!(!present(&cx, v, first));
}

#[test]
fn inactive_windows_preserve_the_remaining_display_time() {
    let (mut cx, v) = setup();
    let id = show(&mut cx, v, ToastKind::Success);

    advance(&mut cx, v, 1000);
    let mut visual = gpui::VisualTestContext::from_window(v.into(), &cx);

    visual.deactivate_window();
    advance(&mut cx, v, 20000);
    assert!(present(&cx, v, id));
    v.update(&mut cx, |_, window, _| window.activate_window())
        .unwrap();
    draw(&mut cx, v);
    advance(&mut cx, v, 3999);
    assert!(present(&cx, v, id));
    advance(&mut cx, v, 1);
    assert!(!present(&cx, v, id));
}

#[test]
fn clearing_a_hovered_stack_does_not_pause_future_notifications() {
    let (mut cx, v) = setup();

    show(&mut cx, v, ToastKind::Success);
    mouse(&mut cx, v, 300., 360.);
    v.update(&mut cx, |v, w, cx| {
        v.toasts.update(cx, |s, cx| s.clear(w, cx))
    })
    .unwrap();
    draw(&mut cx, v);
    mouse(&mut cx, v, 10., 100.);
    let id = show(&mut cx, v, ToastKind::Success);

    advance(&mut cx, v, 5000);
    assert!(!present(&cx, v, id));
}

#[test]
fn removing_a_focused_action_keeps_focus_inside_the_updated_card() {
    let (mut cx, v) = setup();

    key(&mut cx, v, "tab");
    let id = v
        .update(&mut cx, |v, w, cx| {
            v.toasts.update(cx, |s, cx| {
                s.show(
                    Toast {
                        action: Some(ToastAction::new("Retry", |_, _| {})),
                        ..Toast::new(ToastKind::Error, "Failed")
                    },
                    w,
                    cx,
                )
            })
        })
        .unwrap();

    draw(&mut cx, v);
    key(&mut cx, v, "tab");
    v.update(&mut cx, |v, w, cx| {
        v.toasts.update(cx, |s, cx| {
            assert!(s.update(id, Toast::new(ToastKind::Success, "Recovered"), w, cx));
        })
    })
    .unwrap();
    draw(&mut cx, v);
    assert!(
        v.update(&mut cx, |v, w, cx| v
            .toasts
            .read(cx)
            .focus_handle(cx)
            .contains_focused(w, cx))
            .unwrap()
    );
    key(&mut cx, v, "escape");
    assert!(!present(&cx, v, id));
}

fn bounds(
    cx: &gpui::TestAppContext,
    v: gpui::WindowHandle<Workbench>,
    selector: &'static str,
) -> gpui::Bounds<gpui::Pixels> {
    gpui::VisualTestContext::from_window(v.into(), cx)
        .debug_bounds(selector)
        .expect("toast is mounted")
}

fn pointer(
    cx: &mut gpui::TestAppContext,
    v: gpui::WindowHandle<Workbench>,
    point: gpui::Point<gpui::Pixels>,
    phase: &str,
) {
    cx.update_window(v.into(), |_, w, cx| {
        let event = match phase {
            "down" => gpui::MouseDownEvent {
                button: gpui::MouseButton::Left,
                position: point,
                modifiers: Default::default(),
                click_count: 1,
                first_mouse: false,
            }
            .to_platform_input(),
            "up" => gpui::MouseUpEvent {
                button: gpui::MouseButton::Left,
                position: point,
                modifiers: Default::default(),
                click_count: 1,
            }
            .to_platform_input(),
            "move" => gpui::MouseMoveEvent {
                position: point,
                pressed_button: Some(gpui::MouseButton::Left),
                modifiers: Default::default(),
            }
            .to_platform_input(),
            _ => unreachable!("test pointer phase"),
        };

        w.dispatch_event(event, cx);
    })
    .unwrap();
    draw(cx, v);
}

fn frame(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Workbench>, millis: u64) -> usize {
    cx.executor().advance_clock(Duration::from_millis(millis));
    let frames = cx
        .update_window(v.into(), |_, w, cx| w.simulate_next_frame(cx))
        .unwrap();

    draw(cx, v);

    frames
}

#[test]
fn short_drags_follow_the_pointer_then_settle_and_long_swipes_dismiss_in_either_direction() {
    for delta in [-140., 140.] {
        let (mut cx, v) = setup();
        let id = show(&mut cx, v, ToastKind::Progress);

        frame(&mut cx, v, 200);
        let initial = bounds(&cx, v, "toast-ToastId(0)");
        let start = initial.origin + gpui::point(px(80.), px(20.));

        pointer(&mut cx, v, start, "down");
        assert!(
            v.update(&mut cx, |v, w, _| v.root.is_focused(w)).unwrap(),
            "dragging preserves application focus"
        );
        assert!(
            v.update(&mut cx, |_, w, _| w.captured_hitbox().is_some())
                .unwrap()
        );
        pointer(&mut cx, v, start + gpui::point(px(40.), px(0.)), "move");
        assert_eq!(
            bounds(&cx, v, "toast-ToastId(0)").origin.x,
            initial.origin.x + px(40.)
        );
        pointer(&mut cx, v, start + gpui::point(px(40.), px(0.)), "up");
        assert!(present(&cx, v, id));
        frame(&mut cx, v, 200);
        assert_eq!(bounds(&cx, v, "toast-ToastId(0)").origin, initial.origin);
        pointer(&mut cx, v, start, "down");
        pointer(&mut cx, v, start + gpui::point(px(delta), px(0.)), "move");
        pointer(&mut cx, v, start + gpui::point(px(delta), px(0.)), "up");
        assert!(!present(&cx, v, id));
        assert!(
            v.update(&mut cx, |_, w, _| w.captured_hitbox().is_none())
                .unwrap()
        );
        frame(&mut cx, v, 300);
        assert_eq!(
            frame(&mut cx, v, 0),
            0,
            "settled and dismissed toasts stop requesting frames"
        );
    }
}

#[test]
fn dragging_pauses_expiration_and_modal_opening_cancels_the_gesture() {
    let (mut cx, v) = setup();
    let id = show(&mut cx, v, ToastKind::Success);

    frame(&mut cx, v, 1000);
    let start = bounds(&cx, v, "toast-ToastId(0)").origin + gpui::point(px(80.), px(20.));

    pointer(&mut cx, v, start, "down");
    pointer(&mut cx, v, start + gpui::point(px(-160.), px(0.)), "move");
    advance(&mut cx, v, 20000);
    assert!(
        present(&cx, v, id),
        "dragging outside the stack must pause expiration"
    );
    v.update(&mut cx, |v, _, cx| {
        v.paused = true;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    assert!(
        v.update(&mut cx, |_, w, _| w.captured_hitbox().is_none())
            .unwrap()
    );
    pointer(&mut cx, v, start + gpui::point(px(-160.), px(0.)), "up");
    assert!(
        present(&cx, v, id),
        "modal cancellation must not dismiss the toast"
    );
    frame(&mut cx, v, 200);
    v.update(&mut cx, |v, _, cx| {
        v.paused = false;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    mouse(&mut cx, v, 10., 100.);
    advance(&mut cx, v, 3999);
    assert!(present(&cx, v, id));
    advance(&mut cx, v, 1);
    assert!(!present(&cx, v, id));
}

#[test]
fn buttons_and_vertical_gestures_do_not_start_horizontal_swipes() {
    let (mut cx, v) = setup();
    let id = show(&mut cx, v, ToastKind::Error);

    frame(&mut cx, v, 200);
    let b = bounds(&cx, v, "toast-ToastId(0)");
    let start = b.origin + gpui::point(px(80.), px(20.));

    pointer(&mut cx, v, start, "down");
    pointer(&mut cx, v, start + gpui::point(px(2.), px(-50.)), "move");
    assert!(
        v.update(&mut cx, |_, w, _| w.captured_hitbox().is_none())
            .unwrap()
    );
    pointer(&mut cx, v, start + gpui::point(px(-160.), px(-50.)), "move");
    pointer(&mut cx, v, start + gpui::point(px(-160.), px(-50.)), "up");
    assert!(present(&cx, v, id));
    let close = b.origin + gpui::point(b.size.width - px(24.), px(24.));

    pointer(&mut cx, v, close, "down");
    assert!(
        v.update(&mut cx, |_, w, _| w.captured_hitbox().is_none())
            .unwrap(),
        "dismiss is an independent button"
    );
    pointer(&mut cx, v, close, "up");
    assert!(!present(&cx, v, id));
}

#[test]
fn stack_reflow_is_animated_and_reduced_motion_snaps_without_idle_frames() {
    let (mut cx, v) = setup();

    show(&mut cx, v, ToastKind::Error);
    frame(&mut cx, v, 200);
    let first = bounds(&cx, v, "toast-ToastId(0)");

    show(&mut cx, v, ToastKind::Progress);
    assert_eq!(bounds(&cx, v, "toast-ToastId(0)").origin.y, first.origin.y);
    frame(&mut cx, v, 70);
    let midway = bounds(&cx, v, "toast-ToastId(0)").origin.y;

    frame(&mut cx, v, 200);
    let final_y = bounds(&cx, v, "toast-ToastId(0)").origin.y;

    assert!(final_y < midway && midway < first.origin.y);
    assert_eq!(frame(&mut cx, v, 0), 0);

    let (mut cx, v) = setup();

    cx.update(|cx| cx.set_reduce_motion(true));
    let id = show(&mut cx, v, ToastKind::Progress);

    assert_eq!(
        frame(&mut cx, v, 0),
        0,
        "reduced motion does not schedule entrance frames"
    );
    let initial = bounds(&cx, v, "toast-ToastId(0)");
    let start = initial.origin + gpui::point(px(80.), px(20.));

    pointer(&mut cx, v, start, "down");
    pointer(&mut cx, v, start + gpui::point(px(40.), px(0.)), "move");
    pointer(&mut cx, v, start + gpui::point(px(40.), px(0.)), "up");
    assert_eq!(bounds(&cx, v, "toast-ToastId(0)").origin, initial.origin);
    assert!(present(&cx, v, id));
    assert_eq!(frame(&mut cx, v, 0), 0);
    v.update(&mut cx, |v, w, cx| {
        v.toasts.update(cx, |state, cx| {
            state.dismiss(id, w, cx);
        });
    })
    .unwrap();
    draw(&mut cx, v);
    assert_eq!(
        frame(&mut cx, v, 0),
        0,
        "reduced motion removes exits immediately"
    );
}

#[test]
fn new_notifications_preserve_a_dragged_card_and_inactive_windows_cancel_the_drag() {
    let (mut cx, v) = setup();
    let dragged = show(&mut cx, v, ToastKind::Error);

    frame(&mut cx, v, 200);
    let start = bounds(&cx, v, "toast-ToastId(0)").origin + gpui::point(px(80.), px(20.));

    pointer(&mut cx, v, start, "down");
    pointer(&mut cx, v, start + gpui::point(px(40.), px(0.)), "move");
    let displaced = show(&mut cx, v, ToastKind::Error);

    show(&mut cx, v, ToastKind::Error);
    show(&mut cx, v, ToastKind::Progress);
    assert!(
        present(&cx, v, dragged),
        "new feedback must not evict a card held by the pointer"
    );
    assert!(!present(&cx, v, displaced));
    gpui::VisualTestContext::from_window(v.into(), &cx).deactivate_window();
    draw(&mut cx, v);
    assert!(
        v.update(&mut cx, |_, w, _| w.captured_hitbox().is_none())
            .unwrap()
    );
    pointer(&mut cx, v, start + gpui::point(px(-180.), px(0.)), "move");
    pointer(&mut cx, v, start + gpui::point(px(-180.), px(0.)), "up");
    assert!(
        present(&cx, v, dragged),
        "losing activation cancels rather than completes a swipe"
    );
}

#[test]
fn an_interrupted_snap_back_can_be_grabbed_outside_the_original_column() {
    let (mut cx, v) = setup();
    let id = show(&mut cx, v, ToastKind::Progress);

    frame(&mut cx, v, 200);
    let initial = bounds(&cx, v, "toast-ToastId(0)");
    let start = initial.origin + gpui::point(px(10.), px(20.));

    pointer(&mut cx, v, start, "down");
    let pulled = start + gpui::point(px(-40.), px(0.));

    pointer(&mut cx, v, pulled, "move");
    pointer(&mut cx, v, pulled, "up");
    assert!(present(&cx, v, id));
    // This point lies outside the original scroll mask, within the moving card.
    pointer(&mut cx, v, pulled, "down");
    assert!(
        v.update(&mut cx, |_, w, _| w.captured_hitbox().is_some())
            .unwrap(),
        "paint and hitboxes escape the original column together"
    );
    pointer(&mut cx, v, pulled + gpui::point(px(10.), px(0.)), "move");
    assert_eq!(
        bounds(&cx, v, "toast-ToastId(0)").origin.x,
        initial.origin.x - px(30.),
        "regrabbing continues from the current presentation"
    );
    pointer(&mut cx, v, pulled + gpui::point(px(-100.), px(0.)), "move");
    pointer(&mut cx, v, pulled + gpui::point(px(-100.), px(0.)), "up");
    assert!(!present(&cx, v, id));
}
