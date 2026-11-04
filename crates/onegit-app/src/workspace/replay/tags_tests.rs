//! Maps source tag review/cancel/dirty-state behavior and requested deletion guards.
use super::*;
use crate::workspace::tests::Fixture;
use onegit_ui::{DialogHost, DialogHostState, Theme};
use rake::gpui::{AppContext, px};

struct Host {
    host: DialogHostState,
    form: gpui::Entity<Form>,
    actions: Vec<crate::workspace::replay::Action>,
    _event: gpui::Subscription,
}

impl Render for Host {
    fn render(&mut self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> impl IntoElement {
        rake::view! {<DialogHost state={self.host.clone()} body={gpui::div().size_full().into_any_element()}>{self.form.clone()}</DialogHost>}
    }
}

fn setup(f: &Fixture, tag: Option<Tag>) -> (gpui::TestAppContext, gpui::WindowHandle<Host>) {
    let source = f.load();
    let commit = Arc::new(source.repository.commit("HEAD", None).unwrap());
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
            form.open(source, &Open { commit, tag }, w, cx);
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

    f.write("a", "base");
    f.commit();

    f
}

#[test]
fn confirms_clicked_commit_on_dirty_worktree_defaults_to_annotation_and_cancels_without_writing() {
    let f = fixture();

    f.write("keep", "dirty");
    let (mut cx, v) = setup(&f, None);

    v.update(&mut cx, |host, w, cx| {
        host.form.update(cx, |form, cx| {
            assert!(form.disabled(cx));
            assert!(form.annotated);
            form.name
                .update(cx, |input, cx| input.set_text("  v1  ", cx));
            form.submit(cx);
            form.submit(cx);
            form.cancel(w, cx);
            assert!(
                form.dialog.read(cx).is_open(),
                "busy dismissal must not lose the request"
            );
        })
    })
    .unwrap();
    draw(&mut cx, v);
    v.read_with(&cx, |host, _| {
        assert_eq!(host.actions.len(), 1);

        let crate::workspace::replay::Action::Tag(action) = &host.actions[0] else {
            panic!("tag action")
        };

        let Change::Create { name, annotation } = &action.change else {
            panic!("create")
        };

        assert_eq!(name, "v1");
        assert_eq!(annotation.as_deref(), Some("Release v1"));
    })
    .unwrap();
    assert!(f.load().repository.tags(None).unwrap().is_empty());
}

#[test]
fn lightweight_choice_and_failed_intent_are_retained_without_automatic_retry() {
    let f = fixture();
    let (mut cx, v) = setup(&f, None);

    v.update(&mut cx, |host, w, cx| {
        host.form.update(cx, |form, cx| {
            form.annotated = false;
            form.name
                .update(cx, |input, cx| input.set_text("preview", cx));
            form.submit(cx);
            form.finish(
                Err("Refresh and inspect tags before retrying.".into()),
                w,
                cx,
            );
            form.submit(cx);
            assert_eq!(form.name.read(cx).text(), "preview");
            assert!(!form.annotated);
            assert!(form.disabled(cx));
        })
    })
    .unwrap();
    draw(&mut cx, v);
    v.read_with(&cx, |host, _| {
        assert_eq!(host.actions.len(), 1);

        let crate::workspace::replay::Action::Tag(action) = &host.actions[0] else {
            panic!("tag")
        };

        assert!(matches!(
            action.change,
            Change::Create {
                annotation: None,
                ..
            }
        ));
    })
    .unwrap();
}

#[test]
fn stale_identity_or_replaced_tag_blocks_consent_and_cancel_keeps_refs() {
    let f = fixture();

    f.git(&["tag", "preview"]);
    let tag = f.load().repository.tags(None).unwrap().remove(0);
    let (mut cx, v) = setup(&f, Some(tag.clone()));

    f.git(&["tag", "-f", "-a", "-m", "Replacement", "preview"]);
    let changed = f.load();

    v.update(&mut cx, |host, w, cx| {
        host.form.update(cx, |form, cx| {
            assert!(form.cancel_focus.is_focused(w));
            form.configure(Some(changed), false, cx);
            assert!(form.disabled(cx));
            form.submit(cx);
            form.cancel(w, cx);
            assert!(!form.dialog.read(cx).is_open());
        })
    })
    .unwrap();
    draw(&mut cx, v);
    v.read_with(&cx, |host, _| assert!(host.actions.is_empty()))
        .unwrap();
    assert_ne!(f.load().repository.tags(None).unwrap()[0].oid, tag.oid);
}

#[test]
fn type_change_animates_height_then_settles_and_reduced_motion_snaps_without_idle_frames() {
    let f = fixture();
    let (mut cx, v) = setup(&f, None);

    v.update(&mut cx, |host, _, cx| {
        host.form.update(cx, |form, cx| {
            form.annotated = false;
            cx.notify();
        })
    })
    .unwrap();
    draw(&mut cx, v);
    cx.executor().advance_clock(Duration::from_millis(150));
    cx.update_window(v.into(), |_, w, cx| w.simulate_next_frame(cx))
        .unwrap();
    draw(&mut cx, v);
    assert_eq!(
        cx.update_window(v.into(), |_, w, cx| w.simulate_next_frame(cx))
            .unwrap(),
        0
    );
    let mut visual = gpui::VisualTestContext::from_window(v.into(), &cx);
    let panel = visual.debug_bounds("tag-panel").unwrap();
    let actions = visual.debug_bounds("tag-actions").unwrap();

    assert!(
        actions.origin.y + actions.size.height <= panel.origin.y + panel.size.height - px(8.),
        "lightweight actions must fit inside the panel with bottom padding"
    );

    cx.update(|cx| cx.set_reduce_motion(true));
    v.update(&mut cx, |host, _, cx| {
        host.form.update(cx, |form, cx| {
            form.annotated = true;
            cx.notify();
        })
    })
    .unwrap();
    draw(&mut cx, v);
    v.update(&mut cx, |host, _, cx| {
        host.form.update(cx, |form, cx| {
            let time = cx
                .background_executor()
                .now()
                .saturating_duration_since(form.epoch);

            let height = form.height.sample(time, true);

            assert_eq!(height.value(), 280.);
            assert!(!height.is_animating());
        })
    })
    .unwrap();
    assert!(f.load().repository.tags(None).unwrap().is_empty());
}
