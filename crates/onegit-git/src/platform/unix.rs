//! Unix implementation; descriptor-relative operations retain their original flags.

use std::borrow::Cow;
use std::ffi::{CStr, CString, OsStr, OsString};
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{self, Read};
use std::mem::MaybeUninit;
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command};

use super::{Access, FileState};

pub(crate) fn path_from_git_bytes(bytes: &[u8]) -> Result<PathBuf, super::PathEncodingError> {
    Ok(OsString::from_vec(bytes.to_vec()).into())
}

pub(crate) fn absolute_path_from_git_bytes(
    bytes: &[u8],
) -> Result<PathBuf, super::PathEncodingError> {
    path_from_git_bytes(bytes)
}

pub(crate) fn validate_relative_filesystem_path(_path: &Path) -> io::Result<()> {
    Ok(())
}

pub(crate) fn sync_directory(file: &File) -> io::Result<()> {
    file.sync_all()
}

pub(crate) fn path_to_git_bytes(path: &OsStr) -> Result<Cow<'_, [u8]>, super::PathEncodingError> {
    Ok(Cow::Borrowed(path.as_bytes()))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct FileIdentity(u64, u64);

impl FileIdentity {
    pub(crate) fn from_file(file: &File) -> io::Result<Self> {
        Ok(Self::from_metadata(&file.metadata()?))
    }

    pub(crate) fn from_path(path: &Path) -> io::Result<Self> {
        Ok(Self::from_metadata(&fs::symlink_metadata(path)?))
    }

    fn from_metadata(metadata: &Metadata) -> Self {
        Self(metadata.dev(), metadata.ino())
    }
}

pub(crate) fn file_state(file: &File) -> io::Result<FileState> {
    let metadata = file.metadata()?;

    Ok(FileState {
        identity: FileIdentity::from_metadata(&metadata),
        length: metadata.len(),
        regular: metadata.is_file(),
        links: metadata.nlink(),
        attributes: metadata.mode(),
        modified: (metadata.mtime(), metadata.mtime_nsec()),
        changed: (metadata.ctime(), metadata.ctime_nsec()),
    })
}

pub(crate) fn is_missing_or_not_regular(error: &io::Error) -> bool {
    matches!(
        error.raw_os_error(),
        Some(libc::ELOOP | libc::ENOENT | libc::ENOTDIR | libc::EISDIR)
    )
}

pub(crate) fn open_directory_no_follow(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(path)
}

pub(crate) fn open_component(parent: &File, name: &OsStr, access: Access) -> io::Result<File> {
    let name = CString::new(name.as_bytes())?;
    let (flags, mode) = match access {
        Access::Read => (libc::O_RDONLY, 0),
        Access::ReadWrite => (libc::O_RDWR, 0),
        Access::Directory => (libc::O_RDONLY | libc::O_DIRECTORY, 0),
        Access::Append { create } => (
            libc::O_RDWR
                | libc::O_APPEND
                | if create {
                    libc::O_CREAT | libc::O_EXCL
                } else {
                    0
                },
            0o644,
        ),
        Access::CreatePrivate => (libc::O_RDWR | libc::O_CREAT | libc::O_EXCL, 0o600),
    };

    open_at(parent, &name, flags, mode)
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

pub(crate) fn create_private_file(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
}

pub(crate) fn truncate_no_follow(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .write(true)
        .truncate(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
}

pub(crate) fn create_private_directory(parent: &File, name: &OsStr) -> io::Result<File> {
    let name = CString::new(name.as_bytes())?;

    // SAFETY: parent owns a live dir fd; name is one validated NUL-terminated leaf.
    if unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) } != 0 {
        return Err(io::Error::last_os_error());
    }

    open_at(parent, &name, libc::O_RDONLY | libc::O_DIRECTORY, 0)
}

pub(crate) fn make_private_directory(directory: &File) -> io::Result<()> {
    directory.set_permissions(fs::Permissions::from_mode(0o700))
}

pub(crate) fn is_private_directory(directory: &File) -> io::Result<bool> {
    Ok(directory.metadata()?.permissions().mode() & 0o077 == 0)
}

pub(crate) fn make_private_file(file: &File) -> io::Result<()> {
    file.set_permissions(fs::Permissions::from_mode(0o600))
}

pub(crate) fn validate_discard_path(root: &File, path: &Path) -> io::Result<bool> {
    let mut parent = root.try_clone()?;
    let mut components = path.components().peekable();

    while let Some(component) = components.next() {
        let Component::Normal(name) = component else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Expected a relative normal path",
            ));
        };
        let name = CString::new(name.as_bytes())?;

        if components.peek().is_some() {
            match open_at(&parent, &name, libc::O_RDONLY | libc::O_DIRECTORY, 0) {
                Ok(directory) => parent = directory,
                Err(error) if error.kind() == io::ErrorKind::NotFound => break,
                Err(error) => return Err(error),
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
                let error = io::Error::last_os_error();

                if error.kind() == io::ErrorKind::NotFound {
                    break;
                }

                return Err(error);
            }

            // SAFETY: successful fstatat initialized the complete stat value.
            let mode = unsafe { metadata.assume_init() }.st_mode & libc::S_IFMT;

            return Ok(matches!(mode, libc::S_IFREG | libc::S_IFLNK));
        }
    }

    Ok(true)
}

pub(crate) fn random_bytes(bytes: &mut [u8]) -> io::Result<()> {
    File::open("/dev/urandom")?.read_exact(bytes)
}

pub(crate) fn spawn(
    command: &mut Command,
    cwd: &Path,
    directory: Option<&File>,
) -> io::Result<OwnedChild> {
    command.process_group(0);
    // The child remaps stdin/stdout/stderr before pre_exec. Duplicate above those
    // descriptors even if the caller opened its directory while standard I/O was closed.
    let pinned_directory = directory.map(duplicate_directory).transpose()?;

    if let Some(directory) = pinned_directory.as_ref() {
        let descriptor = directory.as_raw_fd();

        // SAFETY: the borrowed File stays open through spawn. fchdir is async-signal-safe,
        // and this child-only hook performs no allocation, locking or parent-state mutation.
        unsafe {
            command.pre_exec(move || {
                if libc::fchdir(descriptor) == -1 {
                    return Err(io::Error::last_os_error());
                }

                Ok(())
            });
        }
    } else {
        command.current_dir(cwd);
    }

    Ok(OwnedChild {
        child: command.spawn()?,
        finished: false,
    })
}

pub(crate) fn input_pipe(pipe: ChildStdin) -> io::Result<ChildStdin> {
    nonblocking(pipe.as_raw_fd())?;

    Ok(pipe)
}

pub(crate) fn output_pipe<R: Read + AsRawFd>(pipe: R) -> io::Result<R> {
    nonblocking(pipe.as_raw_fd())?;

    Ok(pipe)
}

fn duplicate_directory(file: &File) -> io::Result<File> {
    // SAFETY: fcntl borrows a live descriptor and atomically creates a distinct owned
    // descriptor >= 3 with close-on-exec. A negative result creates no descriptor.
    let descriptor = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 3) };

    if descriptor == -1 {
        return Err(io::Error::last_os_error());
    }

    // SAFETY: this successful fcntl result has one owner, transferred into File exactly once.
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

pub(crate) struct OwnedChild {
    pub(crate) child: Child,
    pub(crate) finished: bool,
}

impl OwnedChild {
    pub(crate) fn finish(&mut self, _preserve_descendants: bool) -> io::Result<()> {
        self.finished = true;

        Ok(())
    }

    pub(crate) fn signal(&self, signal: super::Signal) {
        let signal = match signal {
            super::Signal::Terminate => libc::SIGTERM,
            super::Signal::Kill => libc::SIGKILL,
        };

        // SAFETY: Command::process_group(0) created this private group; the ID fits pid_t.
        unsafe {
            libc::kill(-(self.child.id() as libc::pid_t), signal);
        }
    }
}

impl Drop for OwnedChild {
    fn drop(&mut self) {
        if !self.finished {
            self.signal(super::Signal::Kill);
            let _ = self.child.wait();
        }
    }
}

fn nonblocking(fd: i32) -> io::Result<()> {
    // SAFETY: fd belongs to a live owned pipe; fcntl changes only its nonblocking flag.
    let result = unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFL);

        if flags < 0 {
            -1
        } else {
            libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK)
        }
    };

    if result < 0 {
        return Err(io::Error::last_os_error());
    }

    Ok(())
}

#[cfg(test)]
pub(crate) use std::os::unix::fs::symlink;
