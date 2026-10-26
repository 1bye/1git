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
        if path.components().any(|part| part == b".git") {
            return Err(RepositoryError::InvalidPath);
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
