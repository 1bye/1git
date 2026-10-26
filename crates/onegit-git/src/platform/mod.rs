//! Platform-neutral filesystem, path and child-process contracts. See README.md.

use std::fmt;
use std::fs::File;
use std::io;
use std::path::{Component, Path};

#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;
#[cfg(unix)]
pub(crate) use unix::*;
#[cfg(windows)]
pub(crate) use windows::*;
#[cfg(not(any(unix, windows)))]
compile_error!("onegit-git requires a Unix or Windows host with a native Git executable");

#[derive(Debug)]
pub(crate) struct PathEncodingError;

impl fmt::Display for PathEncodingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Git path cannot be represented on this platform")
    }
}

impl std::error::Error for PathEncodingError {}

#[derive(Clone, Copy)]
pub(crate) enum Access {
    Read,
    ReadWrite,
    Directory,
    Append { create: bool },
    CreatePrivate,
}

pub(crate) enum Signal {
    Terminate,
    Kill,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct FileState {
    identity: FileIdentity,
    pub(crate) length: u64,
    pub(crate) regular: bool,
    pub(crate) links: u64,
    attributes: u32,
    modified: (i64, i64),
    changed: (i64, i64),
}

impl FileState {
    pub(crate) fn contents_unchanged(&self, after: &Self) -> bool {
        self.length == after.length
            && self.modified == after.modified
            && self.changed == after.changed
    }
}

// Writable access applies only to the final component, without creating or truncating it.
pub(crate) fn open_beneath(root: &File, relative: &Path, writable: bool) -> io::Result<File> {
    let mut parent = None;
    let mut components = relative.components().peekable();

    while let Some(component) = components.next() {
        let Component::Normal(name) = component else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Expected a relative normal path",
            ));
        };
        let last = components.peek().is_none();
        let access = if !last {
            Access::Directory
        } else if writable {
            Access::ReadWrite
        } else {
            Access::Read
        };
        let file = open_component(parent.as_ref().unwrap_or(root), name, access)?;

        if last {
            return Ok(file);
        }

        parent = Some(file);
    }

    Err(io::Error::new(
        io::ErrorKind::InvalidInput,
        "Expected a file path",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    #[test]
    fn unicode_paths_round_trip_without_loss() {
        let bytes = "folder/été 文件.txt".as_bytes();
        let path = path_from_git_bytes(bytes).unwrap();

        assert_eq!(path_to_git_bytes(path.as_os_str()).unwrap().as_ref(), bytes);
    }

    #[cfg(unix)]
    #[test]
    fn unix_git_paths_preserve_non_utf8_and_control_bytes() {
        let bytes = b"folder/tab\tnewline\n\xff";
        let path = path_from_git_bytes(bytes).unwrap();

        assert_eq!(path_to_git_bytes(path.as_os_str()).unwrap().as_ref(), bytes);
    }

    #[test]
    fn held_identity_detects_a_replaced_name_and_metadata_detects_appends() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("file");
        fs::write(&path, b"original").unwrap();
        let held = File::open(&path).unwrap();
        let identity = FileIdentity::from_file(&held).unwrap();
        let before = file_state(&held).unwrap();

        assert_eq!(identity, FileIdentity::from_path(&path).unwrap());
        fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"changed")
            .unwrap();
        assert!(!before.contents_unchanged(&file_state(&held).unwrap()));
        assert_ne!(before, file_state(&held).unwrap());

        fs::rename(&path, temporary.path().join("old")).unwrap();
        fs::write(&path, b"replacement").unwrap();

        assert_ne!(identity, FileIdentity::from_path(&path).unwrap());
        assert_eq!(identity, FileIdentity::from_file(&held).unwrap());
    }

    #[test]
    fn relative_opens_refuse_parent_traversal_and_exclusive_creates_never_overwrite() {
        let temporary = tempfile::tempdir().unwrap();
        let root = open_directory_no_follow(temporary.path()).unwrap();
        let mut file = open_component(&root, "private".as_ref(), Access::CreatePrivate).unwrap();
        file.write_all(b"preserved").unwrap();

        assert!(open_component(&root, "private".as_ref(), Access::CreatePrivate).is_err());
        assert!(open_beneath(&root, Path::new("../private"), false).is_err());
        assert_eq!(
            fs::read(temporary.path().join("private")).unwrap(),
            b"preserved"
        );
    }
}
