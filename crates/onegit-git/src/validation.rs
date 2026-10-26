//! Shared validation for revision arguments and literal repository-relative paths.

use std::os::unix::ffi::OsStrExt;
use std::path::{Component, Path};

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
    paths: impl IntoIterator<Item = &'a Path>,
) -> Result<(), RepositoryError> {
    let mut any = false;

    for path in paths {
        any = true;

        if path.as_os_str().is_empty() || path.as_os_str().as_bytes().contains(&0) {
            return Err(RepositoryError::InvalidPath);
        }

        let mut depth = 0;

        if path.is_absolute() {
            return Err(RepositoryError::PathOutsideRepository);
        }

        for component in path.components() {
            match component {
                Component::ParentDir if depth == 0 => {
                    return Err(RepositoryError::PathOutsideRepository);
                }
                Component::ParentDir => depth -= 1,
                Component::Normal(_) => depth += 1,
                Component::CurDir => {}
                Component::RootDir | Component::Prefix(_) => {
                    return Err(RepositoryError::PathOutsideRepository);
                }
            }
        }
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
