use super::*;
#[cfg(unix)]
use onegit_git::{GitCommand, GitError, RepositoryError, WritePhase};
#[cfg(unix)]
use std::error::Error;

#[test]
#[cfg(unix)]
fn real_hooks_run_for_whole_partial_and_amend_commits_and_preserve_original_errors() {
    for kind in ["whole", "partial", "amend"] {
        let fixture = Fixture::new();

        fixture.write("file", "base\n");
        fixture.write("excluded", "base excluded\n");
        fixture.commit("base");
        fixture.write("excluded", "staged excluded\n");
        fixture.git(&["add", "excluded"]);
        fixture.write("file", "first\nsecond\n");
        let repository = Repository::open(&fixture.root, process(&fixture, "git"), None).unwrap();

        let mut input = if kind == "partial" {
            partial_request(&repository, "file", &["-:1", "+:1"])
        } else {
            request(&repository, &["file"])
        };

        input.amend = kind == "amend";
        let index = fs::read(fixture.root.join(".git/index")).unwrap();
        let head = fixture.git(&["rev-parse", "HEAD"]);
        let hook = fixture.root.join(".git/hooks/pre-commit");

        executable(&hook, "#!/bin/sh\necho commit-blocked >&2\nexit 1\n");
        let working = unchanged_working(&fixture);
        let error = repository.commit_selected_files(&input, None).unwrap_err();

        assert_eq!(error.phase, WritePhase::Command);
        assert!(error.source().is_some());
        let cause = error
            .source()
            .unwrap()
            .downcast_ref::<RepositoryError>()
            .unwrap();

        let RepositoryError::Git(GitError::CommandFailed { output, .. }) = cause else {
            panic!("original Git hook error was not preserved: {cause:?}");
        };

        assert!(String::from_utf8_lossy(&output.stderr).contains("commit-blocked"));
        assert_eq!(fixture.git(&["rev-parse", "HEAD"]), head);
        assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
        assert!(!fixture.root.join(".git/index.lock").exists());

        if kind == "amend" {
            assert_eq!(
                fixture.git(&["for-each-ref", "--format=%(objectname)", "refs/1git/amend/"]),
                head
            );
        }

        working();
        executable(
            &hook,
            "#!/bin/sh\nprintf 'hook ran\\n' > .git/hook-ran\nexit 0\n",
        );
        let result = repository.commit_selected_files(&input, None).unwrap();

        assert_eq!(result.outcome, CommitOutcome::Committed);
        assert!(result.warning.is_none());
        assert_eq!(
            fs::read(fixture.root.join(".git/hook-ran")).unwrap(),
            b"hook ran\n"
        );
        assert_eq!(fixture.git(&["show", ":excluded"]), b"staged excluded\n");
        assert_eq!(
            fixture.git(&["show", "HEAD:file"]),
            if kind == "partial" {
                b"first\n".as_slice()
            } else {
                b"first\nsecond\n"
            }
        );
    }
}

#[test]
#[cfg(unix)]
fn post_write_refresh_or_process_failures_return_review_warnings_without_a_retryable_error() {
    for kind in ["refresh", "outcome", "unreadable-outcome"] {
        let fixture = Fixture::new();

        fixture.write("file", "base\n");
        fixture.commit("base");
        let wrapper = fixture.temporary.path().join("git-wrapper.sh");

        let after = match kind {
            "refresh" => "touch .git/fail-refresh; exit 0",
            "outcome" => "exit 1",
            _ => "touch .git/fail-refresh; exit 1",
        };

        executable(
            &wrapper,
            &format!(
                "#!/bin/sh\nif [ -f .git/fail-refresh ]; then exit 1; fi\nfor argument in \"$@\"; do\n  if [ \"$argument\" = commit ]; then\n    git \"$@\" || exit \"$?\"\n    {after}\n  fi\ndone\nexec git \"$@\"\n"
            ),
        );
        let repository = Repository::open(&fixture.root, process(&fixture, wrapper), None).unwrap();

        fixture.write("new", "new\n");
        let input = request(&repository, &["new"]);
        let index = fs::read(fixture.root.join(".git/index")).unwrap();
        let working = unchanged_working(&fixture);
        let result = repository.commit_selected_files(&input, None).unwrap();

        assert_ne!(
            fixture.git(&["rev-parse", "HEAD"]),
            format!("{}\n", input.expected.oid.unwrap()).as_bytes()
        );
        assert_eq!(fixture.git(&["show", "HEAD:new"]), b"new\n");
        assert_eq!(
            result.outcome,
            if kind == "refresh" {
                CommitOutcome::Committed
            } else {
                CommitOutcome::Unknown
            }
        );
        assert!(result.warning.unwrap().contains(if kind == "refresh" {
            "refreshing"
        } else {
            "uncertain"
        }));
        let directories: Vec<_> = fs::read_dir(fixture.root.join(".git"))
            .unwrap()
            .map(|entry| entry.unwrap())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("1git-commit-")
            })
            .collect();

        if kind == "refresh" {
            assert!(result.snapshot.is_none());
            assert!(directories.is_empty());
        } else {
            assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
            assert_eq!(directories.len(), 1);
            assert!(directories[0].path().join("index").is_file());
            assert_eq!(result.snapshot.is_none(), kind == "unreadable-outcome");
        }

        assert!(!fixture.root.join(".git/index.lock").exists());
        working();
    }
}

#[test]
#[cfg(unix)]
fn post_commit_lock_replacement_is_never_overwritten_and_retains_recovery_index() {
    let fixture = Fixture::new();

    fixture.write("file", "base\n");
    fixture.commit("base");
    let wrapper = fixture.temporary.path().join("git-wrapper.sh");

    executable(
        &wrapper,
        "#!/bin/sh\nfor argument in \"$@\"; do\n  if [ \"$argument\" = commit ]; then\n    git \"$@\" || exit \"$?\"\n    mv .git/index.lock .git/owned-lock-moved\n    printf 'foreign lock' > .git/index.lock\n    exit 0\n  fi\ndone\nexec git \"$@\"\n",
    );
    let repository = Repository::open(&fixture.root, process(&fixture, wrapper), None).unwrap();

    fixture.write("new", "new\n");
    let index = fs::read(fixture.root.join(".git/index")).unwrap();

    let result = repository
        .commit_selected_files(&request(&repository, &["new"]), None)
        .unwrap();

    assert_eq!(result.outcome, CommitOutcome::Committed);
    assert!(result.warning.as_ref().unwrap().contains("Do not recommit"));
    assert!(result.warning.unwrap().contains("cleanup failed"));
    assert_eq!(
        fs::read(fixture.root.join(".git/index.lock")).unwrap(),
        b"foreign lock"
    );
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    assert_eq!(fixture.git(&["show", "HEAD:new"]), b"new\n");
    assert_eq!(
        fs::read_dir(fixture.root.join(".git"))
            .unwrap()
            .filter(|entry| entry
                .as_ref()
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("1git-commit-"))
            .count(),
        1
    );
}

#[test]
#[cfg(unix)]
fn repository_signing_configuration_is_honored_without_using_a_real_key() {
    let fixture = Fixture::new();

    fixture.write("file", "base\n");
    fixture.commit("base");
    let signer = fixture.temporary.path().join("gpg-fixture.sh");

    executable(
        &signer,
        "#!/bin/sh\ncat >/dev/null\nprintf 'signing invoked' > .git/signing-invoked\necho fixture-signing-failed >&2\nexit 1\n",
    );
    fixture.git_os([
        "config".into(),
        "gpg.program".into(),
        signer.into_os_string(),
    ]);
    fixture.git(&["config", "commit.gpgsign", "true"]);
    let runner =
        process(&fixture, "git").with_environment([("GIT_CONFIG_COUNT".into(), "1".into())]);

    let repository = Repository::open(&fixture.root, runner, None).unwrap();

    fixture.write("file", "changed\n");
    let input = request(&repository, &["file"]);
    let index = fs::read(fixture.root.join(".git/index")).unwrap();
    let error = repository.commit_selected_files(&input, None).unwrap_err();

    assert_eq!(error.phase, WritePhase::Command);
    assert!(error.source().is_some());
    assert_eq!(
        fs::read(fixture.root.join(".git/signing-invoked")).unwrap(),
        b"signing invoked"
    );
    assert_eq!(
        fixture.git(&["rev-parse", "HEAD"]),
        format!("{}\n", input.expected.oid.unwrap()).as_bytes()
    );
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(fixture.root.join("file")).unwrap(), b"changed\n");
    assert!(!fixture.root.join(".git/index.lock").exists());
    // This proves invocation/error ownership only; successful signature parity has its own gate.
    assert!(
        process(&fixture, "git")
            .run(GitCommand::new(&fixture.root, ["status", "--porcelain"]))
            .is_ok()
    );
}

#[test]
fn selected_and_amended_commits_have_valid_signatures_from_an_ephemeral_fixture_key() {
    use onegit_git::{ToolCommand, execute_tool};

    let fixture = Fixture::new();
    let key = fixture.temporary.path().join("fixture-signing-key");

    execute_tool(ToolCommand::new(
        std::path::Path::new("ssh-keygen"),
        fixture.temporary.path(),
        [
            "-q".into(),
            "-t".into(),
            "ed25519".into(),
            "-N".into(),
            "".into(),
            "-C".into(),
            "fixture@example.invalid".into(),
            "-f".into(),
            key.clone().into_os_string(),
        ],
    ))
    .unwrap();
    fixture.write("file", "base\n");
    fixture.commit("base");
    fixture.git(&["config", "commit.gpgsign", "true"]);
    fixture.git(&["config", "gpg.format", "ssh"]);
    fixture.git(&["config", "gpg.ssh.program", "ssh-keygen"]);
    fixture.git_os([
        "config".into(),
        "user.signingkey".into(),
        key.into_os_string(),
    ]);

    let public_key =
        fs::read_to_string(fixture.temporary.path().join("fixture-signing-key.pub")).unwrap();

    let signers = fixture.temporary.path().join("allowed-signers");

    fs::write(&signers, format!("fixture@example.invalid {public_key}")).unwrap();
    fixture.git_os([
        "config".into(),
        "gpg.ssh.allowedSignersFile".into(),
        signers.into_os_string(),
    ]);
    fixture.write("file", "selected\n");

    let runner = process(&fixture, "git").with_environment([
        ("GIT_CONFIG_COUNT".into(), "1".into()),
        ("SSH_AUTH_SOCK".into(), "/dev/null".into()),
    ]);

    let repository = Repository::open(&fixture.root, runner, None).unwrap();
    let working = unchanged_working(&fixture);

    repository
        .commit_selected_files(&request(&repository, &["file"]), None)
        .unwrap();
    fixture.git(&["verify-commit", "HEAD"]);
    assert!(
        String::from_utf8(fixture.git(&["cat-file", "commit", "HEAD"]))
            .unwrap()
            .contains("gpgsig -----BEGIN SSH SIGNATURE-----")
    );

    let mut input = request(&repository, &[]);

    input.amend = true;
    input.message = "Signed amended message".into();
    repository.commit_selected_files(&input, None).unwrap();
    fixture.git(&["verify-commit", "HEAD"]);
    assert_eq!(fixture.git(&["show", "HEAD:file"]), b"selected\n");
    working();
}
