use super::*;
use onegit_git::{Cancellation, ErrorCode};

#[test]
fn unborn_commit_excludes_existing_staged_additions_and_handles_a_missing_index() {
    for staged in [false, true] {
        let fixture = Fixture::new();

        fixture.write("selected", "first\n");
        fixture.write("excluded", "excluded\n");

        if staged {
            fixture.git(&["add", "excluded"]);
        }

        let repository = open(&fixture);
        let working = unchanged_working(&fixture);

        let result = repository
            .commit_selected_files(&request(&repository, &["selected"]), None)
            .unwrap();

        assert_eq!(result.outcome, CommitOutcome::Committed);
        assert_eq!(
            fixture.git(&["ls-tree", "--name-only", "HEAD"]),
            b"selected\n"
        );
        assert_eq!(
            fixture.git(&["diff", "--cached", "--name-only"]),
            if staged {
                b"excluded\n".as_slice()
            } else {
                b""
            }
        );
        working();
    }
}

#[test]
fn explicit_complete_files_preserve_unchecked_staging_in_all_five_source_cases() {
    for kind in ["modified", "new", "renamed", "deleted", "recreated"] {
        let fixture = Fixture::new();

        let anchors = if kind == "renamed" {
            "\nanchor one\nanchor two\nanchor three"
        } else {
            ""
        };

        fixture.write("selected", &format!("base selected{anchors}\n"));
        fixture.write("excluded", "base excluded\n");
        fixture.commit("base");
        fixture.write("excluded", "prepared excluded\n");
        fixture.git(&["add", "excluded"]);
        fixture.write("excluded", "current excluded\n");
        let path = match kind {
            "renamed" => {
                fixture.git(&["mv", "selected", "renamed"]);

                "renamed"
            }
            "new" => "new",
            _ => "selected",
        };

        fixture.write(path, &format!("prepared selected{anchors}\n"));
        fixture.git(&["add", path]);

        if kind == "deleted" {
            fs::remove_file(fixture.root.join(path)).unwrap();
        } else {
            if kind == "recreated" {
                fixture.git(&["rm", "--force", path]);
            }

            fixture.write(path, &format!("current selected{anchors}\n"));
        }

        let repository = open(&fixture);
        let mut input = request(&repository, &[path]);

        input.include_partial_staging = true;
        let working = unchanged_working(&fixture);
        let result = repository.commit_selected_files(&input, None).unwrap();

        assert!(result.warning.is_none(), "{kind}");

        if kind == "deleted" {
            assert!(
                fixture
                    .git(&["ls-tree", "--name-only", "HEAD", path])
                    .is_empty()
            );
        } else {
            assert_eq!(
                fixture.git(&["show", &format!("HEAD:{path}")]),
                format!("current selected{anchors}\n").as_bytes(),
                "{kind}"
            );
        }

        assert_eq!(fixture.git(&["show", "HEAD:excluded"]), b"base excluded\n");
        assert_eq!(fixture.git(&["show", ":excluded"]), b"prepared excluded\n");
        assert_eq!(
            result
                .snapshot
                .unwrap()
                .status
                .files
                .iter()
                .map(|file| file.path.clone())
                .collect::<Vec<_>>(),
            vec![common::git_path("excluded")],
            "{kind}"
        );
        working();
    }
}

#[test]
fn preflight_refusals_preserve_head_and_exact_index_and_never_remove_a_foreign_lock() {
    let fixture = Fixture::new();

    fixture.write("file", "base\n");
    fixture.commit("base");
    fixture.write("file", "staged\n");
    fixture.git(&["add", "file"]);
    fixture.write("file", "working\n");
    let repository = open(&fixture);
    let input = request(&repository, &["file"]);
    let index = fs::read(fixture.root.join(".git/index")).unwrap();
    let head = fixture.git(&["rev-parse", "HEAD"]);

    assert!(
        repository
            .commit_selected_files(&input, None)
            .unwrap_err()
            .to_string()
            .contains("partially staged")
    );
    let mut allowed = input.clone();

    allowed.include_partial_staging = true;
    let mut invalids = Vec::new();
    let mut stale = allowed.clone();

    stale.expected.oid = Some("obsolete".into());
    invalids.push(stale);

    for path in [".", "../outside", "file/../file", "./file", "file//"] {
        assert!(onegit_git::GitPath::new(path).is_err());
    }

    for message in ["\nMissing summary", " \nBody", "\0message", "\u{feff}"] {
        let mut invalid = allowed.clone();

        invalid.message = message.into();
        invalids.push(invalid);
    }

    for invalid in invalids {
        assert!(
            repository.commit_selected_files(&invalid, None).is_err(),
            "{invalid:?}"
        );
    }

    fixture.write(".git/MERGE_HEAD", std::str::from_utf8(&head).unwrap());
    assert!(repository.commit_selected_files(&allowed, None).is_err());
    fs::remove_file(fixture.root.join(".git/MERGE_HEAD")).unwrap();
    fixture.write(".git/index.lock", "another process");
    assert_eq!(
        repository
            .commit_selected_files(&allowed, None)
            .unwrap_err()
            .failure
            .code,
        ErrorCode::RepositoryLocked
    );
    assert_eq!(
        fs::read(fixture.root.join(".git/index.lock")).unwrap(),
        b"another process"
    );
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), head);
}

#[test]
fn directories_are_refused_and_pre_cancelled_requests_never_acquire_a_lock() {
    let fixture = Fixture::new();

    fixture.write("file", "base\n");
    fixture.commit("base");
    fs::remove_file(fixture.root.join("file")).unwrap();
    fs::create_dir(fixture.root.join("file")).unwrap();
    fixture.write("file/unchecked", "keep outside commit\n");
    let repository = open(&fixture);
    let input = request(&repository, &["file"]);
    let index = fs::read(fixture.root.join(".git/index")).unwrap();
    let working = unchanged_working(&fixture);

    assert!(
        repository
            .commit_selected_files(&input, None)
            .unwrap_err()
            .to_string()
            .contains("directory")
    );
    let cancellation = Cancellation::default();

    cancellation.cancel();
    let mut invalid = input;

    invalid.message.clear();
    assert_eq!(
        repository
            .commit_selected_files(&invalid, Some(&cancellation))
            .unwrap_err()
            .failure
            .code,
        ErrorCode::Aborted
    );
    assert!(!fixture.root.join(".git/index.lock").exists());
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    working();
}

#[test]
fn linked_worktrees_use_their_own_index_and_detached_commits_remain_supported() {
    let fixture = Fixture::new();

    fixture.write("file", "base\n");
    fixture.commit("base");
    let head = fixture.git(&["rev-parse", "HEAD"]);
    let index = fs::read(fixture.root.join(".git/index")).unwrap();
    let linked = fixture.temporary.path().join("linked");

    fixture.git_os([
        "worktree".into(),
        "add".into(),
        "-b".into(),
        "linked".into(),
        linked.clone().into_os_string(),
    ]);
    fs::write(linked.join("linked"), "linked\n").unwrap();
    let repository = Repository::open(&linked, fixture.process(), None).unwrap();

    let result = repository
        .commit_selected_files(&request(&repository, &["linked"]), None)
        .unwrap();

    assert_eq!(
        result.snapshot.unwrap().status.head.branch.as_deref(),
        Some("linked")
    );
    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    fixture.git(&["checkout", "--detach"]);
    fixture.write("detached", "detached\n");
    let repository = open(&fixture);

    let result = repository
        .commit_selected_files(&request(&repository, &["detached"]), None)
        .unwrap();

    assert!(result.snapshot.unwrap().status.head.branch.is_none());
    assert_eq!(fixture.git(&["show", "HEAD:detached"]), b"detached\n");
}

#[test]
#[cfg(unix)]
fn external_head_directory_and_partial_patch_changes_are_rechecked_before_commit() {
    for change in ["head", "directory", "partial"] {
        let fixture = Fixture::new();

        fixture.write("file", "base\n");
        fixture.commit("base");
        let head = fixture.git(&["rev-parse", "HEAD"]);

        // Produce a different valid commit without moving the reviewed branch yet.
        fixture.write("other", "other\n");
        fixture.commit("other");
        let other = fixture.git(&["rev-parse", "HEAD"]);

        fixture.git(&[
            "reset",
            "--hard",
            std::str::from_utf8(&head).unwrap().trim(),
        ]);
        fixture.write("file", "first\nsecond\n");
        let index = fs::read(fixture.root.join(".git/index")).unwrap();
        let wrapper = fixture.temporary.path().join("git-wrapper.sh");

        executable(
            &wrapper,
            r#"#!/bin/sh
for argument in "$@"; do
  if { [ "$argument" = add ] && [ "$ONEGIT_CHANGE" != partial ]; } || { [ "$argument" = apply ] && [ "$ONEGIT_CHANGE" = partial ]; }; then
    git "$@" || exit "$?"
    case "$ONEGIT_CHANGE" in
      head) git update-ref refs/heads/main "$ONEGIT_OTHER" ;;
      directory) rm file; mkdir file; printf 'unchecked\n' > file/unchecked ;;
      partial) printf 'changed after apply\n' > file ;;
    esac
    exit 0
  fi
done
exec git "$@"
"#,
        );
        let runner = process(&fixture, wrapper).with_environment([
            ("ONEGIT_CHANGE".into(), change.into()),
            (
                "ONEGIT_OTHER".into(),
                std::str::from_utf8(&other).unwrap().trim().into(),
            ),
        ]);

        let repository = Repository::open(&fixture.root, runner, None).unwrap();

        let input = if change == "partial" {
            partial_request(&repository, "file", &["-:1", "+:1"])
        } else {
            request(&repository, &["file"])
        };

        let error = repository.commit_selected_files(&input, None).unwrap_err();

        assert!(
            error.to_string().contains(match change {
                "head" => "HEAD or the branch changed",
                "directory" => "directory",
                _ => "changed since",
            }),
            "{error}"
        );
        assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
        assert_eq!(
            fixture.git(&["rev-parse", "HEAD"]),
            if change == "head" { other } else { head }
        );
        assert!(!fixture.root.join(".git/index.lock").exists());

        if change == "directory" {
            assert_eq!(
                fs::read(fixture.root.join("file/unchecked")).unwrap(),
                b"unchecked\n"
            );
        }
    }
}

#[test]
fn conflicts_in_unchecked_files_also_block_selected_and_staged_commits() {
    let fixture = Fixture::new();

    fixture.write("conflict", "base\n");
    fixture.commit("base");
    fixture.git(&["checkout", "-b", "other"]);
    fixture.write("conflict", "other\n");
    fixture.commit("other");
    fixture.git(&["checkout", "main"]);
    fixture.write("conflict", "main\n");
    fixture.commit("main");
    assert!(
        fixture
            .process()
            .run(onegit_git::GitCommand::new(
                &fixture.root,
                ["merge", "other"]
            ))
            .is_err()
    );
    fixture.write("selected", "selected\n");
    fixture.git(&["add", "selected"]);
    let repository = open(&fixture);
    let mut input = request(&repository, &["selected"]);
    let index = fs::read(fixture.root.join(".git/index")).unwrap();
    let working = unchanged_working(&fixture);

    assert_eq!(
        repository
            .commit_selected_files(&input, None)
            .unwrap_err()
            .failure
            .code,
        ErrorCode::Conflict
    );
    input.mode = CommitMode::Staged;
    assert_eq!(
        repository
            .commit_selected_files(&input, None)
            .unwrap_err()
            .failure
            .code,
        ErrorCode::Conflict
    );
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    working();
}
