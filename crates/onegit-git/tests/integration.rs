//! Covers: public merge/rebase options, reviewed tips/history guards and operation recovery.
//! Real: isolated Git repositories, related worktrees, refs, index/files, hooks and restart.
//! Doubles: bounded wrappers in uncertainty/coordination cases; no network or user data.
//! Requires: POSIX Git and temporary storage. Native UI and real signing remain separate.

mod common;

use common::{Fixture, files_under};

use onegit_git::{
    BranchIdentity, Cancellation, FastForward, FinishKind, FinishOperation, GitCommand,
    IntegrationKind, IntegrationRequest, MergeOptions, OperationState, RebaseOptions, Repository,
    WritePhase,
};
#[cfg(unix)]
use onegit_git::{GitProcess, RepositoryCoordinator};

#[cfg(unix)]
use common::PermissionsExt;
use std::fs;
#[cfg(unix)]
use std::time::{Duration, Instant};

#[cfg(unix)]
fn wrapped_process(fixture: &Fixture, body: &str) -> GitProcess {
    let path = fixture.temporary.path().join("git-wrapper");

    fs::write(&path, format!("#!/bin/sh\n{body}\nexec git \"$@\"\n")).unwrap();
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
    ])
}

#[cfg(unix)]
fn wait_file(path: &std::path::Path) {
    let deadline = Instant::now() + Duration::from_secs(5);

    while !path.exists() {
        assert!(
            Instant::now() < deadline,
            "missing bounded wrapper signal: {path:?}"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn fixture() -> (Fixture, Repository) {
    let fixture = Fixture::new();

    fixture.write("shared", "base\n");
    fixture.commit("Base");
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    (fixture, repository)
}

fn text(fixture: &Fixture, args: &[&str]) -> String {
    String::from_utf8(fixture.git(args))
        .unwrap()
        .trim_end()
        .into()
}

fn diverge(fixture: &Fixture, conflict: bool) {
    fixture.git(&["switch", "-c", "topic"]);
    fixture.write(if conflict { "shared" } else { "topic" }, "topic\n");
    fixture.commit("Topic");
    fixture.git(&["switch", "main"]);
    fixture.write(if conflict { "shared" } else { "main" }, "main\n");
    fixture.commit("Main");
}

fn review(repository: &Repository, kind: IntegrationKind) -> IntegrationRequest {
    let snapshot = repository.snapshot(false, None).unwrap();
    let branches = repository.branches(None).unwrap();

    IntegrationRequest {
        kind,
        target: "refs/heads/topic".into(),
        expected_target: branches
            .branches
            .iter()
            .find(|branch| branch.full_name == "refs/heads/topic")
            .unwrap()
            .oid
            .clone(),
        expected: BranchIdentity::from_snapshot(&snapshot),
        reviewed_source: None,
        message: Some("Combined work\n\nReviewed details".into()),
    }
}

fn paused(repository: &Repository, kind: FinishKind) -> FinishOperation {
    let snapshot = repository.snapshot(false, None).unwrap();

    assert_ne!(snapshot.operation, OperationState::Normal);

    FinishOperation {
        kind,
        operation: snapshot.operation,
        expected: BranchIdentity::from_snapshot(&snapshot),
        token: snapshot.operation_token.unwrap(),
    }
}

#[test]
fn preserves_lower_merge_fast_forward_message_and_squash_options() {
    for policy in [FastForward::Allow, FastForward::Only, FastForward::Prevent] {
        let (fixture, repository) = fixture();

        fixture.git(&["switch", "-c", "topic"]);
        fixture.write("topic", "topic\n");
        fixture.commit("Topic");
        let target = text(&fixture, &["rev-parse", "HEAD"]);

        fixture.git(&["switch", "main"]);
        let original = text(&fixture, &["rev-parse", "HEAD"]);

        let snapshot = repository
            .merge(
                MergeOptions {
                    fast_forward: policy,
                    message: Some("Reviewed literal $(no-shell)\n\nDetails"),
                    ..MergeOptions::new("topic")
                },
                None,
            )
            .unwrap();

        assert_eq!(snapshot.status.head.branch.as_deref(), Some("main"));

        if policy == FastForward::Prevent {
            assert_eq!(
                text(&fixture, &["show", "-s", "--format=%P"]),
                format!("{original} {target}")
            );
            assert_eq!(
                text(&fixture, &["log", "-1", "--format=%B"]),
                "Reviewed literal $(no-shell)\n\nDetails"
            );
        } else {
            assert_eq!(snapshot.status.head.oid.as_deref(), Some(target.as_str()));
        }

        assert_eq!(text(&fixture, &["rev-parse", "topic"]), target);
    }

    let (fixture, repository) = fixture();

    diverge(&fixture, false);
    let before = text(&fixture, &["rev-parse", "HEAD"]);

    assert_eq!(
        repository
            .merge(
                MergeOptions {
                    fast_forward: FastForward::Only,
                    ..MergeOptions::new("topic")
                },
                None
            )
            .unwrap_err()
            .phase,
        WritePhase::Command
    );
    assert_eq!(text(&fixture, &["rev-parse", "HEAD"]), before);
    let result = repository
        .merge(
            MergeOptions {
                squash: true,
                ..MergeOptions::new("topic")
            },
            None,
        )
        .unwrap();

    assert_eq!(result.operation, OperationState::SquashMerge);
    assert_eq!(result.status.head.oid.as_deref(), Some(before.as_str()));
    assert!(
        result
            .status
            .files
            .iter()
            .any(|file| file.path.to_str() == Some("topic"))
    );
    assert_eq!(
        repository
            .finish_operation(&paused(&repository, FinishKind::Continue), None)
            .unwrap()
            .operation,
        OperationState::Normal
    );
    assert_eq!(text(&fixture, &["show", "-s", "--format=%P"]), before);
}

#[test]
fn preserves_lower_rebase_onto_branch_and_autosquash_options() {
    let (fixture, repository) = fixture();

    fixture.git(&["switch", "-c", "upstream"]);
    fixture.write("upstream", "upstream\n");
    fixture.commit("Upstream");
    fixture.git(&["switch", "-c", "topic"]);
    fixture.write("topic", "topic\n");
    fixture.commit("Topic");
    fixture.git(&["switch", "main"]);
    fixture.write("main", "main\n");
    fixture.commit("Main");
    let base = text(&fixture, &["rev-parse", "HEAD"]);

    let result = repository
        .rebase(
            RebaseOptions {
                upstream: "upstream",
                onto: Some("main"),
                branch: Some("topic"),
                autosquash: true,
            },
            None,
        )
        .unwrap();

    assert_eq!(result.status.head.branch.as_deref(), Some("topic"));
    assert_eq!(text(&fixture, &["rev-parse", "HEAD^"]), base);
    assert_eq!(text(&fixture, &["log", "-1", "--format=%s"]), "Topic");
    assert!(!fixture.root.join("upstream").exists());
    assert_eq!(fs::read(fixture.root.join("topic")).unwrap(), b"topic\n");
}

#[test]
fn reviewed_integrations_preserve_target_worktree_and_rebase_recovery_ref() {
    let recovery_ref = regex::Regex::new(r"^refs/1git/rebase/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} [0-9a-f]{40}$").unwrap();

    for kind in [
        IntegrationKind::Merge,
        IntegrationKind::SquashMerge,
        IntegrationKind::Rebase,
    ] {
        let (fixture, repository) = fixture();

        diverge(&fixture, false);
        let request = review(&repository, kind);

        fixture.git(&["branch", "sibling"]);
        fixture.git(&["config", "rebase.updateRefs", "true"]);
        let linked = fixture.temporary.path().join("linked");

        fixture.git_os([
            "worktree".into(),
            "add".into(),
            linked.as_os_str().to_owned(),
            "topic".into(),
        ]);
        let result = repository.integrate_branch(&request, None).unwrap();

        assert_eq!(result.snapshot.operation, OperationState::Normal);
        assert_eq!(result.snapshot.status.head.branch.as_deref(), Some("main"));
        assert!(result.snapshot.status.files.is_empty());
        assert_eq!(
            text(&fixture, &["rev-parse", "topic"]),
            request.expected_target
        );
        assert_eq!(
            text(&fixture, &["rev-parse", "sibling"]),
            request.expected.oid.as_deref().unwrap()
        );
        assert_eq!(fs::read(linked.join("topic")).unwrap(), b"topic\n");
        assert_eq!(fs::read(fixture.root.join("main")).unwrap(), b"main\n");
        assert_eq!(fs::read(fixture.root.join("topic")).unwrap(), b"topic\n");
        let parents = text(&fixture, &["show", "-s", "--format=%P"]);

        match kind {
            IntegrationKind::Merge => assert_eq!(
                parents,
                format!(
                    "{} {}",
                    request.expected.oid.as_ref().unwrap(),
                    request.expected_target
                )
            ),
            IntegrationKind::SquashMerge => {
                assert_eq!(parents, request.expected.oid.as_deref().unwrap());
                assert_eq!(
                    text(&fixture, &["log", "-1", "--format=%B"]),
                    request.message.as_deref().unwrap()
                );
            }
            IntegrationKind::Rebase => {
                assert_eq!(parents, request.expected_target);
                assert_eq!(text(&fixture, &["log", "-1", "--format=%s"]), "Main");
                let refs = text(
                    &fixture,
                    &[
                        "for-each-ref",
                        "--format=%(refname) %(objectname)",
                        "refs/1git/rebase/",
                    ],
                );

                assert!(recovery_ref.is_match(&refs));
                assert!(refs.ends_with(request.expected.oid.as_deref().unwrap()));
            }
        }
    }
}

#[test]
fn reviewed_conflicts_continue_or_abort_after_restart_without_staging_implicitly() {
    for kind in [
        IntegrationKind::Merge,
        IntegrationKind::SquashMerge,
        IntegrationKind::Rebase,
    ] {
        for action in [FinishKind::Continue, FinishKind::Abort] {
            let (fixture, repository) = fixture();

            diverge(&fixture, true);
            let request = review(&repository, kind);

            assert_eq!(
                repository
                    .integrate_branch(&request, None)
                    .unwrap_err()
                    .phase,
                WritePhase::Command
            );
            let reopened = Repository::open(&fixture.root, fixture.process(), None).unwrap();
            let intent = paused(&reopened, action);
            let mut stale = intent.clone();

            stale.token = "stale".into();
            assert_eq!(
                reopened.finish_operation(&stale, None).unwrap_err().phase,
                WritePhase::BeforeCommand
            );
            fixture.write("keep", "untracked stays\n");

            if action == FinishKind::Continue {
                assert_eq!(
                    reopened.finish_operation(&intent, None).unwrap_err().phase,
                    WritePhase::BeforeCommand
                );
                fixture.write("shared", "resolved\n");
                fixture.git(&["add", "shared"]);
                fixture.write("shared", "unstaged edit\n");
                let index = fixture.git(&["show", ":shared"]);

                assert_eq!(
                    reopened.finish_operation(&intent, None).unwrap_err().phase,
                    WritePhase::BeforeCommand
                );
                assert_eq!(fixture.git(&["show", ":shared"]), index);
                assert_eq!(
                    fs::read(fixture.root.join("shared")).unwrap(),
                    b"unstaged edit\n"
                );
                fixture.write("shared", "resolved\n");
            }

            let result = reopened.finish_operation(&intent, None).unwrap();

            assert_eq!(result.operation, OperationState::Normal);
            assert_eq!(result.status.head.branch.as_deref(), Some("main"));
            assert_eq!(
                fs::read(fixture.root.join("keep")).unwrap(),
                b"untracked stays\n"
            );
            assert_eq!(
                text(&fixture, &["rev-parse", "topic"]),
                request.expected_target
            );

            if action == FinishKind::Abort {
                assert_eq!(result.status.head.oid, request.expected.oid);
                assert_eq!(fs::read(fixture.root.join("shared")).unwrap(), b"main\n");
            } else {
                assert_eq!(text(&fixture, &["show", "HEAD:shared"]), "resolved");

                if kind == IntegrationKind::SquashMerge {
                    assert_eq!(
                        text(&fixture, &["log", "-1", "--format=%B"]),
                        request.message.as_deref().unwrap()
                    );
                }
            }
        }
    }
}

#[test]
fn refuses_dirty_detached_stale_and_same_branch_reviews_without_discarding_work() {
    for kind in [
        IntegrationKind::Merge,
        IntegrationKind::SquashMerge,
        IntegrationKind::Rebase,
    ] {
        let (fixture, repository) = fixture();

        diverge(&fixture, false);
        let request = review(&repository, kind);
        let untouched = files_under(&fixture.root);

        for change in 0..4 {
            let mut stale = request.clone();

            match change {
                0 => stale.expected.oid = Some("0".repeat(40)),
                1 => stale.expected_target = "0".repeat(40),
                2 => {
                    stale.target = "refs/heads/main".into();
                    stale.expected_target = request.expected.oid.clone().unwrap();
                }
                _ => {
                    stale.reviewed_source = Some(BranchIdentity {
                        oid: Some("0".repeat(40)),
                        branch: Some("main".into()),
                    });
                }
            }

            assert_eq!(
                repository.integrate_branch(&stale, None).unwrap_err().phase,
                WritePhase::BeforeCommand
            );
        }

        assert_eq!(files_under(&fixture.root), untouched);
        fixture.write("keep", "working\n");
        assert_eq!(
            repository
                .integrate_branch(&request, None)
                .unwrap_err()
                .phase,
            WritePhase::BeforeCommand
        );
        fixture.git(&["add", "keep"]);
        fixture.write("keep", "mixed\n");
        let index = fixture.git(&["ls-files", "--stage"]);

        assert_eq!(
            repository
                .integrate_branch(&request, None)
                .unwrap_err()
                .phase,
            WritePhase::BeforeCommand
        );
        assert_eq!(fixture.git(&["ls-files", "--stage"]), index);
        assert_eq!(fs::read(fixture.root.join("keep")).unwrap(), b"mixed\n");
        fixture.git(&["reset", "--", "keep"]);
        fs::remove_file(fixture.root.join("keep")).unwrap();
        fixture.git(&["switch", "--detach"]);
        let mut detached = request.clone();

        detached.expected =
            BranchIdentity::from_snapshot(&repository.snapshot(false, None).unwrap());
        assert_eq!(
            repository
                .integrate_branch(&detached, None)
                .unwrap_err()
                .phase,
            WritePhase::BeforeCommand
        );
        assert_eq!(
            text(&fixture, &["rev-parse", "HEAD"]),
            request.expected.oid.as_deref().unwrap()
        );
        assert!(text(&fixture, &["for-each-ref", "refs/1git/rebase/"]).is_empty());
    }
}

#[test]
fn refuses_published_ancestors_and_merge_history_before_creating_backup_refs() {
    for published in [true, false] {
        let (fixture, repository) = fixture();

        diverge(&fixture, false);

        if published {
            fixture.git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);
            fixture.write("later", "later\n");
            fixture.commit("Unpublished later commit");
        } else {
            fixture.git(&["switch", "-c", "other"]);
            fixture.write("other", "other\n");
            fixture.commit("Other");
            fixture.git(&["switch", "main"]);
            fixture.git(&["merge", "--no-ff", "other", "-m", "Merge"]);
        }

        let request = review(&repository, IntegrationKind::Rebase);
        let error = repository.integrate_branch(&request, None).unwrap_err();

        assert_eq!(error.phase, WritePhase::BeforeCommand);
        assert!(error.to_string().contains(if published {
            "published"
        } else {
            "merge commits"
        }));
        assert_eq!(
            text(&fixture, &["rev-parse", "HEAD"]),
            request.expected.oid.as_deref().unwrap()
        );
        assert!(text(&fixture, &["for-each-ref", "refs/1git/rebase/"]).is_empty());
    }
}

#[test]
#[cfg(unix)]
fn hook_failure_preserves_staged_squash_and_reviewed_message_for_explicit_continue() {
    let (fixture, _) = fixture();

    diverge(&fixture, false);
    let hook = fixture.root.join(".git/hooks/commit-msg");

    fs::write(&hook, b"#!/bin/sh\nexit 1\n").unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o700)).unwrap();
    let process = fixture
        .process()
        .with_environment([("GIT_CONFIG_VALUE_0".into(), ".git/hooks".into())]);

    let repository = Repository::open(&fixture.root, process, None).unwrap();
    let request = review(&repository, IntegrationKind::SquashMerge);

    let error = repository.integrate_branch(&request, None).unwrap_err();

    assert_eq!(error.phase, WritePhase::Command);
    assert_eq!(
        text(&fixture, &["rev-parse", "HEAD"]),
        request.expected.oid.as_deref().unwrap()
    );
    assert_eq!(
        fs::read_to_string(fixture.root.join(".git/SQUASH_MSG")).unwrap(),
        request.message.clone().unwrap() + "\n"
    );
    let intent = paused(&repository, FinishKind::Continue);

    fs::remove_file(hook).unwrap();
    let result = repository.finish_operation(&intent, None).unwrap();

    assert_eq!(result.operation, OperationState::Normal);
    assert_eq!(
        text(&fixture, &["log", "-1", "--format=%B"]),
        request.message.unwrap()
    );
}

#[test]
fn included_squash_is_a_noop_and_invalid_inputs_or_cancellation_never_start_a_write() {
    let (fixture, repository) = fixture();

    fixture.git(&["branch", "topic"]);
    let request = review(&repository, IntegrationKind::SquashMerge);

    assert_eq!(
        repository
            .integrate_branch(&request, None)
            .unwrap()
            .snapshot
            .status
            .head
            .oid,
        request.expected.oid
    );

    for message in [
        "",
        "\nDetails",
        " \nDetails",
        "\u{feff}\nDetails",
        "message\0hidden",
    ] {
        let mut invalid = request.clone();

        invalid.message = Some(message.into());
        assert_eq!(
            repository
                .integrate_branch(&invalid, None)
                .unwrap_err()
                .phase,
            WritePhase::BeforeCommand
        );
    }

    let mut nel = request.clone();

    nel.message = Some("\u{85}".into());
    assert!(repository.integrate_branch(&nel, None).is_ok());

    for revision in ["", "--abort", "HEAD\0hidden"] {
        assert_eq!(
            repository
                .merge(MergeOptions::new(revision), None)
                .unwrap_err()
                .phase,
            WritePhase::BeforeCommand
        );
        assert_eq!(
            repository
                .rebase(RebaseOptions::new(revision), None)
                .unwrap_err()
                .phase,
            WritePhase::BeforeCommand
        );
    }

    let cancel = Cancellation::default();

    cancel.cancel();
    assert_eq!(
        repository
            .integrate_branch(&request, Some(&cancel))
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
    assert_eq!(
        text(&fixture, &["rev-parse", "HEAD"]),
        request.expected.oid.unwrap()
    );
    assert!(text(&fixture, &["status", "--porcelain"]).is_empty());
}

#[test]
fn reviewed_integrations_preserve_ignored_destination_collisions() {
    for kind in [
        IntegrationKind::Merge,
        IntegrationKind::SquashMerge,
        IntegrationKind::Rebase,
    ] {
        for name in [
            "collision",
            common::filename("collision\nété [literal]", "collision été [literal]"),
        ] {
            let (fixture, repository) = fixture();

            fixture.write(".gitignore", "collision*\n");
            fixture.commit("Ignore local file");
            fixture.git(&["switch", "-c", "topic"]);
            fixture.write(name, "tracked target\n");
            fixture.git(&["add", "-f", "--", name]);
            fixture.git(&["commit", "-m", "Target file"]);
            fixture.git(&["switch", "main"]);
            fixture.write(name, "local ignored work\n");
            let request = review(&repository, kind);
            let result = repository.integrate_branch(&request, None);

            assert_eq!(
                result.unwrap_err().phase,
                WritePhase::BeforeCommand,
                "{kind:?} {name:?}"
            );
            assert_eq!(
                fs::read(fixture.root.join(name)).unwrap(),
                b"local ignored work\n"
            );
            assert_eq!(
                text(&fixture, &["rev-parse", "HEAD"]),
                request.expected.oid.unwrap()
            );
        }
    }
}

#[test]
fn rebase_refuses_ignored_directory_parent_file_and_symlink_collisions() {
    for case in 0..3 {
        let (fixture, repository) = fixture();

        fixture.write(
            ".gitignore",
            if case == 0 {
                "collision/inside\n"
            } else {
                "collision*\n"
            },
        );
        fixture.commit("Ignore local work");
        fixture.git(&["switch", "-c", "topic"]);
        let target = if case == 1 {
            fs::create_dir(fixture.root.join("collision")).unwrap();

            "collision/child"
        } else {
            "collision"
        };

        fixture.write(target, "tracked target\n");
        fixture.git(&["add", "-f", "--", target]);
        fixture.git(&["commit", "-m", "Target file"]);
        fixture.git(&["switch", "main"]);
        let outside = fixture.temporary.path().join("outside");

        fs::write(&outside, b"outside preserved\n").unwrap();

        match case {
            0 => {
                fs::create_dir(fixture.root.join("collision")).unwrap();
                fixture.write("collision/inside", "local work\n");
            }
            1 => fixture.write("collision", "local work\n"),
            _ => common::symlink(&outside, fixture.root.join("collision")).unwrap(),
        }

        let request = review(&repository, IntegrationKind::Rebase);

        assert_eq!(
            repository
                .integrate_branch(&request, None)
                .unwrap_err()
                .phase,
            WritePhase::BeforeCommand
        );
        assert_eq!(
            text(&fixture, &["rev-parse", "HEAD"]),
            request.expected.oid.unwrap()
        );
        assert!(text(&fixture, &["for-each-ref", "refs/1git/rebase/"]).is_empty());
        assert_eq!(fs::read(outside).unwrap(), b"outside preserved\n");

        if case == 2 {
            assert!(
                fs::symlink_metadata(fixture.root.join("collision"))
                    .unwrap()
                    .is_symlink()
            );
        } else {
            assert_eq!(
                fs::read(fixture.root.join(if case == 0 {
                    "collision/inside"
                } else {
                    "collision"
                }))
                .unwrap(),
                b"local work\n"
            );
        }
    }
}

#[test]
fn rebase_checks_replayed_paths_absent_from_both_final_trees_and_preserves_unrelated_ignored_files()
{
    let (fixture, repository) = fixture();

    fixture.write(".gitignore", "collision\nunrelated\n");
    fixture.commit("Ignore local work");
    fixture.git(&["branch", "topic"]);
    fixture.write("collision", "historical\n");
    fixture.git(&["add", "-f", "collision"]);
    fixture.git(&["commit", "-m", "Add historical path"]);
    fixture.git(&["rm", "collision"]);
    fixture.git(&["commit", "-m", "Remove historical path"]);
    fixture.git(&["switch", "topic"]);
    fixture.write("topic", "topic\n");
    fixture.commit("Topic");
    fixture.git(&["switch", "main"]);
    fixture.write("collision", "local ignored work\n");
    fixture.write("unrelated", "keep\n");
    let request = review(&repository, IntegrationKind::Rebase);

    assert_eq!(
        repository
            .integrate_branch(&request, None)
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
    assert_eq!(
        fs::read(fixture.root.join("collision")).unwrap(),
        b"local ignored work\n"
    );
    assert!(text(&fixture, &["for-each-ref", "refs/1git/rebase/"]).is_empty());
    fs::remove_file(fixture.root.join("collision")).unwrap();
    repository.integrate_branch(&request, None).unwrap();
    assert_eq!(fs::read(fixture.root.join("unrelated")).unwrap(), b"keep\n");
}

#[test]
fn lower_merge_and_rebase_recovery_methods_keep_ordinary_continue_abort_and_skip_semantics() {
    for rebase in [false, true] {
        for action in 0..if rebase { 3 } else { 2 } {
            let (fixture, repository) = fixture();

            diverge(&fixture, true);
            let before = text(&fixture, &["rev-parse", "HEAD"]);
            let target = text(&fixture, &["rev-parse", "topic"]);

            let failed = if rebase {
                repository.rebase(RebaseOptions::new("topic"), None)
            } else {
                repository.merge(MergeOptions::new("topic"), None)
            };

            assert_eq!(failed.unwrap_err().phase, WritePhase::Command);
            let result = match (rebase, action) {
                (_, 0) => {
                    fixture.write("shared", "resolved\n");
                    fixture.git(&["add", "shared"]);

                    if rebase {
                        repository.continue_rebase(None)
                    } else {
                        repository.continue_merge(None)
                    }
                }
                (true, 1) => repository.abort_rebase(None),
                (false, 1) => repository.abort_merge(None),
                (true, 2) => repository.skip_rebase(None),
                _ => unreachable!(),
            }
            .unwrap();

            assert_eq!(result.operation, OperationState::Normal);
            assert_eq!(result.status.head.branch.as_deref(), Some("main"));
            assert_eq!(text(&fixture, &["rev-parse", "topic"]), target);

            if action == 1 {
                assert_eq!(result.status.head.oid.as_deref(), Some(before.as_str()));
            }

            if action == 2 {
                assert_eq!(result.status.head.oid.as_deref(), Some(target.as_str()));
            }
        }
    }
}

#[test]
fn reviewed_finish_recovers_external_cherry_pick_and_revert_and_refuses_changed_markers() {
    for revert in [false, true] {
        for action in [FinishKind::Continue, FinishKind::Abort] {
            let (fixture, repository) = fixture();

            let revision = if revert {
                fixture.write("shared", "topic\n");
                fixture.commit("Edit");
                let revision = text(&fixture, &["rev-parse", "HEAD"]);

                fixture.write("shared", "main\n");
                fixture.commit("Later");

                revision
            } else {
                diverge(&fixture, true);

                text(&fixture, &["rev-parse", "topic"])
            };

            let before = text(&fixture, &["rev-parse", "HEAD"]);

            assert!(
                fixture
                    .process()
                    .run(GitCommand::new(
                        &fixture.root,
                        [if revert { "revert" } else { "cherry-pick" }, &revision]
                    ))
                    .is_err()
            );
            let intent = paused(&repository, action);

            assert_eq!(
                intent.operation,
                if revert {
                    OperationState::Revert
                } else {
                    OperationState::CherryPick
                }
            );
            let marker = fixture.root.join(if revert {
                ".git/REVERT_HEAD"
            } else {
                ".git/CHERRY_PICK_HEAD"
            });

            let bytes = fs::read(&marker).unwrap();
            let mut changed = bytes.clone();

            changed.push(b'\n');
            fs::write(&marker, changed).unwrap();
            assert_eq!(
                repository
                    .finish_operation(&intent, None)
                    .unwrap_err()
                    .phase,
                WritePhase::BeforeCommand
            );
            fs::write(marker, bytes).unwrap();

            if action == FinishKind::Continue {
                fixture.write("shared", "resolved\n");
                fixture.git(&["add", "shared"]);
            }

            let result = repository
                .finish_operation(&paused(&repository, action), None)
                .unwrap();

            assert_eq!(result.operation, OperationState::Normal);

            if action == FinishKind::Abort {
                assert_eq!(result.status.head.oid.as_deref(), Some(before.as_str()));
                assert_eq!(fs::read(fixture.root.join("shared")).unwrap(), b"main\n");
            } else {
                assert_eq!(text(&fixture, &["show", "HEAD:shared"]), "resolved");
            }
        }
    }
}

#[test]
#[cfg(unix)]
fn integration_never_follows_a_target_ref_that_moves_after_review() {
    for kind in [
        IntegrationKind::Merge,
        IntegrationKind::SquashMerge,
        IntegrationKind::Rebase,
    ] {
        let (fixture, repository) = fixture();

        diverge(&fixture, false);
        let request = review(&repository, kind);

        fixture.git(&["switch", "topic"]);
        fixture.write("advanced", "not reviewed\n");
        fixture.commit("Advanced target");
        let advanced = text(&fixture, &["rev-parse", "HEAD"]);

        fixture.git(&["switch", "main"]);
        fixture.git(&["update-ref", "refs/heads/topic", &request.expected_target]);
        let process = wrapped_process(
            &fixture,
            &format!(
                "case \" $* \" in *\" merge \"*|*\" rebase \"*) git update-ref refs/heads/topic {advanced} || exit 87;; esac"
            ),
        );

        let repository = Repository::open(&fixture.root, process, None).unwrap();
        let result = repository.integrate_branch(&request, None).unwrap();

        assert_eq!(result.snapshot.operation, OperationState::Normal);
        assert!(!fixture.root.join("advanced").exists());
        assert_eq!(text(&fixture, &["rev-parse", "topic"]), advanced);
        assert_eq!(fs::read(fixture.root.join("topic")).unwrap(), b"topic\n");

        if kind == IntegrationKind::Rebase {
            assert_eq!(
                text(&fixture, &["rev-parse", "HEAD^"]),
                request.expected_target
            );
        }
    }
}

#[test]
#[cfg(unix)]
fn ambiguous_command_and_refresh_failures_are_not_replayed_or_cleaned_up() {
    for refresh in [false, true] {
        let (fixture, repository) = fixture();

        diverge(&fixture, false);
        let request = review(&repository, IntegrationKind::Merge);
        let counter = fixture.temporary.path().join("commands");
        let done = fixture.temporary.path().join("done");

        let body = format!(
            r#"if [ -f '{}' ]; then case " $* " in *" status "*) exit 88;; esac; fi
case " $* " in *" merge "*) printf 'merge\n' >> '{}'; git "$@" || exit $?; {}; exit {};; esac"#,
            done.display(),
            counter.display(),
            if refresh {
                format!(": > '{}'", done.display())
            } else {
                ":".into()
            },
            if refresh { 0 } else { 89 }
        );

        let repository =
            Repository::open(&fixture.root, wrapped_process(&fixture, &body), None).unwrap();

        let result = repository.integrate_branch(&request, None).unwrap_err();

        assert_eq!(
            result.phase,
            if refresh {
                WritePhase::Refresh
            } else {
                WritePhase::Command
            }
        );
        assert_eq!(fs::read(counter).unwrap(), b"merge\n");
        assert_eq!(
            text(&fixture, &["show", "-s", "--format=%P"]),
            format!(
                "{} {}",
                request.expected.oid.unwrap(),
                request.expected_target
            )
        );
        assert!(text(&fixture, &["status", "--porcelain"]).is_empty());
    }

    let (fixture, repository) = fixture();

    diverge(&fixture, false);
    let request = review(&repository, IntegrationKind::Rebase);

    let repository = Repository::open(
        &fixture.root,
        wrapped_process(&fixture, "case \" $* \" in *\" rebase \"*) exit 89;; esac"),
        None,
    )
    .unwrap();

    assert_eq!(
        repository
            .integrate_branch(&request, None)
            .unwrap_err()
            .phase,
        WritePhase::Command
    );
    assert_eq!(
        text(&fixture, &["rev-parse", "HEAD"]),
        request.expected.oid.as_deref().unwrap()
    );
    assert_eq!(
        text(
            &fixture,
            &[
                "for-each-ref",
                "--format=%(objectname)",
                "refs/1git/rebase/"
            ]
        ),
        request.expected.oid.unwrap()
    );
}

#[test]
#[cfg(unix)]
fn canceled_squash_still_retains_its_reviewed_message_for_restart_recovery() {
    let (fixture, repository) = fixture();

    diverge(&fixture, true);
    let request = review(&repository, IntegrationKind::SquashMerge);
    let entered = fixture.temporary.path().join("entered");

    let process = wrapped_process(
        &fixture,
        &format!(
            "case \" $* \" in *\" merge \"*) git \"$@\"; : > '{}'; exec sleep 30;; esac",
            entered.display()
        ),
    );

    let repository = Repository::open(&fixture.root, process, None).unwrap();
    let cancel = Cancellation::default();
    let worker_cancel = cancel.clone();
    let submitted = request.clone();

    let worker =
        std::thread::spawn(move || repository.integrate_branch(&submitted, Some(&worker_cancel)));

    wait_file(&entered);
    cancel.cancel();
    let result = worker.join().unwrap().unwrap_err();

    assert_eq!(result.phase, WritePhase::Command);
    assert!(result.to_string().contains("cancel"));
    let reopened = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    assert_eq!(
        reopened.snapshot(false, None).unwrap().operation,
        OperationState::SquashMerge
    );
    assert_eq!(
        fs::read_to_string(fixture.root.join(".git/SQUASH_MSG")).unwrap(),
        request.message.clone().unwrap() + "\n"
    );
    fixture.write("shared", "resolved\n");
    fixture.git(&["add", "shared"]);
    reopened
        .finish_operation(&paused(&reopened, FinishKind::Continue), None)
        .unwrap();
    assert_eq!(
        text(&fixture, &["log", "-1", "--format=%B"]),
        request.message.unwrap()
    );
}

#[test]
#[cfg(unix)]
fn related_worktree_writes_wait_through_integration_result_refresh() {
    let (fixture, _) = fixture();

    diverge(&fixture, false);
    let linked = fixture.temporary.path().join("linked");

    fixture.git_os([
        "worktree".into(),
        "add".into(),
        linked.as_os_str().to_owned(),
        "topic".into(),
    ]);
    fs::write(linked.join("later"), b"stage after refresh\n").unwrap();
    let after = fixture.temporary.path().join("after");
    let entered = fixture.temporary.path().join("refresh-entered");
    let release = fixture.temporary.path().join("release");
    let stage_started = fixture.temporary.path().join("stage-started");

    let body = format!(
        r#"if [ -f '{}' ] && [ ! -f '{}' ]; then case " $* " in *" status "*) : > '{}'; count=0; while [ ! -f '{}' ]; do count=$((count+1)); [ "$count" -lt 1000 ] || exit 91; sleep 0.01; done;; esac; fi
case " $* " in *" merge "*) git "$@" || exit $?; : > '{}'; exit 0;; *" add "*) : > '{}';; esac"#,
        after.display(),
        release.display(),
        entered.display(),
        release.display(),
        after.display(),
        stage_started.display()
    );

    let process = wrapped_process(&fixture, &body);
    let coordinator = RepositoryCoordinator::default();

    let primary = coordinator
        .open(&fixture.root, process.clone(), None)
        .unwrap();

    let related = coordinator.open(&linked, process, None).unwrap();
    let common = primary.info().common_directory.clone();
    let index_path = related.info().git_directory.join("index");
    let index = fs::read(&index_path).unwrap();
    let request = review(&primary, IntegrationKind::Merge);
    let first = std::thread::spawn(move || primary.integrate_branch(&request, None));

    wait_file(&entered);
    let second = std::thread::spawn(move || related.stage_all(None));
    let deadline = Instant::now() + Duration::from_secs(5);

    while coordinator.pending_writes(&common) != 2 {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }

    assert!(!stage_started.exists());
    assert_eq!(fs::read(index_path).unwrap(), index);
    fs::write(release, b"continue").unwrap();
    assert!(
        first
            .join()
            .unwrap()
            .unwrap()
            .snapshot
            .status
            .files
            .is_empty()
    );
    assert!(
        second
            .join()
            .unwrap()
            .unwrap()
            .status
            .files
            .iter()
            .any(|file| file.path.to_str() == Some("later")
                && file.index_status == onegit_git::FileStatus::Added)
    );
    assert!(stage_started.exists());
    assert_eq!(coordinator.pending_writes(&common), 0);
}

#[test]
fn signing_configuration_failure_remains_recoverable_without_disabling_signing() {
    let (fixture, _) = fixture();

    diverge(&fixture, false);
    fixture.git(&[
        "config",
        "gpg.program",
        fixture
            .temporary
            .path()
            .join("missing-synthetic-signer")
            .to_str()
            .unwrap(),
    ]);
    let process = fixture
        .process()
        .with_environment([("GIT_CONFIG_VALUE_1".into(), "true".into())]);

    let repository = Repository::open(&fixture.root, process, None).unwrap();
    let request = review(&repository, IntegrationKind::SquashMerge);

    let error = repository.integrate_branch(&request, None).unwrap_err();

    assert_eq!(error.phase, WritePhase::Command);
    let failure =
        onegit_git::Failure::from_repository(onegit_git::Operation::SquashMerge, &error.error);

    assert!(
        failure
            .details
            .as_deref()
            .is_some_and(|details| details.contains("gpg failed to sign"))
    );
    assert_eq!(
        text(&fixture, &["rev-parse", "HEAD"]),
        request.expected.oid.unwrap()
    );
    assert_eq!(
        repository.snapshot(false, None).unwrap().operation,
        OperationState::SquashMerge
    );
    assert_eq!(
        fs::read_to_string(fixture.root.join(".git/SQUASH_MSG")).unwrap(),
        request.message.unwrap() + "\n"
    );
    assert_eq!(
        text(&fixture, &["config", "gpg.program"]),
        fixture
            .temporary
            .path()
            .join("missing-synthetic-signer")
            .to_str()
            .unwrap()
    );
}

#[test]
fn reviewed_rebase_and_retained_recovery_tips_support_sha256_repositories() {
    let mut fixture = Fixture::new();

    fixture.root = fixture.temporary.path().join("sha256");
    fs::create_dir(&fixture.root).unwrap();
    fixture.git(&["init", "--initial-branch=main", "--object-format=sha256"]);
    fixture.write("shared", "base\n");
    fixture.commit("Base");
    diverge(&fixture, false);
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let request = review(&repository, IntegrationKind::Rebase);

    assert_eq!(request.expected.oid.as_ref().unwrap().len(), 64);
    assert_eq!(request.expected_target.len(), 64);
    let result = repository.integrate_branch(&request, None).unwrap();

    assert_eq!(result.snapshot.status.head.oid.unwrap().len(), 64);
    assert_eq!(
        text(&fixture, &["rev-parse", "HEAD^"]),
        request.expected_target
    );
    assert_eq!(
        text(
            &fixture,
            &[
                "for-each-ref",
                "--format=%(objectname)",
                "refs/1git/rebase/"
            ]
        ),
        request.expected.oid.unwrap()
    );
}
