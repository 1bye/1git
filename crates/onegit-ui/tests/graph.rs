//! Native graph geometry, retained viewport and controlled keyboard selection.
use onegit_ui::{
    CommitGraph, CommitGraphData, CommitGraphState, CommitItem, CommitRef, CommitRefKind,
    GraphCommit, GraphViewport, Theme,
};

use rake::gpui::{self, InputEvent as _, prelude::*, px};

rake::theme!(Theme);

fn data(start: usize, end: usize) -> CommitGraphData {
    CommitGraphData::new(
        (start..end)
            .map(|i| GraphCommit {
                item: CommitItem {
                    author: Some("Renée".into()),
                    date: Some("Nov 1, 2026".into()),
                    hash: Some(format!("{i:07x}").into()),
                    references: if i == 0 {
                        vec![
                            CommitRef::new(CommitRefKind::Branch, "HEAD"),
                            CommitRef::new(CommitRefKind::Branch, "main"),
                            CommitRef::new(CommitRefKind::Tag, "v1"),
                        ]
                    } else {
                        vec![]
                    },
                    ..CommitItem::new(format!("id-{i}"), format!("feat: Commit {i} · 日本語"))
                },
                parents: if i + 1 < end {
                    vec![format!("id-{}", i + 1).into()]
                } else {
                    vec![]
                },
            })
            .collect(),
    )
    .unwrap()
}

struct Graph {
    state: gpui::Entity<CommitGraphState>,
    data: CommitGraphData,
    selected: Option<gpui::SharedString>,
    root: gpui::FocusHandle,
    accept: bool,
    actions: Vec<gpui::SharedString>,
}

impl Render for Graph {
    fn render(&mut self, _: &mut gpui::Window, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        let owner = cx.entity().downgrade();
        let menu_data = self.data.clone();

        rake::view! {
            <div class="size-full" focus={&self.root} tab-navigation={true}>
                <CommitGraph context_menu={Some(Box::new(move|oid|{
                    assert!(menu_data.position(oid).is_some(),"menus require available commit metadata");
                    let mut menu=onegit_ui::DropdownMenu::new(format!("actions-{oid}"),"Commit actions");
                    menu.entries=vec![onegit_ui::MenuItem::new("inspect","Inspect commit").into()];
                    let target=oid.clone();let owner=owner.clone();
                    menu.on_select=Some(Box::new(move|_,_,cx|{let _=owner.update(cx,|this,cx|{this.actions.push(target.clone());cx.notify();});}));
                    menu
                }))} selected={self.selected.clone()} on_select={Some(Box::new(cx.listener(|this,id:&gpui::SharedString,_,cx|{
                    if this.accept{this.selected=Some(id.clone());}cx.notify();
                })))} {..CommitGraph::new("graph",self.data.clone(),&self.state)}/>
            </div>
        }
    }
}

fn setup() -> (gpui::TestAppContext, gpui::WindowHandle<Graph>) {
    let mut cx = gpui::TestAppContext::single();

    cx.update(|cx| Theme::light().install(cx));
    let v = cx.open_window(gpui::size(px(1100.), px(240.)), |window, cx| {
        let root = cx.focus_handle();

        window.focus(&root, cx);
        window.activate_window();

        Graph {
            root,
            state: cx.new(CommitGraphState::new),
            data: data(0, 500),
            selected: None,
            accept: true,
            actions: Vec::new(),
        }
    });

    draw(&mut cx, v);

    (cx, v)
}

fn draw(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Graph>) {
    for _ in 0..2 {
        cx.run_until_parked();
        cx.update_window(v.into(), |_, w, cx| w.draw(cx).clear(cx))
            .unwrap();
    }

    cx.run_until_parked();
}

fn bounds(
    cx: &gpui::TestAppContext,
    v: gpui::WindowHandle<Graph>,
    selector: &'static str,
) -> Option<gpui::Bounds<gpui::Pixels>> {
    gpui::VisualTestContext::from_window(v.into(), cx).debug_bounds(selector)
}

fn key(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Graph>, text: &str) {
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

fn click(cx: &mut gpui::TestAppContext, v: gpui::WindowHandle<Graph>, selector: &'static str) {
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

#[test]
fn virtualizes_fixed_source_geometry_and_navigates_without_implicit_selection() {
    let (mut cx, v) = setup();

    assert!(v.read_with(&cx, |v, _| v.selected.is_none()).unwrap());
    assert_eq!(bounds(&cx, v, "graph-row-0").unwrap().size.height, px(36.));
    assert!(bounds(&cx, v, "graph-row-499").is_none());
    click(&mut cx, v, "graph-row-1");
    assert_eq!(
        v.read_with(&cx, |v, _| v.selected.clone())
            .unwrap()
            .as_deref(),
        Some("id-1")
    );
    key(&mut cx, v, "down");
    assert_eq!(
        v.read_with(&cx, |v, _| v.selected.clone())
            .unwrap()
            .as_deref(),
        Some("id-2")
    );
    key(&mut cx, v, "end");
    assert!(bounds(&cx, v, "graph-row-499").is_some());
    assert!(bounds(&cx, v, "graph-row-0").is_none());
    v.update(&mut cx, |v, _, cx| {
        v.accept = false;
        cx.notify();
    })
    .unwrap();
    key(&mut cx, v, "up");
    assert_eq!(
        v.read_with(&cx, |v, _| v.selected.clone())
            .unwrap()
            .as_deref(),
        Some("id-499")
    );
}

#[test]
fn preserves_exact_commit_and_pixel_anchor_when_earlier_rows_are_inserted() {
    let (mut cx, v) = setup();
    let state = v.read_with(&cx, |v, _| v.state.clone()).unwrap();

    state.update(&mut cx, |state, _| {
        state.restore(GraphViewport {
            anchor: Some("id-250".into()),
            row: 250,
            offset: 9.,
            horizontal: 0.,
        })
    });
    draw(&mut cx, v);
    v.update(&mut cx, |v, _, cx| {
        let mut commits = data(0, 1).commits().to_vec();

        commits[0].item.id = "new".into();
        commits[0].parents = vec!["id-0".into()];
        commits.extend(v.data.commits().iter().cloned());
        v.data = CommitGraphData::new(commits).unwrap();
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    state.read_with(&cx, |state, _| {
        let saved = state.viewport();

        assert_eq!(saved.anchor.as_deref(), Some("id-250"));
        assert_eq!(saved.row, 251);
        assert_eq!(saved.offset, 9.);
    });
    assert!(bounds(&cx, v, "graph-row-251").is_some());
}

#[test]
fn pending_restoration_waits_for_pages_and_missing_anchor_falls_back() {
    let (mut cx, v) = setup();
    let state = v.read_with(&cx, |v, _| v.state.clone()).unwrap();

    state.update(&mut cx, |state, _| {
        state.restore(GraphViewport {
            anchor: Some("missing".into()),
            row: 30,
            offset: 4.,
            horizontal: -50.,
        })
    });
    draw(&mut cx, v);
    assert_eq!(
        state
            .read_with(&cx, |state, _| state.viewport().anchor)
            .as_deref(),
        Some("missing")
    );
    v.update(&mut cx, |v, _, cx| {
        v.state.update(cx, |state, _| state.finish_restore(&v.data))
    })
    .unwrap();
    draw(&mut cx, v);
    state.read_with(&cx, |state, _| {
        let saved = state.viewport();

        assert_eq!(saved.anchor.as_deref(), Some("id-30"));
        assert_eq!(saved.offset, 4.);
    });
}

#[test]
fn reduced_motion_selection_settles_without_an_idle_frame_loop() {
    let (mut cx, v) = setup();

    cx.update(|cx| cx.set_reduce_motion(true));
    click(&mut cx, v, "graph-row-1");
    cx.executor()
        .advance_clock(std::time::Duration::from_secs(1));
    cx.update_window(v.into(), |_, window, cx| window.simulate_next_frame(cx))
        .unwrap();
    draw(&mut cx, v);
    assert_eq!(
        cx.update_window(v.into(), |_, window, cx| window.simulate_next_frame(cx))
            .unwrap(),
        0
    );
}

#[test]
fn a_dense_graph_keeps_horizontal_scroll_when_a_page_is_appended() {
    let (mut cx, v) = setup();

    v.update(&mut cx, |view, _, cx| {
        let mut commits = view.data.commits().to_vec();

        commits[0].parents = (1..=70).map(|i| format!("id-{i}").into()).collect();
        view.data = CommitGraphData::new(commits).unwrap();
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);

    let state = v.read_with(&cx, |view, _| view.state.clone()).unwrap();

    state.update(&mut cx, |state, _| {
        state.restore(GraphViewport {
            anchor: Some("id-100".into()),
            row: 100,
            offset: 6.,
            horizontal: -75.,
        })
    });
    draw(&mut cx, v);
    assert_eq!(
        state.read_with(&cx, |state, _| state.viewport().horizontal),
        -75.
    );
    v.update(&mut cx, |view, _, cx| {
        let mut commits = view.data.commits().to_vec();

        commits.extend(data(500, 600).commits().iter().cloned());
        view.data = CommitGraphData::new(commits).unwrap();
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    state.read_with(&cx, |state, _| {
        let saved = state.viewport();

        assert_eq!(saved.anchor.as_deref(), Some("id-100"));
        assert_eq!(saved.offset, 6.);
        assert_eq!(saved.horizontal, -75.);
    });
}

#[test]
fn native_scrollbar_track_and_captured_drag_scroll_without_selecting_a_commit() {
    let (mut cx, v) = setup();
    let bounds = bounds(&cx, v, "graph-scroll-vertical").unwrap();
    let start = bounds.center();

    cx.update_window(v.into(), |_, window, cx| {
        window.dispatch_event(
            gpui::MouseDownEvent {
                button: gpui::MouseButton::Left,
                position: start,
                modifiers: Default::default(),
                click_count: 1,
                first_mouse: false,
            }
            .to_platform_input(),
            cx,
        );
    })
    .unwrap();
    draw(&mut cx, v);

    let state = v.read_with(&cx, |view, _| view.state.clone()).unwrap();

    assert!(state.read_with(&cx, |state, _| state.viewport().row) > 200);
    cx.update_window(v.into(), |_, window, cx| {
        window.dispatch_event(
            gpui::MouseMoveEvent {
                position: start + gpui::point(px(80.), px(80.)),
                pressed_button: Some(gpui::MouseButton::Left),
                modifiers: Default::default(),
            }
            .to_platform_input(),
            cx,
        );
        window.dispatch_event(
            gpui::MouseUpEvent {
                position: start + gpui::point(px(80.), px(80.)),
                button: gpui::MouseButton::Left,
                modifiers: Default::default(),
                click_count: 1,
            }
            .to_platform_input(),
            cx,
        );
    })
    .unwrap();
    draw(&mut cx, v);
    assert!(state.read_with(&cx, |state, _| state.viewport().row) > 350);
    assert!(v.read_with(&cx, |view, _| view.selected.is_none()).unwrap());
}

#[test]
fn context_actions_target_clicked_row_without_replacing_selection_and_support_shift_f10() {
    let (mut cx, v) = setup();

    click(&mut cx, v, "graph-row-0");
    let position = bounds(&cx, v, "graph-row-1").unwrap().center();

    cx.update_window(v.into(), |_, w, cx| {
        w.dispatch_event(
            gpui::MouseDownEvent {
                button: gpui::MouseButton::Right,
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
                button: gpui::MouseButton::Right,
                position,
                modifiers: Default::default(),
                click_count: 1,
            }
            .to_platform_input(),
            cx,
        );
    })
    .unwrap();
    draw(&mut cx, v);
    key(&mut cx, v, "enter");
    v.read_with(&cx, |graph, _| {
        assert_eq!(
            graph.actions.as_slice(),
            &[gpui::SharedString::from("id-1")]
        );
        assert_eq!(graph.selected.as_deref(), Some("id-0"));
    })
    .unwrap();
    key(&mut cx, v, "shift-f10");
    key(&mut cx, v, "enter");
    v.read_with(&cx, |graph, _| {
        assert_eq!(
            graph.actions.as_slice(),
            &[
                gpui::SharedString::from("id-1"),
                gpui::SharedString::from("id-0")
            ]
        );
        assert_eq!(graph.selected.as_deref(), Some("id-0"));
    })
    .unwrap();
}

#[test]
fn restored_selection_waits_for_its_page_before_building_a_keyboard_menu() {
    let (mut cx, v) = setup();

    v.update(&mut cx, |graph, _, cx| {
        graph.selected = Some("id-not-loaded".into());
        cx.notify();
    })
    .unwrap();
    draw(&mut cx, v);
    v.read_with(&cx, |graph, _| {
        assert_eq!(graph.selected.as_deref(), Some("id-not-loaded"))
    })
    .unwrap();
}
