//! Exact repository-relative Git names, independent of native filesystem spelling.

use std::ffi::OsString;
use std::fmt;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;

/// An exact `/`-separated repository-relative Git path, stored without Unicode normalization.
///
/// This is a Git name, not a native filesystem path. Backslashes and colons are literal
/// bytes, and non-UTF-8 Unix names remain lossless. Use [`Self::display`] for a label;
/// equality, hashing and ordering always compare the original bytes. A trailing `/`
/// from Git's ignored-directory status is preserved as a directory marker.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct GitPath(Arc<[u8]>);

/// A path is empty, rooted, contains NUL, or contains an empty, `.` or `..` component.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GitPathError;

impl fmt::Display for GitPathError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(
            "Git paths must be nonempty and relative, without NUL, empty, '.' or '..' components",
        )
    }
}

impl std::error::Error for GitPathError {}

impl GitPath {
    /// Validate and copy an exact Git path. Only `/` separates components.
    /// One trailing `/` is allowed for Git's ignored-directory status marker and is
    /// preserved in the stored bytes; component views omit that marker.
    pub fn new(bytes: impl AsRef<[u8]>) -> Result<Self, GitPathError> {
        let bytes = bytes.as_ref();

        let components = bytes.strip_suffix(b"/").unwrap_or(bytes);

        if bytes.contains(&0)
            || components
                .split(|byte| *byte == b'/')
                .any(|part| matches!(part, b"" | b"." | b".."))
        {
            return Err(GitPathError);
        }

        Ok(Self(Arc::from(bytes)))
    }

    /// Borrow the original Git bytes, including literal backslashes and non-UTF-8 names.
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    /// Borrow text only when the exact bytes are valid UTF-8.
    pub fn to_str(&self) -> Option<&str> {
        std::str::from_utf8(&self.0).ok()
    }

    /// Format a label without native-path guards or escapes. Only invalid UTF-8 is replaced.
    pub fn display(&self) -> impl fmt::Display + '_ {
        String::from_utf8_lossy(&self.0)
    }

    /// Borrow nonempty components, splitting only at `/`.
    pub fn components(&self) -> impl DoubleEndedIterator<Item = &[u8]> + Clone {
        self.component_bytes().split(|byte| *byte == b'/')
    }

    /// Borrow the final component. Validated paths always have a filename.
    pub fn file_name(&self) -> &[u8] {
        self.components()
            .next_back()
            .expect("validated Git path has a component")
    }

    /// Borrow the parent Git bytes, or `None` for a single-component path.
    pub fn parent(&self) -> Option<&[u8]> {
        self.component_bytes()
            .iter()
            .rposition(|byte| *byte == b'/')
            .map(|end| &self.0[..end])
    }

    fn component_bytes(&self) -> &[u8] {
        self.0.strip_suffix(b"/").unwrap_or(&self.0)
    }

    pub(crate) fn to_native(&self) -> io::Result<PathBuf> {
        crate::platform::native_path_from_git_bytes(self.as_bytes())
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))
    }

    pub(crate) fn pathspec_bytes(&self) -> io::Result<&[u8]> {
        crate::platform::git_pathspec(self.as_bytes())
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))
    }

    pub(crate) fn to_argument(&self) -> io::Result<OsString> {
        crate::platform::git_argument(self.pathspec_bytes()?)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))
    }
}

pub(crate) fn pathspec_list(paths: &[GitPath]) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();

    for path in paths {
        bytes.extend_from_slice(path.pathspec_bytes()?);
        bytes.push(0);
    }

    Ok(bytes)
}

impl TryFrom<&str> for GitPath {
    type Error = GitPathError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeSet, HashSet};

    #[test]
    fn constructor_rejects_invalid_git_components_without_native_path_rules() {
        for bytes in [
            b"".as_slice(),
            b"/file",
            b"a//b",
            b"a/./b",
            b"a/../b",
            b".",
            b"..",
            b"a//",
            b"a\0b",
        ] {
            assert_eq!(GitPath::new(bytes), Err(GitPathError));
        }

        for name in [
            "folder\\file",
            "a:b",
            "c:/file",
            "aux.c",
            "été.txt",
            "folder/",
        ] {
            assert_eq!(GitPath::try_from(name).unwrap().as_bytes(), name.as_bytes());
        }
    }

    #[test]
    fn equality_ordering_and_hashing_use_exact_bytes() {
        let literal = GitPath::new(b"folder\\file").unwrap();
        let separated = GitPath::new(b"folder/file").unwrap();

        assert_ne!(literal, separated);
        assert_eq!(
            HashSet::from([literal.clone(), separated.clone(), literal.clone()]).len(),
            2
        );
        assert_eq!(
            BTreeSet::from([literal.clone(), separated.clone()])
                .into_iter()
                .collect::<Vec<_>>(),
            vec![separated.clone(), literal.clone()]
        );
        assert_eq!(literal, GitPath::new(b"folder\\file").unwrap());
    }

    #[test]
    fn labels_show_valid_names_literally_and_only_invalid_utf8_is_lossy() {
        for name in [
            "folder\\file",
            "a:b",
            "aux.c",
            "folder/été",
            "private\u{e000}name",
        ] {
            let path = GitPath::new(name).unwrap();

            assert_eq!(path.display().to_string(), name);
            assert_eq!(path.to_str(), Some(name));
        }

        let path = GitPath::new(b"non-utf8-\xff").unwrap();

        assert_eq!(path.as_bytes(), b"non-utf8-\xff");
        assert_eq!(path.to_str(), None);
        assert_eq!(path.display().to_string(), "non-utf8-�");
    }

    #[test]
    fn component_filename_and_parent_views_split_only_on_git_separators() {
        let path = GitPath::new(b"folder/sub\\name/a:b").unwrap();

        assert_eq!(
            path.components().collect::<Vec<_>>(),
            vec![b"folder".as_slice(), b"sub\\name", b"a:b"]
        );
        assert_eq!(path.file_name(), b"a:b");
        assert_eq!(path.parent(), Some(b"folder/sub\\name".as_slice()));
        let leaf = GitPath::new(b"folder\\file").unwrap();

        assert_eq!(leaf.file_name(), b"folder\\file");
        assert_eq!(leaf.parent(), None);
        let directory = GitPath::new(b"folder/sub/").unwrap();

        assert_eq!(directory.as_bytes(), b"folder/sub/");
        assert_eq!(directory.file_name(), b"sub");
        assert_eq!(directory.parent(), Some(b"folder".as_slice()));
        assert_eq!(directory.components().count(), 2);
        assert_ne!(directory, GitPath::new(b"folder/sub").unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn unix_pathspec_arguments_and_nul_lists_keep_literal_names_byte_for_byte() {
        let names = [
            b"folder\\file".as_slice(),
            b"folder/file",
            b"ordinary",
            b"literal*",
            b"non-utf8-\xff",
        ];

        let paths: Vec<_> = names
            .iter()
            .map(|name| GitPath::new(name).unwrap())
            .collect();

        for (path, name) in paths.iter().zip(names) {
            assert_eq!(path.to_argument().unwrap().as_encoded_bytes(), name);
            assert_eq!(path.pathspec_bytes().unwrap(), name);
        }

        assert_eq!(
            pathspec_list(&paths).unwrap(),
            b"folder\\file\0folder/file\0ordinary\0literal*\0non-utf8-\xff\0"
        );
    }

    #[cfg(windows)]
    #[test]
    fn argv_and_nul_lists_refuse_backslashes_with_the_same_typed_error() {
        let path = GitPath::new(b"folder\\file").unwrap();

        for error in [
            path.to_argument().unwrap_err(),
            pathspec_list(&[path]).unwrap_err(),
        ] {
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
            assert!(
                error
                    .get_ref()
                    .is_some_and(|cause| cause.is::<crate::platform::PathEncodingError>())
            );
            assert!(
                error
                    .to_string()
                    .contains("Git for Windows cannot address this file name")
            );
        }

        let path = GitPath::new(b"folder/file").unwrap();

        assert_eq!(path.to_argument().unwrap(), OsString::from("folder/file"));
        assert_eq!(pathspec_list(&[path]).unwrap(), b"folder/file\0");
    }

    #[cfg(windows)]
    #[test]
    fn native_conversion_refuses_unrepresentable_names_with_the_typed_error() {
        for name in ["folder\\file", "a:b", "aux.c"] {
            let error = GitPath::new(name).unwrap().to_native().unwrap_err();

            assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
            assert!(
                error
                    .get_ref()
                    .is_some_and(|cause| cause.is::<crate::platform::PathEncodingError>())
            );
        }

        assert_eq!(
            GitPath::new("folder/file.txt")
                .unwrap()
                .to_native()
                .unwrap(),
            PathBuf::from("folder/file.txt")
        );
        assert!(
            GitPath::new("private\u{e000}name")
                .unwrap()
                .to_native()
                .is_ok()
        );
    }
}
