//! Covers: public branch edits, reviewed stale/dirty/worktree guards and durable Leave/Bring/Restore recovery.
//! Real: system Git, versioned stash metadata, owned process execution and isolated local repositories.
//! Doubles: bounded executable wrappers fail/pause selected calls; no accounts/network/user configuration.
//! Requires: POSIX Git and writable temporary storage; default test runner, no GUI.

mod common;

use common::{Fixture, files_under};

use onegit_git::{
    BranchAction, BranchChanges, BranchError, BranchIdentity, BranchKind, BranchRequest,
    Cancellation, CreateBranch, ErrorCode, Failure, FileStatus, GitProcess, Operation, Repository,
    RepositoryCoordinator, RepositoryError, WritePhase,
};

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

fn fixture() -> Fixture {
    let fixture = Fixture::new();

    fixture.write("file.txt", "base\n");
    fixture.write(".gitignore", "*.ignored\n");
    fixture.commit("Base");
    fixture.git(&["branch", "feature/ui"]);

    fixture
}

#[test]
fn matches_the_frozen_source_backup_decoder_for_all_32_metadata_cases() {
    let reference: serde_json::Value =
        serde_json::from_str(include_str!("branch-backup-reference.json")).unwrap();

    let cases = reference["cases"].as_array().unwrap();

    assert_eq!(cases.len(), 32);

    for case in cases {
        let stashes: Vec<_> = case["stashes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|stash| onegit_git::Stash {
                reference: stash["reference"].as_str().unwrap().into(),
                oid: stash["oid"].as_str().unwrap().into(),
                created_at: stash["createdAt"].as_str().unwrap().into(),
                summary: stash["summary"].as_str().unwrap().into(),
            })
            .collect();

        let result = onegit_git::SavedBranchChanges::from_stashes(
            std::path::Path::new(case["root"].as_str().unwrap()),
            &stashes,
        );

        let normalized: Vec<_> = result.into_iter().map(|saved| serde_json::json!({"oid":saved.oid,"branch":saved.branch,"createdAt":saved.created_at})).collect();

        assert_eq!(
            serde_json::json!(normalized),
            case["expected"],
            "source case {}",
            case["name"]
        );
    }
}

#[test]
fn reviewed_switches_never_overwrite_ignored_files_tracked_by_the_destination() {
    for (remote, changes) in [
        (false, None),
        (true, None),
        (false, Some(BranchChanges::Bring)),
        (true, Some(BranchChanges::Bring)),
    ] {
        let fixture = fixture();

        fixture.git(&["switch", "feature/ui"]);
        fixture.write("collision.ignored", "destination\n");
        fixture.git(&["add", "--force", "--", "collision.ignored"]);
        fixture.git(&["commit", "-m", "Destination tracks ignored path"]);
        let destination = String::from_utf8(fixture.git(&["rev-parse", "HEAD"])).unwrap();

        fixture.git(&["switch", "main"]);
        fixture.write("collision.ignored", "ignored original\n");

        if changes.is_some() {
            mixed(&fixture);
        }

        let action = if remote {
            fixture.git_os([
                "remote".into(),
                "add".into(),
                "team".into(),
                fixture.root.as_os_str().to_owned(),
            ]);
            fixture.git(&[
                "update-ref",
                "refs/remotes/team/new/track",
                destination.trim(),
            ]);

            BranchAction::Remote("refs/remotes/team/new/track".into())
        } else {
            BranchAction::Switch("feature/ui".into())
        };

        let repository = open(&fixture);
        let mut request = request(&repository, action);

        request.changes = changes;
        let error = repository.change_branch(&request, None).unwrap_err();

        assert_eq!(error.failure.phase, WritePhase::Command);
        assert_eq!(
            fs::read(fixture.root.join("collision.ignored")).unwrap(),
            b"ignored original\n"
        );
        assert_eq!(fixture.git(&["branch", "--show-current"]), b"main\n");
        assert!(
            !repository
                .branches(None)
                .unwrap()
                .branches
                .iter()
                .any(|branch| branch.name == "new/track")
        );
        assert_eq!(error.saved_changes.is_some(), changes.is_some());
    }
}

#[test]
fn refuses_dirty_submodule_switching_before_creating_a_recovery_stash() {
    let fixture = fixture();
    let child = Fixture::new();

    child.write("child.txt", "base\n");
    child.commit("Child");
    fixture.git_os([
        "-c".into(),
        "protocol.file.allow=always".into(),
        "submodule".into(),
        "add".into(),
        "--".into(),
        child.root.as_os_str().to_owned(),
        "sub".into(),
    ]);
    fixture.commit("Submodule");
    fs::write(fixture.root.join("sub/child.txt"), b"dirty submodule\n").unwrap();
    let repository = open(&fixture);
    let before = files_under(&fixture.root);
    let error = switch(&repository, "feature/ui", Some(BranchChanges::Bring)).unwrap_err();

    assert!(error.to_string().contains("submodule"));
    assert_conflict(error);
    assert_eq!(files_under(&fixture.root), before);
    assert!(repository.stashes(None).unwrap().is_empty());
}

#[test]
fn branch_failures_redact_diagnostics_and_never_promise_retention_after_uncertain_cleanup() {
    let fixture = fixture();

    let process = wrapper(
        &fixture,
        r#"
case " $* " in
 *" switch "*) printf 'fatal: https://fixture:synthetic-secret@localhost/repository' >&2; exit 1 ;;
esac
exec git "$@""#,
    );

    let repository = Repository::open(&fixture.root, process, None).unwrap();
    let error = switch(&repository, "feature/ui", None).unwrap_err();
    let failure = error.as_failure(Operation::CheckoutBranch);

    assert!(!error.to_string().contains("synthetic-secret"));
    assert!(
        !failure
            .details
            .as_ref()
            .unwrap()
            .contains("synthetic-secret")
    );
    assert!(failure.details.unwrap().contains("fixture:***@localhost"));

    let repository = open(&fixture);

    mixed(&fixture);
    let saved = switch(&repository, "feature/ui", Some(BranchChanges::Leave))
        .unwrap()
        .saved_changes
        .unwrap();

    switch(&repository, "main", None).unwrap();
    let process = wrapper(
        &fixture,
        r#"
case " $* " in
 *" stash drop "*) git "$@" || exit $?; printf 'reported failure after cleanup' >&2; exit 1 ;;
esac
exec git "$@""#,
    );

    let repository = Repository::open(&fixture.root, process, None).unwrap();

    let error = repository
        .change_branch(
            &request(
                &repository,
                BranchAction::Restore {
                    branch: "main".into(),
                    oid: saved.oid,
                },
            ),
            None,
        )
        .unwrap_err();

    assert_eq!(error.failure.phase, WritePhase::Command);
    assert!(error.saved_changes.is_some());
    assert!(
        !error
            .as_failure(Operation::CheckoutBranch)
            .message
            .contains("safe in Stashes")
    );
    assert!(error.to_string().contains("confirm its current state"));
    assert!(open(&fixture).stashes(None).unwrap().is_empty());
}

#[test]
fn refuses_remote_tracking_name_collisions_and_other_worktree_renames_without_writes() {
    let fixture = fixture();
    let oid = String::from_utf8(fixture.git(&["rev-parse", "HEAD"])).unwrap();

    fixture.git_os([
        "remote".into(),
        "add".into(),
        "team".into(),
        fixture.root.as_os_str().to_owned(),
    ]);
    fixture.git(&["update-ref", "refs/remotes/team/feature/ui", oid.trim()]);
    let linked = fixture.temporary.path().join("linked");

    fixture.git_os([
        "worktree".into(),
        "add".into(),
        linked.into_os_string(),
        "feature/ui".into(),
    ]);
    let repository = open(&fixture);

    for action in [
        BranchAction::Remote("refs/remotes/team/feature/ui".into()),
        BranchAction::Remote("refs/remotes/team/missing".into()),
        BranchAction::Rename {
            name: "feature/ui".into(),
            new_name: "moved".into(),
            expected_target: oid.trim().into(),
        },
    ] {
        let before = files_under(&fixture.root);

        assert_conflict(
            repository
                .change_branch(&request(&repository, action), None)
                .unwrap_err(),
        );
        assert_eq!(files_under(&fixture.root), before);
    }
}

#[test]
fn a_successful_checkout_hook_cannot_make_a_later_restore_refusal_look_like_no_write_occurred() {
    let fixture = fixture();
    let hooks = fixture.temporary.path().join("hooks");

    fs::create_dir(&hooks).unwrap();
    let hook = hooks.join("post-checkout");

    fs::write(
        &hook,
        b"#!/bin/sh\nprintf 'hook edit\\n' > hook.txt\nexit 0\n",
    )
    .unwrap();
    fs::set_permissions(hook, fs::Permissions::from_mode(0o700)).unwrap();
    let process = fixture
        .process()
        .with_environment([("GIT_CONFIG_VALUE_0".into(), hooks.into_os_string())]);

    let repository = Repository::open(&fixture.root, process, None).unwrap();

    fixture.write("file.txt", "my edits\n");
    let error = switch(&repository, "feature/ui", Some(BranchChanges::Bring)).unwrap_err();

    assert_eq!(error.failure.phase, WritePhase::Command);
    assert!(error.saved_changes.is_some());
    assert_eq!(fixture.git(&["branch", "--show-current"]), b"feature/ui\n");
    assert_eq!(
        fs::read(fixture.root.join("hook.txt")).unwrap(),
        b"hook edit\n"
    );
}

fn open(fixture: &Fixture) -> Repository {
    Repository::open(&fixture.root, fixture.process(), None).unwrap()
}

fn request(repository: &Repository, action: BranchAction) -> BranchRequest {
    BranchRequest::new(action, &repository.snapshot(false, None).unwrap())
}

fn switch(
    repository: &Repository,
    name: &str,
    changes: Option<BranchChanges>,
) -> Result<onegit_git::BranchMutation, BranchError> {
    let mut request = request(repository, BranchAction::Switch(name.into()));

    request.changes = changes;

    repository.change_branch(&request, None)
}

fn mixed(fixture: &Fixture) -> Vec<u8> {
    fixture.write("file.txt", "staged\n");
    fixture.git(&["add", "--", "file.txt"]);
    fixture.write("file.txt", "unstaged\n");
    fixture.write("new.txt", "untracked\n");
    fixture.write("keep.ignored", "ignored\n");

    fixture.git(&["ls-files", "--stage"])
}

fn wrapper(fixture: &Fixture, body: &str) -> GitProcess {
    let path = fixture.temporary.path().join("git-wrapper");

    fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();

    GitProcess::new(path, 64 * 1024 * 1024).with_environment([
        ("GIT_CONFIG_GLOBAL".into(), "/dev/null".into()),
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
        ("GIT_CONFIG_COUNT".into(), "2".into()),
        ("GIT_CONFIG_KEY_0".into(), "core.hooksPath".into()),
        ("GIT_CONFIG_VALUE_0".into(), "/dev/null".into()),
        ("GIT_CONFIG_KEY_1".into(), "commit.gpgsign".into()),
        ("GIT_CONFIG_VALUE_1".into(), "false".into()),
        ("GIT_AUTHOR_NAME".into(), "Fixture".into()),
        ("GIT_AUTHOR_EMAIL".into(), "fixture@example.invalid".into()),
        ("GIT_COMMITTER_NAME".into(), "Fixture".into()),
        (
            "GIT_COMMITTER_EMAIL".into(),
            "fixture@example.invalid".into(),
        ),
        (
            "HOME".into(),
            fixture.temporary.path().as_os_str().to_owned(),
        ),
    ])
}

fn assert_conflict(error: BranchError) {
    assert_eq!(error.failure.phase, WritePhase::BeforeCommand);
    assert_eq!(
        Failure::from_repository(Operation::CheckoutBranch, &error.failure.error).code,
        ErrorCode::Conflict
    );
}

#[test]
fn edits_local_branches_and_returns_fresh_state_without_changing_committed_contents() {
    let fixture = fixture();
    let repository = open(&fixture);
    let index = fixture.git(&["ls-files", "--stage"]);

    let created = repository
        .create_branch(CreateBranch::new("without-checkout"), None)
        .unwrap();

    assert_eq!(created.snapshot.status.head.branch.as_deref(), Some("main"));
    assert!(
        created
            .branches
            .branches
            .iter()
            .any(|branch| branch.name == "without-checkout")
    );
    let switched = switch(&repository, "feature/ui", None).unwrap();

    assert_eq!(
        switched.snapshot.status.head.branch.as_deref(),
        Some("feature/ui")
    );
    let created = repository
        .change_branch(
            &request(&repository, BranchAction::Create("new/branch".into())),
            None,
        )
        .unwrap();

    assert_eq!(
        created.snapshot.status.head.branch.as_deref(),
        Some("new/branch")
    );
    let renamed = repository
        .rename_branch(None, "renamed", false, None)
        .unwrap();

    assert_eq!(
        renamed.snapshot.status.head.branch.as_deref(),
        Some("renamed")
    );
    repository.checkout_branch("main", false, None).unwrap();
    let removed = repository.delete_branch("renamed", false, None).unwrap();

    assert!(
        !removed
            .branches
            .branches
            .iter()
            .any(|branch| branch.name == "renamed")
    );
    assert_eq!(fs::read(fixture.root.join("file.txt")).unwrap(), b"base\n");
    assert_eq!(fixture.git(&["ls-files", "--stage"]), index);
}

#[test]
fn leaves_mixed_changes_in_a_source_owned_backup_without_consuming_ignored_files() {
    let fixture = fixture();
    let repository = open(&fixture);
    let index = mixed(&fixture);
    let result = switch(&repository, "feature/ui", Some(BranchChanges::Leave)).unwrap();
    let saved = result.saved_changes.unwrap();

    assert_eq!(saved.branch, "main");
    assert!(result.snapshot.status.files.is_empty());
    assert_eq!(
        repository.saved_branch_changes(None).unwrap(),
        vec![saved.clone()]
    );
    assert_eq!(
        fs::read(fixture.root.join("keep.ignored")).unwrap(),
        b"ignored\n"
    );
    assert!(!fixture.root.join("new.txt").exists());
    assert_eq!(
        fixture.git(&["show", &format!("{}:file.txt", saved.oid)]),
        b"unstaged\n"
    );
    assert_eq!(
        fixture.git(&["show", &format!("{}^2:file.txt", saved.oid)]),
        b"staged\n"
    );
    assert!(String::from_utf8(index).unwrap().contains("file.txt"));
}

#[test]
fn brings_mixed_changes_and_preserves_unrelated_manual_stashes_and_index_contents() {
    let fixture = fixture();

    fixture.write("manual.txt", "manual\n");
    fixture.git(&["stash", "push", "-u", "-m", "Manual"]);
    let manual = fixture.git(&["rev-parse", "refs/stash"]);
    let repository = open(&fixture);
    let index = mixed(&fixture);
    let result = switch(&repository, "feature/ui", Some(BranchChanges::Bring)).unwrap();

    assert_eq!(
        result.snapshot.status.head.branch.as_deref(),
        Some("feature/ui")
    );
    assert_eq!(fixture.git(&["ls-files", "--stage"]), index);
    assert_eq!(
        fs::read(fixture.root.join("file.txt")).unwrap(),
        b"unstaged\n"
    );
    assert_eq!(
        fs::read(fixture.root.join("new.txt")).unwrap(),
        b"untracked\n"
    );
    assert_eq!(
        fs::read(fixture.root.join("keep.ignored")).unwrap(),
        b"ignored\n"
    );
    assert_eq!(fixture.git(&["stash", "list", "--format=%H"]), manual);
    assert!(result.saved_changes.is_none());
}

#[test]
fn discovers_and_restores_a_backup_after_reopening_and_stash_renumbering() {
    let fixture = fixture();

    fixture.write("manual.txt", "manual\n");
    fixture.git(&["stash", "push", "-u", "-m", "Manual"]);
    let manual = fixture.git(&["rev-parse", "refs/stash"]);
    let repository = open(&fixture);
    let index = mixed(&fixture);

    switch(&repository, "feature/ui", Some(BranchChanges::Leave)).unwrap();
    drop(repository);
    let repository = open(&fixture);
    let saved = repository.saved_branch_changes(None).unwrap().remove(0);

    fixture.write("manual-again.txt", "another\n");
    fixture.git(&["stash", "push", "-u", "-m", "Another manual"]);
    let another = fixture.git(&["rev-parse", "refs/stash"]);

    switch(&repository, "main", None).unwrap();
    repository
        .change_branch(
            &request(
                &repository,
                BranchAction::Restore {
                    branch: "main".into(),
                    oid: saved.oid,
                },
            ),
            None,
        )
        .unwrap();

    assert_eq!(fixture.git(&["ls-files", "--stage"]), index);
    assert_eq!(
        fs::read(fixture.root.join("file.txt")).unwrap(),
        b"unstaged\n"
    );
    assert_eq!(
        fs::read(fixture.root.join("new.txt")).unwrap(),
        b"untracked\n"
    );
    assert_eq!(
        fixture.git(&["stash", "list", "--format=%H"]),
        [another, manual].concat()
    );
}

#[test]
fn keeps_a_destination_owned_backup_and_real_conflicts_when_bring_cannot_apply() {
    let fixture = fixture();

    fixture.git(&["switch", "feature/ui"]);
    fixture.write("file.txt", "destination\n");
    fixture.git(&["commit", "-am", "Destination"]);
    fixture.git(&["switch", "main"]);
    fixture.write("file.txt", "my edits\n");
    let repository = open(&fixture);
    let error = switch(&repository, "feature/ui", Some(BranchChanges::Bring)).unwrap_err();

    assert!(error.to_string().contains("recovery backup"));
    assert_eq!(error.saved_changes.as_ref().unwrap().branch, "feature/ui");
    assert_eq!(fixture.git(&["branch", "--show-current"]), b"feature/ui\n");
    assert!(
        fixture
            .git(&["status", "--porcelain"])
            .starts_with(b"UU file.txt")
    );
    assert_eq!(repository.saved_branch_changes(None).unwrap().len(), 1);
    assert!(
        String::from_utf8(fixture.git(&["stash", "show", "-p", "stash@{0}"]))
            .unwrap()
            .contains("+my edits")
    );
}

#[test]
fn keeps_saved_work_after_a_checkout_hook_changes_the_destination_and_fails() {
    let fixture = fixture();
    let hooks = fixture.temporary.path().join("hooks");

    fs::create_dir(&hooks).unwrap();
    let hook = hooks.join("post-checkout");

    fs::write(
        &hook,
        b"#!/bin/sh\nprintf 'hook edit\\n' > hook.txt\nexit 1\n",
    )
    .unwrap();
    fs::set_permissions(hook, fs::Permissions::from_mode(0o700)).unwrap();
    let process = fixture
        .process()
        .with_environment([("GIT_CONFIG_VALUE_0".into(), hooks.into_os_string())]);

    let repository = Repository::open(&fixture.root, process, None).unwrap();

    fixture.write("file.txt", "my edits\n");
    let error = switch(&repository, "feature/ui", Some(BranchChanges::Bring)).unwrap_err();

    assert_eq!(error.failure.phase, WritePhase::Command);
    assert!(error.to_string().contains("safe in Stashes"));
    assert_eq!(fixture.git(&["branch", "--show-current"]), b"feature/ui\n");
    assert_eq!(
        fs::read(fixture.root.join("hook.txt")).unwrap(),
        b"hook edit\n"
    );
    assert!(
        String::from_utf8(fixture.git(&["stash", "show", "-p", "stash@{0}"]))
            .unwrap()
            .contains("+my edits")
    );
}

#[test]
fn rejects_missing_and_occupied_dirty_destinations_before_saving_anything() {
    let fixture = fixture();
    let linked = fixture.temporary.path().join("linked");

    fixture.git_os([
        "worktree".into(),
        "add".into(),
        linked.into_os_string(),
        "feature/ui".into(),
    ]);
    let repository = open(&fixture);

    mixed(&fixture);
    let before = files_under(&fixture.root);

    for destination in ["missing", "feature/ui", "main"] {
        assert_conflict(switch(&repository, destination, Some(BranchChanges::Leave)).unwrap_err());
    }

    assert_eq!(files_under(&fixture.root), before);
    assert!(repository.stashes(None).unwrap().is_empty());
}

#[test]
fn creates_exact_remote_tracking_destinations_and_brings_changes_without_network_access() {
    let fixture = fixture();
    let oid = String::from_utf8(fixture.git(&["rev-parse", "HEAD"])).unwrap();

    fixture.git_os([
        "remote".into(),
        "add".into(),
        "team".into(),
        fixture.root.as_os_str().to_owned(),
    ]);
    fixture.git(&["update-ref", "refs/remotes/team/nested/topic", oid.trim()]);
    let repository = open(&fixture);
    let index = mixed(&fixture);

    let mut request = request(
        &repository,
        BranchAction::Remote("refs/remotes/team/nested/topic".into()),
    );

    request.changes = Some(BranchChanges::Bring);
    let result = repository.change_branch(&request, None).unwrap();

    let branch = result
        .branches
        .branches
        .iter()
        .find(|branch| branch.name == "nested/topic" && branch.kind == BranchKind::Local)
        .unwrap();

    assert_eq!(branch.upstream_remote.as_deref(), Some("team"));
    assert_eq!(
        branch.upstream_ref.as_deref(),
        Some("refs/heads/nested/topic")
    );
    assert_eq!(fixture.git(&["ls-files", "--stage"]), index);
    assert!(repository.stashes(None).unwrap().is_empty());
}

#[test]
fn rejects_an_old_dialog_identity_even_after_the_workspace_itself_has_refreshed() {
    let fixture = fixture();
    let repository = open(&fixture);
    let original = BranchIdentity::from_snapshot(&repository.snapshot(false, None).unwrap());

    fixture.git(&["switch", "feature/ui"]);
    let mut request = request(&repository, BranchAction::Switch("main".into()));

    request.reviewed_source = Some(original);
    let before = files_under(&fixture.root);

    assert_conflict(repository.change_branch(&request, None).unwrap_err());

    assert_eq!(files_under(&fixture.root), before);
}

#[test]
fn never_restores_manual_other_branch_or_other_worktree_backups_or_overwrites_new_work() {
    let fixture = fixture();

    fixture.write("manual.txt", "manual\n");
    fixture.git(&["stash", "push", "-u", "-m", "Manual"]);
    let manual = String::from_utf8(fixture.git(&["rev-parse", "refs/stash"])).unwrap();
    let repository = open(&fixture);

    mixed(&fixture);
    let saved = switch(&repository, "feature/ui", Some(BranchChanges::Leave))
        .unwrap()
        .saved_changes
        .unwrap();

    for (branch, oid) in [
        ("feature/ui", saved.oid.clone()),
        ("feature/ui", manual.trim().into()),
    ] {
        let before = files_under(&fixture.root);

        assert_conflict(
            repository
                .change_branch(
                    &request(
                        &repository,
                        BranchAction::Restore {
                            branch: branch.into(),
                            oid,
                        },
                    ),
                    None,
                )
                .unwrap_err(),
        );
        assert_eq!(files_under(&fixture.root), before);
    }

    let linked = fixture.temporary.path().join("linked");

    fixture.git_os([
        "worktree".into(),
        "add".into(),
        linked.as_os_str().to_owned(),
        "main".into(),
    ]);
    let other = Repository::open(&linked, fixture.process(), None).unwrap();
    let before = files_under(&linked);

    assert_conflict(
        other
            .change_branch(
                &request(
                    &other,
                    BranchAction::Restore {
                        branch: "main".into(),
                        oid: saved.oid.clone(),
                    },
                ),
                None,
            )
            .unwrap_err(),
    );
    assert_eq!(files_under(&linked), before);
    fixture.git_os(["worktree".into(), "remove".into(), linked.into_os_string()]);
    switch(&repository, "main", None).unwrap();
    fixture.write("new-work.txt", "do not overwrite\n");
    let before = files_under(&fixture.root);

    assert_conflict(
        repository
            .change_branch(
                &request(
                    &repository,
                    BranchAction::Restore {
                        branch: "main".into(),
                        oid: saved.oid,
                    },
                ),
                None,
            )
            .unwrap_err(),
    );
    assert_eq!(files_under(&fixture.root), before);
}

#[test]
fn rejects_stale_heads_operation_markers_dirty_creation_and_unborn_saved_switches() {
    let fixture = fixture();
    let repository = open(&fixture);
    let mut stale = request(&repository, BranchAction::Switch("feature/ui".into()));

    stale.expected.oid = Some("0".repeat(40));
    assert_conflict(repository.change_branch(&stale, None).unwrap_err());

    for marker in ["MERGE_HEAD", "CHERRY_PICK_HEAD", "SQUASH_MSG"] {
        let marker = fixture.root.join(".git").join(marker);

        fs::write(&marker, fixture.git(&["rev-parse", "HEAD"])).unwrap();
        let before = files_under(&fixture.root);

        assert_conflict(switch(&repository, "feature/ui", None).unwrap_err());
        assert_eq!(files_under(&fixture.root), before);
        fs::remove_file(marker).unwrap();
    }

    mixed(&fixture);
    let before = files_under(&fixture.root);

    assert_conflict(
        repository
            .change_branch(
                &request(&repository, BranchAction::Create("new".into())),
                None,
            )
            .unwrap_err(),
    );
    assert_eq!(files_under(&fixture.root), before);
    fixture.git(&["symbolic-ref", "HEAD", "refs/heads/unborn"]);
    let error = switch(&repository, "feature/ui", Some(BranchChanges::Bring)).unwrap_err();

    assert!(error.to_string().contains("Commit the first changes"));
    assert!(repository.stashes(None).unwrap().is_empty());
}

#[test]
fn renames_and_deletes_only_reviewed_merged_unoccupied_local_tips_without_forcing() {
    let fixture = fixture();
    let repository = open(&fixture);

    let oid = repository
        .snapshot(false, None)
        .unwrap()
        .status
        .head
        .oid
        .unwrap();

    let rename = request(
        &repository,
        BranchAction::Rename {
            name: "feature/ui".into(),
            new_name: "renamed".into(),
            expected_target: oid.clone(),
        },
    );

    repository.change_branch(&rename, None).unwrap();
    let delete = request(
        &repository,
        BranchAction::Delete {
            name: "renamed".into(),
            expected_target: oid.clone(),
        },
    );

    repository.change_branch(&delete, None).unwrap();
    let current = request(
        &repository,
        BranchAction::Delete {
            name: "main".into(),
            expected_target: oid.clone(),
        },
    );

    assert_conflict(repository.change_branch(&current, None).unwrap_err());
    let stale = request(
        &repository,
        BranchAction::Rename {
            name: "main".into(),
            new_name: "bad".into(),
            expected_target: "0".repeat(40),
        },
    );

    assert_conflict(repository.change_branch(&stale, None).unwrap_err());
    let rename_current = request(
        &repository,
        BranchAction::Rename {
            name: "main".into(),
            new_name: "renamed-current".into(),
            expected_target: oid,
        },
    );

    assert_eq!(
        repository
            .change_branch(&rename_current, None)
            .unwrap()
            .snapshot
            .status
            .head
            .branch
            .as_deref(),
        Some("renamed-current")
    );
}

#[test]
fn primitive_force_behavior_is_explicit_and_default_paths_never_replace_refs_or_discard_work() {
    let fixture = fixture();
    let repository = open(&fixture);

    for name in ["", "-bad", "has space", "nul\0name", "feature/ui"] {
        let before = files_under(&fixture.root);

        assert!(
            repository
                .create_branch(CreateBranch::new(name), None)
                .is_err()
        );
        assert_eq!(files_under(&fixture.root), before);
    }

    fixture.git(&["switch", "feature/ui"]);
    fixture.write("file.txt", "destination\n");
    fixture.git(&["commit", "-am", "Destination"]);
    fixture.git(&["switch", "main"]);
    fixture.write("file.txt", "dirty\n");
    assert!(
        repository
            .checkout_branch("feature/ui", false, None)
            .is_err()
    );
    assert_eq!(fs::read(fixture.root.join("file.txt")).unwrap(), b"dirty\n");
    repository
        .checkout_branch("feature/ui", true, None)
        .unwrap();
    assert_eq!(
        fs::read(fixture.root.join("file.txt")).unwrap(),
        b"destination\n"
    );
    let destination = repository
        .snapshot(false, None)
        .unwrap()
        .status
        .head
        .oid
        .unwrap();

    repository.checkout_branch("main", false, None).unwrap();
    assert!(repository.delete_branch("feature/ui", false, None).is_err());
    repository.delete_branch("feature/ui", true, None).unwrap();
    repository
        .create_branch(CreateBranch::new("duplicate"), None)
        .unwrap();
    assert!(
        repository
            .rename_branch(Some("main"), "duplicate", false, None)
            .is_err()
    );
    repository
        .rename_branch(Some("main"), "duplicate", true, None)
        .unwrap();
    let options = CreateBranch {
        force: true,
        ..CreateBranch::new("without-checkout")
    };

    repository.create_branch(options, None).unwrap();
    repository.create_branch(options, None).unwrap();
    repository
        .rename_branch(Some(""), "renamed-empty-current", false, None)
        .unwrap();
    let empty_start = CreateBranch {
        start_point: Some(""),
        ..CreateBranch::new("empty-start")
    };

    repository.create_branch(empty_start, None).unwrap();
    let checkout = CreateBranch {
        checkout: true,
        start_point: Some(&destination),
        ..CreateBranch::new("without-checkout")
    };

    assert!(repository.create_branch(checkout, None).is_err());
    let result = repository
        .create_branch(
            CreateBranch {
                force: true,
                ..checkout
            },
            None,
        )
        .unwrap();

    assert_eq!(
        result.snapshot.status.head.oid.as_deref(),
        Some(destination.as_str())
    );
    assert_eq!(
        fs::read(fixture.root.join("file.txt")).unwrap(),
        b"destination\n"
    );
}

#[test]
fn cancellation_and_root_replacement_fail_before_branch_writes() {
    let fixture = fixture();
    let repository = open(&fixture);
    let cancellation = Cancellation::default();

    cancellation.cancel();
    let before = files_under(&fixture.root);
    let request = request(&repository, BranchAction::Create("new".into()));

    assert_eq!(
        repository
            .change_branch(&request, Some(&cancellation))
            .unwrap_err()
            .failure
            .phase,
        WritePhase::BeforeCommand
    );
    assert_eq!(files_under(&fixture.root), before);
    fs::rename(&fixture.root, fixture.temporary.path().join("moved")).unwrap();
    fs::create_dir(&fixture.root).unwrap();
    fs::write(fixture.root.join("replacement"), b"leave alone").unwrap();
    let before = files_under(&fixture.root);

    assert_eq!(
        repository
            .create_branch(CreateBranch::new("new"), None)
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
    assert_eq!(files_under(&fixture.root), before);
}

#[test]
fn reports_post_command_refresh_failure_without_replaying_or_undoing_a_created_branch() {
    let fixture = fixture();
    let marker = fixture.temporary.path().join("created");

    let process = wrapper(
        &fixture,
        r#"
case " $* " in
 *" switch "*) git "$@" || exit $?; : > "$ONEGIT_CREATED"; exit 0 ;;
 *" for-each-ref "*) if [ -f "$ONEGIT_CREATED" ]; then printf 'malformed'; exit 0; fi ;;
esac
exec git "$@""#,
    )
    .with_environment([("ONEGIT_CREATED".into(), marker.into_os_string())]);

    let repository = Repository::open(&fixture.root, process, None).unwrap();

    let error = repository
        .change_branch(
            &request(&repository, BranchAction::Create("created".into())),
            None,
        )
        .unwrap_err();

    assert_eq!(error.failure.phase, WritePhase::Refresh);
    assert!(matches!(
        error.failure.error,
        RepositoryError::InvalidOutput
    ));
    assert_eq!(fixture.git(&["branch", "--show-current"]), b"created\n");
}

#[test]
fn keeps_restored_backup_until_every_result_read_and_cleanup_succeeds() {
    for fail in ["status", "branches", "drop"] {
        let fixture = fixture();
        let repository = open(&fixture);

        mixed(&fixture);
        let saved = switch(&repository, "feature/ui", Some(BranchChanges::Leave))
            .unwrap()
            .saved_changes
            .unwrap();

        switch(&repository, "main", None).unwrap();
        let applied = fixture.temporary.path().join("applied");

        let process = wrapper(&fixture, r#"
case " $* " in
 *" stash apply "*) git "$@" || exit $?; : > "$ONEGIT_APPLIED"; exit 0 ;;
 *" status "*) if [ -f "$ONEGIT_APPLIED" ] && [ "$ONEGIT_FAIL" = status ]; then printf 'malformed\000'; exit 0; fi ;;
 *" for-each-ref "*) if [ -f "$ONEGIT_APPLIED" ] && [ "$ONEGIT_FAIL" = branches ]; then printf 'malformed'; exit 0; fi ;;
 *" stash drop "*) if [ "$ONEGIT_FAIL" = drop ]; then printf 'refusing cleanup' >&2; exit 1; fi ;;
esac
exec git "$@""#).with_environment([("ONEGIT_APPLIED".into(), applied.into_os_string()), ("ONEGIT_FAIL".into(), fail.into())]);

        let repository = Repository::open(&fixture.root, process, None).unwrap();

        let error = repository
            .change_branch(
                &request(
                    &repository,
                    BranchAction::Restore {
                        branch: "main".into(),
                        oid: saved.oid.clone(),
                    },
                ),
                None,
            )
            .unwrap_err();

        assert!(error.to_string().contains("backup"));
        assert!(
            fixture
                .git(&["stash", "list", "--format=%H"])
                .starts_with(saved.oid.as_bytes())
        );
        assert_eq!(
            fs::read(fixture.root.join("file.txt")).unwrap(),
            b"unstaged\n"
        );
    }
}

#[test]
fn re_resolves_only_the_immutable_backup_after_another_stash_moves_its_selector() {
    let fixture = fixture();

    fixture.write("manual.txt", "manual\n");
    fixture.git(&["stash", "push", "-u", "-m", "Manual"]);
    let manual = String::from_utf8(fixture.git(&["rev-parse", "refs/stash"])).unwrap();
    let repository = open(&fixture);

    mixed(&fixture);
    let saved = switch(&repository, "feature/ui", Some(BranchChanges::Leave))
        .unwrap()
        .saved_changes
        .unwrap();

    switch(&repository, "main", None).unwrap();
    let process = wrapper(&fixture, r#"
case " $* " in
 *" stash apply "*) git "$@" || exit $?; git stash store -m 'Another manual stash' "$ONEGIT_MANUAL"; exit $? ;;
esac
exec git "$@""#).with_environment([("ONEGIT_MANUAL".into(), manual.trim().into())]);

    let repository = Repository::open(&fixture.root, process, None).unwrap();

    repository
        .change_branch(
            &request(
                &repository,
                BranchAction::Restore {
                    branch: "main".into(),
                    oid: saved.oid,
                },
            ),
            None,
        )
        .unwrap();
    assert_eq!(
        fixture.git(&["stash", "list", "--format=%H"]),
        manual.repeat(2).as_bytes()
    );
}

fn wait_until(predicate: impl Fn() -> bool) {
    let until = Instant::now() + Duration::from_secs(5);

    while !predicate() {
        assert!(Instant::now() < until, "branch coordination timed out");
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn holds_the_common_directory_queue_through_backup_switch_restore_cleanup_and_refresh() {
    let fixture = fixture();
    let linked = fixture.temporary.path().join("linked");

    fixture.git_os([
        "worktree".into(),
        "add".into(),
        "-b".into(),
        "linked".into(),
        linked.as_os_str().to_owned(),
    ]);
    let entered = fixture.temporary.path().join("entered");
    let release = fixture.temporary.path().join("release");
    let log = fixture.temporary.path().join("order");

    let process = wrapper(&fixture, r#"
case " $* " in
 *" switch "*)
  if [ "$ONEGIT_TAG" = A ]; then
   git "$@" || exit $?; : > "$ONEGIT_ENTERED"; count=0
   while [ ! -f "$ONEGIT_RELEASE" ]; do count=$((count + 1)); [ "$count" -lt 1000 ] || exit 90; sleep 0.01; done
   exit 0
  fi ;;
 *" stash apply "*) printf 'apply\n' >> "$ONEGIT_LOG" ;;
 *" stash drop "*) printf 'drop\n' >> "$ONEGIT_LOG" ;;
 *" add "*) if [ "$ONEGIT_TAG" = B ]; then printf 'B\n' >> "$ONEGIT_LOG"; fi ;;
esac
exec git "$@""#).with_environment([
        ("ONEGIT_ENTERED".into(), entered.as_os_str().to_owned()),
        ("ONEGIT_RELEASE".into(), release.as_os_str().to_owned()),
        ("ONEGIT_LOG".into(), log.as_os_str().to_owned()),
    ]);

    let coordinator = RepositoryCoordinator::default();

    let first = Arc::new(
        coordinator
            .open(
                &fixture.root,
                process
                    .clone()
                    .with_environment([("ONEGIT_TAG".into(), "A".into())]),
                None,
            )
            .unwrap(),
    );

    let second = coordinator
        .open(
            &linked,
            process.with_environment([("ONEGIT_TAG".into(), "B".into())]),
            None,
        )
        .unwrap();

    mixed(&fixture);
    fs::write(linked.join("linked-new"), b"linked\n").unwrap();
    let mut request = request(&first, BranchAction::Switch("feature/ui".into()));

    request.changes = Some(BranchChanges::Bring);
    let common = first.info().common_directory.clone();

    std::thread::scope(|scope| {
        let a = scope.spawn(|| first.change_branch(&request, None));

        wait_until(|| entered.exists());
        let b = scope.spawn(|| second.stage_all(None));

        wait_until(|| coordinator.pending_writes(&common) == 2);
        let (sent, received) = mpsc::channel();
        let reader = Arc::clone(&first);
        let read = scope.spawn(move || sent.send(reader.saved_branch_changes(None)).unwrap());

        assert!(received.recv_timeout(Duration::from_millis(100)).is_err());
        assert!(!log.exists());
        fs::write(release, b"continue").unwrap();
        a.join().unwrap().unwrap();
        b.join().unwrap().unwrap();
        assert!(
            received
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .unwrap()
                .is_empty()
        );
        read.join().unwrap();
    });
    assert_eq!(fs::read_to_string(log).unwrap(), "apply\ndrop\nB\n");
    assert_eq!(coordinator.pending_writes(&common), 0);
    assert!(
        second
            .snapshot(false, None)
            .unwrap()
            .status
            .files
            .iter()
            .any(|file| file.index_status == FileStatus::Added)
    );
}
