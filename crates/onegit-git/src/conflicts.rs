//! Reviewed text conflict resolution. The common-directory guard spans preflight,
//! an optional descriptor-bound whole-file replacement, literal staging and fresh state.

use crate::GitPath;
use std::ffi::OsString;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};

use sha2::{Digest, Sha256};

use super::{
    BranchIdentity, FileData, FileSource, Repository, RepositoryError, Snapshot, WriteError,
    WritePhase, check_cancelled,
};

use crate::validation::require_paths;
use crate::{Cancellation, GitCommand, GitError, RecordType};

const MAX_TEXT_BYTES: usize = 512 * 1024;
const UNSUPPORTED: &str = "Resolve binary or oversized files using Git outside this app.";

const CHANGED: &str =
    "The file changed since the preview. Refresh and review it before marking resolved.";

/// Owned working-text preview, with an exact UTF-8-byte SHA-256 review identity.
/// Marker text is intentionally retained for the read-only conflict viewer.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConflictPreview {
    /// Exact text, including BOM, original newlines and conflict markers.
    pub text: String,
    /// Lowercase SHA-256 of the exact bytes represented by `text`.
    pub content_hash: String,
}

/// Git index stages, including Git's reversed user-facing sides during rebase.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConflictSide {
    /// Index stage 2, not necessarily the branch being replayed.
    Ours,
    /// Index stage 3.
    Theirs,
}

/// Frozen review of one conflicted working file, retained by the application writer.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolveConflict {
    /// Exact repository-relative path, never a Git pathspec pattern.
    pub path: GitPath,
    /// HEAD and branch shown with the reviewed preview; detached branch is None.
    pub expected: BranchIdentity,
    /// SHA-256 from the displayed [`ConflictPreview`].
    pub content_hash: String,
    /// None stages reviewed manual edits. Some replaces the whole file; UI must confirm this.
    pub side: Option<ConflictSide>,
}

impl Repository {
    /// Read a conflict preview through the ordinary bounded working-file reader.
    ///
    /// Returns None for invalid UTF-8, NUL-containing text or text above 512 KiB.
    /// Files above the ordinary preview reader's 10 MiB ceiling return its size error.
    /// This read never stages or continues an operation. Links may be previewed by
    /// the ordinary reader, but [`Self::resolve_conflict`] refuses symbolic-link paths.
    pub fn conflict_preview(
        &self,
        path: &GitPath,
        cancellation: Option<&Cancellation>,
    ) -> Result<Option<ConflictPreview>, RepositoryError> {
        let content = self.file_content(FileSource::Working, path, cancellation)?;

        Ok(match content.content {
            FileData::Utf8(text) if supported(&text) => Some(preview(text)),
            _ => None,
        })
    }

    /// Validate a reviewed text resolution and stage only that literal path.
    ///
    /// Never commits or continues Git. Checks current HEAD/branch, unmerged status,
    /// regular no-follow path, supported text and the exact reviewed content hash.
    /// Manual edits must have no marker lines. Side replacement also rejects binary,
    /// oversized or nested-marker index content and multiply linked working files.
    /// The optional replacement writes through the held file descriptor without
    /// following a substituted link. Ordinary Git clean filters still apply at add.
    ///
    /// The app queue does not exclude external editors/Git. Preflight is repeated
    /// immediately before mutation; it is not a cross-process filesystem transaction.
    /// A Command error can leave replacement bytes or staging in place. Refresh
    /// before retrying; no rollback, automatic retry or operation cleanup is attempted.
    pub fn resolve_conflict(
        &self,
        request: &ResolveConflict,
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
        require_paths([&request.path]).map_err(before)?;
        self.check_conflict(request, cancellation).map_err(before)?;
        let mut file = self
            .open_working_file(&request.path, request.side.is_some())
            .map_err(path_error)
            .map_err(before)?;

        self.check_conflict_file(&mut file, request, cancellation)
            .map_err(before)?;

        let chosen = request
            .side
            .map(|side| self.conflict_side(&request.path, side, cancellation))
            .transpose()
            .map_err(before)?;

        // Git object reads can take time; do not accept intervening editor/branch changes.
        self.check_conflict(request, cancellation).map_err(before)?;
        self.check_conflict_path(&file, &request.path)
            .map_err(before)?;
        self.check_conflict_file(&mut file, request, cancellation)
            .map_err(before)?;
        check_cancelled(cancellation).map_err(|error| before(error.into()))?;

        let changed = chosen.is_some();

        if let Some(chosen) = chosen {
            file.seek(SeekFrom::Start(0))
                .map_err(|error| command(error.into()))?;
            file.write_all(chosen.as_bytes())
                .map_err(|error| command(error.into()))?;
            file.set_len(chosen.len() as u64)
                .map_err(|error| command(error.into()))?;
        }

        self.check_write_identity()
            .and_then(|_| self.check_conflict_path(&file, &request.path))
            .map_err(if changed { command } else { before })?;

        let mut add = GitCommand::new(
            &self.info.root,
            [
                OsString::from("--literal-pathspecs"),
                "add".into(),
                "--".into(),
                request
                    .path
                    .to_argument()
                    .map_err(|error| before(error.into()))?,
            ],
        );

        add.directory = Some(&self.root_directory);
        add.cancellation = cancellation;
        self.process
            .run(add)
            .map_err(|error| command(error.into()))?;

        self.check_write_identity()
            .and_then(|_| self.snapshot_uncoordinated(false, cancellation))
            .map_err(|error| WriteError {
                phase: WritePhase::Refresh,
                error,
            })
    }

    fn check_conflict(
        &self,
        request: &ResolveConflict,
        cancellation: Option<&Cancellation>,
    ) -> Result<(), RepositoryError> {
        self.check_write_identity()?;
        let snapshot = self.snapshot_uncoordinated(false, cancellation)?;

        if BranchIdentity::from_snapshot(&snapshot) != request.expected {
            return Err(RepositoryError::InvalidInput(
                "The branch changed. Refresh before resolving this file.",
            ));
        }

        if !snapshot.status.files.iter().any(|file| {
            file.path == request.path
                && file.record_type == RecordType::Unmerged
                && !file.submodule.starts_with('S')
        }) {
            return Err(RepositoryError::InvalidInput(
                "This is no longer a supported conflicted file. Refresh first.",
            ));
        }

        Ok(())
    }

    fn check_conflict_file(
        &self,
        file: &mut File,
        request: &ResolveConflict,
        cancellation: Option<&Cancellation>,
    ) -> Result<(), RepositoryError> {
        let state = crate::platform::file_state(file)?;

        if !state.regular || (request.side.is_some() && state.links != 1) {
            return Err(RepositoryError::InvalidInput(
                "Resolve linked and non-regular files using Git outside this app.",
            ));
        }

        if state.length > MAX_TEXT_BYTES as u64 {
            return Err(RepositoryError::InvalidInput(UNSUPPORTED));
        }

        file.seek(SeekFrom::Start(0))?;
        let mut bytes = Vec::new();
        let mut buffer = [0; 8192];

        loop {
            check_cancelled(cancellation)?;
            let count = file.read(&mut buffer)?;

            if count == 0 {
                break;
            }

            if bytes.len() + count > MAX_TEXT_BYTES {
                return Err(RepositoryError::InvalidInput(UNSUPPORTED));
            }

            bytes.extend_from_slice(&buffer[..count]);
        }

        let text =
            std::str::from_utf8(&bytes).map_err(|_| RepositoryError::InvalidInput(UNSUPPORTED))?;

        if !supported(text) {
            return Err(RepositoryError::InvalidInput(UNSUPPORTED));
        }

        if format!("{:x}", Sha256::digest(&bytes)) != request.content_hash {
            return Err(RepositoryError::InvalidInput(CHANGED));
        }

        if request.side.is_none() && has_markers(text) {
            return Err(RepositoryError::InvalidInput(
                "Conflict markers remain. Edit and save the file, then refresh before marking resolved.",
            ));
        }

        Ok(())
    }

    fn check_conflict_path(&self, held: &File, path: &GitPath) -> Result<(), RepositoryError> {
        let current = self.open_working_file(path, false).map_err(path_error)?;

        if !current.metadata()?.is_file()
            || crate::platform::FileIdentity::from_file(&current)?
                != crate::platform::FileIdentity::from_file(held)?
        {
            return Err(RepositoryError::InvalidInput(CHANGED));
        }

        Ok(())
    }

    fn conflict_side(
        &self,
        path: &GitPath,
        side: ConflictSide,
        cancellation: Option<&Cancellation>,
    ) -> Result<String, RepositoryError> {
        let mut object = OsString::from(if side == ConflictSide::Ours {
            ":2:"
        } else {
            ":3:"
        });

        object.push(path.to_argument()?);
        let mut command = GitCommand::new(
            &self.info.root,
            [OsString::from("cat-file"), "blob".into(), object],
        );

        command.directory = Some(&self.root_directory);
        command.cancellation = cancellation;
        command.max_output_bytes = Some(MAX_TEXT_BYTES);
        let output = self.process.run(command).map_err(|error| match error {
            GitError::OutputTooLarge { .. } => RepositoryError::InvalidInput(
                "Resolve binary, oversized, or nested conflicts outside this app.",
            ),
            error => error.into(),
        })?;

        let chosen = String::from_utf8(output.stdout)
            .map_err(|_| RepositoryError::InvalidInput(UNSUPPORTED))?;

        if !supported(&chosen) || has_markers(&chosen) {
            return Err(RepositoryError::InvalidInput(
                "Resolve binary, oversized, or nested conflicts outside this app.",
            ));
        }

        Ok(chosen)
    }
}

fn supported(text: &str) -> bool {
    text.len() <= MAX_TEXT_BYTES && !text.contains('\0')
}

fn path_error(error: RepositoryError) -> RepositoryError {
    match error {
        RepositoryError::Io(error) if crate::platform::is_missing_or_not_regular(&error) => {
            RepositoryError::InvalidInput(
                "Resolve symbolic links, deleted and non-regular files using Git outside this app.",
            )
        }
        error => error,
    }
}

fn preview(text: String) -> ConflictPreview {
    ConflictPreview {
        content_hash: format!("{:x}", Sha256::digest(text.as_bytes())),
        text,
    }
}

fn has_markers(text: &str) -> bool {
    // JavaScript /m recognizes CR, LF, U+2028 and U+2029 as line boundaries.
    text.split(['\n', '\r', '\u{2028}', '\u{2029}'])
        .any(|line| {
            let bytes = line.as_bytes();

            let Some(marker @ (b'<' | b'>' | b'=' | b'|')) = bytes.first() else {
                return false;
            };

            let length = bytes.iter().take_while(|byte| *byte == marker).count();

            length >= 3 && (length == bytes.len() || matches!(bytes[length], b' ' | b'\t'))
        })
}

#[cfg(test)]
mod tests {
    #[test]
    fn marker_lines_match_the_frozen_actual_typescript_expression() {
        let reference: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/conflict-resolution.json")).unwrap();

        for case in reference["cases"].as_array().unwrap() {
            let text = case["text"].as_str().unwrap();

            assert_eq!(
                super::has_markers(text),
                case["markers"].as_bool().unwrap(),
                "{text:?}"
            );
        }
    }
}
