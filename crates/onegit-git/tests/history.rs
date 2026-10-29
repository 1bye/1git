//! Covers: history paging, rename following, commit files, publication and comparison reads.
//! Real: Git CLI and disposable local repositories/remote-tracking refs.
//! Doubles: isolated configuration/identity; no hosting providers or network.
//! Requires: Git and temporary storage.

mod common;

use std::fs;

use common::{Fixture, files_under};

use onegit_git::{
    Cancellation, FileStatus, GitCommand, GitError, HistoryOptions, Repository, RepositoryError,
};

fn oid(fixture: &Fixture, revision: &str) -> String {
    String::from_utf8(fixture.git(&["rev-parse", revision]))
        .unwrap()
        .trim()
        .into()
}

#[test]
fn pages_history_and_keeps_explicit_revisions_browseable_on_an_unborn_branch() {
    let fixture = Fixture::new();
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    assert!(
        repository
            .history(HistoryOptions::default(), None)
            .unwrap()
            .commits
            .is_empty()
    );

    for i in 0..4 {
        fixture.write("file", &format!("{i}\n"));
        fixture.commit(&format!("commit {i}"));
    }

    let first = repository
        .history(
            HistoryOptions {
                limit: 2,
                ..Default::default()
            },
            None,
        )
        .unwrap();

    let second = repository
        .history(
            HistoryOptions {
                limit: 2,
                offset: 2,
                ..Default::default()
            },
            None,
        )
        .unwrap();

    let head = oid(&fixture, "HEAD");

    assert_eq!(
        first
            .commits
            .iter()
            .map(|commit| commit.summary.as_str())
            .collect::<Vec<_>>(),
        ["commit 3", "commit 2"]
    );
    assert_eq!(first.next_offset, Some(2));
    assert!(first.has_more);
    assert_eq!(second.commits.len(), 2);
    assert!(!second.has_more);
    assert!(second.next_offset.is_none());
    assert_eq!(repository.history_count("HEAD", None).unwrap(), 4);

    fixture.git(&["checkout", "--orphan", "unborn"]);

    assert!(
        repository
            .history(HistoryOptions::default(), None)
            .unwrap()
            .commits
            .is_empty()
    );
    assert_eq!(
        repository
            .history(
                HistoryOptions {
                    revision: Some(&head),
                    ..Default::default()
                },
                None
            )
            .unwrap()
            .commits
            .len(),
        4
    );
}

#[test]
fn preserves_control_separators_in_messages_and_unsimplified_merge_parents() {
    let fixture = Fixture::new();
    let message = "summary\n\nbody with \u{1e} record and \u{1f} field separators\n";

    fixture.write("base", "base\n");
    fixture.commit(message);

    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let root = repository.commit("HEAD", None).unwrap();

    assert!(root.body.contains("\u{1e} record and \u{1f} field"));
    assert_eq!(root.summary, "summary");
    assert!(root.parent_oids.is_empty());

    fixture.git(&["checkout", "-b", "side"]);
    fixture.write("side", "side\n");
    fixture.commit("side");
    fixture.git(&["checkout", "main"]);
    fixture.write("main", "main\n");
    fixture.commit("main");
    fixture.git(&["merge", "--no-ff", "side", "-m", "merge"]);

    let merge = repository.commit("HEAD", None).unwrap();

    assert_eq!(merge.parent_oids.len(), 2);
    assert_eq!(repository.history_count("HEAD", None).unwrap(), 4);
}

#[test]
fn follows_renames_across_pages_without_treating_path_contents_as_record_headers() {
    let fixture = Fixture::new();
    let old = common::filename("old\nfile", "old été file");
    let current = "a".repeat(40);

    fixture.write(old, "first\n");
    fixture.commit("initial");
    fixture.git(&["mv", "--", old, &current]);
    fixture.commit("rename");
    fixture.write(&current, "second\n");
    fixture.commit("edit");
    fixture.write("unrelated", "unrelated\n");
    fixture.commit("unrelated");

    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let mut commits = Vec::new();

    for offset in 0..3 {
        let page = repository
            .history(
                HistoryOptions {
                    limit: 1,
                    offset,
                    file_path: Some(&common::git_path(&current)),
                    ..Default::default()
                },
                None,
            )
            .unwrap();

        assert_eq!(page.commits.len(), 1);
        assert_eq!(page.has_more, offset < 2);
        commits.extend(page.commits);
    }

    assert_eq!(
        commits
            .iter()
            .map(|commit| commit.summary.as_str())
            .collect::<Vec<_>>(),
        ["edit", "rename", "initial"]
    );
    let rename = commits[1].history_file.as_ref().unwrap();

    assert_eq!(rename.original_path.as_ref(), Some(&common::git_path(old)));
    assert_eq!(rename.path, common::git_path(&current));
    assert_eq!(rename.status, FileStatus::Renamed);
    assert_eq!(
        commits[2].history_file.as_ref().unwrap().path,
        common::git_path(old)
    );
}

#[test]
fn reads_root_and_renamed_file_identities_and_uses_literal_history_filters() {
    let fixture = Fixture::new();

    fixture.write(common::filename("literal*", "literal[1]"), "initial\n");
    fixture.commit("literal");
    fixture.write("literal-other", "other\n");
    fixture.commit("other");

    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let paths = [common::git_path(common::filename("literal*", "literal[1]"))];

    let history = repository
        .history(
            HistoryOptions {
                paths: Some(&paths),
                ..Default::default()
            },
            None,
        )
        .unwrap();

    let root_files = repository.commit_files("HEAD~1", None).unwrap();

    assert_eq!(history.commits.len(), 1);
    assert_eq!(history.commits[0].summary, "literal");
    assert_eq!(root_files[0].status, FileStatus::Added);
    assert!(root_files[0].before_oid.bytes().all(|byte| byte == b'0'));

    fixture.git_os([
        "mv".into(),
        "--".into(),
        common::filename("literal*", "literal[1]").into(),
        common::filename("renamed\t\nfile", "renamed [literal] file").into(),
    ]);
    fixture.commit("rename");

    let files = repository.commit_files("HEAD", None).unwrap();

    assert_eq!(files[0].status, FileStatus::Renamed);
    assert_eq!(
        files[0].original_path.as_ref(),
        Some(&common::git_path(common::filename(
            "literal*",
            "literal[1]"
        )))
    );
    assert_eq!(
        files[0].path,
        common::git_path(common::filename(
            "renamed\t\nfile",
            "renamed [literal] file"
        ))
    );
    assert_eq!(files[0].before_oid, files[0].after_oid);
}

#[test]
fn determines_publication_from_local_refs_with_case_normalization_and_no_date_cutoff() {
    let fixture = Fixture::new();

    fixture.write("file", "first\n");
    fixture.commit("first");

    let first = oid(&fixture, "HEAD");

    fixture.git(&["update-ref", "refs/remotes/origin/main", &first]);
    fixture.write("file", "backdated\n");
    fixture.git(&["add", "--", "file"]);

    let mut command = GitCommand::new(&fixture.root, ["commit", "-m", "backdated"]);

    command.environment = vec![("GIT_COMMITTER_DATE".into(), "2000-01-01T00:00:00Z".into())];

    fixture.process().run(command).unwrap();

    let second = oid(&fixture, "HEAD");
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let requested = [second.to_ascii_uppercase(), first, second.clone()];

    assert_eq!(
        repository
            .unpushed_commits(&requested, None)
            .unwrap()
            .as_slice(),
        std::slice::from_ref(&second)
    );

    fixture.git(&["update-ref", "refs/remotes/origin/main", &second]);

    assert!(
        repository
            .unpushed_commits(&requested, None)
            .unwrap()
            .is_empty()
    );
    assert!(matches!(
        repository.unpushed_commits(&[oid(&fixture, "HEAD:file")], None),
        Err(RepositoryError::InvalidInput(_))
    ));
}

#[test]
fn anchors_branch_comparisons_and_rejects_unrelated_history() {
    let fixture = Fixture::new();

    fixture.write("file", "first\n");
    fixture.commit("first");

    let base = oid(&fixture, "HEAD");

    fixture.git(&["checkout", "-b", "incoming"]);
    fixture.write("incoming", "change\n");
    fixture.commit("incoming");

    let head = oid(&fixture, "HEAD");
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();

    let comparison = repository
        .compare_branches("main", "incoming", None)
        .unwrap();

    assert_eq!(comparison.base, base);
    assert_eq!(comparison.head, head);
    assert_eq!(comparison.merge_base, base);
    assert_eq!(comparison.files[0].path, common::git_path("incoming"));

    fixture.git(&["checkout", "--orphan", "unrelated"]);
    fixture.write("other", "unrelated\n");
    fixture.commit("unrelated");

    assert!(matches!(
        repository.compare_branches("main", "unrelated", None),
        Err(RepositoryError::InvalidInput(_))
    ));
}

#[test]
fn validates_history_inputs_and_preserves_all_files_during_reads() {
    let fixture = Fixture::new();

    fixture.write("file", "first\n");
    fixture.commit("first");

    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let before = files_under(&fixture.root);

    repository.history(HistoryOptions::default(), None).unwrap();
    repository.history_count("HEAD", None).unwrap();
    repository.commit("HEAD", None).unwrap();
    repository.commit_files("HEAD", None).unwrap();
    repository.compare_branches("HEAD", "HEAD", None).unwrap();
    repository
        .unpushed_commits(&[oid(&fixture, "HEAD")], None)
        .unwrap();

    assert_eq!(files_under(&fixture.root), before);
    assert!(matches!(
        repository.history(
            HistoryOptions {
                limit: 0,
                ..Default::default()
            },
            None
        ),
        Err(RepositoryError::InvalidInput(_))
    ));
    assert!(matches!(
        repository.commit("--help", None),
        Err(RepositoryError::InvalidInput(_))
    ));

    assert!(onegit_git::GitPath::new("../outside").is_err());

    let cancellation = Cancellation::default();

    cancellation.cancel();

    assert!(matches!(
        repository.history(HistoryOptions::default(), Some(&cancellation)),
        Err(RepositoryError::Git(GitError::Cancelled))
    ));
    assert!(fs::metadata(&fixture.root).unwrap().is_dir());
}
