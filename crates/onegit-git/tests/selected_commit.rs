//! Covers: selected/staged/partial/amend commits, recovery, review and owned write boundaries.
//! Real: public Git APIs, Git CLI, private indexes, hooks, local bare remotes and threads.
//! Doubles: command wrappers inject races/failures and a synthetic signer refuses signing.
//! Requires: Git, POSIX shell and writable temporary storage; no network or real keys.

mod common;

use common::{Fixture, files_under};

use onegit_git::{
    CommitFiles, CommitMode, CommitOutcome, DiffOptions, DiffTarget, GitProcess, PartialCommitFile,
    Repository,
};

use std::fs;
use std::path::PathBuf;

#[path = "selected_commit/amend.rs"]
mod amend;
#[path = "selected_commit/coordination.rs"]
mod coordination;
#[path = "selected_commit/guards.rs"]
mod guards;
#[path = "selected_commit/outcomes.rs"]
mod outcomes;
#[path = "selected_commit/partial.rs"]
mod partial;

fn process(fixture: &Fixture, executable: impl Into<PathBuf>) -> GitProcess {
    GitProcess::new(executable, 64 * 1024 * 1024).with_environment([
        ("GIT_CONFIG_GLOBAL".into(), "/dev/null".into()),
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
        ("GIT_CONFIG_COUNT".into(), "2".into()),
        ("GIT_CONFIG_KEY_0".into(), "core.hooksPath".into()),
        (
            "GIT_CONFIG_VALUE_0".into(),
            fixture.root.join(".git/hooks").into_os_string(),
        ),
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
fn executable(path: &std::path::Path, script: &str) {
    #[cfg(unix)]
    use common::PermissionsExt;

    fs::write(path, script).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
}

fn partial_request(repository: &Repository, path: &str, keys: &[&str]) -> CommitFiles {
    let mut input = request(repository, &[path]);
    let paths = [common::git_path(path)];
    let mut options = DiffOptions::new(DiffTarget::Changes);

    options.paths = Some(&paths);
    input.include_partial_staging = true;
    input.partial_files.push(PartialCommitFile {
        path: path.try_into().unwrap(),
        expected_patch: repository.diff(options, None).unwrap().patch,
        included_lines: keys.iter().map(|key| (*key).to_owned()).collect(),
    });

    input
}

fn open(fixture: &Fixture) -> Repository {
    Repository::open(&fixture.root, fixture.process(), None).unwrap()
}

fn request(repository: &Repository, paths: &[&str]) -> CommitFiles {
    CommitFiles::new(
        paths.iter().map(common::git_path).collect(),
        "Selected files\n\nKeep excluded work staged.".to_owned(),
        &repository.snapshot(false, None).unwrap(),
    )
}

fn unchanged_working(fixture: &Fixture) -> impl FnOnce() {
    let root = fixture.root.clone();
    let mut before = files_under(&root);

    before.retain(|path, _| !path.starts_with(".git"));

    move || {
        let mut after = files_under(&root);

        after.retain(|path, _| !path.starts_with(".git"));
        assert_eq!(before, after);
    }
}

#[test]
fn commits_checked_files_and_keeps_excluded_staging_and_working_bytes() {
    let fixture = Fixture::new();

    fixture.write("selected", "base selected\n");
    fixture.write("excluded", "base excluded\n");
    fixture.write("deleted", "delete\n");
    fixture.write("working-deleted", "delete\n");
    fixture.write("rename", "rename\n");
    fixture.commit("base");
    fixture.write("excluded", "staged excluded\n");
    fixture.git_os(["add".into(), "--".into(), "excluded".into()]);
    fixture.write("excluded", "working excluded\n");
    fixture.write("selected", "selected\n");
    fixture.git(&["rm", "deleted"]);
    fs::remove_file(fixture.root.join("working-deleted")).unwrap();
    fixture.git(&["mv", "rename", "renamed"]);
    fixture.write(
        common::filename("new [file]\t\n:name.txt", "new [file] été.txt"),
        "new\n",
    );
    let repository = open(&fixture);
    let assert_working = unchanged_working(&fixture);

    let result = repository
        .commit_selected_files(
            &request(
                &repository,
                &[
                    "selected",
                    "deleted",
                    "working-deleted",
                    "renamed",
                    common::filename("new [file]\t\n:name.txt", "new [file] été.txt"),
                ],
            ),
            None,
        )
        .unwrap();

    assert_eq!(result.outcome, CommitOutcome::Committed);
    assert!(result.warning.is_none());
    assert_eq!(fixture.git(&["show", "HEAD:selected"]), b"selected\n");
    assert_eq!(fixture.git(&["show", "HEAD:excluded"]), b"base excluded\n");
    assert_eq!(fixture.git(&["show", ":excluded"]), b"staged excluded\n");
    assert_eq!(fixture.git(&["show", "HEAD:renamed"]), b"rename\n");
    assert!(
        fixture
            .git(&[
                "ls-tree",
                "--name-only",
                "HEAD",
                "deleted",
                "working-deleted",
                "rename"
            ])
            .is_empty()
    );
    assert_eq!(
        result
            .snapshot
            .unwrap()
            .status
            .files
            .iter()
            .map(|file| file.path.clone())
            .collect::<Vec<_>>(),
        vec![common::git_path("excluded")]
    );
    assert_eq!(
        fixture.git(&[
            "show",
            common::filename("HEAD:new [file]\t\n:name.txt", "HEAD:new [file] été.txt")
        ]),
        b"new\n"
    );
    assert!(!fixture.root.join(".git/index.lock").exists());
    assert!(
        !fs::read_dir(fixture.root.join(".git"))
            .unwrap()
            .any(|entry| entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("1git-commit-"))
    );
    assert_working();
}

#[test]
fn commits_reviewed_lines_and_whole_files_without_including_other_edits() {
    let fixture = Fixture::new();

    fixture.write("partial", "one\ntwo\nthree\nfour\n");
    fixture.write("excluded", "base\n");
    fixture.commit("base");
    fixture.write("partial", "ONE\ntwo\nTHREE\nfour\n");
    fixture.write("excluded", "staged\n");
    fixture.git(&["add", "excluded"]);
    fixture.write("excluded", "working\n");
    fixture.write("whole", "whole\n");
    let repository = open(&fixture);
    let mut input = request(&repository, &["partial", "whole"]);

    input.include_partial_staging = true;
    let paths = [common::git_path("partial")];
    let mut options = DiffOptions::new(DiffTarget::Changes);

    options.paths = Some(&paths);
    input.partial_files.push(PartialCommitFile {
        path: "partial".try_into().unwrap(),
        expected_patch: repository.diff(options, None).unwrap().patch,
        included_lines: vec!["-:1".into(), "+:1".into()],
    });
    let assert_working = unchanged_working(&fixture);
    let result = repository.commit_selected_files(&input, None).unwrap();

    assert_eq!(result.outcome, CommitOutcome::Committed);
    assert!(result.warning.is_none());
    assert_eq!(
        fixture.git(&["show", "HEAD:partial"]),
        b"ONE\ntwo\nthree\nfour\n"
    );
    assert_eq!(fixture.git(&["show", "HEAD:whole"]), b"whole\n");
    assert_eq!(fixture.git(&["show", ":excluded"]), b"staged\n");
    assert!(
        fixture
            .git(&["diff", "--cached", "--", "partial"])
            .is_empty()
    );
    assert!(
        String::from_utf8(fixture.git(&["diff", "--", "partial"]))
            .unwrap()
            .contains("+THREE")
    );
    assert_working();
}

#[test]
fn staged_mode_ignores_checkbox_paths_and_keeps_current_working_edits() {
    let fixture = Fixture::new();

    fixture.write("file", "base\n");
    fixture.commit("base");
    fixture.write("file", "staged\n");
    fixture.git(&["add", "file"]);
    fixture.write("file", "working\n");
    let repository = open(&fixture);
    let mut input = request(&repository, &[".git/ignored-in-staged-mode"]);

    input.mode = CommitMode::Staged;
    let assert_working = unchanged_working(&fixture);

    assert!(
        repository
            .commit_selected_files(&input, None)
            .unwrap()
            .warning
            .is_none()
    );
    assert_eq!(fixture.git(&["show", "HEAD:file"]), b"staged\n");
    assert!(fixture.git(&["diff", "--cached"]).is_empty());
    assert_working();
}

#[test]
fn message_only_amend_preserves_the_tree_author_staging_and_old_commit() {
    let fixture = Fixture::new();

    fixture.write("file", "original\n");
    fixture.commit("original");
    let oid = fixture.git(&["rev-parse", "HEAD"]);
    let tree = fixture.git(&["rev-parse", "HEAD^{tree}"]);
    let author = fixture.git(&["show", "-s", "--format=%an <%ae> %aI"]);

    fixture.write("file", "staged\n");
    fixture.git(&["add", "file"]);
    fixture.write("file", "working\n");
    fixture.write("new", "untracked\n");
    let index = fixture.git(&["ls-files", "--stage"]);
    let repository = open(&fixture);
    let mut input = request(&repository, &[]);

    input.amend = true;
    input.message = "Amended\n\nDetails".into();
    let assert_working = unchanged_working(&fixture);

    assert!(
        repository
            .commit_selected_files(&input, None)
            .unwrap()
            .warning
            .is_none()
    );
    assert_ne!(fixture.git(&["rev-parse", "HEAD"]), oid);
    assert_eq!(fixture.git(&["rev-parse", "HEAD^{tree}"]), tree);
    assert_eq!(
        fixture.git(&["show", "-s", "--format=%an <%ae> %aI"]),
        author
    );
    assert_eq!(fixture.git(&["ls-files", "--stage"]), index);
    assert_eq!(
        fixture.git(&["for-each-ref", "--format=%(objectname)", "refs/1git/amend/"]),
        oid
    );
    assert_working();
}
