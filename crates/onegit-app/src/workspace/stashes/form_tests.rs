//! Native forms mirror source action tests: explicit consent, captured identity, focus and busy guards.
use super::*;
use onegit_git::BranchIdentity;
use onegit_ui::{DialogHost, Theme};

struct Host {
    form: gpui::Entity<Form>,
    host: DialogHostState,
    requests: Vec<StashRequest>,
    _events: gpui::Subscription,
}

impl Render for Host {
    fn render(&mut self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> impl IntoElement {
        rake::view! {<DialogHost state={self.host.clone()} body={gpui::div().size_full().into_any_element()}>{self.form.clone()}</DialogHost>}
    }
}

fn setup() -> (
    gpui::TestAppContext,
    gpui::WindowHandle<Host>,
    gpui::Entity<Form>,
) {
    let mut cx = gpui::TestAppContext::single();

    cx.update(|cx| Theme::light().install(cx));
    let view = cx.open_window(gpui::size(px(640.), px(480.)), |window, cx| {
        let host = DialogHostState::new(cx);
        let form = cx.new(|cx| Form::new(&host, window, cx));

        let events = cx.subscribe(&form, |this: &mut Host, _, event: &Submit, _| {
            this.requests.push(event.0.clone())
        });

        Host {
            form,
            host,
            requests: Vec::new(),
            _events: events,
        }
    });

    let form = view.read_with(&cx, |host, _| host.form.clone()).unwrap();

    form.update(&mut cx, |form, cx| {
        form.blocked(false, cx);
        form.create_anchor.set(gpui::Bounds::new(
            gpui::point(px(260.), px(224.)),
            gpui::size(px(83.), px(24.)),
        ));
        form.more_anchor.set(gpui::Bounds::new(
            gpui::point(px(111.), px(224.)),
            gpui::size(px(26.), px(24.)),
        ));
    });

    (cx, view, form)
}

fn request(action: StashAction) -> StashRequest {
    StashRequest {
        source: BranchIdentity {
            oid: Some("b".repeat(40)),
            branch: Some("main".into()),
        },
        action,
    }
}

fn draw(cx: &mut gpui::TestAppContext, view: gpui::WindowHandle<Host>) {
    cx.run_until_parked();
    cx.executor().advance_clock(Duration::from_millis(200));

    for _ in 0..3 {
        cx.update_window(view.into(), |_, window, cx| window.draw(cx).clear(cx))
            .unwrap();
        cx.run_until_parked();
    }
}

#[test]
fn deletion_focuses_cancel_captures_reviewed_oid_and_cancellation_never_submits() {
    let (mut cx, view, form) = setup();
    let reviewed = request(StashAction::Delete("a".repeat(40)));

    view.update(&mut cx, |_, window, cx| {
        form.update(cx, |form, cx| {
            form.open(reviewed.clone(), "On main: Saved work".into(), window, cx)
        })
    })
    .unwrap();
    draw(&mut cx, view);
    view.update(&mut cx, |host, window, cx| {
        assert!(form.read(cx).cancel.is_focused(window));
        assert!(host.requests.is_empty());
        form.update(cx, |form, cx| form.close(window, cx));
    })
    .unwrap();
    draw(&mut cx, view);
    assert!(!form.read_with(&cx, |form, cx| form.dialog.read(cx).is_open()));
    view.update(&mut cx, |_, window, cx| {
        form.update(cx, |form, cx| {
            form.open(reviewed.clone(), "On main: Saved work".into(), window, cx)
        })
    })
    .unwrap();
    draw(&mut cx, view);
    form.update(&mut cx, |form, cx| {
        form.submit(cx);
        form.submit(cx);
    });
    cx.run_until_parked();
    view.read_with(&cx, |host, _| assert_eq!(host.requests, vec![reviewed]))
        .unwrap();
    view.update(&mut cx, |_, window, cx| {
        form.update(cx, |form, cx| form.close(window, cx));
        assert!(form.read(cx).dialog.read(cx).is_open());
    })
    .unwrap();
}

#[test]
fn saving_uses_only_form_values_preserves_them_on_failure_and_requires_explicit_retry() {
    let (mut cx, view, form) = setup();

    view.update(&mut cx, |_, window, cx| {
        form.update(cx, |form, cx| {
            form.open(
                request(StashAction::Save {
                    message: String::new(),
                    include_untracked: false,
                }),
                String::new(),
                window,
                cx,
            );
            form.message
                .update(cx, |input, cx| input.set_text("Work été ✨", cx));
            form.untracked = true;
            form.submit(cx);
            form.submit(cx);
        })
    })
    .unwrap();
    draw(&mut cx, view);
    view.read_with(&cx, |host, _| {
        assert_eq!(host.requests.len(), 1);
        assert_eq!(
            host.requests[0],
            request(StashAction::Save {
                message: "Work été ✨".into(),
                include_untracked: true
            })
        );
    })
    .unwrap();
    view.update(&mut cx, |_, window, cx| {
        form.update(cx, |form, cx| {
            form.finish(Err("Review before retrying".into()), window, cx)
        })
    })
    .unwrap();
    draw(&mut cx, view);
    form.read_with(&cx, |form, cx| {
        assert!(!form.busy);
        assert_eq!(form.message.read(cx).text(), "Work été ✨");
        assert!(form.untracked);
        assert!(form.dialog.read(cx).is_open());
    });
    form.update(&mut cx, |form, cx| form.submit(cx));
    draw(&mut cx, view);
    view.read_with(&cx, |host, _| assert_eq!(host.requests.len(), 2))
        .unwrap();
    view.update(&mut cx, |_, window, cx| {
        form.update(cx, |form, cx| form.finish(Ok(()), window, cx))
    })
    .unwrap();
    draw(&mut cx, view);
    form.read_with(&cx, |form, cx| {
        assert!(form.message.read(cx).text().is_empty());
        assert!(form.untracked);
        assert!(!form.dialog.read(cx).is_open());
    });
}

#[test]
fn narrow_popover_stays_above_trigger_and_error_size_motion_settles_without_idle_frames() {
    let (mut cx, view, form) = setup();

    view.update(&mut cx, |_, window, cx| {
        form.update(cx, |form, cx| {
            form.open(
                request(StashAction::Delete("a".repeat(40))),
                "Saved work".into(),
                window,
                cx,
            )
        })
    })
    .unwrap();
    draw(&mut cx, view);
    let bounds = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("stash-form-content")
        .unwrap();

    assert!(bounds.left() >= px(0.));
    assert!(bounds.right() <= px(640.));
    assert!(bounds.bottom() <= px(224.));
    view.update(&mut cx, |_, window, cx| {
        form.update(cx, |form, cx| {
            form.finish(Err("Review the result".repeat(4)), window, cx)
        })
    })
    .unwrap();
    draw(&mut cx, view);
    let bounds = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("stash-form-content")
        .unwrap();

    assert!(bounds.top() >= px(0.));
    assert!(bounds.bottom() <= px(480.));
    form.update(&mut cx, |form, cx| {
        let time = cx
            .background_executor()
            .now()
            .saturating_duration_since(form.epoch);

        assert!(!form.height.sample(time, false).is_animating());
        assert!(!form.opacity.sample(time, false).is_animating());
    });
}

#[test]
fn reduced_motion_snaps_form_opacity_and_error_height() {
    let (mut cx, view, form) = setup();

    cx.update(|cx| cx.set_reduce_motion(true));
    view.update(&mut cx, |_, window, cx| {
        form.update(cx, |form, cx| {
            form.open(
                request(StashAction::Save {
                    message: String::new(),
                    include_untracked: false,
                }),
                String::new(),
                window,
                cx,
            )
        })
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(view.into(), |_, window, cx| window.draw(cx).clear(cx))
        .unwrap();
    form.update(&mut cx, |form, cx| {
        let time = cx
            .background_executor()
            .now()
            .saturating_duration_since(form.epoch);

        assert!(!form.opacity.sample(time, true).is_animating());
        assert_eq!(form.opacity.sample(time, true).value(), 1.);
    });
}

#[test]
fn unrelated_stash_completion_preserves_a_cancelled_save_form_draft() {
    let (mut cx, view, form) = setup();

    view.update(&mut cx, |_, window, cx| {
        form.update(cx, |form, cx| {
            form.open(
                request(StashAction::Save {
                    message: String::new(),
                    include_untracked: false,
                }),
                String::new(),
                window,
                cx,
            );
            form.message
                .update(cx, |input, cx| input.set_text("Save this later", cx));
            form.untracked = true;
            form.close(window, cx);
        })
    })
    .unwrap();
    draw(&mut cx, view);
    view.update(&mut cx, |_, window, cx| {
        form.update(cx, |form, cx| form.finish(Ok(()), window, cx))
    })
    .unwrap();
    draw(&mut cx, view);
    form.read_with(&cx, |form, cx| {
        assert_eq!(form.message.read(cx).text(), "Save this later");
        assert!(form.untracked);
    });
}
