//! Native history selection, virtualization, stable identities and accessible input behavior.
use onegit_ui::{
    Button, CommitItem, CommitList, CommitListData, CommitListDensity, CommitRef, CommitRefKind,
    Theme,
};

use rake::gpui::{self, InputEvent as _, prelude::*, px};

rake::theme!(Theme);

fn data(count: usize) -> CommitListData {
    CommitListData::new(
        (0..count)
            .map(|index| CommitItem {
                author: Some("Renée · 日本語".into()),
                date: Some("2 min ago".into()),
                hash: Some(format!("a{index:07x}").into()),
                references: vec![
                    CommitRef::new(CommitRefKind::Branch, "a very long branch label"),
                    CommitRef::new(CommitRefKind::Remote, "origin/a very long branch label"),
                    CommitRef::new(CommitRefKind::Tag, "v1.0"),
                ],
                ..CommitItem::new(
                    format!("id-{index}"),
                    format!("Commit {index} · {}", "Unicode 👋 subject ".repeat(12)),
                )
            })
            .collect(),
    )
    .unwrap()
}

struct History {
    root: gpui::FocusHandle,
    before: gpui::FocusHandle,
    after: gpui::FocusHandle,
    data: CommitListData,
    selected: Option<gpui::SharedString>,
    density: CommitListDensity,
    accept: bool,
    requests: Vec<gpui::SharedString>,
    width: gpui::Pixels,
}

impl Render for History {
    fn render(&mut self, _: &mut gpui::Window, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        rake::view! {
            <div class="size-full flex flex-col" focus={&self.root} tab-navigation={true}>
                <Button focus={Some(self.before.clone())} {..Button::new("before","Before")}/>
                <div class="h-[240px] shrink-0" style={|s|s.w(self.width)}>
                    <CommitList selected={self.selected.clone()} density={self.density}
                        on_select={Some(Box::new(cx.listener(|this,id:&gpui::SharedString,_,cx| {
                            this.requests.push(id.clone());
                            if this.accept {this.selected=Some(id.clone());}
                            cx.notify();
                        })))} {..CommitList::new("history","Repository history",self.data.clone())}/>
                </div>
                <Button focus={Some(self.after.clone())} {..Button::new("after","After")}/>
            </div>
        }
    }
}

fn setup() -> (gpui::TestAppContext, gpui::WindowHandle<History>) {
    let mut cx = gpui::TestAppContext::single();

    cx.update(|cx| Theme::dark().install(cx));
    let v = cx.open_window(gpui::size(px(500.), px(380.)), |window, cx| {
        let root = cx.focus_handle();

        window.focus(&root, cx);
        window.activate_window();

        History {
            root,
            before: cx.focus_handle(),
            after: cx.focus_handle(),
            data: data(50),
            selected: Some("id-0".into()),
            density: CommitListDensity::Compact,
            accept: true,
            requests: Vec::new(),
            width: px(400.),
        }
    });

    draw(&mut cx, v);

    (cx, v)
}

fn draw(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<History>) {
    for _ in 0..2 {
        cx.run_until_parked();
        cx.update_window(v.into(), |_, w, cx| w.draw(cx).clear(cx))
            .unwrap();
    }

    cx.run_until_parked();
}

fn bounds(
    cx: &gpui::TestAppContext,
    v: gpui::WindowHandle<History>,
    selector: &'static str,
) -> Option<gpui::Bounds<gpui::Pixels>> {
    gpui::VisualTestContext::from_window(v.into(), cx).debug_bounds(selector)
}

fn key(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<History>, text: &str) {
    cx.update_window(v.into(), |_, window, cx| {
        let keystroke = gpui::Keystroke::parse(text).unwrap();

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

fn click(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<History>, selector: &'static str) {
    let position = bounds(cx, v, selector).unwrap().center();

    cx.update_window(v.into(), |_, w, cx| {
        w.dispatch_event(
            gpui::MouseDownEvent {
                button: gpui::MouseButton::Left,
                position,
                modifiers: Default::default(),
                click_count: 1,
                first_mouse: false,
            }
            .to_platform_input(),
            cx,
        );
        w.dispatch_event(
            gpui::MouseUpEvent {
                button: gpui::MouseButton::Left,
                position,
                modifiers: Default::default(),
                click_count: 1,
            }
            .to_platform_input(),
            cx,
        );
    })
    .unwrap();
    draw(cx, v);
}

fn selected(cx: &gpui::TestAppContext, v: gpui::WindowHandle<History>, id: &str) -> bool {
    v.read_with(cx, |v, _| v.selected.as_deref() == Some(id))
        .unwrap()
}

#[test]
fn snapshots_validate_identity_and_return_invalid_entries_for_recovery() {
    let entries = vec![
        CommitItem::new("a", "One"),
        CommitItem::new("a", "Duplicate"),
    ];

    let error = CommitListData::new(entries.clone()).unwrap_err();

    assert_eq!(error.index(), 1);
    assert!(error.to_string().contains("duplicate"));
    assert_eq!(error.into_items(), entries);
    let error = CommitListData::new(vec![CommitItem::new("", "Empty")]).unwrap_err();

    assert_eq!(error.index(), 0);
    assert!(error.to_string().contains("empty"));
    let snapshot = data(10);
    let clone = snapshot.clone();

    assert_eq!(clone.find("id-5"), Some(&snapshot.items()[5]));
    assert!(clone.find("missing").is_none());
    assert!(CommitListData::default().items().is_empty());
    fn send_sync<T: Send + Sync>() {}
    send_sync::<CommitListData>();
}

#[test]
fn keyboard_selection_clamps_pages_and_uses_one_tab_stop() {
    let (mut cx, v) = setup();

    key(&mut cx, v, "tab");
    assert!(v.update(&mut cx, |v, w, _| v.before.is_focused(w)).unwrap());
    key(&mut cx, v, "tab");
    key(&mut cx, v, "up");
    key(&mut cx, v, "enter");
    key(&mut cx, v, "space");
    assert!(selected(&cx, v, "id-0"));
    assert_eq!(v.read_with(&cx, |v, _| v.requests.len()).unwrap(), 0);
    key(&mut cx, v, "down");
    assert!(selected(&cx, v, "id-1"));
    key(&mut cx, v, "end");
    assert!(selected(&cx, v, "id-49"));
    assert!(bounds(&cx, v, "commit-row-id-49").is_some());
    key(&mut cx, v, "down");
    assert!(selected(&cx, v, "id-49"));
    key(&mut cx, v, "pageup");
    assert!(selected(&cx, v, "id-45"));
    key(&mut cx, v, "pagedown");
    assert!(selected(&cx, v, "id-49"));
    key(&mut cx, v, "home");
    assert!(selected(&cx, v, "id-0"));
    key(&mut cx, v, "tab");
    assert!(v.update(&mut cx, |v, w, _| v.after.is_focused(w)).unwrap());
    key(&mut cx, v, "shift-tab");
    key(&mut cx, v, "down");
    assert!(selected(&cx, v, "id-1"));
}

#[test]
fn pointer_selection_is_once_per_change_and_navigation_respects_caller_control() {
    let (mut cx, v) = setup();

    click(&mut cx, v, "commit-row-id-1");
    assert!(selected(&cx, v, "id-1"));
    click(&mut cx, v, "commit-row-id-1");
    assert_eq!(v.read_with(&cx, |v, _| v.requests.len()).unwrap(), 1);
    v.update(&mut cx, |v, _, cx| {
        v.accept = false;
        cx.notify();
    })
    .unwrap();
    key(&mut cx, v, "down");
    key(&mut cx, v, "down");
    assert!(selected(&cx, v, "id-1"), "the owner can decline requests");
    assert_eq!(
        v.read_with(&cx, |v, _| v.requests.last().cloned()).unwrap(),
        Some("id-3".into())
    );
    let requests = v.read_with(&cx, |v, _| v.requests.len()).unwrap();

    key(&mut cx, v, "ctrl-down");
    assert_eq!(v.read_with(&cx, |v, _| v.requests.len()).unwrap(), requests);
}

#[test]
fn large_histories_virtualize_and_external_selection_reveals_the_requested_commit() {
    let (mut cx, v) = setup();

    v.update(&mut cx, |v, _, cx| {
        v.data = data(10_000);
        v.selected = Some("id-9000".into());
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    assert!(bounds(&cx, v, "commit-row-id-9000").is_some());
    assert!(bounds(&cx, v, "commit-row-id-0").is_none());
    assert!(bounds(&cx, v, "commit-row-id-5000").is_none());
    assert!(bounds(&cx, v, "commit-row-id-9999").is_none());
    key(&mut cx, v, "tab");
    key(&mut cx, v, "tab");
    key(&mut cx, v, "end");
    assert!(selected(&cx, v, "id-9999"));
    assert!(bounds(&cx, v, "commit-row-id-9999").is_some());
    key(&mut cx, v, "home");
    assert!(bounds(&cx, v, "commit-row-id-0").is_some());
}

#[test]
fn snapshot_reordering_preserves_ids_and_the_visible_anchor_without_issuing_selections() {
    let (mut cx, v) = setup();
    let old_top = bounds(&cx, v, "commit-row-id-0").unwrap().top();

    v.update(&mut cx, |v, _, cx| {
        let mut entries = vec![
            CommitItem::new("prepended-a", "A"),
            CommitItem::new("prepended-b", "B"),
            CommitItem::new("prepended-c", "C"),
        ];

        entries.extend_from_slice(v.data.items());
        v.data = CommitListData::new(entries).unwrap();
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    assert_eq!(bounds(&cx, v, "commit-row-id-0").unwrap().top(), old_top);
    assert!(selected(&cx, v, "id-0"));
    assert!(v.read_with(&cx, |v, _| v.requests.is_empty()).unwrap());
    v.update(&mut cx, |v, _, cx| {
        v.data = CommitListData::new(vec![CommitItem::new("new", "Replacement")]).unwrap();
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    assert!(
        selected(&cx, v, "id-0"),
        "removing an entry does not invent an application selection"
    );
    click(&mut cx, v, "commit-row-new");
    assert!(selected(&cx, v, "new"));
}

#[test]
fn densities_themes_narrow_layout_and_empty_lists_keep_navigation_usable() {
    let (mut cx, v) = setup();

    for theme in [Theme::light(), Theme::dark()] {
        cx.update(|cx| theme.install(cx));
        v.update(&mut cx, |v, _, cx| {
            v.density = CommitListDensity::Comfortable;
            v.width = px(240.);
            cx.notify();
        })
        .unwrap();
        draw(&mut cx, v);
        let row = bounds(&cx, v, "commit-row-id-0").unwrap();
        let list = bounds(&cx, v, "commit-list").unwrap();

        assert_eq!(row.size.height, px(60.));
        assert!(row.right() <= list.right() && row.left() >= list.left());
        assert!(selected(&cx, v, "id-0"));
    }

    v.update(&mut cx, |v, _, cx| {
        v.data = CommitListData::default();
        v.selected = None;
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    key(&mut cx, v, "tab");
    key(&mut cx, v, "tab");
    assert!(v.update(&mut cx, |v, w, _| v.after.is_focused(w)).unwrap());
    assert!(v.read_with(&cx, |v, _| v.requests.is_empty()).unwrap());
}

#[test]
fn settled_and_reduced_motion_lists_do_not_schedule_continuous_frames() {
    let (mut cx, v) = setup();

    cx.update(|cx| cx.set_reduce_motion(true));
    click(&mut cx, v, "commit-row-id-1");
    cx.executor()
        .advance_clock(std::time::Duration::from_secs(1));
    cx.update_window(v.into(), |_, w, cx| w.simulate_next_frame(cx))
        .unwrap();
    draw(&mut cx, v);
    assert_eq!(
        cx.update_window(v.into(), |_, w, cx| w.simulate_next_frame(cx))
            .unwrap(),
        0
    );
}
