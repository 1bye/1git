//! Shared validation for revision arguments and literal repository-relative paths.

use crate::GitPath;

use crate::RepositoryError;

pub(crate) fn require_revision(revision: &str) -> Result<(), RepositoryError> {
    if revision.is_empty() || revision.starts_with('-') || revision.contains('\0') {
        return Err(RepositoryError::InvalidInput(
            "Revision must be non-empty, contain no NUL and not begin with '-'",
        ));
    }

    Ok(())
}

pub(crate) fn require_paths<'a>(
    paths: impl IntoIterator<Item = &'a GitPath>,
) -> Result<(), RepositoryError> {
    let mut any = false;

    for path in paths {
        any = true;
        if path
            .components()
            .any(crate::platform::is_git_directory_component)
        {
            return Err(RepositoryError::InvalidPath);
        }
        path.pathspec_bytes()?;
    }

    if !any {
        return Err(RepositoryError::InvalidInput(
            "At least one repository path is required",
        ));
    }

    Ok(())
}

pub(crate) fn full_oid(oid: &str) -> bool {
    matches!(oid.len(), 40 | 64) && oid.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_directory_guard_is_ascii_case_insensitive_and_shared_with_ignore_patterns() {
        for name in [".git", ".GIT", ".Git/config", "folder/.gIt/hooks/x"] {
            let path = GitPath::new(name).unwrap();
            assert!(matches!(
                require_paths([&path]),
                Err(RepositoryError::InvalidPath)
            ));
            assert!(matches!(
                crate::ignore_pattern(&path, &crate::IgnoreRule::File),
                Err(RepositoryError::InvalidPath)
            ));
        }
        for name in [".gitignore", ".github/x", "foo.git", "folder/.gitkeep"] {
            let path = GitPath::new(name).unwrap();
            require_paths([&path]).unwrap();
            assert!(crate::ignore_pattern(&path, &crate::IgnoreRule::File).is_ok());
        }
    }

    #[test]
    fn ntfs_git_directory_aliases_are_guarded_only_on_windows() {
        for name in [
            ".git.",
            ".git ",
            ".GIT... ",
            ".git::$INDEX_ALLOCATION",
            ".git:stream",
            "GIT~1",
            "folder/git~1. /config",
        ] {
            let path = GitPath::new(name).unwrap();
            assert_eq!(require_paths([&path]).is_err(), cfg!(windows), "{name}");
            assert_eq!(
                crate::ignore_pattern(&path, &crate::IgnoreRule::File).is_err(),
                cfg!(windows),
                "{name}"
            );
        }
    }
}
