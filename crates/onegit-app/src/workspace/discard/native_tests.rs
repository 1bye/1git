//! Source native confirmation contracts: Cancel default, frozen consent and no duplicate submissions.
use super::*;
use onegit_git::{BranchIdentity, GitPath};
use onegit_ui::DialogHost;

struct Host {
    form: gpui::Entity<Form>,
    host: DialogHostState,
    actions: Vec<Action>,
    _event: gpui::Subscription,
}

impl Render for Host {
    fn render(&mut self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> impl IntoElement {
        rake::view! { <DialogHost state={self.host.clone()} body={gpui::div().size_full().into_any_element()}>{self.form.clone()}</DialogHost> }
    }
}

fn selection(scope: DiscardScope) -> Selection {
    Selection {
        source: BranchIdentity {
            oid: Some("a".repeat(40)),
            branch: Some("main".into()),
        },
        paths: vec![GitPath::new("a[1].txt").unwrap()],
        scope,
        label: "a[1].txt".into(),
    }
}

fn setup() -> (gpui::TestAppContext, gpui::WindowHandle<Host>) {
    let mut cx = gpui::TestAppContext::single();

    cx.update(|cx| onegit_ui::Theme::light().install(cx));
    let view = cx.open_window(gpui::size(px(640.), px(480.)), |window, cx| {
        let host = DialogHostState::new(cx);
        let form = cx.new(|cx| Form::new(&host, window, cx));

        form.update(cx, |form, cx| {
            form.configure(false, cx);
        });
        let event = cx.subscribe(&form, |this: &mut Host, _, event: &Submit, _| {
            this.actions.push(event.0.clone())
        });

        Host {
            form,
            host,
            actions: Vec::new(),
            _event: event,
        }
    });

    (cx, view)
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
fn cancel_and_escape_never_submit_and_confirmation_keeps_paths_and_branch() {
    let (mut cx, view) = setup();

    view.update(&mut cx, |host, window, cx| {
        host.form.update(cx, |form, cx| {
            form.open(selection(DiscardScope::Tracked), window, cx)
        })
    })
    .unwrap();
    draw(&mut cx, view);
    view.update(&mut cx, |host, window, cx| {
        assert!(host.form.read(cx).cancel.is_focused(window));
        assert!(host.actions.is_empty());
        host.form.update(cx, |form, cx| form.close(window, cx));
    })
    .unwrap();
    draw(&mut cx, view);
    view.update(&mut cx, |host, window, cx| {
        host.form.update(cx, |form, cx| {
            form.open(selection(DiscardScope::Untracked), window, cx);
            form.submit(cx);
            form.submit(cx);
            form.close(window, cx);
            assert!(form.dialog.read(cx).is_open());
        })
    })
    .unwrap();
    cx.run_until_parked();
    view.read_with(&cx, |host, _| {
        assert_eq!(host.actions.len(), 1);

        let Action::Discard {
            selection: captured,
            ..
        } = &host.actions[0]
        else {
            panic!("expected discard");
        };

        assert_eq!(*captured, selection(DiscardScope::Untracked));
    })
    .unwrap();
}

#[test]
fn failures_require_new_review_and_motion_settles_without_an_idle_frame_loop() {
    let (mut cx, view) = setup();

    view.update(&mut cx, |host, window, cx| {
        host.form.update(cx, |form, cx| {
            form.open(selection(DiscardScope::Tracked), window, cx);
            form.submit(cx);
        })
    })
    .unwrap();
    draw(&mut cx, view);
    view.update(&mut cx, |host, window, cx| {
        host.form.update(cx, |form, cx| {
            form.finish(
                Err("Files changed. Review again.".into()),
                None,
                None,
                window,
                cx,
            );
            form.submit(cx);
        })
    })
    .unwrap();
    draw(&mut cx, view);
    view.read_with(&cx, |host, cx| {
        assert_eq!(host.actions.len(), 1);
        assert_eq!(
            host.form.read(cx).request.as_ref(),
            Some(&selection(DiscardScope::Tracked))
        );
        assert!(host.form.read(cx).error.is_some());
    })
    .unwrap();
    view.update(&mut cx, |host, _, cx| {
        host.form.update(cx, |form, cx| {
            let time = cx
                .background_executor()
                .now()
                .saturating_duration_since(form.epoch);

            assert!(!form.height.sample(time, false).is_animating());
            assert!(!form.opacity.sample(time, false).is_animating());
        })
    })
    .unwrap();
}

#[test]
fn reduced_motion_snaps_and_the_alert_matches_source_geometry() {
    let (mut cx, view) = setup();

    cx.update(|cx| cx.set_reduce_motion(true));
    view.update(&mut cx, |host, window, cx| {
        host.form.update(cx, |form, cx| {
            form.open(selection(DiscardScope::Tracked), window, cx)
        })
    })
    .unwrap();
    draw(&mut cx, view);
    let mut visual = gpui::VisualTestContext::from_window(view.into(), &cx);
    let panel = visual.debug_bounds("discard-content").unwrap();
    let confirm = visual.debug_bounds("discard-confirm-button").unwrap();
    let copy = visual.debug_bounds("discard-copy-viewport").unwrap();

    assert_eq!(panel.size.width, px(260.));
    assert_eq!(panel.size.height, px(316.));
    assert_eq!(confirm.size.width, px(228.));
    assert_eq!(confirm.size.height, px(28.));
    assert!(confirm.top() >= copy.bottom());
    view.update(&mut cx, |host, _, cx| {
        host.form.update(cx, |form, cx| {
            let time = cx
                .background_executor()
                .now()
                .saturating_duration_since(form.epoch);

            assert_eq!(form.opacity.sample(time, true).value(), 1.);
            assert!(!form.height.sample(time, true).is_animating());
        })
    })
    .unwrap();
}

#[test]
fn an_older_restore_action_keeps_its_token_and_cannot_clear_a_newer_recovery() {
    let fixture = crate::workspace::tests::Fixture::new();
    let repository = fixture.load().repository.clone();

    let original = Recovery {
        repository,
        source: selection(DiscardScope::Tracked).source,
        undo: onegit_git::DiscardUndo {
            token: "older".into(),
            path: GitPath::new("a.txt").unwrap(),
            expires_at: "2099-01-01T00:00:00.000Z".into(),
        },
        backup: onegit_git::RecoveryBackup {
            directory: fixture.directory.path().join("backup"),
            complete: true,
        },
    };

    let mut newer = original.clone();

    newer.undo.token = "newer".into();
    let (mut cx, view) = setup();

    view.update(&mut cx, |host, _, cx| {
        host.form.update(cx, |form, cx| {
            form.recovery = Some(newer);
            form.restore_saved(original.clone(), cx);
        })
    })
    .unwrap();
    cx.run_until_parked();
    view.read_with(&cx, |host, _| {
        let Action::Restore(saved) = &host.actions[0] else {
            panic!("expected frozen restore");
        };

        assert_eq!(saved.undo.token, "older");
    })
    .unwrap();
    view.update(&mut cx, |host, window, cx| {
        host.form.update(cx, |form, cx| {
            form.finish(Ok(()), None, Some("older"), window, cx);
            assert_eq!(form.recovery.as_ref().unwrap().undo.token, "newer");
        })
    })
    .unwrap();
}
