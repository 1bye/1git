//! Covers: source ignore-rule parity, reviewed append, preservation and failure boundaries.
//! Real: isolated Git/index/worktree, filesystem modes/links/FIFO and shared mutation queue.
//! Doubles: child-only Git wrappers for concurrent changes, cancellation and refresh failure.
//! Requires: local POSIX Git and temporary storage; no network, accounts or native UI.

mod common;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use common::Fixture;

use onegit_git::{
    BranchIdentity, Cancellation, FileStatus, GitCommand, GitError, GitProcess, IgnoreFile,
    IgnoreRule, OperationState, Repository, RepositoryCoordinator, RepositoryError, WritePhase,
    ignore_extension, ignore_folders, ignore_pattern,
};

use std::ffi::{CString, OsString};
use std::fs;
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::Path;
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

fn request(repository: &Repository, path: &str, rule: IgnoreRule) -> IgnoreFile {
    IgnoreFile {
        path: path.into(),
        rule,
        expected: BranchIdentity::from_snapshot(&repository.snapshot(false, None).unwrap()),
    }
}

fn selected() -> (Fixture, Repository, IgnoreFile) {
    let fixture = Fixture::new();

    fixture.write("selected.txt", "original\n");
    fixture.commit("Base");
    fixture.write("selected.txt", "changed\n");
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let request = request(&repository, "selected.txt", IgnoreRule::File);

    (fixture, repository, request)
}

fn wrapper(fixture: &Fixture, body: &str) -> GitProcess {
    let path = fixture.temporary.path().join("git-wrapper");

    fs::write(
        &path,
        format!(
            "#!/bin/sh\nset -eu\ninspect_command() {{\nshift 4\n{body}\n}}\ninspect_command \"$@\"\nexec git \"$@\"\n"
        ),
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

fn wait_file(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(5);

    while !path.exists() {
        assert!(Instant::now() < deadline, "missing Git signal: {path:?}");
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn public_suggestions_and_patterns_match_all_actual_typescript_cases() {
    let reference: serde_json::Value = serde_json::from_str(include_str!(
        "../fixtures/ignore-rules.json"
    ))
    .unwrap();

    for case in reference["cases"].as_array().unwrap() {
        let path = case["path"].as_str().unwrap();

        let rule = match case["rule"]["kind"].as_str().unwrap() {
            "file" => IgnoreRule::File,
            "extension" => IgnoreRule::Extension,
            "folder" => IgnoreRule::Folder(case["rule"]["path"].as_str().unwrap().into()),
            other => panic!("unknown source rule {other}"),
        };

        assert_eq!(ignore_extension(path), case["extension"].as_str(), "{case}");
        assert_eq!(
            serde_json::json!(ignore_folders(path)),
            case["folders"],
            "{case}"
        );
        let actual = ignore_pattern(Path::new(path), &rule);

        assert_eq!(
            actual.is_err(),
            case["rejected"].as_bool().unwrap(),
            "{case}"
        );

        if let Ok(pattern) = actual {
            assert_eq!(pattern, case["pattern"].as_str().unwrap(), "{case}");
        }
    }
}

#[test]
fn public_append_matches_frozen_source_bytes_and_keeps_mode_and_index() {
    let reference: serde_json::Value = serde_json::from_str(include_str!(
        "../fixtures/ignore-rules.json"
    ))
    .unwrap();

    for case in reference["appends"].as_array().unwrap() {
        let fixture = Fixture::new();
        let path = case["path"].as_str().unwrap();

        fixture.write(path, "original\n");
        fixture.commit("Base");
        fixture.write(path, "changed\n");
        let ignore = fixture.root.join(".gitignore");

        fs::write(
            &ignore,
            STANDARD.decode(case["before"].as_str().unwrap()).unwrap(),
        )
        .unwrap();
        fs::set_permissions(&ignore, fs::Permissions::from_mode(0o640)).unwrap();
        let index = fs::read(fixture.root.join(".git/index")).unwrap();
        let head = fixture.git(&["rev-parse", "HEAD"]);
        let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
        let request = request(&repository, path, IgnoreRule::File);

        let mut settled_modified = None;

        for _ in 0..2 {
            repository.ignore_file(&request, None).unwrap();
            assert_eq!(
                fs::read(&ignore).unwrap(),
                STANDARD.decode(case["after"].as_str().unwrap()).unwrap(),
                "{}",
                case["name"]
            );
            let modified = fs::metadata(&ignore).unwrap().modified().unwrap();

            if let Some(settled) = settled_modified {
                assert_eq!(
                    modified, settled,
                    "duplicate must not write: {}",
                    case["name"]
                );
            }

            settled_modified = Some(modified);
        }

        assert_eq!(
            fs::metadata(&ignore).unwrap().permissions().mode() & 0o777,
            0o640
        );
        assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
        assert_eq!(fixture.git(&["rev-parse", "HEAD"]), head);
        assert_eq!(fs::read(fixture.root.join(path)).unwrap(), b"changed\n");
    }
}

#[test]
fn literal_rule_ignores_only_the_exact_path_and_keeps_all_working_bytes() {
    let fixture = Fixture::new();
    let path = "src/#file[1]*?!\\ .tsx ";

    fs::create_dir(fixture.root.join("src")).unwrap();
    fixture.write(path, "keep\n");
    fixture.write("src/file1.tsx", "neighbor\n");
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    let result = repository
        .ignore_file(&request(&repository, path, IgnoreRule::File), None)
        .unwrap();

    assert_eq!(result.status.files.len(), 2);
    assert!(
        result
            .status
            .files
            .iter()
            .any(|file| file.path == Path::new("src/file1.tsx"))
    );
    let input = format!("{path}\0");
    let mut command = GitCommand::new(&fixture.root, ["check-ignore", "-z", "--stdin"]);

    command.stdin = input.as_bytes();
    assert_eq!(
        fixture.process().run(command).unwrap().stdout,
        input.as_bytes()
    );
    assert_eq!(fs::read(fixture.root.join(path)).unwrap(), b"keep\n");
    assert_eq!(
        fs::read(fixture.root.join("src/file1.tsx")).unwrap(),
        b"neighbor\n"
    );
    assert!(fixture.git(&["ls-files"]).is_empty());
}

#[test]
fn folder_rules_are_root_anchored_and_extension_rules_apply_at_every_depth() {
    for (rule, expected, visible) in [
        (
            IgnoreRule::Folder("src/cache".into()),
            "/src/cache/\n",
            vec![".gitignore", "other/a.txt"],
        ),
        (
            IgnoreRule::Extension,
            "*.txt\n",
            vec![".gitignore", "src/cache/b.bin"],
        ),
    ] {
        let fixture = Fixture::new();

        fs::create_dir_all(fixture.root.join("src/cache")).unwrap();
        fs::create_dir(fixture.root.join("other")).unwrap();
        fixture.write("src/cache/a.txt", "a\n");
        fixture.write("src/cache/b.bin", "b\n");
        fixture.write("other/a.txt", "other\n");
        let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

        let snapshot = repository
            .ignore_file(&request(&repository, "src/cache/a.txt", rule), None)
            .unwrap();

        assert_eq!(
            fs::read(fixture.root.join(".gitignore")).unwrap(),
            expected.as_bytes()
        );
        let actual: Vec<_> = snapshot
            .status
            .files
            .iter()
            .map(|file| file.path.to_str().unwrap())
            .collect();

        assert_eq!(actual, visible);
        assert_eq!(
            fs::read(fixture.root.join("src/cache/b.bin")).unwrap(),
            b"b\n"
        );
    }
}

#[test]
fn tracked_staged_and_working_contents_remain_intact_with_no_optional_index_writes() {
    let (fixture, repository, request) = selected();

    fixture.write("selected.txt", "staged\n");
    fixture.git_os(["add", "--", "selected.txt"].map(OsString::from));
    fixture.write("selected.txt", "working\n");
    let before = common::files_under(&fixture.root);
    let snapshot = repository.ignore_file(&request, None).unwrap();
    let mut after = common::files_under(&fixture.root);

    after.remove(Path::new(".gitignore"));
    assert_eq!(before, after);
    assert_eq!(fixture.git(&["show", ":selected.txt"]), b"staged\n");
    assert_eq!(
        snapshot
            .status
            .files
            .iter()
            .find(|file| file.path == request.path)
            .unwrap()
            .index_status,
        FileStatus::Modified
    );
}

#[test]
fn unborn_and_detached_reviews_keep_head_and_index_unchanged() {
    for detached in [false, true] {
        let fixture = Fixture::new();

        if detached {
            fixture.write("base", "base\n");
            fixture.commit("Base");
            fixture.git(&["switch", "--detach"]);
        }

        fixture.write("selected.txt", "new\n");
        let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
        let request = request(&repository, "selected.txt", IgnoreRule::File);
        let before = common::files_under(&fixture.root.join(".git"));
        let snapshot = repository.ignore_file(&request, None).unwrap();

        assert_eq!(BranchIdentity::from_snapshot(&snapshot), request.expected);
        assert_eq!(snapshot.status.files.len(), 1);
        assert_eq!(snapshot.status.files[0].path, Path::new(".gitignore"));
        assert_eq!(common::files_under(&fixture.root.join(".git")), before);
    }
}

#[test]
fn stale_head_branch_missing_selection_and_invalid_inputs_do_not_create_ignore_file() {
    let (fixture, repository, valid) = selected();
    let mut stale_head = valid.clone();

    stale_head.expected.oid = Some("0".repeat(40));
    let mut stale_branch = valid.clone();

    stale_branch.expected.branch = Some("other".into());
    let mut absent = valid.clone();

    absent.path = "absent".into();
    let mut invalid = valid.clone();

    invalid.path = "a\n*.txt".into();
    let mut non_utf8 = valid.clone();

    non_utf8.path = OsString::from_vec(vec![b'x', 255]).into();
    let mut unrelated = valid.clone();

    unrelated.rule = IgnoreRule::Folder("elsewhere".into());
    let before = common::files_under(&fixture.root);

    for request in [
        stale_head,
        stale_branch,
        absent,
        invalid,
        non_utf8,
        unrelated,
    ] {
        assert_eq!(
            repository.ignore_file(&request, None).unwrap_err().phase,
            WritePhase::BeforeCommand
        );
        assert_eq!(common::files_under(&fixture.root), before);
    }
}

#[test]
fn every_active_operation_marker_refuses_even_an_ordinary_changed_file() {
    for marker in [
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "SQUASH_MSG",
        "rebase-merge/head-name",
        "rebase-apply/head-name",
    ] {
        let (fixture, repository, request) = selected();
        let path = fixture.root.join(".git").join(marker);

        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "paused\n").unwrap();
        let before = common::files_under(&fixture.root);
        let error = repository.ignore_file(&request, None).unwrap_err();

        assert_eq!(error.phase, WritePhase::BeforeCommand, "{marker}");
        assert_eq!(common::files_under(&fixture.root), before, "{marker}");
    }
}

#[test]
fn conflicting_selected_file_is_rejected_without_touching_resolution_or_ignore_data() {
    let (fixture, repository, _) = selected();

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
    fs::remove_file(fixture.root.join(".git/MERGE_HEAD")).unwrap();
    assert_eq!(
        repository.snapshot(false, None).unwrap().operation,
        OperationState::Normal
    );
    let request = request(&repository, "selected.txt", IgnoreRule::File);
    let before = common::files_under(&fixture.root);

    assert_eq!(
        repository.ignore_file(&request, None).unwrap_err().phase,
        WritePhase::BeforeCommand
    );
    assert_eq!(common::files_under(&fixture.root), before);
}

#[test]
fn refuses_symlink_hardlink_directory_fifo_and_oversized_ignore_files() {
    for kind in [
        "symlink",
        "dangling",
        "hardlink",
        "directory",
        "fifo",
        "large",
    ] {
        let (fixture, repository, request) = selected();
        let ignore = fixture.root.join(".gitignore");
        let target = fixture.temporary.path().join("outside");

        fs::write(&target, "outside\n").unwrap();

        match kind {
            "symlink" => symlink(&target, &ignore).unwrap(),
            "dangling" => symlink(fixture.temporary.path().join("missing"), &ignore).unwrap(),
            "hardlink" => fs::hard_link(&target, &ignore).unwrap(),
            "directory" => fs::create_dir(&ignore).unwrap(),
            "fifo" => {
                let name = CString::new(ignore.as_os_str().as_bytes()).unwrap();

                // SAFETY: name owns a NUL-terminated path within this private fixture.
                assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
            }
            "large" => fs::write(&ignore, vec![b'#'; 1024 * 1024 + 1]).unwrap(),
            _ => unreachable!(),
        }

        let before = fs::symlink_metadata(&ignore).unwrap();
        let index = fs::read(fixture.root.join(".git/index")).unwrap();
        let start = Instant::now();
        let error = repository.ignore_file(&request, None).unwrap_err();

        assert_eq!(error.phase, WritePhase::BeforeCommand, "{kind}");
        assert!(
            start.elapsed() < Duration::from_secs(3),
            "must not block on {kind}"
        );
        assert_eq!(fs::read(&target).unwrap(), b"outside\n");
        assert_eq!(fs::symlink_metadata(&ignore).unwrap().len(), before.len());
        assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    }
}

#[test]
fn exact_one_mib_source_boundary_appends_then_refuses_a_later_edit() {
    let (fixture, repository, request) = selected();
    let ignore = fixture.root.join(".gitignore");
    let original = vec![b'#'; 1024 * 1024];

    fs::write(&ignore, &original).unwrap();
    repository.ignore_file(&request, None).unwrap();
    let after = fs::read(&ignore).unwrap();

    assert!(after.starts_with(&original));
    assert!(after.ends_with(b"\n/selected.txt\n"));
    assert_eq!(
        repository.ignore_file(&request, None).unwrap_err().phase,
        WritePhase::BeforeCommand
    );
    assert_eq!(fs::read(&ignore).unwrap(), after);
}

#[test]
fn cancelled_request_and_replaced_root_never_write_the_old_or_substituted_directory() {
    let (fixture, repository, request) = selected();
    let cancellation = Cancellation::default();

    cancellation.cancel();
    let before = common::files_under(&fixture.root);

    let error = repository
        .ignore_file(&request, Some(&cancellation))
        .unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert!(matches!(
        error.error,
        RepositoryError::Git(GitError::Cancelled)
    ));
    assert_eq!(common::files_under(&fixture.root), before);
    let moved = fixture.temporary.path().join("moved");

    fs::rename(&fixture.root, &moved).unwrap();
    fs::create_dir(&fixture.root).unwrap();
    let error = repository.ignore_file(&request, None).unwrap_err();

    assert_eq!(error.phase, WritePhase::BeforeCommand);
    assert!(!fixture.root.join(".gitignore").exists());
    assert!(!moved.join(".gitignore").exists());
}

#[test]
fn second_preflight_detects_selected_file_and_branch_changes_before_creation() {
    for action in [
        "git restore -- selected.txt",
        "git symbolic-ref HEAD refs/heads/other",
    ] {
        let (fixture, _, request) = selected();

        let body = format!(
            r#"
if [ "$1" = "--no-optional-locks" ]; then
 count=0; [ ! -f ../counter ] || count=$(cat ../counter)
 count=$((count + 1)); printf '%s' "$count" > ../counter
 if [ "$count" -eq 2 ]; then {action}; fi
fi"#
        );

        let process = wrapper(&fixture, &body);
        let repository = Repository::open(&fixture.root, process, None).unwrap();
        let error = repository.ignore_file(&request, None).unwrap_err();

        assert_eq!(error.phase, WritePhase::BeforeCommand);
        assert!(!fixture.root.join(".gitignore").exists());
    }
}

#[test]
fn concurrent_append_replacement_links_and_creation_are_preserved_and_not_replayed() {
    for (existing, action, expected) in [
        (
            true,
            "printf 'other\\n' >> .gitignore",
            "# original\nother\n",
        ),
        (
            true,
            "mv .gitignore ../retired; printf 'other\\n' > .gitignore",
            "other\n",
        ),
        (
            true,
            "mv .gitignore ../retired; ln -s ../outside .gitignore",
            "outside\n",
        ),
        (true, "ln .gitignore ../hardlink", "# original\n"),
        (false, "printf 'other\\n' > .gitignore", "other\n"),
    ] {
        let (fixture, _, request) = selected();

        fs::write(fixture.temporary.path().join("outside"), "outside\n").unwrap();

        if existing {
            fixture.write(".gitignore", "# original\n");
        }

        let body = format!(
            r#"
if [ "$1" = "--no-optional-locks" ]; then
 count=0; [ ! -f ../counter ] || count=$(cat ../counter)
 count=$((count + 1)); printf '%s' "$count" > ../counter
 if [ "$count" -eq 2 ]; then
  git "$@"
  {action}
  exit 0
 fi
fi"#
        );

        let process = wrapper(&fixture, &body);
        let repository = Repository::open(&fixture.root, process, None).unwrap();
        let error = repository.ignore_file(&request, None).unwrap_err();

        assert_eq!(error.phase, WritePhase::BeforeCommand, "{action}");
        assert_eq!(
            fs::read(fixture.root.join(".gitignore")).unwrap(),
            expected.as_bytes(),
            "{action}"
        );
        assert_eq!(
            fs::read(fixture.temporary.path().join("outside")).unwrap(),
            b"outside\n"
        );

        if fixture.temporary.path().join("retired").exists() {
            assert_eq!(
                fs::read(fixture.temporary.path().join("retired")).unwrap(),
                b"# original\n"
            );
        }
    }
}

#[test]
fn successful_append_with_failed_refresh_retains_exact_bytes_and_reports_refresh_phase() {
    let (fixture, _, request) = selected();

    let process = wrapper(
        &fixture,
        r#"
if [ "$1" = "--no-optional-locks" ] && [ -f .gitignore ]; then
 printf 'injected status failure\n' >&2
 exit 74
fi"#,
    );

    let repository = Repository::open(&fixture.root, process, None).unwrap();
    let before = common::files_under(&fixture.root.join(".git"));
    let error = repository.ignore_file(&request, None).unwrap_err();

    assert_eq!(error.phase, WritePhase::Refresh);
    assert!(matches!(
        error.error,
        RepositoryError::Git(GitError::CommandFailed { .. })
    ));
    assert_eq!(
        fs::read(fixture.root.join(".gitignore")).unwrap(),
        b"/selected.txt\n"
    );
    assert_eq!(common::files_under(&fixture.root.join(".git")), before);
}

#[test]
fn partial_append_reports_command_phase_and_preserves_the_existing_prefix() {
    if std::env::var_os("ONEGIT_IGNORE_WRITE_LIMIT").is_none() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "partial_append_reports_command_phase_and_preserves_the_existing_prefix",
                "--nocapture",
            ])
            .env("ONEGIT_IGNORE_WRITE_LIMIT", "isolated-child")
            .output()
            .unwrap();

        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );

        return;
    }

    let (fixture, repository, request) = selected();
    let original = b"# preserved\n";

    fixture.write(".gitignore", std::str::from_utf8(original).unwrap());
    let index = fs::read(fixture.root.join(".git/index")).unwrap();

    let limit = libc::rlimit {
        rlim_cur: original.len() as libc::rlim_t + 3,
        rlim_max: original.len() as libc::rlim_t + 3,
    };

    // SAFETY: only this re-executed single-test child changes its signal/size limits.
    // The fixture is already initialized; all remaining Git invocations are read-only.
    unsafe {
        assert_ne!(libc::signal(libc::SIGXFSZ, libc::SIG_IGN), libc::SIG_ERR);
        assert_eq!(libc::setrlimit(libc::RLIMIT_FSIZE, &limit), 0);
    }

    let error = repository.ignore_file(&request, None).unwrap_err();
    let after = fs::read(fixture.root.join(".gitignore")).unwrap();

    assert_eq!(error.phase, WritePhase::Command);
    assert!(matches!(error.error, RepositoryError::Io(_)));
    assert_eq!(after.len(), limit.rlim_cur as usize);
    assert!(after.starts_with(original));
    assert_eq!(&after[original.len()..], b"/se");
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
}

#[test]
fn cancellation_during_post_append_refresh_keeps_the_append_and_joins_the_worker() {
    let (fixture, _, request) = selected();

    let process = wrapper(
        &fixture,
        r#"
if [ "$1" = "--no-optional-locks" ] && [ -f .gitignore ]; then
 : > ../refresh-started
 while [ ! -f ../never-release ]; do sleep 0.01; done
fi"#,
    );

    let repository = Repository::open(&fixture.root, process, None).unwrap();
    let cancellation = Cancellation::default();
    let worker_cancel = cancellation.clone();
    let worker = std::thread::spawn(move || repository.ignore_file(&request, Some(&worker_cancel)));

    wait_file(&fixture.temporary.path().join("refresh-started"));
    cancellation.cancel();
    let error = worker.join().unwrap().unwrap_err();

    assert_eq!(error.phase, WritePhase::Refresh);
    assert!(matches!(
        error.error,
        RepositoryError::Git(GitError::Cancelled)
    ));
    assert_eq!(
        fs::read(fixture.root.join(".gitignore")).unwrap(),
        b"/selected.txt\n"
    );
}

#[test]
fn shared_queue_keeps_a_later_index_write_and_reader_behind_ignore_refresh() {
    let (fixture, _, request) = selected();

    let process = wrapper(
        &fixture,
        r#"
if [ "$1" = "--no-optional-locks" ] && [ -f .gitignore ] && [ ! -f ../release ]; then
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
    let first_worker = std::thread::spawn(move || first.ignore_file(&request, None));

    wait_file(&fixture.temporary.path().join("refresh-started"));
    assert_eq!(coordinator.pending_writes(&common), 1);
    let (finished, received) = mpsc::channel();
    let writer = Arc::clone(&second);

    let second_worker = std::thread::spawn(move || {
        let result = writer.stage(&["selected.txt".into()], None);

        finished.send(()).unwrap();

        result
    });

    let (read_finished, read_received) = mpsc::channel();
    let reader = Arc::clone(&second);

    let reader_worker = std::thread::spawn(move || {
        let result = reader.snapshot(false, None);

        read_finished.send(()).unwrap();

        result
    });

    assert!(received.recv_timeout(Duration::from_millis(100)).is_err());
    assert!(
        read_received
            .recv_timeout(Duration::from_millis(100))
            .is_err()
    );
    fs::write(fixture.temporary.path().join("release"), "release").unwrap();
    first_worker.join().unwrap().unwrap();
    second_worker.join().unwrap().unwrap();
    reader_worker.join().unwrap().unwrap();
    assert_eq!(coordinator.pending_writes(&common), 0);
    assert_eq!(fixture.git(&["show", ":selected.txt"]), b"changed\n");
    assert_eq!(
        fs::read(fixture.root.join(".gitignore")).unwrap(),
        b"/selected.txt\n"
    );
}
