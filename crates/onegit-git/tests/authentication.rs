//! One-shot auth validation, child environment isolation and safe diagnostics.
mod common;
use common::Fixture;
use onegit_git::{GitCommand, GitError, HttpAuthentication};
#[test]
fn transient_auth_stays_in_child_config_and_never_in_repository_or_error_output() {
    let f = Fixture::new();
    let auth = HttpAuthentication {
        url: "https://example.invalid/repo",
        username: "fixture",
        password: "test-password-123",
    };
    let before = std::fs::read(f.root.join(".git/config")).unwrap();
    let mut command = GitCommand::new(
        &f.root,
        [
            "config",
            "--get",
            "http.https://example.invalid/repo.extraHeader",
        ],
    );
    command.http_authentication = Some(&auth);
    let output = f.process().run(command).unwrap();
    assert!(output.stdout.starts_with(b"Authorization: Basic "));
    assert_eq!(std::fs::read(f.root.join(".git/config")).unwrap(), before);
    let mut command = GitCommand::new(
        &f.root,
        [
            "-c",
            "alias.refuse=!echo test-password-123 >&2; exit 1",
            "refuse",
        ],
    );
    command.http_authentication = Some(&auth);
    let error = f.process().run(command).unwrap_err();
    let failure = onegit_git::Failure::from_process(onegit_git::Operation::Fetch, &error);
    assert!(!format!("{failure:?}").contains("test-password-123"));
    if let GitError::CommandFailed { output, .. } = &error {
        assert!(!String::from_utf8_lossy(&output.stderr).contains("test-password-123"));
    }
    assert!(matches!(error, GitError::CommandFailed { .. }));
    assert!(!format!("{auth:?}").contains("test-password-123"));
}
#[test]
fn account_credentials_require_one_exact_credential_free_https_destination() {
    for url in [
        "http://example.invalid/repo",
        "https://u:p@example.invalid/repo",
        "https://example.invalid/repo?query",
        "https://example.invalid/repo#fragment",
    ] {
        let auth = HttpAuthentication {
            url,
            username: "fixture",
            password: "secret",
        };
        assert!(auth.validate_for(&[url.to_owned()]).is_err());
    }
    let auth = HttpAuthentication {
        url: "https://example.invalid/repo",
        username: "fixture",
        password: "secret",
    };
    assert!(auth.validate_for(&[]).is_err());
    assert!(
        auth.validate_for(&[auth.url.into(), auth.url.into()])
            .is_err()
    );
    assert!(
        auth.validate_for(&["https://example.invalid/other".into()])
            .is_err()
    );
    for username in ["bad:name", "has space", "has\nnewline"] {
        assert!(
            HttpAuthentication { username, ..auth }
                .validate_for(&[auth.url.into()])
                .is_err()
        );
    }
}
#[test]
fn authenticated_commands_clear_inherited_overrides_and_ignore_raw_output_observers() {
    let f = Fixture::new();
    let auth = HttpAuthentication {
        url: "https://example.invalid/repo",
        username: "fixture",
        password: "secret",
    };
    let mut command = GitCommand::new(&f.root, ["config", "--get", "credential.helper"]);
    let calls = std::cell::Cell::new(0);
    let observer = |_, _: &[u8]| calls.set(calls.get() + 1);
    command.on_output = Some(&observer);
    command.http_authentication = Some(&auth);
    command.environment = vec![
        ("GIT_CONFIG_COUNT".into(), "1".into()),
        ("GIT_CONFIG_KEY_0".into(), "credential.helper".into()),
        ("GIT_CONFIG_VALUE_0".into(), "must-not-run".into()),
    ];
    let output = f.process().run(command).unwrap();
    assert!(output.stdout.iter().all(u8::is_ascii_whitespace));
    assert_eq!(calls.get(), 0);
}
