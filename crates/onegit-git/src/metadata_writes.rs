//! Ordinary Git metadata writes and explicitly authorized index/worktree operations.

use super::{
    BranchMutation, ConfigScope, ConfigValue, Remote, Repository, RepositoryError, Snapshot, Stash,
    Tag, WriteError, WritePhase, check_cancelled,
};

use crate::validation::{require_paths, require_revision};
use crate::{Cancellation, GitCommand, GitError, GitOutput, GitPath};
use std::ffi::OsString;

/// One named remote addition, optionally fetching its refs immediately.
#[derive(Clone, Copy, Debug)]
pub struct AddRemote<'a> {
    /// Validated remote name, never an option.
    pub name: &'a str,
    /// Credential-free transport URL or local repository path.
    pub url: &'a str,
    /// Fetch refs as part of Git's remote-add command.
    pub fetch: bool,
}

/// One remote fetch/push URL edit.
#[derive(Clone, Copy, Debug)]
pub struct SetRemoteUrl<'a> {
    /// Existing remote name.
    pub name: &'a str,
    /// Credential-free destination.
    pub url: &'a str,
    /// Edit push URLs instead of fetch URLs.
    pub push: bool,
    /// Append instead of replacing the first URL.
    pub add: bool,
}

/// Lightweight or annotated local tag creation, retaining configured signing.
#[derive(Clone, Copy, Debug)]
pub struct CreateTag<'a> {
    /// New tag name without the refs/tags prefix.
    pub name: &'a str,
    /// Optional target revision; None selects HEAD.
    pub revision: Option<&'a str>,
    /// An explicit message creates an annotated tag.
    pub message: Option<&'a str>,
    /// Explicit permission to replace an existing local tag.
    pub force: bool,
}

/// Literal path restore; working file replacement requires explicit consent.
#[derive(Clone, Copy, Debug, Default)]
pub struct RestoreOptions<'a> {
    /// Exact selected repository-relative names.
    pub paths: &'a [GitPath],
    /// Optional source tree, otherwise Git's ordinary index/HEAD default.
    pub source: Option<&'a str>,
    /// Restore the index too.
    pub staged: bool,
    /// None restores working files unless staged-only was selected.
    pub worktree: Option<bool>,
    /// Explicit consent for replacing working contents.
    pub allow_destructive: bool,
}

/// Git reset destination and affected state.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum ResetMode {
    /// Move HEAD only.
    Soft,
    /// Move HEAD and replace staging.
    #[default]
    Mixed,
    /// Replace HEAD, staging and working files after explicit consent.
    Hard,
}

/// Ordinary reset, separate from reviewed unpublished-history reset.
#[derive(Clone, Copy, Debug, Default)]
pub struct ResetOptions<'a> {
    /// State Git is permitted to replace.
    pub mode: ResetMode,
    /// Optional revision; None selects HEAD.
    pub target: Option<&'a str>,
    /// Required for a hard reset.
    pub allow_destructive: bool,
}

/// Stash creation with Git's ordinary staged/untracked and selected-path behavior.
#[derive(Clone, Copy, Debug, Default)]
pub struct StashOptions<'a> {
    /// Include untracked files.
    pub include_untracked: bool,
    /// Leave staged changes in place.
    pub keep_index: bool,
    /// Save staged changes only.
    pub staged: bool,
    /// Optional nonempty stash message.
    pub message: Option<&'a str>,
    /// Optional nonempty literal selection; None saves all eligible paths.
    pub paths: Option<&'a [GitPath]>,
}

/// One explicit stash selection, optionally reinstating the saved index state.
#[derive(Clone, Copy, Debug)]
pub struct StashReference<'a> {
    /// Validated stash reflog reference or object name.
    pub reference: &'a str,
    /// Restore saved staging as well as working changes.
    pub reinstate_index: bool,
}

pub(super) fn before(error: impl Into<RepositoryError>) -> WriteError {
    WriteError {
        phase: WritePhase::BeforeCommand,
        error: error.into(),
    }
}

pub(super) fn refresh(error: impl Into<RepositoryError>) -> WriteError {
    WriteError {
        phase: WritePhase::Refresh,
        error: error.into(),
    }
}

pub(super) fn text(value: &str) -> Result<(), RepositoryError> {
    if value.is_empty() || value.contains('\0') {
        return Err(RepositoryError::InvalidInput(
            "Text must be nonempty and contain no NUL.",
        ));
    }

    Ok(())
}

pub(super) fn remote_url(value: &str) -> Result<(), RepositoryError> {
    text(value)?;

    if value
        .get(..7)
        .is_some_and(|p| p.eq_ignore_ascii_case("http://"))
        || value
            .get(..8)
            .is_some_and(|p| p.eq_ignore_ascii_case("https://"))
    {
        let parsed = url::Url::parse(value)
            .map_err(|_| RepositoryError::InvalidInput("Remote URL must be a valid HTTP URL."))?;

        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err(RepositoryError::InvalidInput(
                "Remote URL must not contain credentials. Configure a Git credential helper instead.",
            ));
        }
    }

    Ok(())
}

impl Repository {
    pub(super) fn mutate<T>(
        &self,
        cancellation: Option<&Cancellation>,
        action: impl FnOnce() -> Result<T, WriteError>,
    ) -> Result<T, WriteError> {
        let _write = self.mutations.enter();

        check_cancelled(cancellation).map_err(before)?;
        self.check_write_identity().map_err(before)?;

        action()
    }

    pub(super) fn write_command(
        &self,
        args: impl IntoIterator<Item = impl Into<OsString>>,
        input: &[u8],
        cancellation: Option<&Cancellation>,
    ) -> Result<GitOutput, WriteError> {
        check_cancelled(cancellation).map_err(before)?;
        self.check_write_identity().map_err(before)?;
        let mut command = GitCommand::new(&self.info.root, args);

        command.directory = Some(&self.root_directory);
        command.stdin = input;
        command.cancellation = cancellation;

        self.process.run(command).map_err(|error| WriteError {
            phase: WritePhase::Command,
            error: error.into(),
        })
    }

    pub(super) fn written_snapshot(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.check_write_identity()
            .and_then(|()| self.snapshot_uncoordinated(false, cancellation))
            .map_err(refresh)
    }

    /// Add a credential-free remote and optionally fetch it; writes stay serialized.
    pub fn add_remote(
        &self,
        options: AddRemote<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Remote>, WriteError> {
        self.mutate(cancellation, || {
            require_revision(options.name).map_err(before)?;
            remote_url(options.url).map_err(before)?;
            let mut args = vec!["remote", "add"];

            if options.fetch {
                args.push("-f");
            }

            args.extend(["--", options.name, options.url]);
            self.write_command(args, &[], cancellation)?;

            self.remotes_uncoordinated(cancellation).map_err(refresh)
        })
    }

    /// Rename one remote and its associated tracking configuration.
    pub fn rename_remote(
        &self,
        current: &str,
        name: &str,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Remote>, WriteError> {
        self.mutate(cancellation, || {
            require_revision(current).map_err(before)?;
            require_revision(name).map_err(before)?;
            self.write_command(["remote", "rename", current, name], &[], cancellation)?;

            self.remotes_uncoordinated(cancellation).map_err(refresh)
        })
    }

    /// Replace or append one remote URL without writing embedded HTTP credentials.
    pub fn set_remote_url(
        &self,
        options: SetRemoteUrl<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Remote>, WriteError> {
        self.mutate(cancellation, || {
            require_revision(options.name).map_err(before)?;
            remote_url(options.url).map_err(before)?;
            let mut args = vec!["remote", "set-url"];

            if options.push {
                args.push("--push");
            }

            if options.add {
                args.push("--add");
            }

            args.extend([options.name, options.url]);
            self.write_command(args, &[], cancellation)?;

            self.remotes_uncoordinated(cancellation).map_err(refresh)
        })
    }

    /// Remove a remote and its tracking configuration, preserving local branch tips.
    pub fn remove_remote(
        &self,
        name: &str,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Remote>, WriteError> {
        self.mutate(cancellation, || {
            require_revision(name).map_err(before)?;
            self.write_command(["remote", "remove", name], &[], cancellation)?;

            self.remotes_uncoordinated(cancellation).map_err(refresh)
        })
    }

    /// Create a local tag after checking its full ref syntax, preserving hooks/signing.
    pub fn create_tag(
        &self,
        options: CreateTag<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Tag>, WriteError> {
        self.mutate(cancellation, || {
            require_revision(options.name).map_err(before)?;
            self.run(
                ["check-ref-format", &format!("refs/tags/{}", options.name)],
                cancellation,
            )
            .map_err(before)?;
            let mut args: Vec<OsString> = vec!["tag".into()];

            if options.force {
                args.push("--force".into());
            }

            if let Some(message) = options.message {
                text(message).map_err(before)?;
                args.extend(["-a".into(), "-m".into(), message.into()]);
            }

            args.push(options.name.into());

            if let Some(revision) = options.revision.filter(|s| !s.is_empty()) {
                require_revision(revision).map_err(before)?;
                args.push(revision.into());
            }

            self.write_command(args, &[], cancellation)?;

            self.tags_uncoordinated(cancellation).map_err(refresh)
        })
    }

    /// Delete one validated local tag, never a remote tag.
    pub fn delete_tag(
        &self,
        name: &str,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Tag>, WriteError> {
        self.mutate(cancellation, || {
            require_revision(name).map_err(before)?;
            self.run(
                ["check-ref-format", &format!("refs/tags/{name}")],
                cancellation,
            )
            .map_err(before)?;
            self.write_command(["tag", "--delete", "--", name], &[], cancellation)?;

            self.tags_uncoordinated(cancellation).map_err(refresh)
        })
    }

    /// Set tracking for the current or explicitly selected local branch.
    pub fn set_upstream(
        &self,
        upstream: &str,
        branch: Option<&str>,
        cancellation: Option<&Cancellation>,
    ) -> Result<BranchMutation, WriteError> {
        self.mutate(cancellation, || {
            require_revision(upstream).map_err(before)?;
            let mut args = vec!["branch".to_owned(), format!("--set-upstream-to={upstream}")];

            if let Some(branch) = branch.filter(|s| !s.is_empty()) {
                require_revision(branch).map_err(before)?;
                self.run(["check-ref-format", "--branch", branch], cancellation)
                    .map_err(before)?;
                args.push(branch.into());
            }

            self.write_command(args, &[], cancellation)?;

            Ok(BranchMutation {
                saved_changes: None,
                snapshot: self.written_snapshot(cancellation)?,
                branches: self.branches_uncoordinated(cancellation).map_err(refresh)?,
            })
        })
    }

    /// Write local/worktree configuration; effective/global scope is never writable.
    pub fn set_config(
        &self,
        key: &str,
        value: &str,
        scope: ConfigScope,
        cancellation: Option<&Cancellation>,
    ) -> Result<ConfigValue, WriteError> {
        self.mutate(cancellation, || {
            let flag = config_scope(key, scope).map_err(before)?;

            text(value).map_err(before)?;
            self.write_command(["config", flag, key, value], &[], cancellation)?;

            Ok(ConfigValue {
                key: key.into(),
                scope,
                value: Some(value.into()),
            })
        })
    }

    /// Remove all matching scoped configuration values; absence is successful.
    pub fn unset_config(
        &self,
        key: &str,
        scope: ConfigScope,
        cancellation: Option<&Cancellation>,
    ) -> Result<ConfigValue, WriteError> {
        self.mutate(cancellation, || {
            let flag = config_scope(key, scope).map_err(before)?;

            match self.write_command(["config", flag, "--unset-all", key], &[], cancellation) {
                Err(WriteError {
                    error: RepositoryError::Git(GitError::CommandFailed { status, .. }),
                    ..
                }) if status.code() == Some(5) => {}
                result => {
                    result?;
                }
            }

            Ok(ConfigValue {
                key: key.into(),
                scope,
                value: None,
            })
        })
    }

    /// Restore selected index/worktree paths after explicit working-file consent.
    pub fn restore(
        &self,
        options: RestoreOptions<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.mutate(cancellation, || {
            require_paths(options.paths).map_err(before)?;
            let worktree = options.worktree.unwrap_or(!options.staged);

            if worktree && !options.allow_destructive {
                return Err(before(RepositoryError::InvalidInput(
                    "Restoring worktree content requires allowDestructive: true.",
                )));
            }

            let mut args: Vec<OsString> = vec!["--literal-pathspecs".into(), "restore".into()];

            if let Some(source) = options.source.filter(|s| !s.is_empty()) {
                require_revision(source).map_err(before)?;
                args.push(format!("--source={source}").into());
            }

            if options.staged {
                args.push("--staged".into());
            }

            if worktree {
                args.push("--worktree".into());
            }

            args.extend([
                "--pathspec-from-file=-".into(),
                "--pathspec-file-nul".into(),
            ]);
            let paths = crate::git_path::pathspec_list(options.paths).map_err(before)?;

            self.write_command(args, &paths, cancellation)?;

            self.written_snapshot(cancellation)
        })
    }

    /// Ordinary soft/mixed/hard reset; hard resets require explicit destructive consent.
    pub fn reset(
        &self,
        options: ResetOptions<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.mutate(cancellation, || {
            if options.mode == ResetMode::Hard && !options.allow_destructive {
                return Err(before(RepositoryError::InvalidInput(
                    "Hard reset requires allowDestructive: true.",
                )));
            }

            let target = options.target.unwrap_or("HEAD");

            require_revision(target).map_err(before)?;
            let mode = match options.mode {
                ResetMode::Soft => "--soft",
                ResetMode::Mixed => "--mixed",
                ResetMode::Hard => "--hard",
            };

            self.write_command(["reset", mode, target], &[], cancellation)?;

            self.written_snapshot(cancellation)
        })
    }

    /// Save eligible working changes, optionally limited to exact literal paths.
    pub fn stash(
        &self,
        options: StashOptions<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.mutate(cancellation, || {
            let mut args: Vec<OsString> = vec!["stash".into(), "push".into()];

            if options.include_untracked {
                args.push("--include-untracked".into());
            }

            if options.keep_index {
                args.push("--keep-index".into());
            }

            if options.staged {
                args.push("--staged".into());
            }

            if let Some(message) = options.message.filter(|s| !s.is_empty()) {
                text(message).map_err(before)?;
                args.extend(["-m".into(), message.into()]);
            }

            let input = if let Some(paths) = options.paths {
                require_paths(paths).map_err(before)?;
                args.extend([
                    "--pathspec-from-file=-".into(),
                    "--pathspec-file-nul".into(),
                ]);
                // Global literal mode also reaches stash's internal root-magic cleanup.
                // Scope literal semantics to each selected name instead.
                let mut input = Vec::new();

                for path in paths {
                    input.extend_from_slice(b":(literal)");
                    input.extend_from_slice(path.pathspec_bytes().map_err(before)?);
                    input.push(0);
                }

                input
            } else {
                Vec::new()
            };

            self.write_command(args, &input, cancellation)?;

            self.written_snapshot(cancellation)
        })
    }

    /// Apply a stash, leaving it available even when the application fails.
    pub fn apply_stash(
        &self,
        options: StashReference<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.stash_action(
            "apply",
            options.reference,
            options.reinstate_index,
            cancellation,
        )
    }

    /// Apply and remove a stash; Git retains a conflicted entry for review.
    pub fn pop_stash(
        &self,
        options: StashReference<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.stash_action(
            "pop",
            options.reference,
            options.reinstate_index,
            cancellation,
        )
    }

    fn stash_action(
        &self,
        action: &str,
        reference: &str,
        reinstate_index: bool,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.mutate(cancellation, || {
            require_revision(reference).map_err(before)?;
            let mut args = vec!["stash", action];

            if reinstate_index {
                args.push("--index");
            }

            args.push(reference);
            self.write_command(args, &[], cancellation)?;

            self.written_snapshot(cancellation)
        })
    }

    /// Delete one explicitly selected stash reflog entry and return the remaining entries.
    pub fn drop_stash(
        &self,
        reference: &str,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Stash>, WriteError> {
        self.mutate(cancellation, || {
            require_revision(reference).map_err(before)?;
            self.write_command(["stash", "drop", reference], &[], cancellation)?;

            self.stashes_uncoordinated(cancellation).map_err(refresh)
        })
    }
}

fn config_scope(key: &str, scope: ConfigScope) -> Result<&'static str, RepositoryError> {
    if !super::refs::CONFIG_KEY.is_match(key) {
        return Err(RepositoryError::InvalidInput(
            "Invalid Git configuration key",
        ));
    }

    match scope {
        ConfigScope::Local => Ok("--local"),
        ConfigScope::Worktree => Ok("--worktree"),
        ConfigScope::Effective => Err(RepositoryError::InvalidInput(
            "Configuration write scope is not supported.",
        )),
    }
}
