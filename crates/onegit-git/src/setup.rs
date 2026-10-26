//! Explicit Git initialization and clone operations. Failures never delete destination files.

use std::ffi::OsString;
use std::fs;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;

use url::Url;

use super::{Repository, RepositoryError};
use crate::validation::require_revision;
use crate::{Cancellation, GitCommand, GitProcess};

const MAX_DEPTH: u64 = 9_007_199_254_740_991;

/// Clone through Git's configured transport/credential helpers, without embedding HTTP credentials.
/// One-shot account authentication is a separate execution capability, still being ported.
pub struct CloneOptions<'a> {
    /// Credential-free remote URL or Git-supported local/SSH source.
    pub remote: &'a str,
    /// Destination passed literally to Git; its existing files are never removed.
    pub destination: &'a Path,
    /// Optional selected branch/tag.
    pub branch: Option<&'a str>,
    /// Optional depth from 1 through the legacy safe-integer limit.
    pub depth: Option<u64>,
    /// Whether explicitly requested submodules should be cloned too.
    pub recurse_submodules: bool,
}

impl<'a> CloneOptions<'a> {
    /// Construct a complete-history clone without selecting a branch or submodules.
    pub fn new(remote: &'a str, destination: &'a Path) -> Self {
        Self {
            remote,
            destination,
            branch: None,
            depth: None,
            recurse_submodules: false,
        }
    }
}

impl Repository {
    /// Initialize and open a non-bare repository, preserving existing files and Git configuration.
    /// This is the explicit CLI-level operation; the app's setup flow additionally owns its
    /// already-repository/nested-directory/symlink destination policy.
    pub fn initialize(
        destination: &Path,
        initial_branch: Option<&str>,
        process: GitProcess,
        cancellation: Option<&Cancellation>,
    ) -> Result<Self, RepositoryError> {
        require_destination(destination)?;
        super::check_cancelled(cancellation)?;

        let mut args = vec![OsString::from("init")];

        if let Some(branch) = initial_branch.filter(|branch| !branch.is_empty()) {
            require_revision(branch)?;
            args.push(format!("--initial-branch={branch}").into());
        }

        let destination = std::path::absolute(destination)?;
        let parent = destination.parent().ok_or(RepositoryError::InvalidPath)?;

        fs::create_dir_all(parent)?;
        args.extend(["--".into(), destination.as_os_str().to_owned()]);

        let mut command = GitCommand::new(parent, args);

        command.cancellation = cancellation;

        process.run(command)?;

        Self::open(&destination, process, cancellation)
    }

    /// Clone and open through Git, preserving partial destination state on errors/cancellation.
    /// HTTP userinfo is rejected before creating directories; ordinary credential helpers,
    /// TLS, filters and transport configuration remain Git-owned in this execution mode.
    pub fn clone(
        options: CloneOptions<'_>,
        process: GitProcess,
        cancellation: Option<&Cancellation>,
    ) -> Result<Self, RepositoryError> {
        require_destination(options.destination)?;
        require_remote(options.remote)?;
        super::check_cancelled(cancellation)?;

        let mut args = vec![OsString::from("clone")];

        if let Some(branch) = options.branch.filter(|branch| !branch.is_empty()) {
            require_revision(branch)?;
            args.extend(["--branch".into(), branch.into()]);
        }

        if let Some(depth) = options.depth {
            if !(1..=MAX_DEPTH).contains(&depth) {
                return Err(RepositoryError::InvalidInput("Clone depth is out of range"));
            }

            args.push(format!("--depth={depth}").into());
        }

        if options.recurse_submodules {
            args.push("--recurse-submodules".into());
        }

        let destination = std::path::absolute(options.destination)?;
        let parent = destination.parent().ok_or(RepositoryError::InvalidPath)?;

        fs::create_dir_all(parent)?;
        args.extend([
            "--".into(),
            options.remote.into(),
            destination.as_os_str().to_owned(),
        ]);

        let mut command = GitCommand::new(parent, args);

        command.cancellation = cancellation;

        process.run(command)?;

        Self::open(&destination, process, cancellation)
    }
}

fn require_destination(path: &Path) -> Result<(), RepositoryError> {
    if path.as_os_str().is_empty() || path.as_os_str().as_bytes().contains(&0) {
        return Err(RepositoryError::InvalidPath);
    }

    Ok(())
}

fn require_remote(remote: &str) -> Result<(), RepositoryError> {
    if remote.is_empty() || remote.contains('\0') {
        return Err(RepositoryError::InvalidInput(
            "Remote must be non-empty and contain no NUL",
        ));
    }

    let lower = remote.to_ascii_lowercase();

    if lower.starts_with("http://") || lower.starts_with("https://") {
        let parsed = Url::parse(remote)
            .map_err(|_| RepositoryError::InvalidInput("Remote URL must be a valid HTTP URL"))?;

        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err(RepositoryError::InvalidInput(
                "Remote URL must not contain credentials; configure a Git credential helper instead",
            ));
        }
    }

    Ok(())
}
