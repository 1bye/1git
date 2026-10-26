//! Covers: porcelain v2 parity, HEAD/tracking, renames, conflicts and exact path bytes.
//! Real: parser, Git CLI and fresh repositories with isolated configuration.
//! Doubles: synthetic malformed/status records for boundary cases.
//! Requires: Git and temporary storage; no network, user configuration or credentials.

mod common;

use std::ffi::OsString;
use std::fs;

use std::process::{Command, Output};

use onegit_git::{FileStatus, RecordType, parse_status};
use serde_json::{Value, json};
use tempfile::TempDir;

#[test]
fn matches_frozen_typescript_status_results_for_all_valid_reference_cases() {
    let reference: Value = serde_json::from_str(include_str!("status-reference.json")).unwrap();

    for case in reference["cases"].as_array().unwrap() {
        let status = parse_status(case["input"].as_str().unwrap().as_bytes()).unwrap();

        let files: Vec<Value> = status
            .files
            .iter()
            .map(|file| {
                let mut value = json!({
                    "path": file.path.to_str().unwrap(),
                    "indexStatus": status_name(file.index_status),
                    "worktreeStatus": status_name(file.worktree_status),
                    "recordType": match file.record_type {
                        RecordType::Ordinary => "ordinary",
                        RecordType::Renamed => "renamed",
                        RecordType::Unmerged => "unmerged",
                        RecordType::Untracked => "untracked",
                        RecordType::Ignored => "ignored",
                    },
                    "submodule": file.submodule,
                });

                let object = value.as_object_mut().unwrap();

                if let Some(path) = &file.original_path {
                    object.insert("originalPath".into(), json!(path.to_str().unwrap()));
                }

                if let Some(oid) = &file.head_oid {
                    object.insert("headOid".into(), json!(oid));
                }

                if let Some(oid) = &file.index_oid {
                    object.insert("indexOid".into(), json!(oid));
                }

                if let Some(score) = file.rename_score {
                    object.insert("renameScore".into(), json!(score));
                }

                value
            })
            .collect();

        let normalized = json!({
            "files": files,
            "head": {
                "ahead": status.head.ahead,
                "behind": status.head.behind,
                "branch": status.head.branch,
                "detached": status.head.is_detached(),
                "oid": status.head.oid,
                "unborn": status.head.is_unborn(),
                "upstream": status.head.upstream,
            },
            "stashCount": status.stash_count,
        });

        assert_eq!(
            normalized, case["expected"],
            "reference case {}",
            case["name"]
        );
    }
}

fn status_name(status: FileStatus) -> &'static str {
    match status {
        FileStatus::Added => "added",
        FileStatus::Copied => "copied",
        FileStatus::Deleted => "deleted",
        FileStatus::Ignored => "ignored",
        FileStatus::Modified => "modified",
        FileStatus::Renamed => "renamed",
        FileStatus::TypeChanged => "type-changed",
        FileStatus::Unmerged => "unmerged",
        FileStatus::Unmodified => "unmodified",
        FileStatus::Untracked => "untracked",
    }
}

#[test]
fn parses_unborn_and_detached_heads_and_tracking_headers() {
    let unborn = parse_status(b"# branch.oid (initial)\0# branch.head main\0").unwrap();

    assert!(unborn.head.is_unborn());
    assert!(!unborn.head.is_detached());
    assert_eq!(unborn.head.branch.as_deref(), Some("main"));

    let oid = "a".repeat(64);

    let bytes = format!(
        "# branch.oid {oid}\0# branch.head (detached)\0# branch.upstream origin/main\0# branch.ab +12 -3\0# stash 2\0# future-header okay\0"
    );

    let detached = parse_status(bytes.as_bytes()).unwrap();

    assert_eq!(detached.head.oid.as_deref(), Some(oid.as_str()));
    assert!(detached.head.is_detached());
    assert!(!detached.head.is_unborn());
    assert_eq!(detached.head.upstream.as_deref(), Some("origin/main"));
    assert_eq!(
        (
            detached.head.ahead,
            detached.head.behind,
            detached.stash_count
        ),
        (12, 3, 2)
    );
}

#[test]
#[cfg(unix)]
fn preserves_non_utf8_and_control_characters_in_rename_names() {
    let oid = "1".repeat(40);

    let mut bytes =
        format!("2 RM S.MU 100644 100644 100644 {oid} {oid} R087 dest \t\n").into_bytes();

    bytes.extend_from_slice(b"\xff\0old \n\t\xfe\0? -untracked\0! ignored folder/\0");

    let status = parse_status(&bytes).unwrap();
    let renamed = &status.files[0];

    assert_eq!(renamed.path.as_bytes(), b"dest \t\n\xff");
    assert_eq!(
        renamed.original_path.as_ref().unwrap().as_bytes(),
        b"old \n\t\xfe"
    );
    assert_eq!(renamed.index_status, FileStatus::Renamed);
    assert_eq!(renamed.worktree_status, FileStatus::Modified);
    assert_eq!(renamed.rename_score, Some(87));
    assert_eq!(renamed.submodule, "S.MU");
    assert_eq!(renamed.head_oid.as_deref(), Some(oid.as_str()));
    assert_eq!(status.files[1].worktree_status, FileStatus::Untracked);
    assert_eq!(status.files[2].worktree_status, FileStatus::Ignored);
}

#[test]
fn rejects_truncated_and_malformed_records_instead_of_reporting_a_clean_tree() {
    let oid = "a".repeat(40);
    let missing_source = format!("2 R. N... 100644 100644 100644 {oid} {oid} R100 target\0");
    let unknown_status = format!("1 X. N... 100644 100644 100644 {oid} {oid} target\0");

    let excessive_score =
        format!("2 R. N... 100644 100644 100644 {oid} {oid} R101 target\0source\0");

    for malformed in [
        b"? path without terminator".as_slice(),
        b"1 M. N...\0",
        b"? \0",
        b"# branch.ab +bad -1\0",
        b"# branch.oid invalid-object\0",
        b"# stash -1\0",
        b"x unsupported record\0",
        missing_source.as_bytes(),
        unknown_status.as_bytes(),
        excessive_score.as_bytes(),
    ] {
        assert!(parse_status(malformed).is_err(), "accepted {malformed:?}");
    }
}

#[test]
fn matches_real_git_for_mixed_staged_unstaged_renamed_untracked_and_ignored_files() {
    let fixture = Fixture::new();

    fixture.write("mixed", "before\n");
    fixture.write("rename source", "rename\n");
    fixture.write(".gitignore", "ignored\n");
    fixture.commit("initial");
    fixture.write("mixed", "staged\n");
    fixture.git(&["add", "--", "mixed"]);
    fixture.write("mixed", "worktree\n");
    fixture.git(&["mv", "--", "rename source", "renamed\t\nfile"]);
    fixture.write("ignored", "ignored\n");

    let odd_name = OsString::from("untracked\t\nété");

    fs::write(fixture.0.path().join(&odd_name), "untracked").unwrap();

    let before = fs::read(fixture.0.path().join(".git/index")).unwrap();

    let raw = fixture.git(&[
        "--no-optional-locks",
        "status",
        "--porcelain=v2",
        "--branch",
        "--show-stash",
        "--untracked-files=all",
        "--ignored=matching",
        "-z",
    ]);

    let status = parse_status(&raw.stdout).unwrap();

    assert_eq!(status.head.branch.as_deref(), Some("main"));
    assert!(!status.head.is_unborn());
    assert_eq!(status.files.len(), 4);

    let mixed = status
        .files
        .iter()
        .find(|file| file.path == common::git_path("mixed"))
        .unwrap();

    assert_eq!(
        (mixed.index_status, mixed.worktree_status),
        (FileStatus::Modified, FileStatus::Modified)
    );

    let renamed = status
        .files
        .iter()
        .find(|file| file.record_type == RecordType::Renamed)
        .unwrap();

    assert_eq!(
        renamed.original_path.as_ref(),
        Some(&common::git_path("rename source"))
    );
    assert_eq!(renamed.path, common::git_path("renamed\t\nfile"));
    assert_eq!(renamed.rename_score, Some(100));
    assert!(status.files.iter().any(|file| file.path.as_bytes()
        == odd_name.to_str().unwrap().as_bytes()
        && file.worktree_status == FileStatus::Untracked));
    assert!(
        status
            .files
            .iter()
            .any(|file| file.path == common::git_path("ignored")
                && file.worktree_status == FileStatus::Ignored)
    );
    assert_eq!(
        fs::read(fixture.0.path().join(".git/index")).unwrap(),
        before
    );
}

#[test]
fn detects_real_merge_conflicts_stashes_and_detached_head() {
    let fixture = Fixture::new();

    fixture.write("conflict", "base\n");
    fixture.commit("initial");
    fixture.git(&["checkout", "-b", "side"]);
    fixture.write("conflict", "side\n");
    fixture.commit("side");
    fixture.git(&["checkout", "main"]);
    fixture.write("conflict", "main\n");
    fixture.commit("main");

    assert!(!fixture.command(&["merge", "side"]).status.success());

    let raw = fixture.git(&["status", "--porcelain=v2", "--branch", "-z"]);
    let status = parse_status(&raw.stdout).unwrap();

    assert_eq!(status.files.len(), 1);
    assert_eq!(status.files[0].record_type, RecordType::Unmerged);
    assert_eq!(status.files[0].index_status, FileStatus::Unmerged);
    assert_eq!(status.files[0].worktree_status, FileStatus::Unmerged);

    fixture.git(&["merge", "--abort"]);
    fixture.write("conflict", "stashed\n");
    fixture.git(&["stash", "push", "-m", "local fixture"]);
    fixture.git(&["checkout", "--detach"]);

    let raw = fixture.git(&["status", "--porcelain=v2", "--branch", "--show-stash", "-z"]);
    let status = parse_status(&raw.stdout).unwrap();

    assert!(status.head.is_detached());
    assert_eq!(status.stash_count, 1);
    assert!(status.files.is_empty());
}

struct Fixture(TempDir);

impl Fixture {
    fn new() -> Self {
        let fixture = Self(tempfile::tempdir().unwrap());

        fixture.git(&["init", "--initial-branch=main"]);

        fixture
    }

    fn command(&self, args: &[&str]) -> Output {
        Command::new("git")
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap())
            .env("HOME", self.0.path())
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "Fixture")
            .env("GIT_AUTHOR_EMAIL", "fixture@example.invalid")
            .env("GIT_COMMITTER_NAME", "Fixture")
            .env("GIT_COMMITTER_EMAIL", "fixture@example.invalid")
            .args([
                "-c",
                "commit.gpgsign=false",
                "-c",
                "core.hooksPath=/dev/null",
            ])
            .args(args)
            .current_dir(self.0.path())
            .output()
            .unwrap()
    }

    fn git(&self, args: &[&str]) -> Output {
        let output = self.command(args);

        assert!(
            output.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );

        output
    }

    fn write(&self, name: &str, text: &str) {
        fs::write(self.0.path().join(name), text).unwrap();
    }

    fn commit(&self, subject: &str) {
        self.git(&["add", "--all"]);
        self.git(&["commit", "-m", subject]);
    }
}

#[test]
fn status_keeps_reserved_colon_and_literal_backslash_git_names() {
    let status =
        parse_status(b"? aux.c\0? a:b\0? folder\\file\0? folder/file\0! ignored/\0").unwrap();
    let names: Vec<_> = status
        .files
        .iter()
        .map(|change| change.path.as_bytes())
        .collect();
    assert_eq!(
        names,
        vec![
            b"aux.c".as_slice(),
            b"a:b",
            b"folder\\file",
            b"folder/file",
            b"ignored/"
        ]
    );
    assert_ne!(status.files[2].path, status.files[3].path);
}

#[cfg(unix)]
#[test]
fn non_utf8_name_round_trips_from_status_to_staging() {
    use common::Fixture;
    use onegit_git::{FileSource, GitCommand, Repository};

    let fixture = Fixture::new();
    let name = b"literal\\non-utf8-\xff";
    fixture.write("blob-source", "exact contents\n");
    let oid = fixture.git(&["hash-object", "-w", "blob-source"]);
    fs::remove_file(fixture.root.join("blob-source")).unwrap();
    let oid = std::str::from_utf8(&oid).unwrap().trim();
    let index_info = [format!("100644 {oid}\t").as_bytes(), name, b"\0"].concat();
    let mut command = GitCommand::new(&fixture.root, ["update-index", "-z", "--index-info"]);
    command.stdin = &index_info;
    fixture.process().run(command).unwrap();
    // APFS refuses non-UTF-8 filesystem names. A real committed Git index name
    // exercises the same raw status -> argv -> staged path flow on every Unix.
    fixture.git(&["commit", "-m", "raw-byte tree name"]);
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let snapshot = repository.snapshot(false, None).unwrap();
    let path = snapshot
        .status
        .files
        .iter()
        .find(|change| change.path.as_bytes() == name)
        .unwrap()
        .path
        .clone();
    assert_eq!(path.to_str(), None);
    assert_eq!(
        snapshot.status.files[0].worktree_status,
        FileStatus::Deleted
    );
    repository.stage(std::slice::from_ref(&path), None).unwrap();
    assert_eq!(
        fixture.git(&["diff", "--cached", "--name-only", "-z"]),
        [name.as_slice(), b"\0"].concat()
    );
    assert!(fixture.git(&["ls-files", "-z"]).is_empty());
    let committed = repository
        .file_content(FileSource::Revision("HEAD"), &path, None)
        .unwrap();
    assert_eq!(committed.path, path);
    assert_eq!(committed.content.as_bytes(), b"exact contents\n");
    let snapshot = repository.snapshot(false, None).unwrap();
    assert_eq!(snapshot.status.files.len(), 1);
    assert_eq!(snapshot.status.files[0].path, path);
    assert_eq!(snapshot.status.files[0].index_status, FileStatus::Deleted);
}
