//! Maps squash/reorder component tests to real Git review and retained native controls.
use super::*;

use crate::workspace::{
    replay::{Action, Kind, Open, Submit},
    tests::Fixture,
};

use onegit_ui::{DialogHost, DialogHostState, Theme};
use rake::gpui::{self, AppContext, InputEvent as _, px};
use std::sync::Arc;

struct Host {
    host: DialogHostState,
    form: gpui::Entity<Form>,
    actions: Vec<Action>,
    _event: gpui::Subscription,
}

impl Render for Host {
    fn render(&mut self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> impl IntoElement {
        rake::view! {<DialogHost state={self.host.clone()} body={gpui::div().size_full().into_any_element()}>{self.form.clone()}</DialogHost>}
    }
}

fn draw(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Host>) {
    for _ in 0..3 {
        cx.run_until_parked();
        cx.update_window(v.into(), |_, w, cx| w.draw(cx).clear(cx))
            .unwrap();
    }

    cx.run_until_parked();
}

fn fixture() -> Fixture {
    let f = Fixture::new();

    for name in ["base", "one", "two", "later"] {
        f.write(name, name);
        f.commit();
    }

    f
}

fn setup(f: &Fixture, kind: Kind, root: bool) -> (gpui::TestAppContext, gpui::WindowHandle<Host>) {
    let source = f.load();

    let commits = if root {
        vec!["HEAD^", "HEAD^^", "HEAD^^^"]
    } else {
        vec!["HEAD^", "HEAD^^"]
    }
    .into_iter()
    .map(|id| Arc::new(source.repository.commit(id, None).unwrap()))
    .collect();

    let mut cx = gpui::TestAppContext::single();

    cx.update(|cx| Theme::light().install(cx));
    let v = cx.open_window(gpui::size(px(900.), px(700.)), |w, cx| {
        let host = DialogHostState::new(cx);
        let form = cx.new(|cx| Form::new(&host, w, cx));

        let event = cx.subscribe(&form, |this: &mut Host, _, event: &Submit, _| {
            this.actions.push(event.0.clone())
        });

        form.update(cx, |form, cx| {
            form.configure(Some(source.clone()), false, cx);
            form.open(source, &Open { kind, commits }, w, cx);
        });

        Host {
            host,
            form,
            actions: vec![],
            _event: event,
        }
    });

    draw(&mut cx, v);

    (cx, v)
}

#[test]
fn readonly_range_review_and_cancel_never_install_refs_or_touch_files() {
    for kind in [Kind::Squash, Kind::Reorder] {
        let f = fixture();
        let old = f.load().snapshot.status.head.oid.clone();
        let index = std::fs::read(f.root.join(".git/index")).unwrap();
        let (mut cx, v) = setup(&f, kind, false);

        v.update(&mut cx, |host, w, cx| {
            host.form.update(cx, |form, cx| {
                assert_eq!(form.plan.as_ref().unwrap().commits.len(), 2);
                assert_eq!(form.plan.as_ref().unwrap().replay.len(), 1);
                assert_eq!(
                    form.order[0].oid,
                    form.review.as_ref().unwrap().commits[1].oid
                );
                form.cancel(w, cx);
            })
        })
        .unwrap();
        draw(&mut cx, v);
        v.read_with(&cx, |host, cx| {
            assert!(host.actions.is_empty());
            assert!(!host.form.read(cx).dialog.read(cx).is_open());
        })
        .unwrap();
        assert_eq!(f.load().snapshot.status.head.oid, old);
        assert_eq!(std::fs::read(f.root.join(".git/index")).unwrap(), index);
        assert!(
            f.git(&["for-each-ref", "refs/1git/squash/", "refs/1git/reorder/"])
                .is_empty()
        );
    }
}

#[test]
fn squash_edits_exact_captured_message_and_failed_consent_cannot_repeat() {
    let f = fixture();
    let (mut cx, v) = setup(&f, Kind::Squash, false);

    v.update(&mut cx, |host, w, cx| {
        host.form.update(cx, |form, cx| {
            form.summary
                .update(cx, |input, cx| input.set_text("   ", cx));
            form.submit(cx);
            assert!(!form.busy);
            form.summary
                .update(cx, |input, cx| input.set_text("Combined", cx));
            form.description
                .update(cx, |input, cx| input.set_text("Keep body", cx));
            form.submit(cx);
            form.submit(cx);
            assert!(form.busy);
            form.finish(Err("Hook failed".into()), w, cx);
            form.submit(cx);
            assert!(!form.busy);
            assert!(form.plan.is_none());
            assert_eq!(form.summary.read(cx).text(), "Combined");
            assert_eq!(form.description.read(cx).text(), "Keep body");
        })
    })
    .unwrap();
    draw(&mut cx, v);
    v.read_with(&cx, |host, _| {
        assert_eq!(host.actions.len(), 1);

        let Action::Squash {
            review, message, ..
        } = &host.actions[0]
        else {
            panic!("squash consent")
        };

        assert_eq!(review.commits.len(), 2);
        assert_eq!(
            message,
            "Combined

Keep body"
        );
    })
    .unwrap();
}

#[test]
fn reorder_requires_a_change_retains_failed_order_and_keeps_a_selected_root_first() {
    let f = fixture();
    let (mut cx, v) = setup(&f, Kind::Reorder, false);

    v.update(&mut cx, |host, w, cx| {
        host.form.update(cx, |form, cx| {
            let original = form.order.iter().map(|c| c.oid.clone()).collect::<Vec<_>>();

            form.submit(cx);
            assert!(!form.busy);
            form.move_by(1, cx);
            assert_eq!(form.order[0].oid, original[1]);
            form.submit(cx);
            form.submit(cx);
            assert!(form.busy);
            form.finish(Err("Replay conflict".into()), w, cx);
            assert_eq!(form.order[0].oid, original[1]);
            form.submit(cx);
            assert!(!form.busy);
        })
    })
    .unwrap();
    draw(&mut cx, v);
    v.read_with(&cx, |host, _| assert_eq!(host.actions.len(), 1))
        .unwrap();
    let (mut cx, v) = setup(&f, Kind::Reorder, true);

    v.update(&mut cx, |host, _, cx| {
        host.form.update(cx, |form, cx| {
            let root = form.order[0].oid.clone();

            assert!(!form.can_move(1));
            form.move_by(1, cx);
            assert_eq!(form.order[0].oid, root);
            form.selected = Some(form.order[1].oid.clone());
            assert!(!form.can_move(-1));
            form.move_by(-1, cx);
            assert_eq!(form.order[0].oid, root);
            assert!(form.can_move(1));
            form.move_by(1, cx);
            assert_eq!(form.order[0].oid, root);
        })
    })
    .unwrap();
}

#[test]
fn stale_and_published_reviews_never_emit_range_writes() {
    for kind in [Kind::Squash, Kind::Reorder] {
        let f = fixture();
        let old = f.load().snapshot.status.head.oid.clone().unwrap();

        f.git(&["update-ref", "refs/remotes/origin/main", &old]);
        let (mut cx, v) = setup(&f, kind, false);

        v.update(&mut cx, |host, _, cx| {
            host.form.update(cx, |form, cx| {
                assert!(form.error.as_ref().unwrap().contains("published"));
                form.submit(cx);
                assert!(!form.busy);
            })
        })
        .unwrap();
        v.read_with(&cx, |host, _| assert!(host.actions.is_empty()))
            .unwrap();
        f.git(&["update-ref", "-d", "refs/remotes/origin/main"]);
        let (mut cx, v) = setup(&f, kind, false);

        f.git(&["switch", "-c", "external"]);
        let source = f.load();

        v.update(&mut cx, |host, _, cx| {
            host.form.update(cx, |form, cx| {
                form.configure(Some(source), false, cx);
                assert!(form.reason().is_some());
                form.move_by(1, cx);
                form.submit(cx);
                assert!(!form.busy);
                assert_eq!(
                    form.review
                        .as_ref()
                        .unwrap()
                        .source
                        .expected
                        .branch
                        .as_deref(),
                    Some("main")
                );
            })
        })
        .unwrap();
        v.read_with(&cx, |host, _| assert!(host.actions.is_empty()))
            .unwrap();
    }
}

fn key(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Host>, value: &str) {
    cx.update_window(v.into(), |_, window, cx| {
        let keystroke = gpui::Keystroke::parse(value).unwrap();

        window.dispatch_event(
            gpui::KeyDownEvent {
                keystroke: keystroke.clone(),
                is_held: false,
                prefer_character_input: false,
            }
            .to_platform_input(),
            cx,
        );
        window.dispatch_event(gpui::KeyUpEvent { keystroke }.to_platform_input(), cx);
    })
    .unwrap();
    draw(cx, v);
}

#[test]
fn native_keyboard_drag_and_reduced_motion_reorder_without_writing_and_settle_at_rest() {
    let f = fixture();
    let (mut cx, v) = setup(&f, Kind::Reorder, false);

    cx.executor()
        .advance_clock(std::time::Duration::from_millis(150));
    cx.update_window(v.into(), |_, w, cx| w.simulate_next_frame(cx))
        .unwrap();
    draw(&mut cx, v);
    let original = v
        .read_with(&cx, |host, cx| {
            host.form
                .read(cx)
                .order
                .iter()
                .map(|c| c.oid.clone())
                .collect::<Vec<_>>()
        })
        .unwrap();

    key(&mut cx, v, "alt-down");
    v.read_with(&cx, |host, cx| {
        assert_eq!(host.form.read(cx).order[0].oid, original[1])
    })
    .unwrap();
    key(&mut cx, v, "alt-up");
    v.read_with(&cx, |host, cx| {
        assert_eq!(host.form.read(cx).order[0].oid, original[0])
    })
    .unwrap();
    let row = gpui::VisualTestContext::from_window(v.into(), &cx)
        .debug_bounds("rewrite-row-0")
        .unwrap();

    assert_eq!(
        row.size.width,
        px(412.),
        "source rows fill the 440px dialog minus panel/list padding"
    );
    let from = row.center();

    let to = from + gpui::point(px(0.), px(48.));

    cx.update_window(v.into(), |_, w, cx| {
        w.dispatch_event(
            gpui::MouseDownEvent {
                button: gpui::MouseButton::Left,
                position: from,
                modifiers: Default::default(),
                click_count: 1,
                first_mouse: false,
            }
            .to_platform_input(),
            cx,
        );
        w.dispatch_event(
            gpui::MouseMoveEvent {
                position: to,
                pressed_button: Some(gpui::MouseButton::Left),
                modifiers: Default::default(),
            }
            .to_platform_input(),
            cx,
        );
        w.dispatch_event(
            gpui::MouseUpEvent {
                button: gpui::MouseButton::Left,
                position: to,
                modifiers: Default::default(),
                click_count: 1,
            }
            .to_platform_input(),
            cx,
        );
    })
    .unwrap();
    draw(&mut cx, v);
    v.read_with(&cx, |host, cx| {
        assert_eq!(host.form.read(cx).order[0].oid, original[1]);
        assert!(host.actions.is_empty());
    })
    .unwrap();
    cx.executor()
        .advance_clock(std::time::Duration::from_millis(250));
    cx.update_window(v.into(), |_, w, cx| w.simulate_next_frame(cx))
        .unwrap();
    draw(&mut cx, v);
    let pending = cx
        .update_window(v.into(), |_, w, cx| w.simulate_next_frame(cx))
        .unwrap();

    assert_eq!(
        pending, 0,
        "settled reorder must not schedule an idle animation loop"
    );
    cx.update(|cx| cx.set_reduce_motion(true));
    key(&mut cx, v, "alt-up");
    v.update(&mut cx, |host, _, cx| {
        host.form.update(cx, |form, cx| {
            assert_eq!(form.order[0].oid, original[0]);
            let time = cx
                .background_executor()
                .now()
                .saturating_duration_since(form.epoch);

            for (index, commit) in form.order.iter().enumerate() {
                let sample = form
                    .positions
                    .get_mut(&commit.oid)
                    .unwrap()
                    .sample(time, true);

                assert!(!sample.is_animating());
                assert_eq!(sample.value(), index as f64 * 48.);
            }
        })
    })
    .unwrap();
}

#[test]
fn cancelling_a_pending_range_review_cancels_git_and_ignores_its_late_result() {
    for kind in [Kind::Squash, Kind::Reorder] {
        let f = fixture();
        let (mut cx, v) = setup(&f, kind, false);

        v.update(&mut cx, |host, window, cx| {
            host.form.update(cx, |form, cx| {
                let source = f.load();
                let commits = form.review.as_ref().unwrap().commits.clone();

                form.open(source, &Open { kind, commits }, window, cx);
                let cancel = form.read_job.as_ref().unwrap().cancel.clone();

                form.cancel(window, cx);
                assert!(cancel.is_cancelled());
            })
        })
        .unwrap();
        draw(&mut cx, v);
        v.read_with(&cx, |host, cx| {
            let form = host.form.read(cx);

            assert!(!form.is_open(cx));
            assert!(form.plan.is_none());
            assert!(form.read_job.is_none());
            assert!(form.deadline.is_none());
            assert!(host.actions.is_empty());
        })
        .unwrap();
    }
}
