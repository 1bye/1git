//! Covers: reviewed discard, durable separate patches, links, undo and failure ownership.
//! Real: disposable Git/index/worktree, private recovery files and manual Git recovery.
//! Doubles: child-only Git wrappers for backup/apply failures, cancellation and queue barriers.
//! Requires: POSIX Git and temporary storage; no network, accounts or native UI.

mod common;

#[cfg(unix)]
use base64::Engine;
#[cfg(unix)]
use base64::engine::general_purpose::STANDARD;
use common::Fixture;

use onegit_git::{
    BranchIdentity, DiscardFiles, DiscardRecovery, GitCommand, Repository, WritePhase,
};

#[cfg(unix)]
use onegit_git::{Cancellation, GitError, GitProcess, RepositoryCoordinator, RepositoryError};

#[cfg(unix)]
use common::PermissionsExt;
use common::symlink;
#[cfg(target_os = "macos")]
use onegit_git::{ToolCommand, execute_tool};
use std::fs;
use std::path::Path;
#[cfg(unix)]
use std::sync::{Arc, mpsc};
use std::time::Duration;
#[cfg(unix)]
use std::time::Instant;

fn setup() -> (Fixture, Repository) {
    let fixture = Fixture::new();

    fixture.write("selected.txt", "base\n");
    fixture.commit("Base");
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    (fixture, repository)
}

fn review(fixture: &Fixture, repository: &Repository, paths: &[&str]) -> DiscardFiles {
    DiscardFiles {
        paths: paths.iter().map(common::git_path).collect(),
        allow_destructive: true,
        recovery: Some(DiscardRecovery {
            directory: fixture.temporary.path().join("recovery"),
            expected: BranchIdentity::from_snapshot(&repository.snapshot(false, None).unwrap()),
        }),
    }
}

fn mixed(fixture: &Fixture) {
    fixture.write("selected.txt", "staged\n");
    fixture.git_os(["add", "--", "selected.txt"].map(Into::into));
    fixture.write("selected.txt", "working\n");
    fs::write(fixture.root.join("new[1].bin"), [0, 1, 255, 19]).unwrap();
    fixture.write("keep.txt", "keep\n");
}

#[cfg(unix)]
fn wrapper(fixture: &Fixture, body: &str) -> GitProcess {
    let executable = fixture.temporary.path().join("git-wrapper");

    fs::write(&executable, format!("#!/bin/sh\nset -eu\ninspect_command() {{\nshift 4\n{body}\n}}\ninspect_command \"$@\"\nexec git \"$@\"\n")).unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();

    GitProcess::new(executable, 64 * 1024 * 1024).with_environment([
        ("GIT_CONFIG_GLOBAL".into(), "/dev/null".into()),
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
        ("GIT_CONFIG_COUNT".into(), "2".into()),
        ("GIT_CONFIG_KEY_0".into(), "core.hooksPath".into()),
        ("GIT_CONFIG_VALUE_0".into(), "/dev/null".into()),
        ("GIT_CONFIG_KEY_1".into(), "commit.gpgsign".into()),
        ("GIT_CONFIG_VALUE_1".into(), "false".into()),
        (
            "HOME".into(),
            fixture.temporary.path().as_os_str().to_owned(),
        ),
    ])
}

#[cfg(unix)]
fn wait_file(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(5);

    while !path.exists() {
        assert!(Instant::now() < deadline, "missing signal {path:?}");
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[cfg(unix)]
fn captured_paths(fixture: &Fixture, paths: &[String]) -> serde_json::Value {
    let values: Vec<_> = paths.iter().map(|path| {
        let absolute = fixture.root.join(path);

        let working = match fs::symlink_metadata(&absolute) {
            Err(error) if error.kind()==std::io::ErrorKind::NotFound => serde_json::json!({"kind":"missing"}),
            Ok(metadata) if metadata.file_type().is_symlink() => serde_json::json!({"kind":"link","target":fs::read_link(&absolute).unwrap().to_str().unwrap()}),
            Ok(_) => serde_json::json!({"kind":"file","bytes":STANDARD.encode(fs::read(&absolute).unwrap())}),
            Err(error) => panic!("unexpected file read: {error}"),
        };

        let object = format!(":{path}");

        let staged = match fixture.process().run(GitCommand::new(&fixture.root, ["--literal-pathspecs", "show", &object])) {
            Ok(output) => Some(STANDARD.encode(output.stdout)),
            Err(GitError::CommandFailed { status, .. }) if status.code()==Some(128) => None,
            Err(error) => panic!("unexpected index read: {error}"),
        };

        serde_json::json!({"path":path,"working":working,"staged":staged})
    }).collect();

    serde_json::json!(values)
}

#[cfg(unix)]
#[test]
fn exact_recovery_patches_instructions_and_transitions_match_the_actual_source() {
    let reference: serde_json::Value =
        serde_json::from_str(include_str!("../fixtures/discard-recovery.json")).unwrap();

    for case in reference["cases"].as_array().unwrap() {
        let kind = case["kind"].as_str().unwrap();
        let fixture = Fixture::new();

        if kind != "unborn" {
            fixture.write("README.md", "# Test repository\n");
            fixture.commit("Initial");
        }

        match kind {
            "mixed" => {
                fixture.write("tracked[1].txt", "base\n");
                fixture.commit("Track fixture");
                fixture.write("tracked[1].txt", "staged\n");
                fixture.git(&["add", "--", "tracked[1].txt"]);
                fixture.write("tracked[1].txt", "working\n");
                fs::write(fixture.root.join("new[1].bin"), [0, 1, 255, 19]).unwrap();
            }
            "links" => {
                symlink("base-target", fixture.root.join("tracked-link")).unwrap();
                fixture.commit("Track link");
                fs::remove_file(fixture.root.join("tracked-link")).unwrap();
                symlink("staged-target", fixture.root.join("tracked-link")).unwrap();
                fixture.git(&["add", "--", "tracked-link"]);
                fs::remove_file(fixture.root.join("tracked-link")).unwrap();
                symlink("working-target", fixture.root.join("tracked-link")).unwrap();
                symlink("missing\n\"target", fixture.root.join("link [1]\n\"rose☃")).unwrap();
            }
            "deleted-parent" => {
                fs::create_dir(fixture.root.join("nested")).unwrap();
                symlink("../README.md", fixture.root.join("nested/link")).unwrap();
                fixture.commit("Nested link");
                fs::remove_dir_all(fixture.root.join("nested")).unwrap();
            }
            "unborn" => {
                fixture.write("new.txt", "staged\n");
                fixture.git(&["add", "--", "new.txt"]);
                fixture.write("new.txt", "working\n");
            }
            other => panic!("unknown source case {other}"),
        }

        fixture.write("excluded.txt", "keep\n");
        let paths: Vec<_> = case["paths"]
            .as_array()
            .unwrap()
            .iter()
            .map(|path| path.as_str().unwrap().to_owned())
            .collect();

        let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

        let request = review(
            &fixture,
            &repository,
            &paths.iter().map(String::as_str).collect::<Vec<_>>(),
        );

        let expected = request.recovery.as_ref().unwrap().expected.clone();

        assert_eq!(captured_paths(&fixture, &paths), case["prior"], "{kind}");
        let result = repository.discard_files(&request, None).unwrap();

        assert_eq!(captured_paths(&fixture, &paths), case["after"], "{kind}");
        assert_eq!(BranchIdentity::from_snapshot(&result.snapshot), expected);

        for (field, file) in [("staged", "staged.patch"), ("working", "working.patch")] {
            assert_eq!(
                STANDARD.encode(fs::read(result.recovery.directory.join(file)).unwrap()),
                case["patches"][field].as_str().unwrap(),
                "{kind}: {field}"
            );
        }

        assert_eq!(
            fs::read_to_string(result.recovery.directory.join("README.txt")).unwrap(),
            case["instructions"].as_str().unwrap()
        );
        let mut manifest: serde_json::Value = serde_json::from_slice(
            &fs::read(result.recovery.directory.join("recovery.json")).unwrap(),
        )
        .unwrap();

        assert_eq!(manifest["root"], repository.info().root.to_str().unwrap());
        assert_eq!(manifest["head"], serde_json::json!(expected.oid));
        assert!(
            chrono::DateTime::parse_from_rfc3339(manifest["createdAt"].as_str().unwrap()).is_ok()
        );
        manifest["root"] = "$ROOT".into();
        manifest["createdAt"] = "$UTC".into();

        if !manifest["head"].is_null() {
            manifest["head"] = "$HEAD".into();
        }

        assert_eq!(manifest, case["manifest"], "{kind}");
        assert_eq!(
            serde_json::json!(
                result
                    .snapshot
                    .status
                    .files
                    .iter()
                    .map(|file| file.path.to_str().unwrap())
                    .collect::<Vec<_>>()
            ),
            case["remaining"]
        );
        repository.undo_discard(&result.undo.token, None).unwrap();
        assert_eq!(captured_paths(&fixture, &paths), case["undone"], "{kind}");
        assert_eq!(
            fs::read(fixture.root.join("excluded.txt")).unwrap(),
            b"keep\n"
        );
    }
}

#[test]
#[cfg(unix)]
fn discards_and_undoes_mixed_selected_states_without_touching_excluded_data() {
    let (fixture, repository) = setup();

    mixed(&fixture);
    let request = review(&fixture, &repository, &["selected.txt", "new[1].bin"]);
    let expected = fixture.git(&["diff", "--cached", "--binary", "--full-index"]);
    let head = fixture.git(&["rev-parse", "HEAD"]);
    let result = repository.discard_files(&request, None).unwrap();

    assert_eq!(
        fs::read(fixture.root.join("selected.txt")).unwrap(),
        b"base\n"
    );
    assert_eq!(fixture.git(&["show", ":selected.txt"]), b"base\n");
    assert!(!fixture.root.join("new[1].bin").exists());
    assert_eq!(result.snapshot.status.files.len(), 1);
    assert_eq!(
        result.snapshot.status.files[0].path,
        common::git_path("keep.txt")
    );
    assert!(result.recovery.complete);
    assert_eq!(result.undo.path, common::git_path("selected.txt"));
    assert_eq!(result.undo.token.len(), 36);
    assert_eq!(result.undo.token.as_bytes()[14], b'4');
    assert!(result.undo.expires_at.ends_with('Z'));
    assert_eq!(result.undo.expires_at.len(), 24);
    assert_eq!(
        fs::metadata(&result.recovery.directory)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );

    for name in [
        "staged.patch",
        "working.patch",
        "recovery.json",
        "README.txt",
    ] {
        assert_eq!(
            fs::metadata(result.recovery.directory.join(name))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }

    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(result.recovery.directory.join("recovery.json")).unwrap())
            .unwrap();

    assert_eq!(manifest["root"], repository.info().root.to_str().unwrap());
    assert_eq!(
        manifest["head"],
        String::from_utf8(head.clone()).unwrap().trim_end()
    );
    assert_eq!(
        manifest["paths"],
        serde_json::json!(["selected.txt", "new[1].bin"])
    );
    assert!(manifest["createdAt"].as_str().unwrap().ends_with('Z'));
    assert_eq!(
        fs::read(result.recovery.directory.join("staged.patch")).unwrap(),
        expected
    );
    repository.undo_discard(&result.undo.token, None).unwrap();
    assert_eq!(fixture.git(&["show", ":selected.txt"]), b"staged\n");
    assert_eq!(
        fs::read(fixture.root.join("selected.txt")).unwrap(),
        b"working\n"
    );
    assert_eq!(
        fs::read(fixture.root.join("new[1].bin")).unwrap(),
        [0, 1, 255, 19]
    );
    assert_eq!(fs::read(fixture.root.join("keep.txt")).unwrap(), b"keep\n");
    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(
        repository
            .undo_discard(&result.undo.token, None)
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );
    assert!(result.recovery.directory.join("README.txt").exists());
}

#[test]
fn backups_survive_reopen_and_recover_manually_with_separate_staging() {
    let (fixture, repository) = setup();

    mixed(&fixture);
    let result = repository
        .discard_files(
            &review(&fixture, &repository, &["selected.txt", "new[1].bin"]),
            None,
        )
        .unwrap();

    drop(repository);
    let reopened = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    assert_eq!(
        reopened
            .undo_discard(&result.undo.token, None)
            .unwrap_err()
            .phase,
        WritePhase::BeforeCommand
    );

    for args in [
        vec!["apply", "--cached", "staged.patch"],
        vec!["apply", "staged.patch"],
        vec!["apply", "working.patch"],
    ] {
        let mut actual: Vec<_> = args[..args.len() - 1]
            .iter()
            .map(|arg| (*arg).into())
            .collect();

        actual.push(
            result
                .recovery
                .directory
                .join(args[args.len() - 1])
                .into_os_string(),
        );
        fixture.git_os(actual);
    }

    assert_eq!(fixture.git(&["show", ":selected.txt"]), b"staged\n");
    assert_eq!(
        fs::read(fixture.root.join("selected.txt")).unwrap(),
        b"working\n"
    );
    assert_eq!(
        fs::read(fixture.root.join("new[1].bin")).unwrap(),
        [0, 1, 255, 19]
    );
}

#[cfg(unix)]
#[test]
fn restores_tracked_and_untracked_links_themselves_without_reading_targets() {
    let (fixture, repository) = setup();

    symlink("base-target", fixture.root.join("tracked-link")).unwrap();
    fixture.commit("Track link");
    fs::remove_file(fixture.root.join("tracked-link")).unwrap();
    symlink("staged-target", fixture.root.join("tracked-link")).unwrap();
    fixture.git(&["add", "--", "tracked-link"]);
    fs::remove_file(fixture.root.join("tracked-link")).unwrap();
    symlink("working-target", fixture.root.join("tracked-link")).unwrap();
    let outside = fixture.temporary.path().join("outside");

    fs::write(&outside, "private outside contents\n").unwrap();
    symlink(&outside, fixture.root.join("external")).unwrap();
    symlink("missing\n\"target", fixture.root.join("link [1]\n\"rose☃")).unwrap();
    symlink(".git", fixture.root.join("directory-link")).unwrap();
    let paths = [
        "tracked-link",
        "external",
        "link [1]\n\"rose☃",
        "directory-link",
    ];

    let result = repository
        .discard_files(&review(&fixture, &repository, &paths), None)
        .unwrap();

    assert_eq!(
        fs::read_link(fixture.root.join("tracked-link")).unwrap(),
        Path::new("base-target")
    );
    assert!(fs::symlink_metadata(fixture.root.join("external")).is_err());
    assert!(
        !String::from_utf8(fs::read(result.recovery.directory.join("working.patch")).unwrap())
            .unwrap()
            .contains("private outside contents")
    );
    repository.undo_discard(&result.undo.token, None).unwrap();
    assert_eq!(
        fs::read_link(fixture.root.join("tracked-link")).unwrap(),
        Path::new("working-target")
    );
    assert_eq!(fixture.git(&["show", ":tracked-link"]), b"staged-target");
    assert_eq!(
        fs::read_link(fixture.root.join("external")).unwrap(),
        outside
    );
    assert_eq!(
        fs::read_link(fixture.root.join("link [1]\n\"rose☃")).unwrap(),
        Path::new("missing\n\"target")
    );
    assert_eq!(
        fs::read(fixture.temporary.path().join("outside")).unwrap(),
        b"private outside contents\n"
    );
}

#[test]
fn restores_deleted_links_when_parents_are_missing_and_handles_unborn_head() {
    #[cfg(unix)]
    {
        let (fixture, repository) = setup();

        fs::create_dir(fixture.root.join("nested")).unwrap();
        symlink("../selected.txt", fixture.root.join("nested/link")).unwrap();
        fixture.commit("Nested link");
        fs::remove_dir_all(fixture.root.join("nested")).unwrap();
        let result = repository
            .discard_files(&review(&fixture, &repository, &["nested/link"]), None)
            .unwrap();

        assert_eq!(
            fs::read_link(fixture.root.join("nested/link")).unwrap(),
            Path::new("../selected.txt")
        );
        repository.undo_discard(&result.undo.token, None).unwrap();
        assert!(fs::symlink_metadata(fixture.root.join("nested/link")).is_err());
    }
    let unborn = Fixture::new();

    unborn.write("new.txt", "staged\n");
    unborn.git(&["add", "--", "new.txt"]);
    unborn.write("new.txt", "working\n");
    let repository = Repository::open(&unborn.root, unborn.process(), None).unwrap();

    let result = repository
        .discard_files(&review(&unborn, &repository, &["new.txt"]), None)
        .unwrap();

    assert!(result.snapshot.status.head.oid.is_none());
    assert!(!unborn.root.join("new.txt").exists());
    repository.undo_discard(&result.undo.token, None).unwrap();
    assert_eq!(unborn.git(&["show", ":new.txt"]), b"staged\n");
    assert_eq!(fs::read(unborn.root.join("new.txt")).unwrap(), b"working\n");
}

#[test]
fn preflight_refuses_entire_stale_or_unsupported_batches_without_creating_backups() {
    let (fixture, repository) = setup();

    mixed(&fixture);
    let valid = review(&fixture, &repository, &["selected.txt"]);
    let mut cases = Vec::new();
    let mut consent = valid.clone();

    consent.allow_destructive = false;
    cases.push(consent);
    let mut stale = valid.clone();

    stale.recovery.as_mut().unwrap().expected.oid = Some("0".repeat(40));
    cases.push(stale);
    let mut branch = valid.clone();

    branch.recovery.as_mut().unwrap().expected.branch = Some("other".into());
    cases.push(branch);
    let mut missing = valid.clone();

    missing.paths.push("missing.txt".try_into().unwrap());
    cases.push(missing);

    for path in ["../outside", "./selected.txt"] {
        assert!(onegit_git::GitPath::new(path).is_err());
    }

    let mut metadata = valid.clone();

    metadata.paths = vec![common::git_path(".git/config")];
    cases.push(metadata);
    let before = common::files_under(&fixture.root);

    for request in cases {
        let error = repository.discard_files(&request, None).unwrap_err();

        assert_eq!(error.phase, WritePhase::BeforeCommand);
        assert!(error.recovery.is_none());
        assert!(!fixture.temporary.path().join("recovery").exists());
        assert_eq!(common::files_under(&fixture.root), before);
    }

    fs::write(fixture.root.join(".git/MERGE_HEAD"), "paused\n").unwrap();
    assert_eq!(
        repository.discard_files(&valid, None).unwrap_err().phase,
        WritePhase::BeforeCommand
    );
    assert!(!fixture.temporary.path().join("recovery").exists());
}

#[test]
fn rejects_parent_links_and_non_regular_leaves_without_touching_outside_data() {
    let (fixture, repository) = setup();

    fs::create_dir(fixture.root.join("nested")).unwrap();
    fixture.write("nested/tracked", "base\n");
    fixture.commit("Nested file");
    let request = review(&fixture, &repository, &["selected.txt", "nested/tracked"]);

    fixture.write("selected.txt", "keep\n");
    fs::remove_dir_all(fixture.root.join("nested")).unwrap();
    fs::create_dir(fixture.temporary.path().join("outside")).unwrap();
    fs::write(
        fixture.temporary.path().join("outside/tracked"),
        "outside\n",
    )
    .unwrap();
    symlink(
        fixture.temporary.path().join("outside"),
        fixture.root.join("nested"),
    )
    .unwrap();
    let error = repository.discard_files(&request, None).unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert!(error.recovery.is_none());
    assert_eq!(
        fs::read(fixture.temporary.path().join("outside/tracked")).unwrap(),
        b"outside\n"
    );
    assert_eq!(
        fs::read(fixture.root.join("selected.txt")).unwrap(),
        b"keep\n"
    );
    common::remove_directory_link(&fixture.root.join("nested"));
    fs::create_dir(fixture.root.join("selected.txt.directory")).unwrap();
    fs::rename(
        fixture.root.join("selected.txt"),
        fixture.root.join("retired"),
    )
    .unwrap();
    fs::rename(
        fixture.root.join("selected.txt.directory"),
        fixture.root.join("selected.txt"),
    )
    .unwrap();
    assert_eq!(
        repository.discard_files(&request, None).unwrap_err().phase,
        WritePhase::BeforeCommand
    );
}

#[test]
fn backup_creation_failure_never_overwrites_existing_or_missing_parent_destinations() {
    let (fixture, repository) = setup();

    mixed(&fixture);
    let mut request = review(&fixture, &repository, &["selected.txt"]);

    fs::create_dir(fixture.temporary.path().join("recovery")).unwrap();
    fs::write(fixture.temporary.path().join("recovery/keep"), "keep\n").unwrap();
    let before = common::files_under(&fixture.root);

    for directory in [
        fixture.temporary.path().join("recovery"),
        fixture.temporary.path().join("missing/recovery"),
    ] {
        request.recovery.as_mut().unwrap().directory = directory;
        let error = repository.discard_files(&request, None).unwrap_err();

        assert_eq!(error.phase, WritePhase::BeforeCommand);
        assert!(error.recovery.is_none());
        assert_eq!(common::files_under(&fixture.root), before);
    }

    assert_eq!(
        fs::read(fixture.temporary.path().join("recovery/keep")).unwrap(),
        b"keep\n"
    );
}

#[test]
#[cfg(unix)]
fn staged_apply_failures_compensate_without_losing_the_original_error_or_backup() {
    for target in ["worktree", "index"] {
        let (fixture, _) = setup();

        mixed(&fixture);
        let body = format!(
            r#"
if [ "$1" = "apply" ]; then
 check=false; cached=false; reverse=false
 for value in "$@"; do
  [ "$value" != '--check' ] || check=true
  [ "$value" != '--cached' ] || cached=true
  [ "$value" != '--reverse' ] || reverse=true
 done
 if [ "$check" = false ] && [ "$reverse" = true ]; then
  count=0; [ ! -f ../apply-count ] || count=$(cat ../apply-count)
  count=$((count+1)); printf '%s' "$count" > ../apply-count
  if {{ [ '{target}' = worktree ] && [ "$cached" = false ] && [ "$count" -eq 2 ]; }} || {{ [ '{target}' = index ] && [ "$cached" = true ]; }}; then
   printf 'original apply failure\n' >&2; exit 73
  fi
 fi
fi"#
        );

        let repository = Repository::open(&fixture.root, wrapper(&fixture, &body), None).unwrap();
        let request = review(&fixture, &repository, &["selected.txt", "new[1].bin"]);
        let staged = fixture.git(&["diff", "--cached"]);
        let error = repository.discard_files(&request, None).unwrap_err();

        assert_eq!(error.phase, WritePhase::Command, "{target}");
        assert!(error.rollback_error.is_none(), "{target}: {error:?}");
        assert!(error.recovery.unwrap().complete);
        assert!(
            matches!(error.error, RepositoryError::Git(GitError::CommandFailed { status, .. }) if status.code()==Some(73))
        );
        assert_eq!(fixture.git(&["diff", "--cached"]), staged);
        assert_eq!(
            fs::read(fixture.root.join("selected.txt")).unwrap(),
            b"working\n"
        );
        assert_eq!(
            fs::read(fixture.root.join("new[1].bin")).unwrap(),
            [0, 1, 255, 19]
        );
        assert_eq!(fs::read(fixture.root.join("keep.txt")).unwrap(), b"keep\n");
    }
}

#[test]
fn failed_undo_preserves_intervening_edits_and_keeps_token_for_an_explicit_retry() {
    let (fixture, repository) = setup();

    mixed(&fixture);
    let result = repository
        .discard_files(&review(&fixture, &repository, &["selected.txt"]), None)
        .unwrap();

    let index = fs::read(fixture.root.join(".git/index")).unwrap();

    fixture.write("selected.txt", "intervening\n");
    let error = repository
        .undo_discard(&result.undo.token, None)
        .unwrap_err();

    assert_eq!(error.phase, WritePhase::Command);
    assert!(error.rollback_error.is_none());
    assert_eq!(
        fs::read(fixture.root.join("selected.txt")).unwrap(),
        b"intervening\n"
    );
    assert_eq!(fixture.git(&["show", ":selected.txt"]), b"base\n");
    fixture.write("selected.txt", "base\n");
    repository.undo_discard(&result.undo.token, None).unwrap();
    assert_eq!(
        fs::read(fixture.root.join("selected.txt")).unwrap(),
        b"working\n"
    );
    assert_eq!(fixture.git(&["show", ":selected.txt"]), b"staged\n");
    assert_ne!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
}

#[test]
fn tampered_recovery_is_refused_before_undo_changes_any_repository_data() {
    let (fixture, repository) = setup();

    mixed(&fixture);
    let result = repository
        .discard_files(&review(&fixture, &repository, &["selected.txt"]), None)
        .unwrap();

    let before = common::files_under(&fixture.root);

    fs::write(
        result.recovery.directory.join("working.patch"),
        "tampered\n",
    )
    .unwrap();
    let error = repository
        .undo_discard(&result.undo.token, None)
        .unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert_eq!(common::files_under(&fixture.root), before);
    assert!(error.recovery.unwrap().complete);
}

#[test]
#[cfg(unix)]
fn cancellation_during_streamed_capture_keeps_partial_backup_without_destructive_steps() {
    let (fixture, _) = setup();

    mixed(&fixture);
    let process = wrapper(
        &fixture,
        r#"
for value in "$@"; do
 if [ "$value" = diff ]; then
  git "$@"
  : > ../captured
  while [ ! -f ../never-release ]; do sleep 0.01; done
 fi
done"#,
    );

    let repository = Repository::open(&fixture.root, process, None).unwrap();
    let request = review(&fixture, &repository, &["selected.txt"]);
    let cancellation = Cancellation::default();
    let worker_cancel = cancellation.clone();
    let before = common::files_under(&fixture.root);

    let worker =
        std::thread::spawn(move || repository.discard_files(&request, Some(&worker_cancel)));

    wait_file(&fixture.temporary.path().join("captured"));
    cancellation.cancel();
    let error = worker.join().unwrap().unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert!(matches!(
        error.error,
        RepositoryError::Git(GitError::Cancelled)
    ));
    assert!(!error.recovery.unwrap().complete);
    assert!(
        !fixture
            .temporary
            .path()
            .join("recovery/README.txt")
            .exists()
    );
    assert_eq!(common::files_under(&fixture.root), before);
}

#[test]
#[cfg(unix)]
fn common_directory_queue_spans_discard_result_refresh_and_read_barriers() {
    let (fixture, _) = setup();

    mixed(&fixture);
    let process = wrapper(
        &fixture,
        r#"
if [ "$1" = apply ]; then
 check=false
 for value in "$@"; do [ "$value" != '--check' ] || check=true; done
 if [ "$check" = false ]; then : > ../mutated; fi
fi
if [ "$1" = '--no-optional-locks' ] && [ "$2" = status ] && [ -f ../mutated ] && [ ! -f ../release ]; then
 : > ../refresh-started
 while [ ! -f ../release ]; do sleep 0.01; done
fi"#,
    );

    let coordinator = RepositoryCoordinator::default();
    let first = coordinator.open(&fixture.root, process, None).unwrap();

    let second = Arc::new(
        coordinator
            .open(&fixture.root, fixture.process(), None)
            .unwrap(),
    );

    let common = second.info().common_directory.clone();
    let request = review(&fixture, &first, &["selected.txt"]);
    let worker = std::thread::spawn(move || first.discard_files(&request, None));

    wait_file(&fixture.temporary.path().join("refresh-started"));
    assert_eq!(coordinator.pending_writes(&common), 1);
    let (sent, received) = mpsc::channel();
    let writer = Arc::clone(&second);

    let queued = std::thread::spawn(move || {
        let result = writer.stage(&["keep.txt".try_into().unwrap()], None);

        sent.send(()).unwrap();

        result
    });

    let (read_sent, read_received) = mpsc::channel();
    let reader = Arc::clone(&second);

    let read = std::thread::spawn(move || {
        let result = reader.snapshot(false, None);

        read_sent.send(()).unwrap();

        result
    });

    assert!(received.recv_timeout(Duration::from_millis(100)).is_err());
    assert!(
        read_received
            .recv_timeout(Duration::from_millis(100))
            .is_err()
    );
    fs::write(fixture.temporary.path().join("release"), "release").unwrap();
    worker.join().unwrap().unwrap();
    queued.join().unwrap().unwrap();
    read.join().unwrap().unwrap();
    assert_eq!(coordinator.pending_writes(&common), 0);
    assert_eq!(fixture.git(&["show", ":keep.txt"]), b"keep\n");
    assert_eq!(
        fs::read(fixture.root.join("selected.txt")).unwrap(),
        b"base\n"
    );
}

#[test]
fn reviewed_renames_type_changes_and_unmerged_files_are_refused_as_a_whole_batch() {
    for kind in ["rename", "type-change", "unmerged"] {
        let (fixture, repository) = setup();

        match kind {
            "rename" => {
                fixture.git(&["mv", "selected.txt", "renamed.txt"]);
            }
            "type-change" => {
                fs::remove_file(fixture.root.join("selected.txt")).unwrap();
                symlink("missing", fixture.root.join("selected.txt")).unwrap();
            }
            "unmerged" => {
                fixture.git(&["switch", "-c", "topic"]);
                fixture.write("selected.txt", "theirs\n");
                fixture.commit("Theirs");
                fixture.git(&["switch", "main"]);
                fixture.write("selected.txt", "ours\n");
                fixture.commit("Ours");
                assert!(
                    fixture
                        .process()
                        .run(GitCommand::new(&fixture.root, ["merge", "topic"]))
                        .is_err()
                );
            }
            _ => unreachable!(),
        }

        let path = if kind == "rename" {
            "renamed.txt"
        } else {
            "selected.txt"
        };

        let request = review(&fixture, &repository, &[path]);
        let before = common::files_under(&fixture.root);
        let error = repository.discard_files(&request, None).unwrap_err();

        assert_eq!(error.phase, WritePhase::BeforeCommand, "{kind}");
        assert!(error.recovery.is_none());
        assert!(!fixture.temporary.path().join("recovery").exists());
        assert_eq!(common::files_under(&fixture.root), before);
    }
}

#[test]
#[cfg(unix)]
fn lower_request_uses_private_disk_recovery_and_newest_success_replaces_only_the_token() {
    let (fixture, repository) = setup();

    fixture.write("selected.txt", "first\n");
    let request = DiscardFiles {
        paths: vec![
            "selected.txt".try_into().unwrap(),
            "selected.txt".try_into().unwrap(),
        ],
        allow_destructive: true,
        recovery: None,
    };

    let first = repository.discard_files(&request, None).unwrap();

    fixture.write("selected.txt", "second\n");
    let second = repository.discard_files(&request, None).unwrap();

    assert_ne!(first.undo.token, second.undo.token);
    assert!(repository.undo_discard(&first.undo.token, None).is_err());
    assert!(first.recovery.directory.join("working.patch").exists());
    repository.undo_discard(&second.undo.token, None).unwrap();
    assert_eq!(
        fs::read(fixture.root.join("selected.txt")).unwrap(),
        b"second\n"
    );

    for backup in [first.recovery.directory, second.recovery.directory] {
        assert!(
            backup
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("1git-discard-recovery-")
        );
        assert_eq!(
            fs::metadata(&backup).unwrap().permissions().mode() & 0o777,
            0o700
        );
        fs::remove_dir_all(backup).unwrap();
    }
}

#[test]
fn expiration_refuses_undo_and_keeps_the_complete_backup() {
    let (fixture, repository) = setup();

    fixture.write("selected.txt", "expire\n");
    let result = repository
        .discard_files(&review(&fixture, &repository, &["selected.txt"]), None)
        .unwrap();

    let expiration = chrono::DateTime::parse_from_rfc3339(&result.undo.expires_at)
        .unwrap()
        .timestamp_millis();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    assert!((14_000..=15_000).contains(&(expiration - now)));
    std::thread::sleep(Duration::from_millis((expiration - now + 20) as u64));
    let before = common::files_under(&fixture.root);

    let error = repository
        .undo_discard(&result.undo.token, None)
        .unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert_eq!(common::files_under(&fixture.root), before);
    assert!(result.recovery.directory.join("README.txt").exists());
}

#[test]
#[cfg(unix)]
fn failed_compensation_keeps_the_original_error_and_reports_its_own_failure() {
    let (fixture, _) = setup();

    mixed(&fixture);
    let process = wrapper(
        &fixture,
        r#"
if [ "$1" = apply ]; then
 check=false; cached=false; reverse=false
 for value in "$@"; do
  [ "$value" != '--check' ] || check=true
  [ "$value" != '--cached' ] || cached=true
  [ "$value" != '--reverse' ] || reverse=true
 done
 if [ "$check" = false ] && [ "$reverse" = true ] && [ "$cached" = true ]; then
  printf 'original failure\n' >&2; exit 73
 fi
 if [ "$check" = false ] && [ "$reverse" = false ]; then
  printf 'compensation failure\n' >&2; exit 74
 fi
fi"#,
    );

    let repository = Repository::open(&fixture.root, process, None).unwrap();

    let error = repository
        .discard_files(&review(&fixture, &repository, &["selected.txt"]), None)
        .unwrap_err();

    assert_eq!(error.phase, WritePhase::Command);
    assert!(
        matches!(error.error, RepositoryError::Git(GitError::CommandFailed { status, .. }) if status.code()==Some(73))
    );
    assert!(
        matches!(error.rollback_error.as_deref(), Some(RepositoryError::Git(GitError::CommandFailed { status, .. })) if status.code()==Some(74))
    );
    assert!(error.recovery.unwrap().complete);
    assert_eq!(fixture.git(&["show", ":selected.txt"]), b"staged\n");
    assert_eq!(
        fs::read(fixture.root.join("selected.txt")).unwrap(),
        b"base\n"
    );
}

#[test]
#[cfg(unix)]
fn refresh_failure_retains_completed_discard_and_the_manual_recovery_files() {
    let (fixture, _) = setup();

    mixed(&fixture);
    let process = wrapper(
        &fixture,
        r#"
if [ "$1" = apply ]; then
 check=false
 for value in "$@"; do [ "$value" != '--check' ] || check=true; done
 if [ "$check" = false ]; then : > ../mutated; fi
fi
if [ "$1" = '--no-optional-locks' ] && [ "$2" = status ] && [ -f ../mutated ]; then
 printf 'post-discard refresh failure\n' >&2; exit 75
fi"#,
    );

    let repository = Repository::open(&fixture.root, process, None).unwrap();

    let error = repository
        .discard_files(&review(&fixture, &repository, &["selected.txt"]), None)
        .unwrap_err();

    assert_eq!(error.phase, WritePhase::Refresh);
    assert!(error.recovery.unwrap().complete);
    assert_eq!(
        fs::read(fixture.root.join("selected.txt")).unwrap(),
        b"base\n"
    );
    assert_eq!(fixture.git(&["show", ":selected.txt"]), b"base\n");
    assert_eq!(
        fs::read(fixture.root.join("new[1].bin")).unwrap(),
        [0, 1, 255, 19]
    );
}

#[cfg(target_os = "macos")]
#[test]
#[cfg(unix)]
fn a_real_fsync_error_stops_before_discard_and_retains_only_partial_recovery() {
    if std::env::var("ONEGIT_DISCARD_FSYNC_CHILD").as_deref() != Ok("isolated-child") {
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("fsync-failure.c");
        let library = temporary.path().join("fsync-failure.dylib");
        let marker = temporary.path().join("injected");

        fs::write(
            &source,
            r#"
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
static int injected_fcntl(int fd, int command, ...) {
 char path[PATH_MAX];
 if (command == F_FULLFSYNC && fcntl(fd, F_GETPATH, path) == 0) {
  const char *leaf = strrchr(path, '/');
  if (leaf && strcmp(leaf, "/working.patch") == 0) {
   const char *marker = getenv("ONEGIT_FSYNC_MARKER");
   if (marker) {
    int output = open(marker, O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (output >= 0) { (void)write(output, "injected", 8); close(output); }
   }
   errno = EIO;
   return -1;
  }
 }
 if (command == F_FULLFSYNC) return fcntl(fd, command);
 va_list arguments;
 va_start(arguments, command);
 int result;
 switch (command) {
  case F_GETFD: case F_GETFL: case F_GETOWN:
#ifdef F_GETNOSIGPIPE
  case F_GETNOSIGPIPE:
#endif
#ifdef F_BARRIERFSYNC
  case F_BARRIERFSYNC:
#endif
   result = fcntl(fd, command); break;
  case F_SETFD: case F_SETFL: case F_SETOWN: case F_DUPFD: case F_DUPFD_CLOEXEC:
  case F_NOCACHE:
#ifdef F_SETNOSIGPIPE
  case F_SETNOSIGPIPE:
#endif
   result = fcntl(fd, command, va_arg(arguments, int)); break;
  default:
   result = fcntl(fd, command, va_arg(arguments, void *)); break;
 }
 va_end(arguments);
 return result;
}

__attribute__((used)) static const struct { const void *replacement; const void *replacee; }
interpose __attribute__((section("__DATA,__interpose"))) = {
 (const void *)&injected_fcntl, (const void *)&fcntl
};
"#,
        )
        .unwrap();
        let mut compile = ToolCommand::new(
            Path::new("/usr/bin/clang"),
            temporary.path(),
            [
                "-dynamiclib".into(),
                "-Wall".into(),
                "-Wextra".into(),
                "-Werror".into(),
                "-o".into(),
                library.as_os_str().to_owned(),
                source.into_os_string(),
            ],
        );

        compile.timeout = Duration::from_secs(30);
        execute_tool(compile)
            .unwrap_or_else(|error| panic!("Fault fixture compiler failed: {error:?}"));
        let arguments = vec![
            format!("DYLD_INSERT_LIBRARIES={}", library.display()).into(),
            "ONEGIT_DISCARD_FSYNC_CHILD=isolated-child".into(),
            format!("ONEGIT_FSYNC_MARKER={}", marker.display()).into(),
            std::env::current_exe().unwrap().into_os_string(),
            "--exact".into(),
            "a_real_fsync_error_stops_before_discard_and_retains_only_partial_recovery".into(),
            "--nocapture".into(),
        ];

        let mut probe = ToolCommand::new(Path::new("/usr/bin/env"), temporary.path(), arguments);

        probe.timeout = Duration::from_secs(30);
        execute_tool(probe).unwrap_or_else(|error| panic!("Fault fixture child failed: {error:?}"));
        assert_eq!(fs::read(marker).unwrap(), b"injected");

        return;
    }

    let (fixture, repository) = setup();

    mixed(&fixture);
    let request = review(&fixture, &repository, &["selected.txt"]);
    let before = common::files_under(&fixture.root);
    let error = repository.discard_files(&request, None).unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert!(
        matches!(error.error, RepositoryError::Io(error) if error.raw_os_error()==Some(libc::EIO))
    );
    assert!(!error.recovery.unwrap().complete);
    assert!(
        !fixture
            .temporary
            .path()
            .join("recovery/README.txt")
            .exists()
    );
    assert_eq!(common::files_under(&fixture.root), before);
}

#[test]
fn lower_requests_preserve_rename_and_type_change_undo_semantics() {
    for kind in ["rename", "type-change"] {
        let (fixture, repository) = setup();

        let path = if kind == "rename" {
            fixture.git(&["mv", "selected.txt", "renamed.txt"]);

            "renamed.txt"
        } else {
            fs::remove_file(fixture.root.join("selected.txt")).unwrap();
            symlink("missing-target", fixture.root.join("selected.txt")).unwrap();

            "selected.txt"
        };

        let request = DiscardFiles {
            paths: vec![path.try_into().unwrap()],
            allow_destructive: true,
            recovery: None,
        };

        if cfg!(windows) && kind == "type-change" {
            let error = repository.discard_files(&request, None).unwrap_err();

            assert_eq!(error.phase, WritePhase::BeforeCommand);
            assert!(error.recovery.is_none());
            assert_eq!(
                fs::read_link(fixture.root.join("selected.txt")).unwrap(),
                Path::new("missing-target")
            );
            continue;
        }

        let result = repository.discard_files(&request, None).unwrap();

        assert_eq!(
            fs::read(fixture.root.join("selected.txt")).unwrap(),
            b"base\n"
        );
        assert!(result.snapshot.status.files.is_empty());
        repository.undo_discard(&result.undo.token, None).unwrap();

        if kind == "rename" {
            assert!(!fixture.root.join("selected.txt").exists());
            assert_eq!(
                fs::read(fixture.root.join("renamed.txt")).unwrap(),
                b"base\n"
            );
        } else {
            assert_eq!(
                fs::read_link(fixture.root.join("selected.txt")).unwrap(),
                Path::new("missing-target")
            );
        }

        fs::remove_dir_all(result.recovery.directory).unwrap();
    }
}

#[test]
fn replaced_recovery_entries_are_rejected_even_when_the_old_descriptor_has_valid_bytes() {
    let (fixture, repository) = setup();

    mixed(&fixture);
    let result = repository
        .discard_files(&review(&fixture, &repository, &["selected.txt"]), None)
        .unwrap();

    let working = result.recovery.directory.join("working.patch");
    let retired = result.recovery.directory.join("retired.patch");

    fs::rename(&working, &retired).unwrap();
    fs::copy(&retired, &working).unwrap();
    let before = common::files_under(&fixture.root);

    let error = repository
        .undo_discard(&result.undo.token, None)
        .unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert_eq!(common::files_under(&fixture.root), before);
    assert_eq!(fs::read(&working).unwrap(), fs::read(retired).unwrap());
}

#[test]
#[cfg(unix)]
fn branch_change_after_complete_backup_is_refused_without_reversing_working_data() {
    let (fixture, _) = setup();

    mixed(&fixture);
    let process = wrapper(
        &fixture,
        r#"
if [ "$1" = '--no-optional-locks' ] && [ "$2" = status ] && [ -f ../recovery/README.txt ]; then
 git symbolic-ref HEAD refs/heads/other
fi"#,
    );

    let repository = Repository::open(&fixture.root, process, None).unwrap();

    let error = repository
        .discard_files(&review(&fixture, &repository, &["selected.txt"]), None)
        .unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert!(error.recovery.unwrap().complete);
    assert_eq!(
        fixture.git(&["symbolic-ref", "HEAD"]),
        b"refs/heads/other\n"
    );
    assert_eq!(
        fs::read(fixture.root.join("selected.txt")).unwrap(),
        b"working\n"
    );
    assert_eq!(fixture.git(&["show", ":selected.txt"]), b"staged\n");
}

#[test]
#[cfg(unix)]
fn cancellation_after_apply_preserves_discard_and_joins_the_refresh_worker() {
    let (fixture, _) = setup();

    mixed(&fixture);
    let process = wrapper(
        &fixture,
        r#"
if [ "$1" = apply ]; then
 check=false
 for value in "$@"; do [ "$value" != '--check' ] || check=true; done
 if [ "$check" = false ]; then : > ../mutated; fi
fi
if [ "$1" = '--no-optional-locks' ] && [ "$2" = status ] && [ -f ../mutated ]; then
 : > ../refresh-started
 while [ ! -f ../never-release ]; do sleep 0.01; done
fi"#,
    );

    let repository = Repository::open(&fixture.root, process, None).unwrap();
    let request = review(&fixture, &repository, &["selected.txt"]);
    let cancellation = Cancellation::default();
    let worker_cancel = cancellation.clone();

    let worker =
        std::thread::spawn(move || repository.discard_files(&request, Some(&worker_cancel)));

    wait_file(&fixture.temporary.path().join("refresh-started"));
    cancellation.cancel();
    let error = worker.join().unwrap().unwrap_err();

    assert_eq!(error.phase, WritePhase::Refresh);
    assert!(matches!(
        error.error,
        RepositoryError::Git(GitError::Cancelled)
    ));
    assert!(error.recovery.unwrap().complete);
    assert_eq!(
        fs::read(fixture.root.join("selected.txt")).unwrap(),
        b"base\n"
    );
    assert_eq!(fixture.git(&["show", ":selected.txt"]), b"base\n");
}

#[test]
fn discarding_a_hardlinked_working_file_never_changes_the_other_link() {
    let (fixture, repository) = setup();

    mixed(&fixture);
    let outside = fixture.temporary.path().join("outside-link");

    fs::hard_link(fixture.root.join("selected.txt"), &outside).unwrap();
    let result = repository
        .discard_files(&review(&fixture, &repository, &["selected.txt"]), None)
        .unwrap();

    assert_eq!(
        fs::read(fixture.root.join("selected.txt")).unwrap(),
        b"base\n"
    );
    assert_eq!(fs::read(&outside).unwrap(), b"working\n");
    repository.undo_discard(&result.undo.token, None).unwrap();
    assert_eq!(
        fs::read(fixture.root.join("selected.txt")).unwrap(),
        b"working\n"
    );
    assert_eq!(fs::read(outside).unwrap(), b"working\n");
}

#[cfg(windows)]
#[test]
fn windows_discard_refuses_final_symlinks_without_reading_or_changing_targets() {
    let (fixture, repository) = setup();
    let outside = fixture.temporary.path().join("outside");

    fs::write(&outside, b"private target bytes").unwrap();
    symlink(&outside, fixture.root.join("external")).unwrap();
    let before = common::files_under(&fixture.root);

    let error = repository
        .discard_files(&review(&fixture, &repository, &["external"]), None)
        .unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert!(error.recovery.is_none());
    assert_eq!(fs::read(&outside).unwrap(), b"private target bytes");
    assert_eq!(
        fs::read_link(fixture.root.join("external")).unwrap(),
        outside
    );
    assert_eq!(common::files_under(&fixture.root), before);
}
