//! Real repository writes verify exact index contents and preserve unstaged working data.
use super::*;
use crate::workspace::write::{self, Operation};

fn run(loaded: Arc<Loaded>, operation: Operation) -> Arc<Loaded> {
    let outcome = write::run(loaded, operation);

    assert!(outcome.result.is_ok(), "{:?}", outcome.result);

    outcome.loaded.unwrap()
}

fn file(loaded: &Loaded, path: &str, side: read::Side) -> Operation {
    Operation::File(loaded.file(&key(path, side)).unwrap().clone())
}

#[test]
fn whole_file_staging_and_unstaging_preserve_working_data_and_literal_paths() {
    let f = Fixture::new();

    f.write("literal[1].txt", "base\n");
    f.write("literal1.txt", "neighbor base\n");
    f.commit();
    f.write("literal[1].txt", "staged version\n");
    f.git(&["add", "--", "literal[1].txt"]);
    f.write("literal[1].txt", "working version\n");
    f.write("literal1.txt", "neighbor working\n");
    let loaded = f.load();
    let operation = file(&loaded, "literal[1].txt", read::Side::Working);
    let loaded = run(loaded, operation);

    assert_eq!(f.git(&["show", ":literal[1].txt"]), b"working version\n");
    assert_eq!(f.git(&["show", ":literal1.txt"]), b"neighbor base\n");
    assert!(
        loaded
            .file(&key("literal[1].txt", read::Side::Working))
            .is_none()
    );
    let operation = file(&loaded, "literal[1].txt", read::Side::Staged);
    let loaded = run(loaded, operation);

    assert_eq!(write::staged_count(&loaded), 0);
    assert_eq!(f.git(&["show", ":literal[1].txt"]), b"base\n");
    assert_eq!(
        fs::read(f.root.join("literal[1].txt")).unwrap(),
        b"working version\n"
    );
    fs::remove_file(f.root.join("literal1.txt")).unwrap();
    fs::write(f.root.join("image.bin"), [0, 1, 2]).unwrap();
    let loaded = run(f.load(), Operation::StageAll);

    assert_eq!(write::staged_count(&loaded), 3);
    let loaded = run(loaded, Operation::UnstageAll);

    assert_eq!(write::staged_count(&loaded), 0);
    assert!(!f.root.join("literal1.txt").exists());
    assert_eq!(fs::read(f.root.join("image.bin")).unwrap(), [0, 1, 2]);
}

#[test]
fn unstage_rename_restores_both_index_names_and_copy_leaves_its_source_alone() {
    let f = Fixture::new();

    f.write("old.txt", "original\n");
    f.commit();
    f.git(&["mv", "old.txt", "new.txt"]);
    let loaded = f.load();
    let operation = file(&loaded, "new.txt", read::Side::Staged);
    let loaded = run(loaded, operation);

    assert_eq!(write::staged_count(&loaded), 0);
    assert_eq!(f.git(&["show", ":old.txt"]), b"original\n");
    assert!(!f.root.join("old.txt").exists());
    assert_eq!(fs::read(f.root.join("new.txt")).unwrap(), b"original\n");
    f.write("old.txt", "source changed independently\n");
    f.git(&["add", "--all"]);
    let loaded = f.load();

    let mut copy = loaded
        .file(&key("new.txt", read::Side::Staged))
        .unwrap()
        .clone();

    copy.status = onegit_git::FileStatus::Copied;
    copy.original = Some(GitPath::new("old.txt").unwrap());
    let loaded = run(loaded, Operation::File(copy));

    assert_eq!(
        f.git(&["show", ":old.txt"]),
        b"source changed independently\n"
    );
    assert!(loaded.file(&key("old.txt", read::Side::Staged)).is_some());
    assert!(loaded.file(&key("new.txt", read::Side::Working)).is_some());
}

#[test]
fn commit_uses_only_index_and_records_summary_and_description() {
    let f = Fixture::new();

    f.write("a.txt", "base\n");
    f.commit();
    f.write("a.txt", "staged\n");
    f.git(&["add", "--all"]);
    f.write("a.txt", "unstaged\n");
    f.write("b.txt", "untracked\n");
    let outcome = write::run(
        f.load(),
        Operation::Commit {
            summary: "  Commit staged content  ".into(),
            description: "  Explain the change.\n\nKeep working content.  ".into(),
        },
    );

    assert!(outcome.committed);
    assert!(outcome.result.is_ok());
    let loaded = outcome.loaded.unwrap();

    assert_eq!(write::staged_count(&loaded), 0);
    assert_eq!(f.git(&["show", "HEAD:a.txt"]), b"staged\n");
    assert_eq!(
        f.git(&["log", "-1", "--format=%B"]),
        b"Commit staged content\n\nExplain the change.\n\nKeep working content.\n\n"
    );
    assert_eq!(f.git(&["rev-list", "--count", "HEAD"]), b"2\n");
    assert_eq!(fs::read(f.root.join("a.txt")).unwrap(), b"unstaged\n");
    assert_eq!(fs::read(f.root.join("b.txt")).unwrap(), b"untracked\n");
    assert_eq!(loaded.files.len(), 2);
}

#[test]
fn unborn_staging_unstaging_and_first_commit_work_and_empty_commits_are_rejected() {
    let f = Fixture::new();

    f.write("first.txt", "first\n");
    let loaded = run(f.load(), Operation::StageAll);
    let loaded = run(loaded, Operation::UnstageAll);

    assert!(loaded.snapshot.status.head.is_unborn());
    assert_eq!(write::staged_count(&loaded), 0);
    let outcome = write::run(
        loaded,
        Operation::Commit {
            summary: "Nothing staged".into(),
            description: String::new(),
        },
    );

    assert!(
        outcome
            .result
            .unwrap_err()
            .contains("Stage at least one file")
    );
    let loaded = run(outcome.loaded.unwrap(), Operation::StageAll);

    let loaded = run(
        loaded,
        Operation::Commit {
            summary: "First commit".into(),
            description: String::new(),
        },
    );

    assert!(loaded.files.is_empty());
    assert_eq!(f.git(&["rev-list", "--count", "HEAD"]), b"1\n");
}

#[test]
fn locks_and_stale_heads_refresh_without_replaying_writes() {
    let f = Fixture::new();

    f.write("a.txt", "base\n");
    f.commit();
    f.write("a.txt", "new\n");
    fs::write(f.root.join(".git/index.lock"), "owned elsewhere").unwrap();
    let outcome = write::run(f.load(), Operation::StageAll);

    assert!(outcome.result.unwrap_err().contains("index.lock"));
    assert!(!outcome.committed);
    assert_eq!(write::staged_count(&outcome.loaded.unwrap()), 0);
    assert_eq!(
        fs::read(f.root.join(".git/index.lock")).unwrap(),
        b"owned elsewhere"
    );
    fs::remove_file(f.root.join(".git/index.lock")).unwrap();
    let stale = f.load();

    f.commit();
    f.write("a.txt", "later\n");
    let outcome = write::run(stale, Operation::StageAll);

    assert!(
        outcome
            .result
            .unwrap_err()
            .contains("HEAD or the branch changed")
    );
    assert_eq!(write::staged_count(&outcome.loaded.unwrap()), 0);
    assert_eq!(f.git(&["show", ":a.txt"]), b"new\n");
}

#[cfg(unix)]
#[test]
fn rejecting_hook_is_respected_and_its_partial_index_effects_are_refreshed() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new();

    f.write("a.txt", "base\n");
    f.commit();
    f.write("a.txt", "staged\n");
    f.git(&["add", "--all"]);
    let hooks = f.directory.path().join("hooks");

    fs::create_dir(&hooks).unwrap();
    fs::write(hooks.join("pre-commit"), "#!/bin/sh\nprintf 'hook content\\n' > from-hook.txt\ngit add -- from-hook.txt\necho 'Rejected by fixture hook' >&2\nexit 1\n").unwrap();
    fs::set_permissions(hooks.join("pre-commit"), fs::Permissions::from_mode(0o700)).unwrap();
    let process = f
        .process()
        .with_environment([("GIT_CONFIG_VALUE_0".into(), hooks.into_os_string())]);

    let loaded = read::load(&f.root, process, &Cancellation::default()).unwrap();

    let outcome = write::run(
        loaded,
        Operation::Commit {
            summary: "Rejected".into(),
            description: String::new(),
        },
    );

    assert!(!outcome.committed);
    assert!(
        outcome
            .result
            .unwrap_err()
            .contains("Rejected by fixture hook")
    );
    assert_eq!(write::staged_count(&outcome.loaded.unwrap()), 2);
    assert_eq!(f.git(&["rev-list", "--count", "HEAD"]), b"1\n");
    assert_eq!(f.git(&["show", ":from-hook.txt"]), b"hook content\n");
}

#[test]
fn an_external_git_operation_blocks_writes_and_refreshes_the_snapshot() {
    let f = Fixture::new();

    f.write("a.txt", "base\n");
    f.commit();
    f.write("a.txt", "new\n");
    let loaded = f.load();

    fs::write(
        f.root.join(".git/MERGE_HEAD"),
        f.git(&["rev-parse", "HEAD"]),
    )
    .unwrap();
    let outcome = write::run(loaded, Operation::StageAll);

    assert!(
        outcome
            .result
            .unwrap_err()
            .contains("Finish the current Git operation")
    );
    let loaded = outcome.loaded.unwrap();

    assert!(!write::available(&loaded));
    assert_eq!(write::staged_count(&loaded), 0);
    assert_eq!(f.git(&["show", ":a.txt"]), b"base\n");
}

#[test]
fn stale_rename_metadata_cannot_unstage_a_new_independent_source_change() {
    let f = Fixture::new();

    f.write("old.txt", "original\n");
    f.commit();
    f.git(&["mv", "old.txt", "new.txt"]);
    let loaded = f.load();
    let operation = file(&loaded, "new.txt", read::Side::Staged);

    f.git(&["restore", "--staged", "."]);
    f.write("old.txt", "independent staged source\n");
    f.git(&["add", "--all"]);
    let outcome = write::run(loaded, operation);

    assert!(
        outcome.result.is_err(),
        "a changed rename must require review"
    );
    assert_eq!(f.git(&["show", ":old.txt"]), b"independent staged source\n");
    assert_eq!(f.git(&["show", ":new.txt"]), b"original\n");
}
