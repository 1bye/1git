//! Source mappings: workspace-tabs.unit.test.ts and repository-connection/auto-refresh.component.test.tsx.
use super::*;

use crate::workspace::{
    Preview, PreviewState, Section,
    tests::{Fixture, contents},
};

use onegit_git::GitPath;
use std::{fs, time::Duration};

fn setup(f: &Fixture) -> (gpui::TestAppContext, gpui::WindowHandle<Workspace>) {
    let mut cx = gpui::TestAppContext::single();

    cx.update(|cx| Theme::light().install(cx));
    let view = cx.open_window(gpui::size(px(1280.), px(820.)), |window, cx| {
        let mut workspace = Workspace::new(window, cx, None);

        workspace.process = f.process();

        workspace
    });

    draw(&mut cx, view);

    (cx, view)
}

fn draw(cx: &mut gpui::TestAppContext, view: gpui::WindowHandle<Workspace>) {
    for _ in 0..3 {
        cx.run_until_parked();
        cx.update_window(view.into(), |_, window, cx| window.draw(cx).clear(cx))
            .unwrap();
    }

    cx.run_until_parked();
}

fn open(
    cx: &mut gpui::TestAppContext,
    view: gpui::WindowHandle<Workspace>,
    path: &std::path::Path,
) -> gpui::Entity<RepositoryWorkspace> {
    let tab = view
        .update(cx, |workspace, window, cx| {
            workspace.open(path.to_owned(), window, cx);

            workspace.tabs.last().unwrap().workspace.clone()
        })
        .unwrap();

    draw(cx, view);

    tab
}

fn patch(view: &RepositoryWorkspace) -> &str {
    match &view.preview {
        PreviewState::Ready(Preview::Patch(doc)) => doc.patch(),
        _ => panic!("expected loaded patch"),
    }
}

fn refresh(
    cx: &mut gpui::TestAppContext,
    view: gpui::WindowHandle<Workspace>,
    root: &std::path::Path,
) {
    view.update(cx, |workspace, _, cx| {
        let root = fs::canonicalize(root).unwrap();

        workspace.invalidate(&root, cx);
        workspace.refresh(&root, cx);
    })
    .unwrap();
    draw(cx, view);
}

#[test]
fn multiple_tabs_home_reordering_and_closing_keep_independent_drafts_and_selections() {
    let first = Fixture::new();

    first.write("a.txt", "first alpha\n");
    first.write("b.txt", "first beta\n");
    let second = Fixture::new();

    second.write("a.txt", "second alpha\n");
    let (mut cx, view) = setup(&first);
    let a = open(&mut cx, view, &first.root);

    a.update(&mut cx, |tab, cx| {
        tab.summary
            .update(cx, |input, cx| input.set_text("First draft", cx));
        tab.description
            .update(cx, |input, cx| input.set_text("First body", cx));
        tab.select(
            read::ChangeKey {
                path: GitPath::new("b.txt").unwrap(),
                side: read::Side::Working,
            },
            cx,
        );
    });
    draw(&mut cx, view);
    let b = open(&mut cx, view, &second.root);

    b.update(&mut cx, |tab, cx| {
        tab.summary
            .update(cx, |input, cx| input.set_text("Second draft", cx))
    });
    view.update(&mut cx, |workspace, window, cx| {
        assert_eq!(workspace.active, Some(2));
        workspace.request(&Request::Home, window, cx);
        assert!(workspace.active.is_none());
        workspace.request(&Request::Activate(1), window, cx);
        workspace.request(&Request::Move(1, 2), window, cx);
        assert_eq!(
            workspace.tabs.iter().map(|tab| tab.id).collect::<Vec<_>>(),
            vec![2, 1]
        );
    })
    .unwrap();
    draw(&mut cx, view);
    a.read_with(&cx, |tab, cx| {
        assert_eq!(tab.summary.read(cx).text(), "First draft");
        assert_eq!(tab.description.read(cx).text(), "First body");
        assert_eq!(
            tab.selected.as_ref().unwrap().path,
            GitPath::new("b.txt").unwrap()
        );
        assert!(patch(tab).contains("first beta"));
    });
    b.read_with(&cx, |tab, cx| {
        assert_eq!(tab.summary.read(cx).text(), "Second draft")
    });
    view.update(&mut cx, |workspace, window, cx| {
        workspace.close(1, window, cx);
        assert_eq!(workspace.active, Some(2));
        workspace.close(2, window, cx);
        assert!(workspace.tabs.is_empty());
        assert!(workspace.active.is_none());
        assert!(workspace.monitors.is_empty());
    })
    .unwrap();
}

#[test]
fn closes_right_then_left_keeps_active_on_inactive_close_and_rejects_busy_close() {
    let f = Fixture::new();
    let (mut cx, view) = setup(&f);

    for _ in 0..4 {
        open(&mut cx, view, &f.root);
    }

    view.update(&mut cx, |workspace, window, cx| {
        workspace.activate(2, window, cx);
        workspace.close(2, window, cx);
        assert_eq!(workspace.active, Some(3));
        workspace.close(1, window, cx);
        assert_eq!(workspace.active, Some(3));
        workspace.close(3, window, cx);
        assert_eq!(workspace.active, Some(4));
        workspace.tabs[0].workspace.update(cx, |tab, _| {
            tab.write_job = Some(super::super::WriteJob(None))
        });
        workspace.close(4, window, cx);
        assert_eq!(workspace.tabs.len(), 1);
        workspace.tabs[0]
            .workspace
            .update(cx, |tab, _| tab.write_job = None);
    })
    .unwrap();
}

#[test]
fn shared_root_refresh_updates_background_tabs_without_losing_same_status_patch_or_draft() {
    let f = Fixture::new();

    f.write("a.txt", "base\n");
    f.commit();
    f.write("a.txt", "first\n");
    let (mut cx, view) = setup(&f);
    let a = open(&mut cx, view, &f.root);
    let b = open(&mut cx, view, &f.root);

    a.update(&mut cx, |tab, cx| {
        tab.summary
            .update(cx, |input, cx| input.set_text("Do not clear", cx))
    });
    let before = contents(&f.root);

    view.read_with(&cx, |workspace, _| assert_eq!(workspace.monitors.len(), 1))
        .unwrap();
    f.write("a.txt", "second, same status\n");
    f.write("b.txt", "new\n");
    let modified = contents(&f.root);

    refresh(&mut cx, view, &f.root);

    for tab in [&a, &b] {
        tab.read_with(&cx, |tab, _| {
            assert!(patch(tab).contains("second, same status"));

            let RepositoryState::Ready(loaded) = &tab.state else {
                panic!()
            };

            assert_eq!(loaded.snapshot.status.files.len(), 2);
            assert_eq!(
                tab.selected.as_ref().unwrap().path,
                GitPath::new("a.txt").unwrap()
            );
        });
    }

    a.read_with(&cx, |tab, cx| {
        assert_eq!(tab.summary.read(cx).text(), "Do not clear")
    });
    assert_eq!(
        contents(&f.root),
        modified,
        "automatic reads must not mutate files, index or refs"
    );
    assert_eq!(
        before.get(&PathBuf::from(".git/index")),
        modified.get(&PathBuf::from(".git/index"))
    );
    view.update(&mut cx, |workspace, window, cx| {
        workspace.close(1, window, cx);
        assert_eq!(workspace.monitors.len(), 1);
        workspace.close(2, window, cx);
        assert!(workspace.monitors.is_empty());
    })
    .unwrap();
}

#[test]
fn refresh_preserves_history_choice_and_staged_side_falls_back_when_file_disappears() {
    let f = Fixture::new();

    f.write("a.txt", "base\n");
    f.commit();
    f.write("a.txt", "staged\n");
    f.git(&["add", "a.txt"]);
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);

    tab.update(&mut cx, |tab, cx| {
        tab.change_section(&gpui::ElementId::from("history"), cx)
    });
    draw(&mut cx, view);
    let history = tab.read_with(&cx, |tab, _| tab.history.clone());
    let selected = history.read_with(&cx, |history, _| history.selected.clone());

    f.write("b.txt", "next\n");
    f.git(&["add", "b.txt"]);
    f.git(&["commit", "-m", "External commit"]);
    refresh(&mut cx, view, &f.root);
    tab.read_with(&cx, |tab, _| assert!(tab.section == Section::History));
    history.read_with(&cx, |history, _| assert_eq!(history.selected, selected));
    f.write("c.txt", "new selection\n");
    refresh(&mut cx, view, &f.root);
    tab.read_with(&cx, |tab, _| {
        assert_eq!(
            tab.selected.as_ref().unwrap().path,
            GitPath::new("c.txt").unwrap()
        )
    });
}

#[test]
fn queued_refresh_pauses_during_writes_reports_failures_and_recovers_without_replacing_view() {
    let f = Fixture::new();

    f.write("a.txt", "before\n");
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);

    tab.update(&mut cx, |tab, _| {
        tab.write_job = Some(super::super::WriteJob(None))
    });
    view.update(&mut cx, |workspace, _, cx| {
        let root = fs::canonicalize(&f.root).unwrap();

        workspace.invalidate(&root, cx);
        workspace.refresh(&root, cx);
        let monitor = &workspace.monitors[&root];

        assert!(monitor.read.is_none());
        assert!(monitor.queue.delay(Instant::now()).is_some());
    })
    .unwrap();
    tab.update(&mut cx, |tab, _| tab.write_job = None);
    draw(&mut cx, view);
    let real = tab.read_with(&cx, |tab, _| tab.process.clone());

    tab.update(&mut cx, |tab, _| {
        tab.process = onegit_git::GitProcess::new("missing-git-for-refresh-test", 1024)
    });
    refresh(&mut cx, view, &f.root);
    tab.read_with(&cx, |tab, _| {
        assert!(matches!(tab.state, RepositoryState::Ready(_)));
        assert!(tab.refresh_error.is_some());
        assert!(patch(tab).contains("before"));
    });
    tab.update(&mut cx, |tab, _| tab.process = real);
    f.write("a.txt", "after\n");
    refresh(&mut cx, view, &f.root);
    tab.read_with(&cx, |tab, _| {
        assert!(tab.refresh_error.is_none());
        assert!(patch(tab).contains("after"));
    });
    // Advance the deterministic native clock without waiting on real wall time.
    cx.executor().advance_clock(Duration::from_millis(300));
    draw(&mut cx, view);
}

#[test]
fn picker_tab_clicks_shortcuts_and_idle_frames_use_the_real_shell() {
    use gpui::InputEvent as _;
    let f = Fixture::new();

    f.write("a.txt", "content\n");
    let (mut cx, view) = setup(&f);

    view.update(&mut cx, |workspace, _, cx| workspace.choose_repository(cx))
        .unwrap();
    cx.simulate_path_prompt_response(|_| Some(vec![f.root.clone()]));
    draw(&mut cx, view);
    open(&mut cx, view, &f.root);
    let position = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("workspace-tab-1")
        .unwrap()
        .center();

    cx.update_window(view.into(), |_, window, cx| {
        window.dispatch_event(
            gpui::MouseDownEvent {
                position,
                button: gpui::MouseButton::Left,
                click_count: 1,
                modifiers: Default::default(),
                first_mouse: false,
            }
            .to_platform_input(),
            cx,
        );
        window.dispatch_event(
            gpui::MouseUpEvent {
                position,
                button: gpui::MouseButton::Left,
                click_count: 1,
                modifiers: Default::default(),
            }
            .to_platform_input(),
            cx,
        );
    })
    .unwrap();
    draw(&mut cx, view);
    view.read_with(&cx, |workspace, _| assert_eq!(workspace.active, Some(1)))
        .unwrap();

    for (shortcut, expected) in [
        ("ctrl-tab", Some(2)),
        ("ctrl-shift-tab", Some(1)),
        ("right", Some(2)),
        ("shift-left", Some(2)),
        ("right", Some(1)),
    ] {
        cx.update_window(view.into(), |_, window, cx| {
            window.dispatch_event(
                gpui::KeyDownEvent {
                    keystroke: gpui::Keystroke::parse(shortcut).unwrap(),
                    is_held: false,
                    prefer_character_input: false,
                }
                .to_platform_input(),
                cx,
            );
        })
        .unwrap();
        draw(&mut cx, view);
        view.read_with(&cx, |workspace, _| {
            assert_eq!(workspace.active, expected, "{shortcut}")
        })
        .unwrap();
    }

    cx.update(|cx| cx.set_reduce_motion(true));
    cx.executor().advance_clock(Duration::from_secs(1));
    draw(&mut cx, view);
    cx.update_window(view.into(), |_, window, cx| window.simulate_next_frame(cx))
        .unwrap();
    draw(&mut cx, view);
    assert_eq!(
        cx.update_window(view.into(), |_, window, cx| window.simulate_next_frame(cx))
            .unwrap(),
        0
    );
}

#[test]
fn a_write_cancels_an_inflight_automatic_read_and_keeps_one_pending_update() {
    let f = Fixture::new();

    f.write("a.txt", "before\n");
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);
    let root = fs::canonicalize(&f.root).unwrap();

    view.update(&mut cx, |workspace, _, cx| {
        workspace.invalidate(&root, cx);
        workspace.refresh(&root, cx);
        let cancel = workspace.monitors[&root]
            .read
            .as_ref()
            .unwrap()
            .cancel
            .clone();

        tab.update(cx, |tab, _| {
            tab.write_job = Some(super::super::WriteJob(None))
        });
        workspace.reconcile(cx);
        assert!(cancel.is_cancelled());
        assert!(workspace.monitors[&root].read.is_none());
        assert!(
            workspace.monitors[&root]
                .queue
                .delay(Instant::now())
                .is_some()
        );
        tab.update(cx, |tab, _| tab.write_job = None);
        workspace.reconcile(cx);
        assert!(workspace.monitors[&root].timer.is_some());
    })
    .unwrap();
    draw(&mut cx, view);
}

#[test]
fn dragging_tabs_reorders_native_targets_without_replacing_their_workspaces() {
    use gpui::InputEvent as _;
    let f = Fixture::new();

    f.write("a.txt", "content\n");
    let (mut cx, view) = setup(&f);
    let first = open(&mut cx, view, &f.root);

    open(&mut cx, view, &f.root);
    let mut visual = gpui::VisualTestContext::from_window(view.into(), &cx);
    let start = visual.debug_bounds("workspace-tab-1").unwrap().center();
    let end = visual.debug_bounds("workspace-tab-2").unwrap().center();

    for (phase, position) in [
        ("down", start),
        ("move", start + gpui::point(px(12.), px(0.))),
        ("move", end),
        ("up", end),
    ] {
        cx.update_window(view.into(), |_, window, cx| {
            let event = match phase {
                "down" => gpui::MouseDownEvent {
                    position,
                    button: gpui::MouseButton::Left,
                    click_count: 1,
                    modifiers: Default::default(),
                    first_mouse: false,
                }
                .to_platform_input(),
                "move" => gpui::MouseMoveEvent {
                    position,
                    pressed_button: Some(gpui::MouseButton::Left),
                    modifiers: Default::default(),
                }
                .to_platform_input(),
                "up" => gpui::MouseUpEvent {
                    position,
                    button: gpui::MouseButton::Left,
                    click_count: 1,
                    modifiers: Default::default(),
                }
                .to_platform_input(),
                _ => unreachable!("test phase"),
            };

            window.dispatch_event(event, cx);
        })
        .unwrap();
        draw(&mut cx, view);
    }

    view.read_with(&cx, |workspace, _| {
        assert_eq!(
            workspace.tabs.iter().map(|tab| tab.id).collect::<Vec<_>>(),
            vec![2, 1]
        );
        assert_eq!(workspace.tabs[1].workspace, first);
    })
    .unwrap();
}

fn tab_bounds(
    cx: &gpui::TestAppContext,
    view: gpui::WindowHandle<Workspace>,
    selector: &'static str,
) -> gpui::Bounds<gpui::Pixels> {
    gpui::VisualTestContext::from_window(view.into(), cx)
        .debug_bounds(selector)
        .unwrap()
}

#[test]
fn shared_selection_moves_across_workspace_entities_and_interrupts_without_a_jump() {
    let f = Fixture::new();

    f.write("a.txt", "content\n");
    let (mut cx, view) = setup(&f);
    let first = open(&mut cx, view, &f.root);

    open(&mut cx, view, &f.root);
    cx.executor().advance_clock(Duration::from_millis(300));
    draw(&mut cx, view);
    let second = tab_bounds(&cx, view, "workspace-tab-selection").left();

    first.update(&mut cx, |tab, cx| {
        tab.summary
            .update(cx, |input, cx| input.set_text("Keep while moving", cx))
    });
    view.update(&mut cx, |workspace, window, cx| {
        workspace.request(&Request::Activate(1), window, cx)
    })
    .unwrap();
    draw(&mut cx, view);
    assert_eq!(
        tab_bounds(&cx, view, "workspace-tab-selection").left(),
        second
    );
    cx.executor().advance_clock(Duration::from_millis(80));
    draw(&mut cx, view);
    let midway = tab_bounds(&cx, view, "workspace-tab-selection").left();

    assert!(midway < second && midway > second - px(210.));
    view.update(&mut cx, |workspace, window, cx| {
        workspace.request(&Request::Activate(2), window, cx)
    })
    .unwrap();
    draw(&mut cx, view);
    assert!((tab_bounds(&cx, view, "workspace-tab-selection").left() - midway).abs() < px(0.51));
    cx.executor().advance_clock(Duration::from_millis(300));
    draw(&mut cx, view);
    assert_eq!(
        tab_bounds(&cx, view, "workspace-tab-selection").left(),
        second
    );
    first.read_with(&cx, |tab, cx| {
        assert_eq!(tab.summary.read(cx).text(), "Keep while moving")
    });
    // The source's delayed overflow-label reveal can last up to 2.52 seconds.
    cx.executor().advance_clock(Duration::from_secs(3));
    draw(&mut cx, view);
    cx.update_window(view.into(), |_, window, cx| window.simulate_next_frame(cx))
        .unwrap();
    draw(&mut cx, view);
    assert_eq!(
        cx.update_window(view.into(), |_, window, cx| window.simulate_next_frame(cx))
            .unwrap(),
        0
    );
}

#[test]
fn pointer_drag_previews_neighbors_before_release_and_escape_cancels_the_order() {
    use gpui::InputEvent as _;
    let f = Fixture::new();

    f.write("a.txt", "content\n");
    let (mut cx, view) = setup(&f);

    open(&mut cx, view, &f.root);
    open(&mut cx, view, &f.root);
    cx.executor().advance_clock(Duration::from_millis(300));
    draw(&mut cx, view);
    let initial = tab_bounds(&cx, view, "workspace-tab-1");
    let start = initial.center();
    let end = start + gpui::point(px(150.), px(0.));

    for (phase, position) in [("down", start), ("move", end)] {
        cx.update_window(view.into(), |_, window, cx| {
            let event = if phase == "down" {
                gpui::MouseDownEvent {
                    position,
                    button: gpui::MouseButton::Left,
                    click_count: 1,
                    modifiers: Default::default(),
                    first_mouse: false,
                }
                .to_platform_input()
            } else {
                gpui::MouseMoveEvent {
                    position,
                    pressed_button: Some(gpui::MouseButton::Left),
                    modifiers: Default::default(),
                }
                .to_platform_input()
            };

            window.dispatch_event(event, cx);
        })
        .unwrap();
        draw(&mut cx, view);
    }

    view.read_with(&cx, |workspace, _| {
        assert_eq!(
            workspace.tabs.iter().map(|tab| tab.id).collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert_eq!(workspace.presentation.borrow().order(&[1, 2]), vec![2, 1]);
    })
    .unwrap();
    assert_eq!(
        tab_bounds(&cx, view, "workspace-tab-1").left(),
        initial.left() + px(150.)
    );
    assert_eq!(
        tab_bounds(&cx, view, "workspace-tab-selection").left(),
        initial.left() + px(150.)
    );
    cx.executor().advance_clock(Duration::from_millis(80));
    draw(&mut cx, view);
    assert!(tab_bounds(&cx, view, "workspace-tab-2").left() < initial.left() + px(210.));
    cx.update_window(view.into(), |_, window, cx| {
        window.dispatch_event(
            gpui::KeyDownEvent {
                keystroke: gpui::Keystroke::parse("escape").unwrap(),
                is_held: false,
                prefer_character_input: false,
            }
            .to_platform_input(),
            cx,
        )
    })
    .unwrap();
    draw(&mut cx, view);
    cx.executor().advance_clock(Duration::from_millis(300));
    draw(&mut cx, view);
    assert_eq!(
        tab_bounds(&cx, view, "workspace-tab-1").left(),
        initial.left()
    );
    view.read_with(&cx, |workspace, _| {
        assert_eq!(
            workspace.tabs.iter().map(|tab| tab.id).collect::<Vec<_>>(),
            vec![1, 2]
        )
    })
    .unwrap();
}
