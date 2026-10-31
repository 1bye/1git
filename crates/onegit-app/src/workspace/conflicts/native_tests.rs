use super::*;
use onegit_git::{BranchIdentity, FinishKind, FinishOperation, OperationState};

struct Host {
    host: DialogHostState,
    form: gpui::Entity<Form>,
    actions: Vec<Action>,
    _event: gpui::Subscription,
}

impl gpui::Render for Host {
    fn render(
        &mut self,
        _: &mut gpui::Window,
        _: &mut gpui::Context<Self>,
    ) -> impl gpui::IntoElement {
        rake::view! {<onegit_ui::DialogHost state={self.host.clone()} body={gpui::div().size_full().into_any_element()}>{self.form.clone()}</onegit_ui::DialogHost>}
    }
}

fn action() -> Action {
    Action::Finish(FinishOperation {
        kind: FinishKind::Abort,
        operation: OperationState::Merge,
        expected: BranchIdentity {
            branch: Some("main".into()),
            oid: Some("a".repeat(40)),
        },
        token: "reviewed".into(),
    })
}

fn setup() -> (gpui::TestAppContext, gpui::WindowHandle<Host>) {
    let mut cx = gpui::TestAppContext::single();

    cx.update(|cx| onegit_ui::Theme::light().install(cx));
    let view = cx.open_window(gpui::size(px(800.), px(600.)), |_, cx| {
        let host = DialogHostState::new(cx);
        let form = cx.new(|cx| Form::new(&host, cx));

        let event = cx.subscribe(&form, |host: &mut Host, _, event: &Submit, _| {
            host.actions.push(event.0.clone())
        });

        Host {
            host,
            form,
            actions: Vec::new(),
            _event: event,
        }
    });

    (cx, view)
}

fn draw(cx: &mut gpui::TestAppContext, view: gpui::WindowHandle<Host>) {
    for _ in 0..3 {
        cx.run_until_parked();
        cx.update_window(view.into(), |_, window, cx| window.draw(cx).clear(cx))
            .unwrap();
    }

    cx.run_until_parked();
}

#[test]
fn frozen_abort_review_is_cancel_first_and_busy_rejects_duplicates_and_dismissal() {
    let (mut cx, view) = setup();

    view.update(&mut cx, |host, window, cx| {
        host.form.update(cx, |form, cx| {
            form.configure(false, cx);
            form.open(action(), gpui::point(px(30.), px(30.)), window, cx);
        })
    })
    .unwrap();
    draw(&mut cx, view);
    view.update(&mut cx, |host, window, cx| {
        assert!(host.form.read(cx).cancel.is_focused(window));
        assert!(host.actions.is_empty());
        host.form.update(cx, |form, cx| {
            form.confirm(cx);
            form.confirm(cx);
            form.close(window, cx);
            assert!(form.dialog.read(cx).is_open());
        });
    })
    .unwrap();
    draw(&mut cx, view);
    view.read_with(&cx, |host, _| {
        assert_eq!(host.actions.len(), 1);

        let Action::Finish(request) = &host.actions[0] else {
            panic!("abort");
        };

        assert_eq!(request.token, "reviewed");
    })
    .unwrap();
    view.update(&mut cx, |host, window, cx| {
        host.form.update(cx, |form, cx| {
            form.finish(Err("The operation changed; refresh.".into()), window, cx);
            form.confirm(cx);
        })
    })
    .unwrap();
    draw(&mut cx, view);
    view.read_with(&cx, |host, _| assert_eq!(host.actions.len(), 1))
        .unwrap();
}

#[test]
fn reduced_motion_snaps_and_settled_confirmations_do_not_keep_animating() {
    let (mut cx, view) = setup();

    cx.update(|cx| cx.set_reduce_motion(true));
    view.update(&mut cx, |host, window, cx| {
        host.form.update(cx, |form, cx| {
            form.configure(false, cx);
            form.open(action(), gpui::point(px(30.), px(30.)), window, cx);
        })
    })
    .unwrap();
    draw(&mut cx, view);
    let bounds = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("conflict-confirmation-content")
        .unwrap();

    assert_eq!(bounds.size.width, px(320.));
    view.update(&mut cx, |host, _, cx| {
        host.form.update(cx, |form, cx| {
            let time = cx
                .background_executor()
                .now()
                .saturating_duration_since(form.epoch);

            assert!(!form.opacity.sample(time, true).is_animating());
            assert!(!form.height.sample(time, true).is_animating());
        })
    })
    .unwrap();
}
