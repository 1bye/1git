//! Disposable local transports exercise explicit sync, drafts, worktrees and publication consent.
use super::tests::{draw, open, setup};
use super::*;

use crate::workspace::{
    Section,
    sync::{Action, Sync},
    tests::Fixture,
};

use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

struct Network {
    f: Fixture,
    remote: PathBuf,
    writer: PathBuf,
}

impl Network {
    fn new() -> Self {
        let f = Fixture::new();

        f.write("file.txt", "base\n");
        f.commit();
        let remote = f.directory.path().join("remote.git");
        let writer = f.directory.path().join("writer");

        f.git(&[
            "clone",
            "--bare",
            f.root.to_str().unwrap(),
            remote.to_str().unwrap(),
        ]);
        f.git(&["remote", "add", "origin", remote.to_str().unwrap()]);
        f.git(&["fetch", "origin"]);
        f.git(&["branch", "--set-upstream-to=origin/main"]);
        f.git(&["clone", remote.to_str().unwrap(), writer.to_str().unwrap()]);

        Self { f, remote, writer }
    }

    fn git(&self, root: &Path, args: &[&str]) -> String {
        let out = self
            .f
            .process()
            .run(onegit_git::GitCommand::new(root, args.iter().copied()))
            .unwrap();

        String::from_utf8(out.stdout).unwrap().trim().to_owned()
    }

    fn incoming(&self) {
        fs::write(self.writer.join("incoming.txt"), "incoming\n").unwrap();
        self.git(&self.writer, &["add", "."]);
        self.git(&self.writer, &["commit", "-m", "Incoming"]);
        self.git(&self.writer, &["push", "origin", "main"]);
    }

    fn outgoing(&self) {
        self.f.write("outgoing.txt", "outgoing\n");
        self.f.commit();
    }
}

fn show(
    cx: &mut gpui::TestAppContext,
    view: gpui::WindowHandle<Workspace>,
    tab: &gpui::Entity<RepositoryWorkspace>,
) -> gpui::Entity<Sync> {
    let source = tab.read_with(cx, |tab, _| match &tab.state {
        RepositoryState::Ready(source) => source.clone(),
        _ => panic!("ready tab"),
    });

    let state = view
        .read_with(cx, |workspace, _| {
            workspace.syncs[&source.snapshot.repository.common_directory]
                .state
                .clone()
        })
        .unwrap();

    cx.update_window(view.into(), |_, window, cx| {
        state.update(cx, |state, cx| state.open(source, window, cx))
    })
    .unwrap();
    settle(cx, view);

    state
}

fn settle(cx: &mut gpui::TestAppContext, view: gpui::WindowHandle<Workspace>) {
    draw(cx, view);
    cx.executor().advance_clock(Duration::from_millis(200));
    draw(cx, view);
}

fn start(
    cx: &mut gpui::TestAppContext,
    view: gpui::WindowHandle<Workspace>,
    state: &gpui::Entity<Sync>,
    action: Action,
) {
    state.update(cx, |state, cx| state.submit(action, cx));
    until(cx, view, |cx| !state.read_with(cx, |state, _| state.busy()));
    settle(cx, view);
}

fn head(
    tab: &gpui::Entity<RepositoryWorkspace>,
    cx: &gpui::TestAppContext,
) -> onegit_git::HeadState {
    tab.read_with(cx, |tab, _| match &tab.state {
        RepositoryState::Ready(source) => source.snapshot.status.head.clone(),
        _ => panic!("ready tab"),
    })
}

#[test]
fn opening_sync_never_transports_and_fetch_refreshes_duplicate_and_linked_tabs_without_losing_state()
 {
    let n = Network::new();

    n.f.write("draft.txt", "untracked\n");
    let linked = n.f.directory.path().join("linked");

    n.f.git(&[
        "worktree",
        "add",
        "-b",
        "linked",
        linked.to_str().unwrap(),
        "main",
    ]);
    n.git(&linked, &["branch", "--set-upstream-to=origin/main"]);
    let other = Fixture::new();
    let (mut cx, view) = setup(&n.f);
    let a = open(&mut cx, view, &n.f.root);
    let b = open(&mut cx, view, &n.f.root);
    let c = open(&mut cx, view, &linked);
    let unrelated = open(&mut cx, view, &other.root);

    for (tab, draft) in [(&a, "A draft"), (&b, "B draft"), (&c, "Linked draft")] {
        tab.update(&mut cx, |tab, cx| {
            tab.summary
                .update(cx, |input, cx| input.set_text(draft, cx));
            tab.description
                .update(cx, |input, cx| input.set_text("Body\nretained", cx));
            tab.filter
                .update(cx, |input, cx| input.set_text("draft", cx));
            tab.view = onegit_ui::DiffView::Split;
        });
    }

    draw(&mut cx, view);
    n.incoming();
    let before = n.f.git(&["rev-parse", "HEAD"]);
    let state = show(&mut cx, view, &a);

    assert!(state.read_with(&cx, |state, _| state.pending.is_none()));
    assert_eq!(n.f.git(&["rev-parse", "HEAD"]), before);
    assert_eq!(head(&a, &cx).behind, 0, "opening the panel must not fetch");
    start(&mut cx, view, &state, Action::Fetch);

    for (tab, draft) in [(&a, "A draft"), (&b, "B draft"), (&c, "Linked draft")] {
        assert_eq!(head(tab, &cx).behind, 1);
        tab.read_with(&cx, |tab, cx| {
            assert_eq!(tab.summary.read(cx).text(), draft);
            assert_eq!(tab.description.read(cx).text(), "Body\nretained");
            assert_eq!(tab.filter.read(cx).text(), "draft");
            assert_eq!(tab.view, onegit_ui::DiffView::Split);
        });
    }

    assert_eq!(head(&c, &cx).branch.as_deref(), Some("linked"));
    assert!(head(&unrelated, &cx).is_unborn());
    assert_eq!(n.f.git(&["rev-parse", "HEAD"]), before);
    assert_eq!(
        fs::read(n.f.root.join("draft.txt")).unwrap(),
        b"untracked\n"
    );
    assert!(state.read_with(&cx, |state, _| state.fetched_at.is_some() && state.complete));
    cx.executor().advance_clock(Duration::from_secs(3));
    draw(&mut cx, view);
    assert!(state.read_with(&cx, |state, _| state.fetched_at.is_some()
        && !state.complete));
}

#[test]
fn fast_forward_pull_retains_independent_drafts_history_and_panes() {
    let n = Network::new();
    let (mut cx, view) = setup(&n.f);
    let a = open(&mut cx, view, &n.f.root);
    let b = open(&mut cx, view, &n.f.root);

    for (tab, draft) in [(&a, "First"), (&b, "Second")] {
        tab.update(&mut cx, |tab, cx| {
            tab.summary
                .update(cx, |input, cx| input.set_text(draft, cx));
            tab.section = Section::History;
        });
    }

    n.incoming();
    let state = show(&mut cx, view, &a);

    start(&mut cx, view, &state, Action::Pull);
    assert_eq!(
        n.git(&n.f.root, &["rev-parse", "HEAD"]),
        n.git(&n.writer, &["rev-parse", "HEAD"])
    );

    for (tab, draft) in [(&a, "First"), (&b, "Second")] {
        assert_eq!(head(tab, &cx).behind, 0);
        tab.read_with(&cx, |tab, cx| {
            assert_eq!(tab.summary.read(cx).text(), draft);
            assert!(tab.section == Section::History);
        });
    }
}

#[test]
fn push_targets_only_reviewed_upstream_and_preserves_staged_unstaged_and_untracked_work() {
    let n = Network::new();

    n.f.git(&["config", "branch.main.merge", "refs/heads/review"]);
    n.git(
        &n.remote,
        &[
            "update-ref",
            "refs/heads/review",
            &n.git(&n.remote, &["rev-parse", "main"]),
        ],
    );
    n.f.git(&["fetch", "origin"]);
    n.outgoing();
    n.f.write("file.txt", "staged\n");
    n.f.git(&["add", "file.txt"]);
    n.f.write("file.txt", "unstaged\n");
    n.f.write("new.txt", "untracked\n");
    n.f.git(&["config", "remote.origin.mirror", "true"]);
    n.f.git(&["config", "remote.origin.push", "+refs/heads/*:refs/heads/*"]);
    let before_main = n.git(&n.remote, &["rev-parse", "main"]);
    let index = n.f.git(&["show", ":file.txt"]);
    let (mut cx, view) = setup(&n.f);
    let a = open(&mut cx, view, &n.f.root);
    let b = open(&mut cx, view, &n.f.root);
    let state = show(&mut cx, view, &a);

    start(&mut cx, view, &state, Action::Push);
    assert_eq!(
        n.git(&n.remote, &["rev-parse", "review"]),
        n.git(&n.f.root, &["rev-parse", "HEAD"])
    );
    assert_eq!(n.git(&n.remote, &["rev-parse", "main"]), before_main);
    assert_eq!(n.f.git(&["show", ":file.txt"]), index);
    assert_eq!(fs::read(n.f.root.join("file.txt")).unwrap(), b"unstaged\n");
    assert_eq!(fs::read(n.f.root.join("new.txt")).unwrap(), b"untracked\n");
    assert_eq!(head(&a, &cx).ahead, 0);
    assert_eq!(head(&b, &cx).ahead, 0);
}

#[test]
fn publishing_requires_review_and_confirmation_and_multiple_remotes_require_selection() {
    let n = Network::new();

    n.f.git(&["checkout", "-b", "feature/ui"]);
    n.f.git(&["remote", "add", "backup", n.remote.to_str().unwrap()]);
    let (mut cx, view) = setup(&n.f);
    let a = open(&mut cx, view, &n.f.root);
    let state = show(&mut cx, view, &a);

    start(&mut cx, view, &state, Action::Publish);
    assert!(
        !n.git(
            &n.remote,
            &[
                "for-each-ref",
                "--format=%(refname)",
                "refs/heads/feature/ui"
            ]
        )
        .contains("feature/ui")
    );
    state.update(&mut cx, |state, cx| state.begin_publish(cx));
    assert!(state.read_with(&cx, |state, _| state.remote.is_none()));
    start(&mut cx, view, &state, Action::Publish);
    assert!(head(&a, &cx).upstream.is_none());
    state.update(&mut cx, |state, cx| {
        state.select_remote("backup".into(), cx)
    });
    start(&mut cx, view, &state, Action::Publish);
    assert_eq!(head(&a, &cx).upstream.as_deref(), Some("backup/feature/ui"));
    assert_eq!(
        n.git(&n.remote, &["rev-parse", "feature/ui"]),
        n.git(&n.f.root, &["rev-parse", "HEAD"])
    );
}

#[test]
fn dirty_or_diverged_pull_reports_an_error_without_stashing_merging_or_pushing() {
    let n = Network::new();

    n.incoming();
    n.f.write("file.txt", "dirty\n");
    let (mut cx, view) = setup(&n.f);
    let a = open(&mut cx, view, &n.f.root);
    let b = open(&mut cx, view, &n.f.root);
    let state = show(&mut cx, view, &a);
    let before = n.f.git(&["rev-parse", "HEAD"]);

    start(&mut cx, view, &state, Action::Pull);
    assert!(state.read_with(&cx, |state, _| state.error.is_some()));
    assert_eq!(n.f.git(&["rev-parse", "HEAD"]), before);
    assert_eq!(fs::read(n.f.root.join("file.txt")).unwrap(), b"dirty\n");
    assert!(n.f.git(&["stash", "list"]).is_empty());
    assert_eq!(head(&a, &cx), head(&b, &cx));
    n.f.git(&["checkout", "--", "file.txt"]);
    n.outgoing();
    n.f.git(&["fetch", "origin"]);
    let state = show(&mut cx, view, &a);

    start(&mut cx, view, &state, Action::Pull);
    assert!(state.read_with(&cx, |state, _| state.error.is_some()));
    assert_eq!(
        n.git(&n.remote, &["rev-parse", "main"]),
        n.git(&n.writer, &["rev-parse", "HEAD"])
    );
    assert!(!n.f.root.join(".git/MERGE_HEAD").exists());
}

#[test]
fn stale_branch_or_changed_destination_requires_new_review_without_remote_writes() {
    let n = Network::new();

    n.outgoing();
    let (mut cx, view) = setup(&n.f);
    let a = open(&mut cx, view, &n.f.root);
    let state = show(&mut cx, view, &a);
    let remote = n.git(&n.remote, &["rev-parse", "main"]);

    n.f.git(&["checkout", "-b", "different"]);
    start(&mut cx, view, &state, Action::Push);
    assert!(state.read_with(&cx, |state, _| state.error.is_some()));
    assert_eq!(n.git(&n.remote, &["rev-parse", "main"]), remote);
    assert_eq!(head(&a, &cx).branch.as_deref(), Some("different"));
    n.f.git(&["checkout", "main"]);
    let state = show(&mut cx, view, &a);

    n.f.git(&[
        "remote",
        "set-url",
        "--push",
        "origin",
        n.f.directory.path().join("removed.git").to_str().unwrap(),
    ]);
    start(&mut cx, view, &state, Action::Push);
    assert!(state.read_with(&cx, |state, _| {
        state
            .error
            .as_deref()
            .is_some_and(|error| error.contains("remote") || error.contains("destination"))
    }));
    assert_eq!(n.git(&n.remote, &["rev-parse", "main"]), remote);
}

#[test]
fn escape_discards_publication_consent_and_single_or_ambiguous_remote_choices_are_explicit() {
    let n = Network::new();

    n.f.git(&["checkout", "-b", "feature/cancel"]);
    let (mut cx, view) = setup(&n.f);
    let a = open(&mut cx, view, &n.f.root);
    let state = show(&mut cx, view, &a);

    state.update(&mut cx, |state, cx| state.begin_publish(cx));
    assert_eq!(
        state
            .read_with(&cx, |state, _| state.remote.clone())
            .as_deref(),
        Some("origin")
    );
    cx.simulate_keystrokes(view.into(), "escape");
    draw(&mut cx, view);
    let state = show(&mut cx, view, &a);

    start(&mut cx, view, &state, Action::Publish);
    assert!(head(&a, &cx).upstream.is_none());
    assert!(
        n.git(
            &n.remote,
            &[
                "for-each-ref",
                "--format=%(refname)",
                "refs/heads/feature/cancel"
            ]
        )
        .is_empty()
    );
    n.f.git(&[
        "config",
        "--add",
        "remote.origin.pushurl",
        n.remote.to_str().unwrap(),
    ]);
    n.f.git(&[
        "config",
        "--add",
        "remote.origin.pushurl",
        n.f.directory.path().join("second.git").to_str().unwrap(),
    ]);
    let state = show(&mut cx, view, &a);

    state.update(&mut cx, |state, cx| {
        state.begin_publish(cx);
        state.select_remote("origin".into(), cx);
    });
    assert!(state.read_with(&cx, |state, _| state.remote.is_none()));
    start(&mut cx, view, &state, Action::Publish);
    assert!(head(&a, &cx).upstream.is_none());
}

#[test]
fn rejected_push_keeps_error_until_explicit_action_and_refreshes_all_tabs_without_replaying() {
    let n = Network::new();

    n.incoming();
    n.outgoing();
    let remote = n.git(&n.remote, &["rev-parse", "main"]);
    let (mut cx, view) = setup(&n.f);
    let a = open(&mut cx, view, &n.f.root);
    let b = open(&mut cx, view, &n.f.root);
    let state = show(&mut cx, view, &a);

    start(&mut cx, view, &state, Action::Push);
    assert!(state.read_with(&cx, |state, _| state.error.is_some()));
    assert_eq!(head(&a, &cx), head(&b, &cx));
    let state = show(&mut cx, view, &a);

    settle(&mut cx, view);
    assert!(state.read_with(&cx, |state, _| state.error.is_some()
        && state.pending.is_none()));
    assert_eq!(n.git(&n.remote, &["rev-parse", "main"]), remote);
}

#[test]
fn command_r_fetches_only_and_missing_remotes_refresh_locally_without_publishing() {
    let n = Network::new();

    n.incoming();
    let (mut cx, view) = setup(&n.f);
    let a = open(&mut cx, view, &n.f.root);
    let original = n.git(&n.f.root, &["rev-parse", "HEAD"]);

    cx.simulate_keystrokes(view.into(), "cmd-r");
    settle(&mut cx, view);
    until(&mut cx, view, |cx| head(&a, cx).behind == 1);
    assert_eq!(n.git(&n.f.root, &["rev-parse", "HEAD"]), original);
    cx.simulate_keystrokes(view.into(), "escape");
    draw(&mut cx, view);
    n.f.git(&["remote", "remove", "origin"]);
    n.f.write("new.txt", "local\n");
    cx.simulate_keystrokes(view.into(), "cmd-r");
    settle(&mut cx, view);
    assert!(a.read_with(&cx,|tab,_|matches!(&tab.state,RepositoryState::Ready(source) if source.files.iter().any(|file|file.label=="new.txt"))));
    assert_eq!(n.git(&n.f.root, &["rev-parse", "HEAD"]), original);
}

#[cfg(unix)]
fn stalled_push() -> (Network, PathBuf, PathBuf, onegit_git::GitProcess) {
    use std::os::unix::fs::PermissionsExt;
    let n = Network::new();

    n.outgoing();
    let hooks = n.f.directory.path().join("hooks");

    fs::create_dir(&hooks).unwrap();
    let started = n.f.directory.path().join("transport-started");
    let stopped = n.f.directory.path().join("transport-stopped");
    let hook = hooks.join("pre-push");

    fs::write(&hook,format!("#!/bin/sh\ntrap 'printf stopped > \"{}\"; exit 1' TERM INT\nprintf '%s' \"$$\" > \"{}\"\nprintf 'Writing objects: 100%% (1/1)\\r' >&2\nattempt=0; while [ \"$attempt\" -lt 100 ]; do sleep 0.1; attempt=$((attempt+1)); done; exit 1\n",stopped.display(),started.display())).unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    let process =
        n.f.process()
            .with_environment([("GIT_CONFIG_VALUE_0".into(), hooks.as_os_str().to_owned())]);

    (n, started, stopped, process)
}

fn until(
    cx: &mut gpui::TestAppContext,
    view: gpui::WindowHandle<Workspace>,
    condition: impl Fn(&gpui::TestAppContext) -> bool,
) {
    for _ in 0..300 {
        draw(cx, view);

        if condition(cx) {
            return;
        }

        std::thread::sleep(Duration::from_millis(10));
    }

    panic!("transport condition did not settle");
}

#[cfg(unix)]
#[test]
fn progress_and_cancel_are_shared_by_linked_tabs_and_100_percent_never_implies_success() {
    let (n, started, _stopped, process) = stalled_push();
    let linked = n.f.directory.path().join("linked");

    n.f.git(&[
        "worktree",
        "add",
        "-b",
        "linked",
        linked.to_str().unwrap(),
        "main",
    ]);
    let (mut cx, view) = setup(&n.f);

    view.update(&mut cx, |workspace, _, _| workspace.process = process)
        .unwrap();
    let a = open(&mut cx, view, &n.f.root);
    let b = open(&mut cx, view, &linked);
    let state = show(&mut cx, view, &a);

    state.update(&mut cx, |state, cx| state.submit(Action::Push, cx));
    until(&mut cx, view, |_| started.exists());
    assert!(
        state.read_with(&cx, |state, _| state.pending == Some(Action::Push)
            && state.error.is_none())
    );
    assert!(!a.read_with(&cx, |tab, _| tab.can_write()));
    assert!(!b.read_with(&cx, |tab, _| tab.can_write()));
    let count = view
        .read_with(&cx, |workspace, _| workspace.tabs.len())
        .unwrap();

    view.update(&mut cx, |workspace, window, cx| {
        let id = workspace.tabs[0].id;

        workspace.close(id, window, cx);
    })
    .unwrap();
    assert_eq!(
        view.read_with(&cx, |workspace, _| workspace.tabs.len())
            .unwrap(),
        count
    );
    cx.simulate_keystrokes(view.into(), "escape");
    draw(&mut cx, view);
    let state = show(&mut cx, view, &b);

    assert_eq!(
        state.read_with(&cx, |state, _| state.pending),
        Some(Action::Push)
    );
    let _stopping = std::time::Instant::now();

    state.update(&mut cx, |state, cx| state.stop(cx));
    until(&mut cx, view, |cx| {
        !state.read_with(cx, |state, _| state.busy())
    });
    assert!(
        !process_alive(&started),
        "cancellation must stop the owned Git hook"
    );
    assert!(state.read_with(&cx, |state, _| {
        state
            .error
            .as_deref()
            .is_some_and(|message| message.contains("cancelled"))
    }));
    assert_eq!(
        n.git(&n.remote, &["rev-parse", "main"]),
        n.git(&n.writer, &["rev-parse", "HEAD"])
    );
    assert!(a.read_with(&cx, |tab, _| tab.can_write()));
    assert!(b.read_with(&cx, |tab, _| tab.can_write()));
}

#[test]
fn sync_panel_motion_is_bounded_respects_reduce_motion_and_stops_requesting_idle_frames() {
    let n = Network::new();

    n.f.git(&["checkout", "-b", "new-branch"]);
    let (mut cx, view) = setup(&n.f);
    let a = open(&mut cx, view, &n.f.root);
    let state = show(&mut cx, view, &a);

    let initial = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("sync-panel")
        .unwrap();

    assert_eq!(initial.size.width, px(340.));
    let footer = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("sync-footer")
        .unwrap();

    assert_eq!(
        footer.size.height,
        px(24.),
        "footer actions remain on one line"
    );
    let identity = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("sync-identity")
        .unwrap();

    assert!(
        identity.top() >= initial.top() + px(32.),
        "initial focus must not scroll branch details out of view"
    );
    let row = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("sync-action-fetch")
        .unwrap();

    assert!(
        row.size.height <= px(48.),
        "action buttons and their descriptions share a row"
    );
    state.update(&mut cx, |state, cx| state.begin_publish(cx));
    draw(&mut cx, view);
    cx.executor().advance_clock(Duration::from_millis(80));
    draw(&mut cx, view);
    let mid = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("sync-panel")
        .unwrap();

    assert!(mid.size.width > px(340.) && mid.size.width < px(400.));
    cx.executor().advance_clock(Duration::from_millis(200));
    draw(&mut cx, view);
    let end = gpui::VisualTestContext::from_window(view.into(), &cx)
        .debug_bounds("sync-panel")
        .unwrap();

    assert_eq!(end.size.width, px(400.));
    assert_eq!(
        gpui::VisualTestContext::from_window(view.into(), &cx)
            .debug_bounds("sync-footer")
            .unwrap()
            .size
            .height,
        px(24.)
    );
    assert_eq!(
        end.size.height,
        px(168.),
        "one-remote publishing matches the reference compact dialog"
    );
    cx.update_window(view.into(), |_, window, cx| window.simulate_next_frame(cx))
        .unwrap();
    draw(&mut cx, view);
    assert_eq!(
        cx.update_window(view.into(), |_, window, cx| window.simulate_next_frame(cx))
            .unwrap(),
        0
    );
    cx.update(|cx| cx.set_reduce_motion(true));
    cx.simulate_keystrokes(view.into(), "escape");
    draw(&mut cx, view);
    let _ = show(&mut cx, view, &a);

    assert_eq!(
        gpui::VisualTestContext::from_window(view.into(), &cx)
            .debug_bounds("sync-panel")
            .unwrap()
            .size
            .width,
        px(340.)
    );
}

#[cfg(unix)]
#[test]
fn window_release_cancels_transport_even_if_a_status_handle_is_retained() {
    let (n, started, _stopped, process) = stalled_push();
    let (mut cx, view) = setup(&n.f);

    view.update(&mut cx, |workspace, _, _| workspace.process = process)
        .unwrap();
    let a = open(&mut cx, view, &n.f.root);
    let state = show(&mut cx, view, &a);

    state.update(&mut cx, |state, cx| state.submit(Action::Push, cx));
    until(&mut cx, view, |_| started.exists());
    let closing = std::time::Instant::now();

    cx.update_window(view.into(), |_, window, _| window.remove_window())
        .unwrap();

    for _ in 0..300 {
        cx.run_until_parked();

        if !process_alive(&started) && !state.read_with(&cx, |state, _| state.busy()) {
            break;
        }

        std::thread::sleep(Duration::from_millis(10));
    }

    assert!(!process_alive(&started));
    assert!(
        closing.elapsed() < Duration::from_secs(5),
        "closing must cancel promptly"
    );
    assert!(!state.read_with(&cx, |state, _| state.busy()));
    assert_eq!(
        n.git(&n.remote, &["rev-parse", "main"]),
        n.git(&n.writer, &["rev-parse", "HEAD"])
    );
}

#[cfg(unix)]
#[test]
fn transport_deadline_cancels_and_reports_uncertainty_without_retrying() {
    let (n, started, _, process) = stalled_push();
    let (mut cx, view) = setup(&n.f);

    view.update(&mut cx, |workspace, _, _| workspace.process = process)
        .unwrap();
    let a = open(&mut cx, view, &n.f.root);
    let state = show(&mut cx, view, &a);

    state.update(&mut cx, |state, cx| state.submit(Action::Push, cx));
    until(&mut cx, view, |_| started.exists());
    cx.executor().advance_clock(Duration::from_secs(121));
    until(&mut cx, view, |cx| {
        !state.read_with(cx, |state, _| state.busy())
    });
    assert!(
        state.read_with(&cx, |state, _| state.error.as_deref().is_some_and(
            |error| error.contains("timed out") && error.contains("may have completed")
        ))
    );
    assert_eq!(
        n.git(&n.remote, &["rev-parse", "main"]),
        n.git(&n.writer, &["rev-parse", "HEAD"])
    );
}

#[cfg(unix)]
fn process_alive(marker: &Path) -> bool {
    let pid = fs::read_to_string(marker).unwrap();

    assert!(
        pid.trim().parse::<u32>().is_ok(),
        "fixture marker must contain its PID"
    );

    std::process::Command::new("/bin/kill")
        .args(["-0", pid.trim()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap()
        .success()
}

#[test]
fn uncertain_status_preserves_drafts_and_selection_but_blocks_writes_until_a_fresh_read() {
    let n = Network::new();

    n.f.write("draft.txt", "work\n");
    let (mut cx, view) = setup(&n.f);
    let a = open(&mut cx, view, &n.f.root);
    let b = open(&mut cx, view, &n.f.root);

    a.update(&mut cx, |tab, cx| {
        tab.summary
            .update(cx, |input, cx| input.set_text("Keep this draft", cx))
    });
    let selection = a.read_with(&cx, |tab, _| tab.selected.clone());
    let state = show(&mut cx, view, &a);
    let root = fs::canonicalize(&n.f.root).unwrap();
    let saved_git = n.f.directory.path().join("saved-git");

    fs::rename(n.f.root.join(".git"), &saved_git).unwrap();

    state.update(&mut cx, |_, cx| {
        cx.emit(crate::workspace::sync::Event::Completed(
            std::sync::Arc::new(crate::workspace::sync::Completed {
                result: Ok(()),
                snapshots: vec![(root, Err("Status is unavailable".into()))],
            }),
        ))
    });
    draw(&mut cx, view);
    assert!(!a.read_with(&cx, |tab, _| tab.can_write()));
    assert!(!b.read_with(&cx, |tab, _| tab.can_write()));
    a.read_with(&cx, |tab, cx| {
        assert_eq!(tab.summary.read(cx).text(), "Keep this draft");
        assert_eq!(tab.selected, selection);
    });
    // Refresh status performs only reads, then enables writing from the newly reviewed state.
    fs::rename(&saved_git, n.f.root.join(".git")).unwrap();
    let _ = show(&mut cx, view, &a);

    assert!(a.read_with(&cx, |tab, _| tab.can_write()));
    assert!(b.read_with(&cx, |tab, _| tab.can_write()));
    assert_eq!(
        n.git(&n.remote, &["rev-parse", "main"]),
        n.git(&n.writer, &["rev-parse", "HEAD"])
    );
}
