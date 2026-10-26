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
    #[cfg(windows)]
    Inspect,
    Directory,
    Append {
        create: bool,
    },
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
    validate_relative_filesystem_path(relative)?;

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
        let path = crate::GitPath::new(bytes).unwrap().to_native().unwrap();

        assert_eq!(path_to_git_bytes(path.as_os_str()).unwrap().as_ref(), bytes);
    }

    #[cfg(unix)]
    #[test]
    fn unix_git_paths_preserve_non_utf8_and_control_bytes() {
        let bytes = b"folder/tab\tnewline\n\xff";
        let path = crate::GitPath::new(bytes).unwrap().to_native().unwrap();

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

// Pure Windows policy is compiled into Unix unit tests too; it has no native calls.
#[cfg(any(windows, test))]
mod windows_policy {
    use super::PathEncodingError;
    use std::borrow::Cow;

    pub(super) fn native_git_path(text: &str) -> Result<&str, PathEncodingError> {
        if text
            .strip_suffix('/')
            .unwrap_or(text)
            .split('/')
            .all(component_representable)
        {
            Ok(text)
        } else {
            Err(PathEncodingError)
        }
    }

    #[derive(Debug)]
    struct EntryNameVerificationError(std::io::Error);

    impl std::fmt::Display for EntryNameVerificationError {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(formatter, "Cannot verify the opened entry name: {}", self.0)
        }
    }

    impl std::error::Error for EntryNameVerificationError {
        fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
            Some(&self.0)
        }
    }

    pub(super) fn verified_entry_name(result: std::io::Result<bool>) -> std::io::Result<()> {
        // A failed query is not proof of absence. In particular, never let a native
        // PATH_NOT_FOUND from name verification reach discard's missing-entry branch.
        match result {
            Ok(true) => Ok(()),
            Ok(false) => Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Opened entry spelling differs from the requested Git path",
            )),
            Err(error) => Err(std::io::Error::other(EntryNameVerificationError(error))),
        }
    }

    pub(super) fn drive_prefix(text: &str) -> bool {
        text.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
            && text.as_bytes().get(1) == Some(&b':')
    }

    pub(super) fn component_representable(part: &str) -> bool {
        if matches!(part, "" | "." | "..") {
            return false;
        }
        if part.ends_with(['.', ' '])
            || part
                .chars()
                .any(|ch| ch < ' ' || "<>:\"|?*\\/".contains(ch))
        {
            return false;
        }
        let stem = part
            .split('.')
            .next()
            .unwrap_or("")
            .trim_end_matches(' ')
            .to_uppercase();

        !matches!(
            stem.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
        ) && !["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|number| {
                matches!(
                    number,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        })
    }

    pub(super) fn cwd_path(text: &str) -> Cow<'_, str> {
        let plain = if let Some(unc) = text.strip_prefix("\\\\?\\UNC\\") {
            Cow::Owned(format!("\\\\{unc}"))
        } else if let Some(dos) = text
            .strip_prefix("\\\\?\\")
            .filter(|dos| drive_prefix(dos) && dos.as_bytes().get(2) == Some(&b'\\'))
        {
            Cow::Borrowed(dos)
        } else {
            return Cow::Borrowed(text);
        };
        let compatible = plain.encode_utf16().count() < 260
            && plain.split('\\').enumerate().all(|(index, part)| {
                part.is_empty()
                    || index == 0 && drive_prefix(part) && part.len() == 2
                    || component_representable(part) && part.encode_utf16().count() <= 255
            });

        if compatible {
            plain
        } else {
            Cow::Borrowed(text)
        }
    }

    pub(super) fn name_surrogate(tag: u32) -> bool {
        tag & 0x2000_0000 != 0
    }

    pub(super) fn valid_file_id(id: &[u8; 16]) -> bool {
        id.iter().any(|byte| *byte != 0)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn display_names_are_separate_from_filesystem_representability() {
            for name in ["aux.c", "con.h", "a:b", "trailing.", "name ", "tab\tname"] {
                assert!(crate::GitPath::new(name).is_ok(), "{name}");
                assert!(!component_representable(name), "{name}");
            }
            assert!(component_representable("été.txt"));
        }

        #[test]
        fn cwd_conversion_preserves_verbatim_only_semantics_and_long_paths() {
            assert_eq!(cwd_path("\\\\?\\C:\\repo"), "C:\\repo");
            assert_eq!(
                cwd_path("\\\\?\\UNC\\server\\share\\repo"),
                "\\\\server\\share\\repo"
            );
            assert_eq!(cwd_path("C:\\repo"), "C:\\repo");
            for path in [
                "\\\\?\\C:\\name.",
                "\\\\?\\C:\\name ",
                "\\\\?\\C:\\a\\..\\b",
                "\\\\?\\C:\\aux.c",
                "\\\\?\\Volume{guid}\\repo",
            ] {
                assert_eq!(cwd_path(path), path);
            }
            let limit = format!(
                "\\\\?\\C:\\{}\\{}\\{}",
                "a".repeat(100),
                "b".repeat(100),
                "c".repeat(55)
            );
            assert_eq!(cwd_path(&limit), limit);
            let long = format!("\\\\?\\C:\\{}", "a".repeat(256));
            assert_eq!(cwd_path(&long), long);
            let boundary = format!("\\\\?\\C:\\{}", "é".repeat(256));
            assert_eq!(cwd_path(&boundary), boundary);
        }

        #[test]
        fn reparse_policy_distinguishes_links_from_data_filters() {
            for tag in [0xa000_000c, 0xa000_0003] {
                assert!(name_surrogate(tag));
            }
            for tag in [0, 0x9000_001a, 0x9000_101a, 0x8000_0017, 0x8000_0013] {
                assert!(!name_surrogate(tag));
            }
        }

        #[test]
        fn zero_file_ids_cannot_claim_an_identity() {
            assert!(!valid_file_id(&[0; 16]));
            let mut id = [0; 16];
            id[15] = 1;
            assert!(valid_file_id(&id));
        }

        #[test]
        fn entry_name_query_failures_cannot_be_mistaken_for_missing_entries() {
            for kind in [
                std::io::ErrorKind::NotFound,
                std::io::ErrorKind::PermissionDenied,
                std::io::ErrorKind::Unsupported,
            ] {
                let error = verified_entry_name(Err(kind.into())).unwrap_err();
                assert_eq!(error.kind(), std::io::ErrorKind::Other);
                assert!(error.get_ref().unwrap().source().is_some());
            }
            assert!(verified_entry_name(Ok(true)).is_ok());
            assert_eq!(
                verified_entry_name(Ok(false)).unwrap_err().kind(),
                std::io::ErrorKind::InvalidInput
            );
        }
        #[test]
        fn native_git_paths_reject_unrepresentable_components_without_transport_escapes() {
            for path in [
                "c:/x",
                "C:\\x",
                "c:",
                "/x",
                "\\x",
                "//server/share/x",
                "\\\\?\\C:\\x",
                "a:b",
                "folder\\file",
                "aux.c",
            ] {
                assert!(native_git_path(path).is_err(), "{path}");
            }
            assert_eq!(
                native_git_path("folder/file.txt").unwrap(),
                "folder/file.txt"
            );
        }
    }
}
