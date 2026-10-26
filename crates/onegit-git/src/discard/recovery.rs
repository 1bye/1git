//! Private recovery files, streamed capture and literal no-follow filesystem checks.

use crate::GitPath;
use std::collections::HashSet;
use std::ffi::{CStr, OsString};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, SecondsFormat, Utc};
use sha2::{Digest, Sha256};

use super::{DiscardError, DiscardRecovery, RecoveryBackup, failure};
use crate::repository::{Repository, RepositoryError, Snapshot, WritePhase, check_cancelled};
use crate::validation::{full_oid, require_paths};
use crate::{Cancellation, FileChange, GitCommand, RecordType};

const INSTRUCTIONS: &str = "Recovery patches preserve staged and unstaged changes separately. Keep this folder. In the original repository, first review current changes and recovery.json. Apply non-empty staged.patch twice: git apply --cached, then git apply. Finally apply non-empty working.patch with git apply. Use --check before each command. Never force or reset if a patch fails. Patches may contain private file contents.\n";

pub(super) struct Patch {
    pub file: File,
    pub size: u64,
    hash: Option<[u8; 32]>,
}

impl Patch {
    fn new(file: File) -> Self {
        Self {
            file,
            size: 0,
            hash: None,
        }
    }

    fn seal(&mut self, cancellation: Option<&Cancellation>) -> Result<(), RepositoryError> {
        self.size = self.file.metadata()?.len();
        self.hash = Some(hash_file(&mut self.file, cancellation)?);

        Ok(())
    }

    pub fn verify(&mut self, cancellation: Option<&Cancellation>) -> Result<(), RepositoryError> {
        if self.hash != Some(hash_file(&mut self.file, cancellation)?)
            || self.file.metadata()?.len() != self.size
        {
            return Err(RepositoryError::InvalidInput(
                "Recovery patch changed. Inspect the backup before continuing.",
            ));
        }

        self.file.seek(SeekFrom::Start(0))?;

        Ok(())
    }
}

pub(super) struct Recovery {
    pub path: PathBuf,
    parent: File,
    directory: File,
    pub paths: Vec<GitPath>,
    pub staged: Patch,
    pub working: Patch,
    complete: bool,
}

impl Recovery {
    fn create(destination: Option<&Path>, paths: Vec<GitPath>) -> Result<Self, RepositoryError> {
        let (path, parent, directory) = match destination {
            Some(path) => {
                if !path.is_absolute() || path.file_name().is_none() {
                    return Err(RepositoryError::InvalidInput(
                        "Choose a new absolute recovery directory beneath an existing parent.",
                    ));
                }

                let parent_path =
                    fs::canonicalize(path.parent().ok_or(RepositoryError::InvalidPath)?)?;

                let parent = crate::platform::open_directory_no_follow(&parent_path)?;

                let directory = crate::platform::create_private_directory(
                    &parent,
                    path.file_name().ok_or(RepositoryError::InvalidPath)?,
                )?;

                (
                    parent_path.join(path.file_name().ok_or(RepositoryError::InvalidPath)?),
                    parent,
                    directory,
                )
            }
            None => {
                let temporary = tempfile::Builder::new()
                    .prefix("1git-discard-recovery-")
                    .tempdir()?;

                let path = fs::canonicalize(temporary.path())?;
                let parent = crate::platform::open_directory_no_follow(
                    path.parent().ok_or(RepositoryError::InvalidPath)?,
                )?;
                let directory = crate::platform::open_directory_no_follow(&path)?;

                let _ = temporary.keep();

                (path, parent, directory)
            }
        };

        crate::platform::make_private_directory(&directory)?;
        let staged = create_file(&directory, c"staged.patch")?;
        let working = create_file(&directory, c"working.patch")?;

        let backup = Self {
            path,
            parent,
            directory,
            paths,
            staged: Patch::new(staged),
            working: Patch::new(working),
            complete: false,
        };

        backup.check_identity()?;

        Ok(backup)
    }

    pub fn check_identity(&self) -> Result<(), RepositoryError> {
        let named = fs::symlink_metadata(&self.path)?;

        if !named.is_dir()
            || crate::platform::FileIdentity::from_path(&self.path)?
                != crate::platform::FileIdentity::from_file(&self.directory)?
            || !crate::platform::is_private_directory(&self.directory)?
        {
            return Err(RepositoryError::InvalidInput(
                "Recovery directory changed. Inspect the backup before continuing.",
            ));
        }

        for (name, patch) in [
            (c"staged.patch", &self.staged),
            (c"working.patch", &self.working),
        ] {
            let entry = crate::platform::open_component(
                &self.directory,
                name.to_str().map_err(std::io::Error::other)?.as_ref(),
                crate::platform::Access::Read,
            )?;
            let named = entry.metadata()?;

            if !named.is_file()
                || crate::platform::file_state(&entry)?.links != 1
                || crate::platform::FileIdentity::from_file(&entry)?
                    != crate::platform::FileIdentity::from_file(&patch.file)?
            {
                return Err(RepositoryError::InvalidInput(
                    "Recovery patch entry changed. Inspect the backup before continuing.",
                ));
            }
        }

        Ok(())
    }

    pub fn info(&self) -> Option<RecoveryBackup> {
        let has_patch = [&self.staged.file, &self.working.file].iter().any(|file| {
            file.metadata()
                .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
        });

        has_patch.then(|| RecoveryBackup {
            directory: self.path.clone(),
            complete: self.complete,
        })
    }

    fn finish(
        &mut self,
        root: &Path,
        head: Option<&str>,
        cancellation: Option<&Cancellation>,
    ) -> Result<(), RepositoryError> {
        self.staged.seal(cancellation)?;
        self.working.seal(cancellation)?;

        if self.staged.size == 0 && self.working.size == 0 {
            return Err(RepositoryError::InvalidInput(
                "The selected file has no discardable changes.",
            ));
        }

        let root = root.to_str().ok_or(RepositoryError::InvalidInput(
            "Recovery metadata requires UTF-8 repository paths.",
        ))?;

        let paths: Vec<_> = self
            .paths
            .iter()
            .map(|path| path.to_str().ok_or(RepositoryError::InvalidPath))
            .collect::<Result<_, _>>()?;

        let created = iso_time(wall_time()?)?;

        let manifest = format!(
            "{{\"root\":{},\"head\":{},\"paths\":{},\"createdAt\":{}}}",
            serde_json::to_string(root).map_err(std::io::Error::other)?,
            serde_json::to_string(&head).map_err(std::io::Error::other)?,
            serde_json::to_string(&paths).map_err(std::io::Error::other)?,
            serde_json::to_string(&created).map_err(std::io::Error::other)?
        );

        self.check_identity()?;
        check_cancelled(cancellation)?;
        write_file(&self.directory, c"recovery.json", manifest.as_bytes())?;
        write_file(&self.directory, c"README.txt", INSTRUCTIONS.as_bytes())?;
        crate::platform::sync_directory(&self.directory)?;
        crate::platform::sync_directory(&self.parent)?;
        self.complete = true;

        Ok(())
    }
}

impl Repository {
    pub(super) fn capture_discard(
        &self,
        before: &Snapshot,
        selected: &[FileChange],
        review: Option<&DiscardRecovery>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Recovery, DiscardError> {
        let mut seen = HashSet::new();
        let mut paths = Vec::new();

        for file in selected {
            for path in file.original_path.iter().chain(std::iter::once(&file.path)) {
                if seen.insert(path.clone()) {
                    paths.push(path.clone());
                }
            }
        }

        let mut backup = Recovery::create(review.map(|value| value.directory.as_path()), paths)
            .map_err(|error| failure(WritePhase::BeforeCommand, error, None, None))?;

        let capture = (|| {
            let empty;

            let head = match before.status.head.oid.as_deref() {
                Some(head) => head,
                None => {
                    let output =
                        self.run(["hash-object", "-t", "tree", "--stdin"], cancellation)?;

                    empty = String::from_utf8(output.stdout)
                        .map_err(|_| RepositoryError::InvalidOutput)?;
                    let value = empty.trim_end();

                    if !full_oid(value) {
                        return Err(RepositoryError::InvalidOutput);
                    }

                    value
                }
            };

            self.capture_discard_patch(
                &mut backup.staged.file,
                diff_args(Some(head), &backup.paths, false)?,
                None,
                &[],
                cancellation,
            )?;
            self.capture_discard_patch(
                &mut backup.working.file,
                diff_args(None, &backup.paths, false)?,
                None,
                &[],
                cancellation,
            )?;
            let untracked: Vec<_> = selected
                .iter()
                .filter(|file| file.record_type == RecordType::Untracked)
                .map(|file| file.path.clone())
                .collect();

            if !untracked.is_empty() {
                let temporary = tempfile::Builder::new()
                    .prefix("1git-discard-index-")
                    .tempdir()?;

                let index = temporary.path().join("index");
                let mut input = Vec::new();

                for path in &untracked {
                    input.extend_from_slice(path.as_bytes());
                    input.push(0);
                }

                let prepare = (|| {
                    self.discard_index_command(
                        ["read-tree", "--empty"],
                        &index,
                        &[],
                        cancellation,
                    )?;
                    self.discard_index_command(
                        [
                            "add",
                            "--intent-to-add",
                            "--pathspec-from-file=-",
                            "--pathspec-file-nul",
                        ],
                        &index,
                        &input,
                        cancellation,
                    )?;
                    backup.working.file.seek(SeekFrom::End(0))?;

                    self.capture_discard_patch(
                        &mut backup.working.file,
                        diff_args(None, &[], true)?,
                        Some(&index),
                        &[],
                        cancellation,
                    )
                })();

                let cleanup = temporary.close();

                prepare?;
                cleanup?;
            }

            backup.finish(
                &self.info.root,
                before.status.head.oid.as_deref(),
                cancellation,
            )
        })();

        capture.map_err(|error| failure(WritePhase::BeforeCommand, error, backup.info(), None))?;

        Ok(backup)
    }

    fn capture_discard_patch(
        &self,
        file: &mut File,
        args: Vec<OsString>,
        index: Option<&Path>,
        input: &[u8],
        cancellation: Option<&Cancellation>,
    ) -> Result<(), RepositoryError> {
        self.check_write_identity()?;
        let mut command = GitCommand::new(&self.info.root, discard_args(args, index.is_some()));

        command.directory = Some(&self.root_directory);
        command.index_file = index;
        command.stdin = input;
        command.stdout_file = Some(file.try_clone()?);
        command.cancellation = cancellation;
        self.process.run(command)?;
        file.sync_all()?;

        Ok(())
    }

    fn discard_index_command(
        &self,
        args: impl IntoIterator<Item = impl Into<OsString>>,
        index: &Path,
        input: &[u8],
        cancellation: Option<&Cancellation>,
    ) -> Result<(), RepositoryError> {
        let mut command = GitCommand::new(
            &self.info.root,
            discard_args(args.into_iter().map(Into::into).collect(), true),
        );

        command.directory = Some(&self.root_directory);
        command.index_file = Some(index);
        command.stdin = input;
        command.cancellation = cancellation;
        self.process.run(command)?;

        Ok(())
    }

    pub(super) fn validate_discard_files(&self, paths: &[GitPath]) -> Result<(), RepositoryError> {
        self.check_write_identity()?;

        for path in paths {
            if !crate::platform::validate_discard_path(&self.root_directory, &path.to_native()?)? {
                return Err(RepositoryError::InvalidInput(
                    "Non-regular files require external Git handling.",
                ));
            }
        }

        Ok(())
    }
}

pub(super) fn validate_paths(paths: &[GitPath]) -> Result<(), RepositoryError> {
    require_paths(paths.iter())?;

    for path in paths {
        let text = path.to_str().ok_or(RepositoryError::InvalidInput(
            "Recovery metadata requires UTF-8 repository paths.",
        ))?;

        if text
            .split('/')
            .any(|part| matches!(part, "" | "." | ".." | ".git"))
        {
            return Err(RepositoryError::InvalidInput(
                "Choose an ordinary literal repository-relative path.",
            ));
        }
    }

    Ok(())
}

fn diff_args(
    head: Option<&str>,
    paths: &[GitPath],
    untracked: bool,
) -> Result<Vec<OsString>, RepositoryError> {
    let mut args: Vec<OsString> = [
        "diff",
        "--no-textconv",
        "--no-ext-diff",
        "--no-color",
        "--binary",
        "--full-index",
    ]
    .map(OsString::from)
    .into();

    if untracked {
        args.extend(["--default-prefix", "--no-renames"].map(OsString::from));
    }

    if let Some(head) = head {
        args.push("--cached".into());
        args.push(head.into());
    }

    args.push("--".into());
    for path in paths {
        args.push(path.to_argument()?);
    }

    Ok(args)
}

fn discard_args(args: Vec<OsString>, private_index: bool) -> Vec<OsString> {
    let mut prefix: Vec<OsString> = ["--no-optional-locks", "--literal-pathspecs"]
        .map(OsString::from)
        .into();

    if private_index {
        prefix.extend(
            ["-c", "core.splitIndex=false", "-c", "core.fsmonitor=false"].map(OsString::from),
        );
    }

    prefix.extend(args);

    prefix
}

fn create_file(directory: &File, name: &CStr) -> std::io::Result<File> {
    let file = crate::platform::open_component(
        directory,
        name.to_str().map_err(std::io::Error::other)?.as_ref(),
        crate::platform::Access::CreatePrivate,
    )?;

    crate::platform::make_private_file(&file)?;

    Ok(file)
}

fn write_file(directory: &File, name: &CStr, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = create_file(directory, name)?;

    file.write_all(bytes)?;

    file.sync_all()
}

fn hash_file(
    file: &mut File,
    cancellation: Option<&Cancellation>,
) -> Result<[u8; 32], RepositoryError> {
    let state = crate::platform::file_state(file)?;

    if !state.regular || state.links != 1 {
        return Err(RepositoryError::InvalidInput(
            "Recovery patches must remain ordinary private files without hard links.",
        ));
    }

    file.seek(SeekFrom::Start(0))?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 8192];
    let mut remaining = state.length;

    while remaining > 0 {
        check_cancelled(cancellation)?;
        let size = usize::try_from(remaining.min(buffer.len() as u64))
            .map_err(|_| RepositoryError::InvalidOutput)?;

        let count = file.read(&mut buffer[..size])?;

        if count == 0 {
            return Err(RepositoryError::InvalidInput(
                "Recovery patch changed while being read.",
            ));
        }

        hash.update(&buffer[..count]);
        remaining -= count as u64;
    }

    if !state.contents_unchanged(&crate::platform::file_state(file)?) {
        return Err(RepositoryError::InvalidInput(
            "Recovery patch changed while being read.",
        ));
    }

    Ok(hash.finalize().into())
}

pub(super) fn wall_time() -> Result<SystemTime, RepositoryError> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(std::io::Error::other)?;

    let milliseconds = u64::try_from(elapsed.as_millis()).map_err(std::io::Error::other)?;

    Ok(UNIX_EPOCH + Duration::from_millis(milliseconds))
}

pub(super) fn iso_time(time: SystemTime) -> Result<String, RepositoryError> {
    let elapsed = time
        .duration_since(UNIX_EPOCH)
        .map_err(std::io::Error::other)?;

    let milliseconds = i64::try_from(elapsed.as_millis()).map_err(std::io::Error::other)?;

    let date = DateTime::<Utc>::from_timestamp_millis(milliseconds).ok_or(
        RepositoryError::InvalidInput("Recovery timestamp is out of range"),
    )?;

    Ok(date.to_rfc3339_opts(SecondsFormat::Millis, true))
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::validate_paths;
    use crate::GitPath;

    #[test]
    fn native_separators_cannot_hide_git_or_parent_components() {
        for path in [
            "folder\\.git\\config",
            "folder\\..\\file",
            "folder\\.\\file",
        ] {
            let path = GitPath::new(path).unwrap();
            assert!(validate_paths(std::slice::from_ref(&path)).is_ok());
            assert!(path.to_native().is_err());
        }

        let path = GitPath::new("folder/file.txt").unwrap();
        assert!(validate_paths(std::slice::from_ref(&path)).is_ok());
        assert!(path.to_native().is_ok());
        assert!(validate_paths(&[GitPath::new("folder/.git/config").unwrap()]).is_err());
        assert!(GitPath::new("folder/../file").is_err());
    }
}
