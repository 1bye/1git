//! Covers: public conflict previews, reviewed manual/side resolution and failure boundaries.
//! Real: isolated Git merges/rebase, index stages, filesystem links and common-dir queue.
//! Doubles: bounded Git wrappers for races/cancellation/refresh failures; no network.
//! Requires: POSIX Git and temporary storage; native controls/editor launch are separate.

mod common;

use common::Fixture;

use onegit_git::{
    BranchIdentity, Cancellation, ConflictSide, GitCommand, OperationState, Repository,
    ResolveConflict, WritePhase,
};
#[cfg(unix)]
use onegit_git::{GitError, GitProcess, RepositoryCoordinator};

#[cfg(unix)]
use common::PermissionsExt;
use common::symlink;
use std::fs;
#[cfg(unix)]
use std::path::Path;
#[cfg(unix)]
use std::sync::{Arc, mpsc};
#[cfg(unix)]
use std::time::{Duration, Instant};

fn paused(path: &str) -> (Fixture, Repository) {
    let fixture = Fixture::new();

    fixture.write(path, "base\n");
    fixture.commit("Base");
    fixture.git(&["switch", "-c", "topic"]);
    fixture.write(path, "theirs\n");
    fixture.commit("Theirs");
    fixture.git(&["switch", "main"]);
    fixture.write(path, "ours\n");
    fixture.commit("Ours");
    assert!(
        fixture
            .process()
            .run(GitCommand::new(&fixture.root, ["merge", "topic"]))
            .is_err()
    );
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    (fixture, repository)
}

fn request(repository: &Repository, path: &str, side: Option<ConflictSide>) -> ResolveConflict {
    ResolveConflict {
        path: path.try_into().unwrap(),
        expected: BranchIdentity::from_snapshot(&repository.snapshot(false, None).unwrap()),
        content_hash: repository
            .conflict_preview(&common::git_path(path), None)
            .unwrap()
            .unwrap()
            .content_hash,
        side,
    }
}

#[cfg(unix)]
fn wrapper(fixture: &Fixture, body: &str) -> GitProcess {
    let path = fixture.temporary.path().join("git-wrapper");

    fs::write(
        &path,
        format!("#!/bin/sh\nset -eu\ninspect_command() {{\nshift 4\n{body}\n}}\ninspect_command \"$@\"\nexec git \"$@\"\n"),
    )
    .unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();

    GitProcess::new(path, 64 * 1024 * 1024).with_environment([
        ("GIT_CONFIG_GLOBAL".into(), "/dev/null".into()),
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
        ("GIT_CONFIG_COUNT".into(), "2".into()),
        ("GIT_CONFIG_KEY_0".into(), "core.hooksPath".into()),
        ("GIT_CONFIG_VALUE_0".into(), "/dev/null".into()),
        ("GIT_CONFIG_KEY_1".into(), "commit.gpgsign".into()),
        ("GIT_CONFIG_VALUE_1".into(), "false".into()),
    ])
}

#[cfg(unix)]
fn wait_file(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(5);

    while !path.exists() {
        assert!(
            Instant::now() < deadline,
            "missing bounded Git signal: {path:?}"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn previews_preserve_exact_text_hash_and_never_change_git_or_working_bytes() {
    let (fixture, repository) = paused("shared");
    let index = fs::read(fixture.root.join(".git/index")).unwrap();
    let head = fixture.git(&["rev-parse", "HEAD"]);
    let text = "\u{feff}reviewed été\r\nsecond line\n";

    fixture.write("shared", text);
    let files_before = common::files_under(&fixture.root);

    let preview = repository
        .conflict_preview(&common::git_path("shared"), None)
        .unwrap()
        .unwrap();

    assert_eq!(common::files_under(&fixture.root), files_before);
    assert_eq!(preview.text, text);
    assert_eq!(
        preview.content_hash,
        "8bfe26e494505667196c49d2c4141fc66d2f6519856cab6f748321fd23c5e68b"
    );
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(
        fs::read_to_string(fixture.root.join("shared")).unwrap(),
        text
    );
    assert!(fixture.root.join(".git/MERGE_HEAD").exists());
}

#[test]
fn preview_boundaries_distinguish_unsupported_text_errors_and_cancellation() {
    let (fixture, repository) = paused("shared");

    for bytes in [vec![0, 1, 2], vec![0xff, 0xfe], vec![b'x'; 512 * 1024 + 1]] {
        fs::write(fixture.root.join("shared"), bytes).unwrap();
        assert!(
            repository
                .conflict_preview(&common::git_path("shared"), None)
                .unwrap()
                .is_none()
        );
    }

    fixture.write("shared", &"x".repeat(512 * 1024));
    assert_eq!(
        repository
            .conflict_preview(&common::git_path("shared"), None)
            .unwrap()
            .unwrap()
            .text
            .len(),
        512 * 1024
    );
    fixture.write("shared", &"x".repeat(10 * 1024 * 1024 + 1));
    assert!(
        repository
            .conflict_preview(&common::git_path("shared"), None)
            .is_err()
    );
    let cancellation = Cancellation::default();

    cancellation.cancel();
    assert!(
        repository
            .conflict_preview(&common::git_path("shared"), Some(&cancellation))
            .is_err()
    );
}

#[test]
#[cfg(unix)]
fn whole_file_sides_preserve_unrelated_index_working_bytes_and_operation_identity() {
    for side in [ConflictSide::Ours, ConflictSide::Theirs] {
        let (fixture, repository) = paused("shared");

        fixture.write("unrelated", "staged\n");
        fixture.git(&["add", "unrelated"]);
        fixture.write("unrelated", "unstaged\n");
        fs::set_permissions(
            fixture.root.join("shared"),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        let request = request(&repository, "shared", Some(side));
        let marker = fs::read(fixture.root.join(".git/MERGE_HEAD")).unwrap();
        let target = fixture.git(&["rev-parse", "topic"]);

        let result = repository.resolve_conflict(&request, None).unwrap();

        let expected = if side == ConflictSide::Ours {
            b"ours\n".as_slice()
        } else {
            b"theirs\n".as_slice()
        };

        assert_eq!(fs::read(fixture.root.join("shared")).unwrap(), expected);
        assert_eq!(fixture.git(&["show", ":shared"]), expected);
        assert_eq!(fixture.git(&["show", ":unrelated"]), b"staged\n");
        assert_eq!(
            fs::read(fixture.root.join("unrelated")).unwrap(),
            b"unstaged\n"
        );
        assert_eq!(BranchIdentity::from_snapshot(&result), request.expected);
        assert_eq!(result.operation, OperationState::Merge);
        assert_eq!(
            fs::read(fixture.root.join(".git/MERGE_HEAD")).unwrap(),
            marker
        );
        assert_eq!(fixture.git(&["rev-parse", "topic"]), target);
        assert!(fixture.git(&["ls-files", "--unmerged"]).is_empty());
        assert_eq!(
            fs::metadata(fixture.root.join("shared"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o755
        );
    }
}

#[test]
fn manual_resolution_stages_one_literal_unicode_newline_pattern_path_without_continuing() {
    let path = "conflict[1] été\n.txt";
    let (fixture, repository) = paused(path);

    fixture.write(path, "reviewed resolution\n");
    fixture.write("conflict1 été\n.txt", "unrelated\n");
    let request = request(&repository, path, None);

    let result = repository.resolve_conflict(&request, None).unwrap();

    assert_eq!(
        fixture.git(&["show", &format!(":{path}")]),
        b"reviewed resolution\n"
    );
    assert!(
        fixture
            .process()
            .run(GitCommand::new(
                &fixture.root,
                ["show", ":conflict1 été\n.txt"]
            ))
            .is_err()
    );
    assert_eq!(
        fs::read(fixture.root.join("conflict1 été\n.txt")).unwrap(),
        b"unrelated\n"
    );
    assert_eq!(result.operation, OperationState::Merge);
    assert_eq!(BranchIdentity::from_snapshot(&result), request.expected);
}

#[test]
fn markers_stale_hash_head_branch_and_already_resolved_state_are_rejected_before_writes() {
    let (fixture, repository) = paused("shared");
    let marker_request = request(&repository, "shared", None);
    let before = fs::read(fixture.root.join(".git/index")).unwrap();

    let error = repository
        .resolve_conflict(&marker_request, None)
        .unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert!(error.to_string().contains("markers remain"));
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), before);
    fixture.write("shared", "first resolution\n");
    let stale = request(&repository, "shared", Some(ConflictSide::Theirs));

    fixture.write("shared", "new manual edits\n");
    let error = repository.resolve_conflict(&stale, None).unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert!(error.to_string().contains("changed since the preview"));
    let current = request(&repository, "shared", None);

    let mut stale_head = current.clone();

    stale_head.expected.oid = Some("0".repeat(40));
    assert_eq!(
        repository
            .resolve_conflict(&stale_head, None)
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
    let mut branch = current.clone();

    branch.expected.branch = Some("topic".into());
    assert!(repository.resolve_conflict(&branch, None).is_err());
    assert_eq!(
        fs::read_to_string(fixture.root.join("shared")).unwrap(),
        "new manual edits\n"
    );
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), before);
    fixture.git(&["add", "shared"]);
    let index = fs::read(fixture.root.join(".git/index")).unwrap();

    assert_eq!(
        repository
            .resolve_conflict(&current, None)
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
}

#[test]
fn rebase_uses_git_index_sides_and_remains_paused_on_the_replayed_commit() {
    let (fixture, repository) = paused("shared");

    fixture.git(&["merge", "--abort"]);
    assert!(
        fixture
            .process()
            .run(GitCommand::new(&fixture.root, ["rebase", "topic"]))
            .is_err()
    );
    let request = request(&repository, "shared", Some(ConflictSide::Ours));
    let replay = fixture.git(&["rev-parse", "REBASE_HEAD"]);

    assert_eq!(request.expected.branch, None);
    let result = repository.resolve_conflict(&request, None).unwrap();

    assert_eq!(fixture.git(&["show", ":shared"]), b"theirs\n");
    assert_eq!(fixture.git(&["rev-parse", "REBASE_HEAD"]), replay);
    assert_eq!(result.operation, OperationState::Rebase);
    assert_eq!(BranchIdentity::from_snapshot(&result), request.expected);
}

#[test]
fn linked_deleted_directory_and_non_text_working_files_never_become_side_overwrites() {
    for kind in [
        "symlink",
        "internal-link",
        "hardlink",
        "deleted",
        "directory",
        "fifo",
        "nul",
        "invalid-utf8",
        "oversized",
    ] {
        let (fixture, repository) = paused("shared");
        let request = request(&repository, "shared", Some(ConflictSide::Theirs));
        let before = fixture.git(&["ls-files", "--stage", "-z"]);
        let outside = fixture.temporary.path().join("outside");

        let outside_bytes = if kind == "hardlink" {
            fs::read(fixture.root.join("shared")).unwrap()
        } else {
            b"outside fixture\n".to_vec()
        };

        fs::write(&outside, &outside_bytes).unwrap();
        fs::remove_file(fixture.root.join("shared")).unwrap();

        match kind {
            "symlink" => symlink(&outside, fixture.root.join("shared")).unwrap(),
            "internal-link" => {
                fixture.write("inside", "inside fixture\n");
                symlink("inside", fixture.root.join("shared")).unwrap();
            }
            "hardlink" => fs::hard_link(&outside, fixture.root.join("shared")).unwrap(),
            "deleted" => {}
            "directory" => fs::create_dir(fixture.root.join("shared")).unwrap(),
            "fifo" => assert!(
                std::process::Command::new("mkfifo")
                    .arg(fixture.root.join("shared"))
                    .status()
                    .unwrap()
                    .success()
            ),
            "nul" => fs::write(fixture.root.join("shared"), b"resolved\0").unwrap(),
            "invalid-utf8" => fs::write(fixture.root.join("shared"), [0xff, 0xfe]).unwrap(),
            "oversized" => fixture.write("shared", &"x".repeat(512 * 1024 + 1)),
            _ => unreachable!(),
        }

        assert_eq!(
            repository
                .resolve_conflict(&request, None)
                .unwrap_err()
                .phase,
            WritePhase::BeforeCommand,
            "{kind}"
        );
        assert_eq!(
            fixture.git(&["ls-files", "--stage", "-z"]),
            before,
            "{kind}"
        );
        assert_eq!(fs::read(&outside).unwrap(), outside_bytes, "{kind}");
    }
}

#[test]
fn nested_binary_and_oversized_index_sides_are_refused_before_replacing_working_text() {
    for chosen in [
        b"<<<< nested\n".to_vec(),
        vec![0],
        vec![0xff],
        vec![b'x'; 512 * 1024 + 1],
    ] {
        let (fixture, repository) = paused("shared");
        let mut hash = GitCommand::new(&fixture.root, ["hash-object", "-w", "--stdin"]);

        hash.stdin = &chosen;
        let oid = fixture.process().run(hash).unwrap().stdout;
        let oid = String::from_utf8(oid).unwrap();
        let record = format!("100644 {} 2\tshared\0", oid.trim());
        let mut update = GitCommand::new(&fixture.root, ["update-index", "-z", "--index-info"]);

        update.stdin = record.as_bytes();
        fixture.process().run(update).unwrap();
        let request = request(&repository, "shared", Some(ConflictSide::Ours));
        let index = fixture.git(&["ls-files", "--stage", "-z"]);
        let working = fs::read(fixture.root.join("shared")).unwrap();

        assert_eq!(
            repository
                .resolve_conflict(&request, None)
                .unwrap_err()
                .phase,
            WritePhase::BeforeCommand
        );
        assert_eq!(fs::read(fixture.root.join("shared")).unwrap(), working);
        assert_eq!(fixture.git(&["ls-files", "--stage", "-z"]), index);
    }
}

#[test]
#[cfg(unix)]
fn editor_or_symlink_changes_during_side_reads_are_rechecked_without_redirecting_writes() {
    for replace in [
        "printf 'late edits\\n' > shared",
        "rm shared; ln -s ../outside shared",
        "git symbolic-ref HEAD refs/heads/topic",
    ] {
        let (fixture, repository) = paused("shared");
        let request = request(&repository, "shared", Some(ConflictSide::Theirs));
        let index = fixture.git(&["ls-files", "--stage", "-z"]);

        fs::write(
            fixture.temporary.path().join("outside"),
            "outside fixture\n",
        )
        .unwrap();
        let process = wrapper(
            &fixture,
            &format!("if [ \"$1\" = cat-file ] && [ \"$2\" = blob ]; then {replace}; fi"),
        );

        let repository = Repository::open(&fixture.root, process, None).unwrap();

        assert_eq!(
            repository
                .resolve_conflict(&request, None)
                .unwrap_err()
                .phase,
            WritePhase::BeforeCommand
        );
        assert_eq!(fixture.git(&["ls-files", "--stage", "-z"]), index);
        assert_eq!(
            fs::read(fixture.temporary.path().join("outside")).unwrap(),
            b"outside fixture\n"
        );
    }
}

#[test]
fn manual_and_side_resolutions_keep_ordinary_git_clean_filters_without_staging_attributes() {
    for side in [None, Some(ConflictSide::Theirs)] {
        let (fixture, repository) = paused("shared");

        fixture.write(".gitattributes", "shared filter=fixture\n");
        fixture.git(&["config", "filter.fixture.clean", "tr a-z A-Z"]);
        fixture.git(&["config", "filter.fixture.required", "true"]);

        if side.is_none() {
            fixture.write("shared", "reviewed manual\n");
        }

        let request = request(&repository, "shared", side);
        let result = repository.resolve_conflict(&request, None).unwrap();

        let working = if side.is_none() {
            "reviewed manual\n"
        } else {
            "theirs\n"
        };

        assert_eq!(
            fs::read_to_string(fixture.root.join("shared")).unwrap(),
            working
        );
        assert_eq!(
            fixture.git(&["show", ":shared"]),
            working.to_ascii_uppercase().as_bytes()
        );
        assert!(
            fixture
                .process()
                .run(GitCommand::new(&fixture.root, ["show", ":.gitattributes"]))
                .is_err()
        );
        assert_eq!(result.operation, OperationState::Merge);
        assert_eq!(BranchIdentity::from_snapshot(&result), request.expected);
    }
}

#[test]
#[cfg(unix)]
fn cancellation_during_side_read_reaps_the_command_and_preserves_the_resolution() {
    let (fixture, repository) = paused("shared");
    let request = request(&repository, "shared", Some(ConflictSide::Theirs));
    let index = fixture.git(&["ls-files", "--stage", "-z"]);
    let working = fs::read(fixture.root.join("shared")).unwrap();

    let process = wrapper(
        &fixture,
        "if [ \"$1\" = cat-file ] && [ \"$2\" = blob ]; then touch ../entered; sleep 20; fi",
    );

    let repository = Repository::open(&fixture.root, process, None).unwrap();
    let cancellation = Cancellation::default();
    let cancel = cancellation.clone();

    let thread =
        std::thread::spawn(move || repository.resolve_conflict(&request, Some(&cancellation)));

    wait_file(&fixture.temporary.path().join("entered"));
    cancel.cancel();
    let error = thread.join().unwrap().unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert!(matches!(
        error.error,
        onegit_git::RepositoryError::Git(GitError::Cancelled)
    ));
    assert_eq!(fixture.git(&["ls-files", "--stage", "-z"]), index);
    assert_eq!(fs::read(fixture.root.join("shared")).unwrap(), working);
}

#[test]
#[cfg(unix)]
fn failed_add_keeps_explicit_replacement_and_never_continues_or_replays() {
    let (fixture, repository) = paused("shared");
    let request = request(&repository, "shared", Some(ConflictSide::Theirs));
    let index = fixture.git(&["ls-files", "--stage", "-z"]);

    let process = wrapper(
        &fixture,
        "if [ \"$1\" = --literal-pathspecs ] && [ \"$2\" = add ]; then printf 'attempt\\n' >> ../attempts; exit 7; fi",
    );

    let repository = Repository::open(&fixture.root, process, None).unwrap();
    let error = repository.resolve_conflict(&request, None).unwrap_err();

    assert_eq!(error.phase, WritePhase::Command);
    assert_eq!(fs::read(fixture.root.join("shared")).unwrap(), b"theirs\n");
    assert_eq!(fixture.git(&["ls-files", "--stage", "-z"]), index);
    assert_eq!(
        fs::read_to_string(fixture.temporary.path().join("attempts")).unwrap(),
        "attempt\n"
    );
    assert!(fixture.root.join(".git/MERGE_HEAD").exists());
}

#[test]
#[cfg(unix)]
fn successful_add_followed_by_failed_status_reports_refresh_without_replaying_or_rollback() {
    let (fixture, repository) = paused("shared");

    fixture.write("shared", "reviewed manual resolution\n");
    let request = request(&repository, "shared", None);

    let process = wrapper(
        &fixture,
        "if [ \"$1\" = --literal-pathspecs ] && [ \"$2\" = add ]; then git \"$@\"; touch ../written; printf 'attempt\\n' >> ../attempts; exit 0; fi\nif [ -f ../written ] && [ \"$2\" = status ]; then exit 8; fi",
    );

    let repository = Repository::open(&fixture.root, process, None).unwrap();
    let error = repository.resolve_conflict(&request, None).unwrap_err();

    assert_eq!(error.phase, WritePhase::Refresh);
    assert!(fixture.git(&["ls-files", "--unmerged"]).is_empty());
    assert_eq!(
        fixture.git(&["show", ":shared"]),
        b"reviewed manual resolution\n"
    );
    assert_eq!(
        fs::read_to_string(fixture.temporary.path().join("attempts")).unwrap(),
        "attempt\n"
    );
    assert!(fixture.root.join(".git/MERGE_HEAD").exists());
}

#[test]
#[cfg(unix)]
fn common_directory_queue_covers_final_status_and_related_reads() {
    let (fixture, _) = paused("shared");
    let related = fixture.temporary.path().join("linked");

    fixture.git_os([
        "worktree".into(),
        "add".into(),
        "-b".into(),
        "linked".into(),
        related.as_os_str().to_owned(),
        "HEAD".into(),
    ]);
    fixture.write("shared", "reviewed resolution\n");
    let coordinator = RepositoryCoordinator::default();

    let process = wrapper(
        &fixture,
        "if [ \"$1\" = --literal-pathspecs ] && [ \"$2\" = add ]; then git \"$@\"; touch ../written; exit 0; fi\nif [ -f ../written ] && [ \"$2\" = status ] && [ ! -f ../release ]; then touch ../entered; deadline=0; while [ ! -f ../release ] && [ $deadline -lt 500 ]; do sleep 0.01; deadline=$((deadline+1)); done; fi",
    );

    let repository = Arc::new(coordinator.open(&fixture.root, process, None).unwrap());
    let sibling = coordinator.open(&related, fixture.process(), None).unwrap();
    let request = request(&repository, "shared", None);
    let common = repository.info().common_directory.clone();
    let writer = std::thread::spawn(move || repository.resolve_conflict(&request, None));

    wait_file(&fixture.temporary.path().join("entered"));
    assert_eq!(coordinator.pending_writes(&common), 1);
    let (send, receive) = mpsc::channel();
    let reader = std::thread::spawn(move || send.send(sibling.snapshot(false, None)).unwrap());

    assert!(receive.recv_timeout(Duration::from_millis(50)).is_err());
    fs::write(fixture.temporary.path().join("release"), b"release").unwrap();
    assert_eq!(
        writer.join().unwrap().unwrap().operation,
        OperationState::Merge
    );
    assert!(
        receive
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .is_ok()
    );
    reader.join().unwrap();
    assert_eq!(coordinator.pending_writes(&common), 0);
}
