//! Reviewed config-only edits. Git owns file locks; external writers can still race after review.
use super::metadata_writes::{before, refresh, remote_url};
use super::{Remote, Repository, RepositoryError, WriteError, WritePhase};
use crate::{Cancellation, GitCommand, GitError, GitProcess};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::Mutex};

// Coordinate global identity with repository settings from this process without changing other Git writes.
static SETTINGS: Mutex<()> = Mutex::new(());

/// Commit attribution, independent of hosting credentials; absent values inherit Git defaults.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct CommitIdentity {
    /// Configured author name, retaining absence versus an empty value.
    pub name: Option<String>,
    /// Configured author email.
    pub email: Option<String>,
}

impl CommitIdentity {
    /// Validate the same name/email forms accepted by the desktop identity editor.
    /// # Errors
    /// Returns invalid input for missing names, invalid emails or Git identity delimiters.
    pub fn validate(&self) -> Result<(), RepositoryError> {
        let name = self.name.as_deref().unwrap_or("");
        let raw_email = self.email.as_deref().unwrap_or("");
        let email = raw_email.trim();

        if name.trim().is_empty()
            || name.contains(['\r', '\n', '\0', '<', '>'])
            || raw_email.contains(['\r', '\n', '\0', '<', '>'])
            || email.chars().any(char::is_whitespace)
            || email.split('@').count() != 2
            || email.starts_with('@')
            || email.ends_with('@')
        {
            return Err(RepositoryError::InvalidInput(
                "Enter a name and a valid commit email address.",
            ));
        }

        Ok(())
    }

    fn trimmed(&self) -> Self {
        Self {
            name: self.name.as_deref().map(|v| v.trim().to_owned()),
            email: self.email.as_deref().map(|v| v.trim().to_owned()),
        }
    }
}

/// Fresh repository settings with an opaque configuration fingerprint for stale-editor guards.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GitSettings {
    /// Effective author identity, including inherited Git values.
    pub identity: CommitIdentity,
    /// Repository overrides shared by linked worktrees.
    pub local_identity: CommitIdentity,
    /// Effective configured fetch/push destinations; reading never contacts them.
    pub remotes: Vec<Remote>,
    /// Advanced worktree overrides cannot be replaced by repository defaults.
    pub identity_read_only_reason: Option<String>,
    root: PathBuf,
    common: PathBuf,
    fingerprint: [u8; 32],
}

impl GitSettings {
    /// Whether either repository-local author key is configured.
    #[must_use]
    pub fn custom(&self) -> bool {
        self.local_identity.name.is_some() || self.local_identity.email.is_some()
    }
}

/// Explicit settings intent; none of these operations fetches or modifies hosting credentials.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SettingsChange {
    /// Set both local author keys, or remove both overrides to inherit Git defaults.
    Identity(Option<CommitIdentity>),
    /// Add one remote without fetching.
    AddRemote {
        /// New remote name.
        name: String,
        /// Credential-free fetch URL.
        url: String,
    },
    /// Replace a single fetch URL, preserving any dedicated push destinations.
    EditRemote {
        /// Existing remote name.
        name: String,
        /// Credential-free replacement URL.
        url: String,
    },
    /// Remove the reviewed remote, its tracking refs and configuration; keep local branches.
    RemoveRemote {
        /// Exact reviewed remote name.
        name: String,
    },
}

impl Repository {
    /// Read author overrides and remote configuration without writing files or contacting a remote.
    /// # Errors
    /// Returns filesystem, Git, cancellation or invalid-output errors.
    pub fn git_settings(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<GitSettings, RepositoryError> {
        let _settings = SETTINGS.lock().expect("settings queue poisoned");

        self.mutations.wait_for_pending();
        self.check_write_identity()?;

        self.git_settings_uncoordinated(cancellation)
    }

    fn git_settings_uncoordinated(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<GitSettings, RepositoryError> {
        let value = |scope: &str, key: &str| -> Result<Option<String>, RepositoryError> {
            config_value(self.run(["config", scope, "--get", key], cancellation))
        };

        let effective = |key: &str| config_value(self.run(["config", "--get", key], cancellation));
        let extension = value("--local", "extensions.worktreeConfig")?;

        let worktree = extension.as_deref().is_some_and(|v| {
            ["true", "yes", "on", "1", ""].contains(&v.to_ascii_lowercase().as_str())
        });

        let own = worktree
            && (value("--worktree", "user.name")?.is_some()
                || value("--worktree", "user.email")?.is_some());

        Ok(GitSettings{
            identity:CommitIdentity{name:effective("user.name")?,email:effective("user.email")?},
            local_identity:CommitIdentity{name:value("--local","user.name")?,email:value("--local","user.email")?},
            remotes:self.remotes_uncoordinated(cancellation)?,
            identity_read_only_reason:own.then(||"This worktree has its own Git identity. Edit it in Git directly; repository defaults cannot override it.".into()),
            root:self.info.root.clone(),common:self.info.common_directory.clone(),
            fingerprint:Sha256::digest(self.run(["config","--null","--show-origin","--list"],cancellation)?.stdout).into(),
        })
    }

    /// Apply only the explicitly reviewed configuration; reject stale editors before mutation.
    /// # Errors
    /// Refuses changed/replaced repositories, changed config, invalid inputs and unsupported advanced
    /// editors. Command/refresh errors can follow partial changes: reread before retrying, never replay.
    pub fn change_git_settings(
        &self,
        expected: &GitSettings,
        change: &SettingsChange,
        cancellation: Option<&Cancellation>,
    ) -> Result<GitSettings, WriteError> {
        let _settings = SETTINGS.lock().expect("settings queue poisoned");

        self.mutate(cancellation, || {
            let current = self.git_settings_uncoordinated(cancellation).map_err(before)?;

            if current != *expected {
                return Err(before(RepositoryError::Conflict(
                    "Git settings changed since this editor was opened. Reload and review before saving.".into(),
                )));
            }

            match change {
                SettingsChange::Identity(identity) => {
                    if current.identity_read_only_reason.is_some() {
                        return Err(before(RepositoryError::InvalidInput(
                            "This worktree has its own Git identity. Edit it in Git directly.",
                        )));
                    }

                    if let Some(identity) = identity { identity.validate().map_err(before)?; }

                    let identity = identity.as_ref().map(CommitIdentity::trimmed);

                    for (step, (key, value)) in [
                        ("user.name", identity.as_ref().and_then(|i| i.name.as_deref())),
                        ("user.email", identity.as_ref().and_then(|i| i.email.as_deref())),
                    ].into_iter().enumerate() {
                        let result = if let Some(value) = value {
                            self.write_command(["config", "--local", key, value], &[], cancellation).map(|_| ())
                        } else {
                            match self.write_command(["config", "--local", "--unset-all", key], &[], cancellation) {
                                Err(WriteError { error: RepositoryError::Git(GitError::CommandFailed { status, .. }), .. }) if status.code() == Some(5) => Ok(()),
                                result => result.map(|_| ()),
                            }
                        };

                        result.map_err(|mut error| {
                            // The first key may already be saved even if a later pre-command check fails.
                            if step > 0 { error.phase = WritePhase::Command; }

                            error
                        })?;
                    }
                }
                SettingsChange::AddRemote { name, url } | SettingsChange::EditRemote { name, url } => {
                    crate::validation::require_revision(name).map_err(before)?;
                    remote_url(url).map_err(before)?;

                    if url.contains(['\r', '\n']) || url.starts_with('-') {
                        return Err(before(RepositoryError::InvalidInput("Enter a remote URL without line breaks or a leading option.")));
                    }

                    let found = current.remotes.iter().find(|remote| remote.name == *name);

                    if matches!(change, SettingsChange::AddRemote { .. }) {
                        if found.is_some() { return Err(before(RepositoryError::InvalidInput("A remote with this name already exists."))); }

                        self.write_command(["remote", "add", "--", name, url], &[], cancellation)?;
                    } else {
                        if found.is_none_or(|remote| remote.fetch_urls.len() != 1) {
                            return Err(before(RepositoryError::InvalidInput("Remotes with multiple fetch URLs must be edited in Git directly.")));
                        }

                        self.write_command(["remote", "set-url", name, url], &[], cancellation)?;
                    }
                }
                SettingsChange::RemoveRemote { name } => {
                    crate::validation::require_revision(name).map_err(before)?;

                    if !current.remotes.iter().any(|remote| remote.name == *name) {
                        return Err(before(RepositoryError::InvalidInput("The selected remote is no longer configured.")));
                    }

                    self.write_command(["remote", "remove", name], &[], cancellation)?;
                }
            }

            self.git_settings_uncoordinated(cancellation).map_err(refresh)
        })
    }
}

fn config_value(
    result: Result<crate::GitOutput, RepositoryError>,
) -> Result<Option<String>, RepositoryError> {
    match result {
        Ok(output) => Ok(Some(
            String::from_utf8(output.stdout)
                .map_err(|_| RepositoryError::InvalidOutput)?
                .trim_end()
                .to_owned(),
        )),
        Err(RepositoryError::Git(GitError::CommandFailed { status, .. }))
            if status.code() == Some(1) =>
        {
            Ok(None)
        }
        Err(error) => Err(error),
    }
}

/// Snapshot of computer-wide author keys with an opaque global-config review fingerprint.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalIdentityReview {
    /// Global author values, retaining absent keys.
    pub identity: CommitIdentity,
    fingerprint: [u8; 32],
}

/// Narrow repository-independent access to global author configuration only.
#[derive(Clone)]
pub struct GlobalGitIdentity {
    process: GitProcess,
    cwd: PathBuf,
}

impl std::fmt::Debug for GlobalGitIdentity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GlobalGitIdentity")
            .field("cwd", &self.cwd)
            .finish_non_exhaustive()
    }
}

impl GlobalGitIdentity {
    /// Use an existing directory and caller's Git runner; constructing never reads or writes config.
    #[must_use]
    pub fn new(process: GitProcess, cwd: PathBuf) -> Self {
        Self { process, cwd }
    }

    fn run(
        &self,
        args: impl IntoIterator<Item = impl Into<std::ffi::OsString>>,
        cancel: Option<&Cancellation>,
    ) -> Result<crate::GitOutput, RepositoryError> {
        let mut command = GitCommand::new(&self.cwd, args);

        command.cancellation = cancel;

        Ok(self.process.run(command)?)
    }

    fn read_uncoordinated(
        &self,
        cancel: Option<&Cancellation>,
    ) -> Result<GlobalIdentityReview, RepositoryError> {
        Ok(GlobalIdentityReview {
            identity: CommitIdentity {
                name: config_value(self.run(["config", "--global", "--get", "user.name"], cancel))?,
                email: config_value(
                    self.run(["config", "--global", "--get", "user.email"], cancel),
                )?,
            },
            fingerprint: Sha256::digest(global_config(self.run(
                [
                    "config",
                    "--global",
                    "--null",
                    "--show-origin",
                    "--get-regexp",
                    ".",
                ],
                cancel,
            ))?)
            .into(),
        })
    }

    /// Read global keys without creating files or using repository overrides.
    /// # Errors
    /// Returns filesystem, Git, cancellation or malformed UTF-8 errors.
    pub fn read(
        &self,
        cancel: Option<&Cancellation>,
    ) -> Result<GlobalIdentityReview, RepositoryError> {
        let _settings = SETTINGS.lock().expect("settings queue poisoned");

        self.read_uncoordinated(cancel)
    }

    /// Save a validated author pair only if the reviewed global config is still current.
    /// # Errors
    /// A second-key or refresh failure may follow a successful first write. Reread before retrying.
    pub fn write(
        &self,
        expected: &GlobalIdentityReview,
        identity: &CommitIdentity,
        cancel: Option<&Cancellation>,
    ) -> Result<GlobalIdentityReview, WriteError> {
        let _settings = SETTINGS.lock().expect("settings queue poisoned");

        identity.validate().map_err(before)?;

        if self.read_uncoordinated(cancel).map_err(before)? != *expected {
            return Err(before(RepositoryError::Conflict(
                "Global Git settings changed. Reload and review before saving.".into(),
            )));
        }

        let identity = identity.trimmed();

        for (key, value) in [
            ("user.name", identity.name.as_deref().unwrap_or("")),
            ("user.email", identity.email.as_deref().unwrap_or("")),
        ] {
            self.run(["config", "--global", key, value], cancel)
                .map_err(|error| WriteError {
                    phase: WritePhase::Command,
                    error,
                })?;
        }

        self.read_uncoordinated(cancel).map_err(refresh)
    }
}

fn global_config(
    result: Result<crate::GitOutput, RepositoryError>,
) -> Result<Vec<u8>, RepositoryError> {
    match result {
        Ok(output) => Ok(output.stdout),
        Err(RepositoryError::Git(GitError::CommandFailed { status, .. }))
            if status.code() == Some(1) =>
        {
            Ok(Vec::new())
        }
        Err(error) => Err(error),
    }
}
