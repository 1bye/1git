//! Child-only scoped credentials; no credential-bearing argv or persisted configuration.
use crate::{GitError, GitOutput, RepositoryError};
use regex::Regex;
use std::sync::LazyLock;

static UNSAFE_CREDENTIAL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\p{C}\s]").expect("literal credential pattern"));

use base64::{Engine, engine::general_purpose::STANDARD};
use std::ffi::OsString;
use std::process::Command;

/// One-shot Basic authentication for exactly one credential-free HTTPS destination.
/// Secrets are borrowed for one invocation and never retained by the repository session.
#[derive(Clone, Copy)]
pub struct HttpAuthentication<'a> {
    /// Exact freshly resolved remote URL, without credentials, query or fragment.
    pub url: &'a str,
    /// Nonempty account username, at most 2048 UTF-16 units, without colon/whitespace/control bytes.
    pub username: &'a str,
    /// Nonempty transient password/token, at most 4096 UTF-16 units, without whitespace/control bytes.
    pub password: &'a str,
}
impl std::fmt::Debug for HttpAuthentication<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("HttpAuthentication([redacted])")
    }
}
impl HttpAuthentication<'_> {
    /// Validate one freshly resolved destination before exposing credentials to a child.
    ///
    /// # Errors
    /// Rejects ambiguous/stale URLs, non-HTTPS transport or unsafe credential characters.
    pub fn validate_for(&self, urls: &[String]) -> Result<(), RepositoryError> {
        let valid = url::Url::parse(self.url).is_ok_and(|u| {
            u.scheme() == "https"
                && u.has_host()
                && u.username().is_empty()
                && u.password().is_none()
                && u.query().is_none()
                && u.fragment().is_none()
        });
        if urls.len() != 1
            || urls[0] != self.url
            || !valid
            || self.username.is_empty()
            || self.username.encode_utf16().count() > 2048
            || self.username.contains(':')
            || self.password.is_empty()
            || self.password.encode_utf16().count() > 4096
            || (UNSAFE_CREDENTIAL.is_match(self.username)
                || UNSAFE_CREDENTIAL.is_match(self.password))
        {
            return Err(RepositoryError::InvalidInput(
                "The HTTPS destination changed or is ambiguous. Review the remote and account before retrying.",
            ));
        }
        Ok(())
    }

    pub(crate) fn apply(
        &self,
        command: &mut Command,
        overrides: impl IntoIterator<Item = OsString>,
        isolate_clone: bool,
    ) -> Result<(), GitError> {
        self.validate_for(&[self.url.into()]).map_err(|_| {
            GitError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Account authentication requires one validated HTTPS destination.",
            ))
        })?;
        for key in std::env::vars_os().map(|(k, _)| k).chain(overrides) {
            let normalized = key.to_string_lossy().to_ascii_uppercase();
            if normalized.starts_with("GIT_") || normalized.starts_with("GCM_") {
                command.env_remove(key);
            }
        }
        let null = if cfg!(windows) { "NUL" } else { "/dev/null" };
        let mut settings = vec![
            ("credential.helper".to_owned(), String::new()),
            ("core.askPass".into(), String::new()),
            ("http.followRedirects".into(), "false".into()),
            ("http.sslVerify".into(), "true".into()),
            ("protocol.allow".into(), "never".into()),
            ("protocol.https.allow".into(), "always".into()),
            ("http.extraHeader".into(), String::new()),
        ];
        if isolate_clone {
            settings.extend([
                ("core.hooksPath".into(), null.into()),
                ("init.templateDir".into(), String::new()),
            ]);
            command
                .env("GIT_CONFIG_GLOBAL", null)
                .env("GIT_CONFIG_NOSYSTEM", "1");
        }
        let encoded = STANDARD.encode(format!("{}:{}", self.username, self.password));
        settings.push((
            format!("http.{}.extraHeader", self.url),
            format!("Authorization: Basic {encoded}"),
        ));
        command.env("GIT_CONFIG_COUNT", settings.len().to_string());
        for (i, (key, value)) in settings.into_iter().enumerate() {
            command
                .env(format!("GIT_CONFIG_KEY_{i}"), key)
                .env(format!("GIT_CONFIG_VALUE_{i}"), value);
        }
        Ok(())
    }
}

pub(crate) fn sanitized(error: GitError) -> GitError {
    match error {
        GitError::CommandFailed { status, output } => {
            let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
            let denied = [
                "authentication failed",
                "repository not found",
                "could not read username",
                "requested url returned error: 401",
                "requested url returned error: 403",
            ]
            .iter()
            .any(|p| stderr.contains(p));
            let message = if denied {
                "Authentication failed: the HTTPS remote denied access for the selected account. Check account credentials and repository permissions."
            } else {
                "Authenticated HTTPS request failed. Check repository permissions, network and certificate settings."
            };
            GitError::CommandFailed {
                status,
                output: GitOutput {
                    stdout: Vec::new(),
                    stderr: message.as_bytes().to_vec(),
                },
            }
        }
        other => other,
    }
}
