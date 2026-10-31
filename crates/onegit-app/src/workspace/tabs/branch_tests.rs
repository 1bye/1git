//! Real Git and native events cover source branch-picker workflows and shared-tab refresh.
use super::tests::{draw, open, setup};
use super::*;

use crate::workspace::{
    Section,
    branches::{Phase, Picker},
    tests::{Fixture, contents},
};

use onegit_git::{BranchChanges, RecordType};
use rake::gpui::{Focusable, InputEvent as _};
use std::{fs, time::Duration};

fn fixture() -> Fixture {
    let f = Fixture::new();

    f.write("a.txt", "base a\n");
    f.write("b.txt", "base b\n");
    f.commit();
    f.git(&["branch", "feature/ui"]);

    f
}

fn settle(cx: &mut gpui::TestAppContext, view: gpui::WindowHandle<Workspace>) {
    draw(cx, view);
    cx.executor().advance_clock(Duration::from_millis(200));
    draw(cx, view);
}

fn picker(
    cx: &mut gpui::TestAppContext,
    view: gpui::WindowHandle<Workspace>,
) -> gpui::Entity<Picker> {
    view.update(cx, |workspace, window, cx| {
        workspace.open_branches(None, window, cx)
    })
    .unwrap();
    settle(cx, view);

    view.read_with(cx, |workspace, cx| {
        assert!(workspace.branch_host.is_open(cx));

        workspace.branches.clone()
    })
    .unwrap()
}

fn search(
    cx: &mut gpui::TestAppContext,
    view: gpui::WindowHandle<Workspace>,
    picker: &gpui::Entity<Picker>,
    value: &str,
) {
    picker.update(cx, |picker, cx| {
        picker
            .query
            .update(cx, |query, cx| query.set_text(value, cx))
    });
    settle(cx, view);
}

fn choose(
    cx: &mut gpui::TestAppContext,
    view: gpui::WindowHandle<Workspace>,
    picker: &gpui::Entity<Picker>,
    name: &str,
) {
    let index = picker.read_with(cx, |picker, _| {
        picker
            .data
            .as_ref()
            .unwrap()
            .branches
            .iter()
            .position(|branch| branch.name == name)
            .unwrap()
    });

    view.update(cx, |_, window, cx| {
        picker.update(cx, |picker, cx| picker.choose(index, window, cx))
    })
    .unwrap();
}

fn confirm(
    cx: &mut gpui::TestAppContext,
    view: gpui::WindowHandle<Workspace>,
    picker: &gpui::Entity<Picker>,
) {
    view.update(cx, |_, window, cx| {
        picker.update(cx, |picker, cx| picker.confirm(window, cx))
    })
    .unwrap();
    settle(cx, view);
}

fn key(cx: &mut gpui::TestAppContext, view: gpui::WindowHandle<Workspace>, value: &str) {
    cx.update_window(view.into(), |_, window, cx| {
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
    draw(cx, view);
}

fn click(
    cx: &mut gpui::TestAppContext,
    view: gpui::WindowHandle<Workspace>,
    selector: &'static str,
) {
    let bounds = gpui::VisualTestContext::from_window(view.into(), cx)
        .debug_bounds(selector)
        .unwrap();

    click_at(cx, view, bounds.center());
}

fn click_at(
    cx: &mut gpui::TestAppContext,
    view: gpui::WindowHandle<Workspace>,
    position: gpui::Point<gpui::Pixels>,
) {
    cx.update_window(view.into(), |_, window, cx| {
        window.dispatch_event(
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
        window.dispatch_event(
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
    draw(cx, view);
}

fn head(tab: &gpui::Entity<RepositoryWorkspace>, cx: &gpui::TestAppContext) -> String {
    tab.read_with(cx, |tab, _| match &tab.state {
        RepositoryState::Ready(source) => source.snapshot.status.head.branch.clone().unwrap(),
        _ => panic!("repository must stay available"),
    })
}

#[test]
fn search_keyboard_switch_refreshes_duplicate_tabs_and_preserves_drafts_and_layout() {
    let f = fixture();

    f.git(&["switch", "feature/ui"]);
    f.write("b.txt", "feature b\n");
    f.commit();
    f.git(&["switch", "main"]);
    let other = fixture();
    let (mut cx, view) = setup(&f);
    let first = open(&mut cx, view, &f.root);
    let second = open(&mut cx, view, &f.root);
    let unrelated = open(&mut cx, view, &other.root);

    view.update(&mut cx, |workspace, window, cx| {
        first.update(cx, |tab, cx| {
            tab.summary
                .update(cx, |input, cx| input.set_text("First draft", cx));
            tab.description
                .update(cx, |input, cx| input.set_text("Body\nwith details", cx));
            tab.view = onegit_ui::DiffView::Split;
            tab.filter_visible = true;
            tab.filter
                .update(cx, |input, cx| input.set_text("a.txt", cx));
            tab.split
                .update(cx, |split, cx| split.resize(px(352.), window, cx));
        });
        second.update(cx, |tab, cx| {
            tab.summary
                .update(cx, |input, cx| input.set_text("Second draft", cx));
            tab.change_section(&"history".into(), cx);
        });
        workspace.request(&Request::Activate(workspace.tabs[1].id), window, cx);
    })
    .unwrap();
    draw(&mut cx, view);
    let old_history = second.read_with(&cx, |tab, cx| tab.history.read(cx).selected.clone());
    let p = picker(&mut cx, view);

    search(&mut cx, view, &p, "FEATURE/UI");
    p.read_with(&cx, |picker, _| assert_eq!(picker.visible.len(), 1));
    view.update(&mut cx, |_, window, cx| {
        assert!(
            p.read(cx)
                .query
                .read(cx)
                .focus_handle(cx)
                .is_focused(window)
        )
    })
    .unwrap();
    key(&mut cx, view, "down");
    key(&mut cx, view, "enter");
    settle(&mut cx, view);
    assert_eq!(head(&first, &cx), "feature/ui");
    assert_eq!(head(&second, &cx), "feature/ui");
    assert_eq!(head(&unrelated, &cx), "main");
    first.read_with(&cx, |tab, cx| {
        assert_eq!(tab.summary.read(cx).text(), "First draft");
        assert_eq!(tab.description.read(cx).text(), "Body\nwith details");
        assert_eq!(tab.view, onegit_ui::DiffView::Split);
        assert_eq!(tab.filter.read(cx).text(), "a.txt");
        assert_eq!(tab.split.read(cx).preferred_size(), px(352.));
    });
    second.read_with(&cx, |tab, cx| {
        assert_eq!(tab.summary.read(cx).text(), "Second draft");
        assert!(tab.section == Section::History);
        assert_eq!(tab.history.read(cx).selected, old_history);
    });
    view.read_with(&cx, |workspace, cx| {
        assert!(!workspace.branch_host.is_open(cx))
    })
    .unwrap();
}

#[test]
fn creation_keeps_the_form_on_invalid_names_and_never_replaces_an_existing_branch() {
    let f = fixture();
    let before = contents(&f.root);
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);
    let p = picker(&mut cx, view);

    view.update(&mut cx, |_, window, cx| {
        p.update(cx, |picker, cx| picker.create(window, cx))
    })
    .unwrap();
    settle(&mut cx, view);
    p.update(&mut cx, |picker, cx| {
        picker
            .name
            .update(cx, |name, cx| name.set_text("bad..name", cx))
    });
    key(&mut cx, view, "enter");
    settle(&mut cx, view);
    assert_eq!(head(&tab, &cx), "main");
    assert_eq!(contents(&f.root), before);
    p.read_with(&cx, |picker, cx| {
        assert!(picker.error.is_some());
        assert!(picker.dialog.read(cx).is_open());
        assert_eq!(picker.name.read(cx).text(), "bad..name");
    });
    p.update(&mut cx, |picker, cx| {
        picker
            .name
            .update(cx, |name, cx| name.set_text("feature/ui", cx))
    });
    confirm(&mut cx, view, &p);
    assert_eq!(head(&tab, &cx), "main");
    assert_eq!(contents(&f.root), before);
    p.update(&mut cx, |picker, cx| {
        picker
            .name
            .update(cx, |name, cx| name.set_text("feature/new", cx))
    });
    confirm(&mut cx, view, &p);
    assert_eq!(head(&tab, &cx), "feature/new");
    view.read_with(&cx, |workspace, cx| {
        assert!(!workspace.branch_host.is_open(cx))
    })
    .unwrap();
}

#[test]
fn remote_switch_creates_exact_tracking_branch_without_network_or_guessing() {
    let f = fixture();

    let oid = String::from_utf8(f.git(&["rev-parse", "HEAD"]))
        .unwrap()
        .trim()
        .to_owned();

    for remote in ["origin", "backup"] {
        f.git(&[
            "remote",
            "add",
            remote,
            "https://example.invalid/repository.git",
        ]);
        f.git(&["update-ref", &format!("refs/remotes/{remote}/topic"), &oid]);
    }

    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);
    let p = picker(&mut cx, view);

    choose(&mut cx, view, &p, "origin/topic");
    settle(&mut cx, view);
    p.read_with(&cx,|picker,cx|{assert!(matches!(&picker.phase,Phase::Create{remote:Some(remote)}if remote=="refs/remotes/origin/topic"));assert_eq!(picker.name.read(cx).text(),"topic");});
    confirm(&mut cx, view, &p);
    assert_eq!(head(&tab, &cx), "topic");
    assert_eq!(
        f.git(&["config", "--get", "branch.topic.remote"]),
        b"origin\n"
    );
    assert_eq!(
        f.git(&["config", "--get", "branch.topic.merge"]),
        b"refs/heads/topic\n"
    );
}

#[test]
fn leave_switch_back_and_restore_preserve_index_working_files_untracked_files_and_drafts() {
    let f = fixture();

    f.write("a.txt", "staged a\n");
    f.git(&["add", "a.txt"]);
    f.write("a.txt", "working a\n");
    f.write("new.txt", "untracked\n");
    let status = f.git(&["status", "--porcelain=v1", "-z"]);
    let staged = f.git(&["show", ":a.txt"]);
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);
    let duplicate = open(&mut cx, view, &f.root);

    tab.update(&mut cx, |tab, cx| {
        tab.summary
            .update(cx, |input, cx| input.set_text("Keep my draft", cx))
    });
    let p = picker(&mut cx, view);

    choose(&mut cx, view, &p, "feature/ui");
    settle(&mut cx, view);
    assert_eq!(head(&tab, &cx), "main");
    assert_eq!(fs::read(f.root.join("a.txt")).unwrap(), b"working a\n");
    p.read_with(&cx, |picker, _| {
        assert!(matches!(
            picker.phase,
            Phase::Changes {
                choice: BranchChanges::Leave,
                ..
            }
        ))
    });
    confirm(&mut cx, view, &p);
    assert_eq!(head(&tab, &cx), "feature/ui");
    assert_eq!(head(&duplicate, &cx), "feature/ui");
    assert!(!f.root.join("new.txt").exists());
    let p = picker(&mut cx, view);

    choose(&mut cx, view, &p, "main");
    settle(&mut cx, view);
    let p = picker(&mut cx, view);

    p.update(&mut cx, |picker, cx| {
        let saved = picker
            .saved
            .iter()
            .find(|saved| saved.branch == "main")
            .unwrap()
            .clone();

        picker.phase = Phase::Restore(saved);
        cx.notify();
    });
    confirm(&mut cx, view, &p);
    assert_eq!(head(&tab, &cx), "main");
    assert_eq!(f.git(&["status", "--porcelain=v1", "-z"]), status);
    assert_eq!(f.git(&["show", ":a.txt"]), staged);
    assert_eq!(fs::read(f.root.join("a.txt")).unwrap(), b"working a\n");
    assert_eq!(fs::read(f.root.join("new.txt")).unwrap(), b"untracked\n");
    assert!(f.git(&["stash", "list"]).is_empty());
    tab.read_with(&cx, |tab, cx| {
        assert_eq!(tab.summary.read(cx).text(), "Keep my draft")
    });
}

#[test]
fn bring_conflicts_keep_a_backup_refresh_all_tabs_and_reject_blind_retry() {
    let f = fixture();

    f.git(&["switch", "feature/ui"]);
    f.write("a.txt", "destination\n");
    f.commit();
    f.git(&["switch", "main"]);
    f.write("a.txt", "source changes\n");
    let (mut cx, view) = setup(&f);
    let a = open(&mut cx, view, &f.root);
    let b = open(&mut cx, view, &f.root);
    let p = picker(&mut cx, view);

    choose(&mut cx, view, &p, "feature/ui");
    settle(&mut cx, view);
    click(&mut cx, view, "branch-bring");
    confirm(&mut cx, view, &p);
    assert_eq!(head(&a, &cx), "feature/ui");
    assert_eq!(head(&b, &cx), "feature/ui");

    for tab in [a, b] {
        tab.read_with(&cx,|tab,_|assert!(matches!(&tab.state,RepositoryState::Ready(source)if source.snapshot.status.files.iter().any(|file|file.record_type==RecordType::Unmerged))));
    }

    let saved = f.git(&["stash", "list"]);

    assert!(!saved.is_empty());
    p.read_with(&cx, |picker, cx| {
        assert!(picker.error.as_ref().unwrap().contains("backup"));
        assert!(picker.dialog.read(cx).is_open());
        assert!(!picker.busy);
    });
    confirm(&mut cx, view, &p);
    assert_eq!(
        f.git(&["stash", "list"]),
        saved,
        "retry must not create another stash or repeat a partial write"
    );
}

#[test]
fn stale_source_and_other_worktree_are_rejected_without_forcing_or_losing_the_draft() {
    let f = fixture();
    let other = f.directory.path().join("other worktree");

    f.git(&["branch", "occupied"]);
    f.git(&["worktree", "add", other.to_str().unwrap(), "occupied"]);
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);

    tab.update(&mut cx, |tab, cx| {
        tab.summary.update(cx, |input, cx| {
            input.set_text("Retain after stale checkout", cx)
        })
    });
    let p = picker(&mut cx, view);

    search(&mut cx, view, &p, "occupied");
    key(&mut cx, view, "enter");
    assert_eq!(head(&tab, &cx), "main");
    f.git(&["switch", "--detach"]);
    choose(&mut cx, view, &p, "feature/ui");
    settle(&mut cx, view);
    assert_eq!(f.git(&["rev-parse", "--abbrev-ref", "HEAD"]), b"HEAD\n");
    p.read_with(&cx, |picker, _| {
        assert!(
            picker
                .error
                .as_ref()
                .is_some_and(|error| error.contains("changed") && error.contains("reopen"))
        )
    });
    tab.read_with(&cx, |tab, cx| {
        assert_eq!(tab.summary.read(cx).text(), "Retain after stale checkout")
    });
}

#[test]
fn accepted_switch_blocks_dismissal_and_duplicate_tab_writes_before_the_next_frame() {
    let f = fixture();
    let (mut cx, view) = setup(&f);
    let a = open(&mut cx, view, &f.root);
    let b = open(&mut cx, view, &f.root);
    let p = picker(&mut cx, view);

    choose(&mut cx, view, &p, "feature/ui");
    view.read_with(&cx, |_, cx| {
        assert!(p.read(cx).busy);
        assert!(!a.read(cx).can_write());
        assert!(!b.read(cx).can_write());
    })
    .unwrap();
    cx.update_window(view.into(), |_, window, cx| {
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
    view.read_with(&cx, |workspace, cx| {
        assert!(workspace.branch_host.is_open(cx))
    })
    .unwrap();
    settle(&mut cx, view);
    assert_eq!(head(&a, &cx), "feature/ui");
    assert_eq!(head(&b, &cx), "feature/ui");
    assert!(a.read_with(&cx, |tab, _| tab.write_job.is_none()));
    assert!(b.read_with(&cx, |tab, _| tab.write_job.is_none()));
}

#[test]
fn bring_success_moves_staged_and_untracked_work_and_removes_only_its_own_backup() {
    let f = fixture();

    f.write("a.txt", "staged\n");
    f.git(&["add", "a.txt"]);
    f.write("new.txt", "new\n");
    let staged = f.git(&["show", ":a.txt"]);
    let (mut cx, view) = setup(&f);
    let tab = open(&mut cx, view, &f.root);
    let p = picker(&mut cx, view);

    choose(&mut cx, view, &p, "feature/ui");
    settle(&mut cx, view);
    click(&mut cx, view, "branch-bring");
    confirm(&mut cx, view, &p);
    assert_eq!(head(&tab, &cx), "feature/ui");
    assert_eq!(f.git(&["show", ":a.txt"]), staged);
    assert_eq!(fs::read(f.root.join("new.txt")).unwrap(), b"new\n");
    assert!(f.git(&["stash", "list"]).is_empty());
}

#[test]
fn attached_picker_matches_geometry_animates_height_and_stops_frames_after_settling() {
    let f = fixture();
    let (mut cx, view) = setup(&f);

    open(&mut cx, view, &f.root);
    click(&mut cx, view, "rail-branches");
    cx.executor().advance_clock(Duration::from_millis(80));
    draw(&mut cx, view);
    let middle = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("workspace-branch-body")
        .unwrap();

    cx.executor().advance_clock(Duration::from_millis(120));
    draw(&mut cx, view);
    let settled = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("workspace-branch-body")
        .unwrap();

    assert_eq!(settled.origin, gpui::point(px(48.), px(84.)));
    assert_eq!(settled.size.width, px(288.));
    let first_row = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("branch-row-0")
        .unwrap();

    assert_eq!(first_row.origin.y, settled.origin.y + px(36.));
    assert_eq!(first_row.size.height, px(28.));
    assert!(middle.size.height > px(0.) && middle.size.height < settled.size.height);
    view.update(&mut cx, |workspace, window, cx| {
        assert!(
            workspace
                .branches
                .read(cx)
                .query
                .read(cx)
                .focus_handle(cx)
                .is_focused(window)
        )
    })
    .unwrap();
    cx.executor().advance_clock(Duration::from_secs(1));
    draw(&mut cx, view);
    cx.update_window(view.into(), |_, window, cx| window.simulate_next_frame(cx))
        .unwrap();
    draw(&mut cx, view);
    assert_eq!(
        cx.update_window(view.into(), |_, window, cx| window.simulate_next_frame(cx))
            .unwrap(),
        0,
        "settled branch popup must not animate indefinitely"
    );
    // The current branch dismisses the picker even when its decorative icon is clicked.
    click_at(
        &mut cx,
        view,
        first_row.origin + gpui::point(px(12.), px(14.)),
    );
    view.read_with(&cx, |workspace, cx| {
        assert!(!workspace.branch_host.is_open(cx))
    })
    .unwrap();
    // Active-tab Enter uses the same picker, attached beneath that tab.
    view.update(&mut cx, |workspace, window, cx| {
        window.focus(&workspace.tabs[0].focus, cx)
    })
    .unwrap();
    key(&mut cx, view, "enter");
    settle(&mut cx, view);
    let tab_popup = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("workspace-branch-body")
        .unwrap();

    assert_eq!(tab_popup.top(), px(41.));
    let preview = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("branch-tab-preview")
        .unwrap();

    let tab = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("workspace-tab-1")
        .unwrap();

    assert_eq!(preview.left(), tab.left());
    assert_eq!(preview.top(), px(6.));
    click(&mut cx, view, "branch-tab-preview");
    view.read_with(&cx, |workspace, cx| {
        assert!(!workspace.branch_host.is_open(cx))
    })
    .unwrap();
    cx.update(|cx| cx.set_reduce_motion(true));
    click(&mut cx, view, "rail-branches");
    draw(&mut cx, view);
    let snapped = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("workspace-branch-body")
        .unwrap();

    assert_eq!(snapped.size.height, settled.size.height);
}

#[test]
fn creation_from_a_clean_unborn_repository_updates_every_tab_without_creating_a_commit() {
    let f = Fixture::new();
    let (mut cx, view) = setup(&f);
    let a = open(&mut cx, view, &f.root);
    let b = open(&mut cx, view, &f.root);
    let p = picker(&mut cx, view);

    view.update(&mut cx, |_, window, cx| {
        p.update(cx, |picker, cx| picker.create(window, cx))
    })
    .unwrap();
    settle(&mut cx, view);
    p.update(&mut cx, |picker, cx| {
        picker
            .name
            .update(cx, |name, cx| name.set_text("new-repository", cx))
    });
    confirm(&mut cx, view, &p);

    for tab in [a, b] {
        assert_eq!(head(&tab, &cx), "new-repository");
        tab.read_with(&cx,|tab,_|assert!(matches!(&tab.state,RepositoryState::Ready(source)if source.snapshot.status.head.oid.is_none())));
    }

    assert!(
        f.git(&["for-each-ref", "refs/heads"]).is_empty(),
        "creating the unborn branch must not create a commit"
    );
}
