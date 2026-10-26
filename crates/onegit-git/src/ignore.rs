//! Literal, reviewed append-only .gitignore edits. The session's common-directory
//! guard owns preflight, descriptor-bound append, durable sync and result refresh.

use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use super::{
    BranchIdentity, OperationState, Repository, RepositoryError, Snapshot, WriteError, WritePhase,
    check_cancelled,
};

use crate::validation::require_paths;
use crate::{Cancellation, RecordType};

const MAX_IGNORE_BYTES: u64 = 1024 * 1024;

const UNSUPPORTED: &str =
    ".gitignore must be an ordinary file smaller than 1 MiB, without hard links.";

const CHANGED: &str = ".gitignore changed. Refresh and review it before adding a rule.";

/// Rule scope selected from a changed file. Folder paths must be its literal ancestors.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum IgnoreRule {
    /// Root-anchored literal file name.
    File,
    /// Root-anchored literal parent folder, with a trailing slash.
    Folder(String),
    /// The last extension, at every depth.
    Extension,
}

/// Frozen changed-file selection and branch identity for an explicitly confirmed rule.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IgnoreFile {
    /// Exact repository-relative spelling; no line breaks or .git components.
    pub path: PathBuf,
    /// Scope displayed in the confirmation.
    pub rule: IgnoreRule,
    /// HEAD/branch displayed when the action was reviewed; None OID permits unborn HEAD.
    pub expected: BranchIdentity,
}

/// Last extension including its dot, excluding a leading-only or trailing dot.
/// Uses literal POSIX spelling, matching the existing menu's treatment of dotfiles.
pub fn ignore_extension(path: &str) -> Option<&str> {
    let name = path.rsplit('/').next()?;
    let dot = name.rfind('.')?;

    (dot > 0 && dot < name.len() - 1).then(|| &name[dot..])
}

/// Literal parent folders, from nearest parent toward the root.
/// Menu suggestions do not validate a path; [`ignore_pattern`] validates before use.
pub fn ignore_folders(path: &str) -> Vec<&str> {
    path.match_indices('/')
        .rev()
        .map(|(end, _)| &path[..end])
        .collect()
}

/// Construct a literal Git ignore pattern, escaping glob, space, comment and negation characters.
///
/// Rejects empty/absolute/non-UTF-8 paths, NUL/CR/LF, empty/dot/parent/.git components,
/// unrelated folder scopes and extension requests without an extension. No filesystem I/O.
pub fn ignore_pattern(path: &Path, rule: &IgnoreRule) -> Result<String, RepositoryError> {
    require_paths([path])?;
    let encoded = crate::platform::path_to_git_bytes(path.as_os_str())
        .map_err(|_| RepositoryError::InvalidPath)?;
    let path = std::str::from_utf8(&encoded).map_err(|_| {
        RepositoryError::InvalidInput("Ignore rules require a UTF-8 repository path.")
    })?;

    if path.contains(['\r', '\n'])
        || path
            .split('/')
            .any(|part| matches!(part, "" | "." | ".." | ".git"))
    {
        return Err(RepositoryError::InvalidInput(
            "Choose an ordinary repository-relative path without line breaks.",
        ));
    }

    match rule {
        IgnoreRule::File => Ok(format!("/{}", escape(path))),
        IgnoreRule::Folder(folder) => {
            if !ignore_folders(path).contains(&folder.as_str()) {
                return Err(RepositoryError::InvalidInput(
                    "Choose a parent folder of the selected file.",
                ));
            }

            Ok(format!("/{}/", escape(folder)))
        }
        IgnoreRule::Extension => {
            let extension = ignore_extension(path).ok_or(RepositoryError::InvalidInput(
                "This file has no extension to ignore.",
            ))?;

            Ok(format!("*{}", escape(extension)))
        }
    }
}

impl Repository {
    /// Append an explicitly confirmed rule for a currently changed, non-conflicted file.
    ///
    /// Requires normal operation state and exact reviewed HEAD/branch. Preserves existing
    /// bytes, mode and CRLF preference; suppresses only an identical last nonempty rule.
    /// Does not stage, untrack, remove or rewrite working files. Tracked files stay tracked.
    /// Refuses symlinked/non-regular/multiply-linked .gitignore and files above 1 MiB
    /// before appending; an exactly 1 MiB file is accepted, matching the source boundary.
    /// Appends may take the file past that boundary, causing a later edit to be refused.
    ///
    /// Work runs under the session/common-directory queue and belongs on an owned worker.
    /// Creation uses an exclusive no-follow open relative to the held repository directory.
    /// Existing-file append uses O_APPEND and a held descriptor, never truncation. Sync
    /// completes before refresh. Command/Refresh errors may leave a created/appended file;
    /// callers must inspect fresh state and must not automatically replay or roll back.
    /// External writers are not locked out: repeated preflight and inode/metadata checks
    /// detect observed substitutions, but do not provide a cross-process transaction.
    pub fn ignore_file(
        &self,
        request: &IgnoreFile,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        let _write = self.mutations.enter();

        let before = |error| WriteError {
            phase: WritePhase::BeforeCommand,
            error,
        };

        let command = |error| WriteError {
            phase: WritePhase::Command,
            error,
        };

        check_cancelled(cancellation).map_err(|error| before(error.into()))?;
        let pattern = ignore_pattern(&request.path, &request.rule).map_err(before)?;

        self.check_write_identity().map_err(before)?;

        let mut existing = match self.open_ignore(false) {
            Ok(file) => Some(file),
            Err(RepositoryError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(before(error)),
        };

        let state = existing
            .as_ref()
            .map(crate::platform::file_state)
            .transpose()
            .map_err(|error| before(error.into()))?;
        if let Some(state) = state.as_ref() {
            validate_file(state).map_err(before)?;
        }

        // Git status reads .gitignore too; reject a FIFO/device before asking Git to read it.
        self.check_ignore_selection(request, cancellation)
            .map_err(before)?;

        let content = match existing.as_mut() {
            Some(file) => read_content(file, cancellation).map_err(before)?,
            None => Vec::new(),
        };

        let addition = addition(&content, &pattern);

        self.check_ignore_selection(request, cancellation)
            .map_err(before)?;

        if let Some(file) = existing.as_ref() {
            self.check_ignore_path(file).map_err(before)?;

            if state.as_ref()
                != Some(&crate::platform::file_state(file).map_err(|error| before(error.into()))?)
            {
                return Err(before(RepositoryError::InvalidInput(CHANGED)));
            }
        }

        check_cancelled(cancellation).map_err(|error| before(error.into()))?;

        if addition.is_empty() {
            let snapshot = self
                .snapshot_uncoordinated(false, cancellation)
                .map_err(before)?;

            self.check_ignore_path(
                existing
                    .as_ref()
                    .expect("duplicate requires existing content"),
            )
            .map_err(before)?;

            return Ok(snapshot);
        }

        let created = existing.is_none();

        let mut file = match existing {
            Some(file) => file,
            None => self.open_ignore(true).map_err(before)?,
        };

        file.write_all(&addition)
            .and_then(|_| file.sync_all())
            .map_err(|error| command(error.into()))?;

        if created {
            self.root_directory
                .sync_all()
                .map_err(|error| command(error.into()))?;
        }

        self.check_ignore_path(&file)
            .and_then(|_| self.snapshot_uncoordinated(false, cancellation))
            .and_then(|snapshot| {
                self.check_ignore_path(&file)?;

                Ok(snapshot)
            })
            .map_err(|error| WriteError {
                phase: WritePhase::Refresh,
                error,
            })
    }

    fn check_ignore_selection(
        &self,
        request: &IgnoreFile,
        cancellation: Option<&Cancellation>,
    ) -> Result<(), RepositoryError> {
        self.check_write_identity()?;
        let snapshot = self.snapshot_uncoordinated(false, cancellation)?;

        self.check_write_identity()?;

        if snapshot.operation != OperationState::Normal
            || BranchIdentity::from_snapshot(&snapshot) != request.expected
            || !snapshot
                .status
                .files
                .iter()
                .any(|file| file.path == request.path && file.record_type != RecordType::Unmerged)
        {
            return Err(RepositoryError::InvalidInput(
                "Refresh first. The selected file or branch changed, or a Git operation is in progress.",
            ));
        }

        Ok(())
    }

    fn open_ignore(&self, create: bool) -> Result<File, RepositoryError> {
        Ok(crate::platform::open_component(
            &self.root_directory,
            ".gitignore".as_ref(),
            crate::platform::Access::Append { create },
        )?)
    }

    fn check_ignore_path(&self, held: &File) -> Result<(), RepositoryError> {
        self.check_write_identity()?;
        let current = self.open_ignore(false)?;

        let state = crate::platform::file_state(&current)?;

        if !state.regular || state.links != 1 {
            return Err(RepositoryError::InvalidInput(UNSUPPORTED));
        }

        if crate::platform::FileIdentity::from_file(&current)?
            != crate::platform::FileIdentity::from_file(held)?
        {
            return Err(RepositoryError::InvalidInput(CHANGED));
        }

        Ok(())
    }
}

fn validate_file(state: &crate::platform::FileState) -> Result<(), RepositoryError> {
    if !state.regular || state.links != 1 || state.length > MAX_IGNORE_BYTES {
        return Err(RepositoryError::InvalidInput(UNSUPPORTED));
    }

    Ok(())
}

fn read_content(
    file: &mut File,
    cancellation: Option<&Cancellation>,
) -> Result<Vec<u8>, RepositoryError> {
    let mut content = Vec::new();
    let mut buffer = [0; 8192];

    loop {
        check_cancelled(cancellation)?;
        let count = file.read(&mut buffer)?;

        if count == 0 {
            break;
        }

        if content.len() + count > MAX_IGNORE_BYTES as usize {
            return Err(RepositoryError::InvalidInput(UNSUPPORTED));
        }

        content.extend_from_slice(&buffer[..count]);
    }

    Ok(content)
}

fn addition(content: &[u8], pattern: &str) -> Vec<u8> {
    let text = String::from_utf8_lossy(content);

    let last = text
        .split_inclusive('\n')
        .map(|line| {
            line.strip_suffix('\n')
                .map_or(line, |line| line.strip_suffix('\r').unwrap_or(line))
        })
        .rfind(|line| !line.is_empty());

    if last == Some(pattern) {
        return Vec::new();
    }

    let newline = if content.windows(2).any(|bytes| bytes == b"\r\n") {
        "\r\n"
    } else {
        "\n"
    };

    let separator = if !content.is_empty() && !content.ends_with(b"\n") {
        newline
    } else {
        ""
    };

    format!("{separator}{pattern}{newline}").into_bytes()
}

fn escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());

    for character in value.chars() {
        if matches!(character, '\\' | '*' | '?' | '[' | ']' | ' ' | '#' | '!') {
            escaped.push('\\');
        }

        escaped.push(character);
    }

    escaped
}
