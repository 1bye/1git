//! Covers: Git for Windows pathspec refusal without selecting a slash-named neighbor.
//! Real: isolated Git/index/worktree and reviewed stage, commit and discard requests.
//! Requires: Windows and a local Git executable; cross-compiled on other hosts.
#![cfg(windows)]

mod common;

use common::{Fixture, files_under, git_path};

use onegit_git::{
    BranchIdentity, CommitFiles, DiffOptions, DiffTarget, DiscardFiles, DiscardRecovery,
    FileSource, HistoryOptions, Repository, WritePhase,
};

use std::error::Error;
use std::fs;
use std::io;

fn assert_pathspec_error(error: &(dyn Error + 'static)) {
    let mut source = Some(error);

    while let Some(error) = source {
        if let Some(error) = error.downcast_ref::<io::Error>() {
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
            assert_eq!(
                error.get_ref().unwrap().to_string(),
                "Git for Windows cannot address this file name without rewriting it"
            );

            return;
        }

        source = error.source();
    }

    panic!("expected a typed path I/O error: {error:?}");
}

#[test]
fn windows_actions_refuse_backslashes_without_selecting_the_slash_entry() {
    let fixture = Fixture::new();

    fs::create_dir(fixture.root.join("folder")).unwrap();
    fixture.write("folder/file", "base\n");
    fixture.commit("Base");
    fixture.write("folder/file", "selected\n");
    let repository = Repository::open(&fixture.root, fixture.process(), None).unwrap();
    let reviewed = repository.snapshot(false, None).unwrap();
    let literal = git_path("folder\\file");
    let ordinary = git_path("folder/file");
    let recovery = fixture.temporary.path().join("recovery");

    let commit = CommitFiles::new(
        vec![literal.clone()],
        "Save selected work".into(),
        &reviewed,
    );

    let discard = DiscardFiles {
        paths: vec![literal.clone()],
        allow_destructive: true,
        recovery: Some(DiscardRecovery {
            directory: recovery.clone(),
            expected: BranchIdentity::from_snapshot(&reviewed),
        }),
    };

    let before = files_under(&fixture.root);

    let stage_error = repository
        .stage(std::slice::from_ref(&literal), None)
        .unwrap_err();

    assert_eq!(stage_error.phase, WritePhase::BeforeCommand);
    assert_pathspec_error(&stage_error);
    let unstage_error = repository
        .unstage(std::slice::from_ref(&literal), None)
        .unwrap_err();

    assert_eq!(unstage_error.phase, WritePhase::BeforeCommand);
    assert_pathspec_error(&unstage_error);
    let commit_error = repository.commit_selected_files(&commit, None).unwrap_err();

    assert_eq!(commit_error.phase, WritePhase::BeforeCommand);
    assert_pathspec_error(&commit_error);
    assert!(
        commit_error.failure.details.as_deref().is_some_and(
            |details| details.contains("Git for Windows cannot address this file name")
        )
    );
    let discard_error = repository.discard_files(&discard, None).unwrap_err();

    assert_eq!(discard_error.phase, WritePhase::BeforeCommand);
    assert_pathspec_error(&discard_error);
    assert!(discard_error.recovery.is_none());
    assert!(!recovery.exists());

    let paths = [literal.clone()];
    let mut diff = DiffOptions::new(DiffTarget::Working);

    diff.paths = Some(&paths);
    assert_pathspec_error(&repository.diff(diff, None).unwrap_err());
    assert_pathspec_error(
        &repository
            .history(
                HistoryOptions {
                    paths: Some(&paths),
                    ..Default::default()
                },
                None,
            )
            .unwrap_err(),
    );
    assert_pathspec_error(
        &repository
            .file_content(FileSource::Revision("HEAD"), &literal, None)
            .unwrap_err(),
    );
    assert_pathspec_error(&repository.conflict_preview(&literal, None).unwrap_err());
    assert_eq!(files_under(&fixture.root), before);

    repository
        .stage(std::slice::from_ref(&ordinary), None)
        .unwrap();
    assert_eq!(
        fixture.git(&["diff", "--cached", "--name-only", "-z"]),
        b"folder/file\0"
    );
    let commit = CommitFiles::new(
        vec![ordinary.clone()],
        "Save selected work".into(),
        &repository.snapshot(false, None).unwrap(),
    );

    assert!(
        repository
            .commit_selected_files(&commit, None)
            .unwrap()
            .warning
            .is_none()
    );
    assert_eq!(fixture.git(&["show", "HEAD:folder/file"]), b"selected\n");
    fixture.write("folder/file", "discard me\n");
    let discard = DiscardFiles {
        paths: vec![ordinary],
        allow_destructive: true,
        recovery: Some(DiscardRecovery {
            directory: recovery,
            expected: BranchIdentity::from_snapshot(&repository.snapshot(false, None).unwrap()),
        }),
    };

    repository.discard_files(&discard, None).unwrap();
    assert_eq!(
        fs::read(fixture.root.join("folder/file")).unwrap(),
        b"selected\n"
    );
}
