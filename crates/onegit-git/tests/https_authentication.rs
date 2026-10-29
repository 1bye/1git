//! Real Git/OpenSSL/Python TLS loopback parity, including clone/sync, redirects, redaction and cancellation.
//! Credentials and certificates are disposable; no hosting provider or user secrets are used.
mod common;

use common::Fixture;

use onegit_git::{
    BranchIdentity, Cancellation, CloneOptions, CommitIndex, FetchOptions, GitProcess,
    HttpAuthentication, Repository, SyncBranch, SyncKind, ToolCommand, execute_tool,
};

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

struct Server {
    child: Child,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct Https {
    fixture: Fixture,
    _server: Server,
    mode: PathBuf,
    log: PathBuf,
    url: String,
    process: GitProcess,
}

impl Https {
    fn new() -> Self {
        let fixture = Fixture::new();

        fixture.write("base", "base\n");
        fixture.commit("Base");
        fixture.git(&["config", "http.receivepack", "true"]);
        fixture.git(&["config", "receive.denyCurrentBranch", "updateInstead"]);
        let cert = fixture.temporary.path().join("cert.pem");
        let key = fixture.temporary.path().join("key.pem");

        let mut generate = ToolCommand::new(
            std::path::Path::new("openssl"),
            fixture.temporary.path(),
            [
                "req".into(),
                "-x509".into(),
                "-newkey".into(),
                "rsa:2048".into(),
                "-nodes".into(),
                "-days".into(),
                "1".into(),
                "-subj".into(),
                "/CN=127.0.0.1".into(),
                "-addext".into(),
                "subjectAltName=IP:127.0.0.1".into(),
                "-keyout".into(),
                key.as_os_str().to_owned(),
                "-out".into(),
                cert.as_os_str().to_owned(),
            ],
        );

        generate.timeout = std::time::Duration::from_secs(30);
        execute_tool(generate).unwrap();
        let script = fixture.temporary.path().join("server.py");

        std::fs::write(&script, include_str!("fixtures/https_git.py")).unwrap();
        let mode = fixture.temporary.path().join("mode");

        std::fs::write(&mode, "normal").unwrap();
        let log = fixture.temporary.path().join("requests");

        let child = Command::new(if cfg!(windows) { "python" } else { "python3" })
            .arg("-u")
            .arg(&script)
            .args([&fixture.root, &cert, &key, &mode, &log])
            .env(
                "ONEGIT_FIXTURE_AUTH",
                "Basic Zml4dHVyZTp0ZXN0LXBhc3N3b3JkLTEyMw==",
            )
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();

        let mut server = Server { child };
        let mut port = String::new();

        BufReader::new(server.child.stdout.take().unwrap())
            .read_line(&mut port)
            .unwrap();
        let port = port.trim().parse::<u16>().expect("TLS fixture startup");

        let wrapper = fixture.temporary.path().join(if cfg!(windows) {
            "git-trust.cmd"
        } else {
            "git-trust.sh"
        });

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let quoted = format!("'{}'", cert.to_string_lossy().replace('\'', "'\\''"));

            std::fs::write(
                &wrapper,
                format!("#!/bin/sh\nexec git -c http.sslCAInfo={quoted} \"$@\"\n"),
            )
            .unwrap();
            std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        #[cfg(windows)]
        std::fs::write(
            &wrapper,
            format!(
                "@git -c http.sslBackend=openssl -c http.sslCAInfo=\"{}\" %*\r\n",
                cert.display()
            ),
        )
        .unwrap();
        let process = GitProcess::new(wrapper, 64 * 1024 * 1024);

        Self {
            fixture,
            _server: server,
            mode,
            log,
            url: format!("https://127.0.0.1:{port}/repo.git"),
            process,
        }
    }

    fn auth(&self) -> HttpAuthentication<'_> {
        HttpAuthentication {
            url: &self.url,
            username: "fixture",
            password: "test-password-123",
        }
    }

    fn clone_repository(&self, name: &str) -> Result<Repository, onegit_git::RepositoryError> {
        let destination = self.fixture.temporary.path().join(name);
        let auth = self.auth();
        let mut options = CloneOptions::new(&self.url, &destination);

        options.authentication = Some(&auth);

        Repository::clone(options, self.process.clone(), None)
    }
}

#[test]
fn clones_fetches_fast_forwards_and_pushes_with_transient_https_credentials() {
    let tls = Https::new();
    let r = tls.clone_repository("clone").unwrap();
    let config = std::fs::read_to_string(r.info().git_directory.join("config")).unwrap();

    assert!(!config.contains("extraHeader"));
    assert!(!config.contains("test-password"));
    tls.fixture.write("server", "advanced\n");
    tls.fixture.commit("Remote advance");
    let auth = tls.auth();

    r.fetch(
        FetchOptions {
            remote: Some("origin"),
            authentication: Some(&auth),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    let expected = BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap());

    r.sync_branch(
        SyncBranch {
            kind: SyncKind::Pull,
            expected: &expected,
            remote: "origin",
            remote_ref: "refs/heads/main",
            authentication: Some(&auth),
            on_progress: None,
        },
        None,
    )
    .unwrap();
    r.set_config("user.name", "Fixture", onegit_git::ConfigScope::Local, None)
        .unwrap();
    r.set_config(
        "user.email",
        "fixture@example.invalid",
        onegit_git::ConfigScope::Local,
        None,
    )
    .unwrap();
    std::fs::write(r.info().root.join("client"), "new\n").unwrap();
    r.stage_all(None).unwrap();
    r.commit_index(
        CommitIndex {
            summary: "Client",
            ..Default::default()
        },
        None,
    )
    .unwrap();
    let expected = BranchIdentity::from_snapshot(&r.snapshot(false, None).unwrap());

    r.sync_branch(
        SyncBranch {
            kind: SyncKind::Push,
            expected: &expected,
            remote: "origin",
            remote_ref: "refs/heads/main",
            authentication: Some(&auth),
            on_progress: None,
        },
        None,
    )
    .unwrap();
    assert_eq!(
        std::fs::read(tls.fixture.root.join("client")).unwrap(),
        b"new\n"
    );
    assert!(
        std::fs::read_to_string(&tls.log)
            .unwrap()
            .lines()
            .all(|l| l.starts_with("True "))
    );
}

#[test]
fn refuses_https_redirects_and_redacts_reflected_401_and_403_credentials() {
    let tls = Https::new();

    for mode in ["redirect", "401", "403"] {
        std::fs::write(&tls.mode, mode).unwrap();
        let error = tls
            .clone_repository(mode)
            .err()
            .expect("transport must be rejected");

        let failure =
            onegit_git::Failure::from_repository(onegit_git::Operation::CloneRepository, &error);

        let diagnostic = format!("{error:?} {failure:?}");

        assert!(!diagnostic.contains("test-password-123"));
        assert!(!diagnostic.contains("Zml4dHVy"));
        assert!(!diagnostic.contains("reflected-fixture-secret"));

        if mode == "403" {
            assert!(diagnostic.contains("Authentication failed"));
        }
    }

    assert!(
        !std::fs::read_to_string(&tls.log)
            .unwrap()
            .contains("/stolen")
    );
}

#[test]
fn isolated_clone_clears_malicious_process_configuration_and_rejects_unsafe_inputs_before_spawn() {
    let tls = Https::new();
    let auth = tls.auth();
    let destination = tls.fixture.temporary.path().join("isolated");
    let mut options = CloneOptions::new(&tls.url, &destination);

    options.authentication = Some(&auth);
    let malicious = tls.process.clone().with_environment([
        ("GIT_CONFIG_COUNT".into(), "1".into()),
        (
            "GIT_CONFIG_KEY_0".into(),
            "url.https://evil.invalid/.insteadOf".into(),
        ),
        ("GIT_CONFIG_VALUE_0".into(), tls.url.clone().into()),
    ]);

    Repository::clone(options, malicious, None).unwrap();
    let destination = tls.fixture.temporary.path().join("refused");
    let mut options = CloneOptions::new(&tls.url, &destination);

    options.authentication = Some(&auth);
    options.recurse_submodules = true;
    assert!(Repository::clone(options, tls.process.clone(), None).is_err());
    assert!(!destination.exists());
}

#[test]
fn cancellation_reaps_an_authenticated_git_command_without_leaking_transport_output() {
    let tls = Https::new();

    std::fs::write(&tls.mode, "slow").unwrap();
    let stop = Cancellation::default();
    let other = stop.clone();

    let cancel = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(500));
        other.cancel();
    });

    let destination = tls.fixture.temporary.path().join("cancelled");
    let auth = tls.auth();
    let mut options = CloneOptions::new(&tls.url, &destination);

    options.authentication = Some(&auth);
    let began = std::time::Instant::now();

    assert!(matches!(
        Repository::clone(options, tls.process.clone(), Some(&stop)),
        Err(onegit_git::RepositoryError::Git(
            onegit_git::GitError::Cancelled
        ))
    ));
    cancel.join().unwrap();
    assert!(began.elapsed() < std::time::Duration::from_secs(10));
}
