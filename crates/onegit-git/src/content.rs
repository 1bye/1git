//! Bounded file previews, with descriptor-relative access beneath the opened working tree.

use std::ffi::{CString, OsString};
use std::fs::{self, File};
use std::io::{self, Read};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};

use super::{Repository, RepositoryError};
use crate::output::{text, trim};
use crate::validation::{full_oid, require_paths, require_revision};
use crate::{Cancellation, GitCommand, GitError};

const MAX_PREVIEW_BYTES: usize = 10 * 1024 * 1024;

/// Byte-preserving preview representation. Text retains a leading UTF-8 BOM and NULs.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FileData {
    /// Strictly valid UTF-8, without any byte normalization.
    Utf8(String),
    /// Invalid UTF-8, retained as bytes for image/export/protocol adapters.
    Binary(Vec<u8>),
}

impl FileData {
    /// Borrow original bytes without encoding, allocation or BOM removal.
    pub fn as_bytes(&self) -> &[u8] {
        match self {
            Self::Utf8(text) => text.as_bytes(),
            Self::Binary(bytes) => bytes,
        }
    }
}

/// A file source, distinct from the path label attached to its preview.
#[derive(Clone, Copy, Debug)]
pub enum FileSource<'a> {
    /// Current file beneath the repository root; internal symlinks may resolve within it.
    Working,
    /// A path in a validated commit/tree-ish revision.
    Revision(&'a str),
    /// A blob-ish resolved once to its immutable object ID.
    Object(&'a str),
}

/// Owned bounded preview. Binary data is encoded only at an external protocol boundary.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileContent {
    /// Requested repository-relative path, preserving exact Unix bytes.
    pub path: PathBuf,
    /// WORKTREE for current content, otherwise the resolved blob object ID.
    pub revision: String,
    /// Exact decoded text or original binary bytes.
    pub content: FileData,
}

impl FileContent {
    /// Exact original byte length, independent of text/base64 representation.
    pub fn size_bytes(&self) -> usize {
        self.content.as_bytes().len()
    }
}

impl Repository {
    /// Read at most 10 MiB from a working file, revision path or blob.
    ///
    /// Working files resolve within the canonical root and are opened component-by-component
    /// with no-follow descriptors. A symlink replacement during that walk cannot redirect
    /// access outside the opened tree. Growth after stat stays bounded; directories/devices
    /// and external symlinks return errors. All Git object reads are blob-only and bounded too.
    pub fn file_content(
        &self,
        source: FileSource<'_>,
        requested: &Path,
        cancellation: Option<&Cancellation>,
    ) -> Result<FileContent, RepositoryError> {
        self.mutations.wait_for_pending();
        require_paths([requested])?;
        super::check_cancelled(cancellation)?;

        let (bytes, revision) = match source {
            FileSource::Working => (
                self.working_file(requested, cancellation)?,
                "WORKTREE".into(),
            ),
            FileSource::Revision(revision) => {
                require_revision(revision)?;

                let mut object = OsString::from(revision);

                object.push(":");
                object.push(requested);

                self.blob(&object, cancellation)?
            }
            FileSource::Object(object) => {
                require_revision(object)?;

                self.blob(object.as_ref(), cancellation)?
            }
        };

        let content = match String::from_utf8(bytes) {
            Ok(text) => FileData::Utf8(text),
            Err(error) => FileData::Binary(error.into_bytes()),
        };

        Ok(FileContent {
            path: requested.into(),
            revision,
            content,
        })
    }

    fn blob(
        &self,
        object: &std::ffi::OsStr,
        cancellation: Option<&Cancellation>,
    ) -> Result<(Vec<u8>, String), RepositoryError> {
        let output = self.run(
            [
                OsString::from("rev-parse"),
                "--verify".into(),
                object.to_owned(),
            ],
            cancellation,
        )?;

        let oid = trim(&text(&output.stdout)).to_owned();

        if !full_oid(&oid) {
            return Err(RepositoryError::InvalidOutput);
        }

        let kind = self.run(["cat-file", "-t", &oid], cancellation)?;

        if trim(&text(&kind.stdout)) != "blob" {
            return Err(RepositoryError::NotAFile);
        }

        let size = self.run(["cat-file", "-s", &oid], cancellation)?;

        let size: u64 = trim(&text(&size.stdout))
            .parse()
            .map_err(|_| RepositoryError::InvalidOutput)?;

        preview_size(size)?;

        let mut command = GitCommand::new(&self.info.root, ["cat-file", "blob", &oid]);

        command.cancellation = cancellation;
        command.max_output_bytes = Some(MAX_PREVIEW_BYTES);

        let output = self.process.run(command)?;

        preview_size(output.stdout.len() as u64)?;

        Ok((output.stdout, oid))
    }

    fn working_file(
        &self,
        requested: &Path,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<u8>, RepositoryError> {
        let root_metadata = fs::symlink_metadata(&self.info.root)?;
        let held_metadata = self.root_directory.metadata()?;

        if !root_metadata.is_dir()
            || root_metadata.dev() != held_metadata.dev()
            || root_metadata.ino() != held_metadata.ino()
        {
            return Err(RepositoryError::InvalidInput(
                "Repository directory changed; reopen it before previewing files",
            ));
        }

        let resolved = fs::canonicalize(self.info.root.join(requested))?;

        let relative = resolved
            .strip_prefix(&self.info.root)
            .map_err(|_| RepositoryError::PathOutsideRepository)?;

        let mut file = self.open_preview(relative)?;
        let metadata = file.metadata()?;

        if !metadata.is_file() {
            return Err(RepositoryError::NotAFile);
        }

        preview_size(metadata.len())?;

        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        let mut buffer = [0; 8192];

        loop {
            super::check_cancelled(cancellation)?;

            let read = file.read(&mut buffer)?;

            if read == 0 {
                break;
            }

            preview_size((bytes.len() + read) as u64)?;
            bytes.extend_from_slice(&buffer[..read]);
        }

        Ok(bytes)
    }

    fn open_preview(&self, relative: &Path) -> Result<File, RepositoryError> {
        self.open_working_file(relative, false)
    }

    pub(super) fn open_working_file(
        &self,
        relative: &Path,
        writable: bool,
    ) -> Result<File, RepositoryError> {
        let mut parent: Option<File> = None;
        let mut components = relative.components().peekable();

        while let Some(component) = components.next() {
            let Component::Normal(name) = component else {
                return Err(RepositoryError::PathOutsideRepository);
            };

            let name = CString::new(name.as_bytes()).map_err(|_| RepositoryError::InvalidPath)?;
            let directory = parent.as_ref().unwrap_or(&self.root_directory);
            let last = components.peek().is_none();

            let flags = if last && writable {
                libc::O_RDWR
            } else {
                libc::O_RDONLY
            } | libc::O_CLOEXEC
                | libc::O_NOFOLLOW
                | libc::O_NONBLOCK
                | if last { 0 } else { libc::O_DIRECTORY };

            // SAFETY: directory owns a live dir fd, name is one NUL-terminated component,
            // and no-follow flags prevent traversing a substituted symlink. Writable
            // access is requested only for the final file, without creating/truncating it.
            let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags) };

            if fd < 0 {
                return Err(io::Error::last_os_error().into());
            }

            // SAFETY: successful openat returned a new fd, whose sole owner is this File.
            let file = unsafe { File::from_raw_fd(fd) };

            if last {
                return Ok(file);
            }

            parent = Some(file);
        }

        Err(RepositoryError::NotAFile)
    }
}

fn preview_size(size: u64) -> Result<(), GitError> {
    if size > MAX_PREVIEW_BYTES as u64 {
        return Err(GitError::OutputTooLarge {
            limit: MAX_PREVIEW_BYTES,
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::os::unix::fs::symlink;

    use crate::{GitCommand, GitProcess, Repository};

    #[test]
    fn no_follow_walk_rejects_a_swapped_directory_and_final_symlink() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("root");
        let outside = temporary.path().join("outside");

        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("secret"), "outside fixture").unwrap();

        GitProcess::default()
            .run(GitCommand::new(&root, ["-c", "init.templateDir=", "init"]))
            .unwrap();

        let repository = Repository::open(&root, GitProcess::default(), None).unwrap();

        symlink(&outside, root.join("swapped")).unwrap();
        symlink(outside.join("secret"), root.join("file")).unwrap();

        assert!(
            repository
                .open_preview(std::path::Path::new("swapped/secret"))
                .is_err()
        );
        assert!(
            repository
                .open_preview(std::path::Path::new("file"))
                .is_err()
        );
    }
}
