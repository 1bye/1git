//! Private recovery files, streamed capture and literal no-follow filesystem checks.

use std::collections::HashSet;
use std::ffi::{CStr, CString, OsString};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::mem::MaybeUninit;
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Component, Path, PathBuf};
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
    pub paths: Vec<PathBuf>,
    pub staged: Patch,
    pub working: Patch,
    complete: bool,
}

impl Recovery {
    fn create(destination: Option<&Path>, paths: Vec<PathBuf>) -> Result<Self, RepositoryError> {
        let (path, parent, directory) = match destination {
            Some(path) => {
                if !path.is_absolute() || path.file_name().is_none() {
                    return Err(RepositoryError::InvalidInput(
                        "Choose a new absolute recovery directory beneath an existing parent.",
                    ));
                }

                let parent_path =
                    fs::canonicalize(path.parent().ok_or(RepositoryError::InvalidPath)?)?;

                let parent = open_directory(&parent_path)?;

                let name = CString::new(
                    path.file_name()
                        .ok_or(RepositoryError::InvalidPath)?
                        .as_bytes(),
                )
                .map_err(|_| RepositoryError::InvalidPath)?;

                // SAFETY: parent owns a live dir fd; name is one validated NUL-terminated leaf.
                if unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) } != 0 {
                    return Err(std::io::Error::last_os_error().into());
                }

                let directory = open_at(&parent, &name, libc::O_RDONLY | libc::O_DIRECTORY, 0)?;

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
                let parent = open_directory(path.parent().ok_or(RepositoryError::InvalidPath)?)?;
                let directory = open_directory(&path)?;

                let _ = temporary.keep();

                (path, parent, directory)
            }
        };

        directory.set_permissions(fs::Permissions::from_mode(0o700))?;
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
        let held = self.directory.metadata()?;

        if !named.is_dir()
            || named.dev() != held.dev()
            || named.ino() != held.ino()
            || named.permissions().mode() & 0o077 != 0
        {
            return Err(RepositoryError::InvalidInput(
                "Recovery directory changed. Inspect the backup before continuing.",
            ));
        }

        for (name, patch) in [
            (c"staged.patch", &self.staged),
            (c"working.patch", &self.working),
        ] {
            let named = open_at(&self.directory, name, libc::O_RDONLY, 0)?.metadata()?;
            let held = patch.file.metadata()?;

            if !named.is_file()
                || named.nlink() != 1
                || named.dev() != held.dev()
                || named.ino() != held.ino()
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
        self.directory.sync_all()?;
        self.parent.sync_all()?;
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
                diff_args(Some(head), &backup.paths, false),
                None,
                &[],
                cancellation,
            )?;
            self.capture_discard_patch(
                &mut backup.working.file,
                diff_args(None, &backup.paths, false),
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
                    input.extend_from_slice(path.as_os_str().as_bytes());
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
                        diff_args(None, &[], true),
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

    pub(super) fn validate_discard_files(&self, paths: &[PathBuf]) -> Result<(), RepositoryError> {
        self.check_write_identity()?;

        for path in paths {
            let mut parent = self.root_directory.try_clone()?;
            let mut components = path.components().peekable();

            while let Some(component) = components.next() {
                let Component::Normal(name) = component else {
                    return Err(RepositoryError::PathOutsideRepository);
                };

                let name =
                    CString::new(name.as_bytes()).map_err(|_| RepositoryError::InvalidPath)?;

                if components.peek().is_some() {
                    match open_at(&parent, &name, libc::O_RDONLY | libc::O_DIRECTORY, 0) {
                        Ok(directory) => parent = directory,
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
                        Err(error) => return Err(error.into()),
                    }
                } else {
                    let mut metadata = MaybeUninit::<libc::stat>::uninit();

                    // SAFETY: live parent fd and NUL-terminated leaf; fstatat writes a stat
                    // only on success. AT_SYMLINK_NOFOLLOW inspects the link itself.
                    let result = unsafe {
                        libc::fstatat(
                            parent.as_raw_fd(),
                            name.as_ptr(),
                            metadata.as_mut_ptr(),
                            libc::AT_SYMLINK_NOFOLLOW,
                        )
                    };

                    if result != 0 {
                        let error = std::io::Error::last_os_error();

                        if error.kind() == std::io::ErrorKind::NotFound {
                            break;
                        }

                        return Err(error.into());
                    }

                    // SAFETY: successful fstatat initialized the complete stat value.
                    let mode = unsafe { metadata.assume_init() }.st_mode & libc::S_IFMT;

                    if !matches!(mode, libc::S_IFREG | libc::S_IFLNK) {
                        return Err(RepositoryError::InvalidInput(
                            "Non-regular files require external Git handling.",
                        ));
                    }
                }
            }
        }

        Ok(())
    }
}

pub(super) fn validate_paths(paths: &[PathBuf]) -> Result<(), RepositoryError> {
    require_paths(paths.iter().map(PathBuf::as_path))?;

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

fn diff_args(head: Option<&str>, paths: &[PathBuf], untracked: bool) -> Vec<OsString> {
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
    args.extend(paths.iter().map(|path| path.as_os_str().to_owned()));

    args
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

fn open_at(
    directory: &File,
    name: &CStr,
    flags: libc::c_int,
    mode: libc::mode_t,
) -> std::io::Result<File> {
    // SAFETY: the caller supplies a live dir fd and one NUL-terminated leaf. No-follow,
    // close-on-exec and nonblocking flags prevent link traversal and FIFO open hangs.
    let descriptor = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            flags | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
            mode as libc::c_uint,
        )
    };

    if descriptor < 0 {
        return Err(std::io::Error::last_os_error());
    }

    // SAFETY: successful openat returned a new descriptor owned exclusively by this File.
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

fn open_directory(path: &Path) -> std::io::Result<File> {
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(path)
}

fn create_file(directory: &File, name: &CStr) -> std::io::Result<File> {
    let file = open_at(
        directory,
        name,
        libc::O_RDWR | libc::O_CREAT | libc::O_EXCL,
        0o600,
    )?;

    file.set_permissions(fs::Permissions::from_mode(0o600))?;

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
    let before = file.metadata()?;

    if !before.is_file() || before.nlink() != 1 {
        return Err(RepositoryError::InvalidInput(
            "Recovery patches must remain ordinary private files without hard links.",
        ));
    }

    file.seek(SeekFrom::Start(0))?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 8192];
    let mut remaining = before.len();

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

    let after = file.metadata()?;

    if before.len() != after.len()
        || before.mtime() != after.mtime()
        || before.mtime_nsec() != after.mtime_nsec()
        || before.ctime() != after.ctime()
        || before.ctime_nsec() != after.ctime_nsec()
    {
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
