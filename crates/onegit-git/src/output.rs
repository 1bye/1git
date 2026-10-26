//! Git output framing and text compatibility, shared by native metadata readers.

use std::path::PathBuf;

use crate::{GitPath, RepositoryError};

/// Match the legacy JavaScript text boundary, retaining complete Unicode characters.
fn whitespace(character: char) -> bool {
    (character.is_whitespace() && character != '\u{85}') || character == '\u{feff}'
}

pub(crate) fn trim_end(text: &str) -> &str {
    text.trim_end_matches(whitespace)
}

pub(crate) fn trim(text: &str) -> &str {
    text.trim_matches(whitespace)
}

/// Fixed NUL-terminated fields permit embedded newlines in a worktree path.
pub(crate) fn rows(mut bytes: &[u8], count: usize) -> Result<Vec<Vec<&[u8]>>, RepositoryError> {
    let mut result = Vec::new();

    while !bytes.is_empty() {
        if let Some(rest) = bytes.strip_prefix(b"\n") {
            bytes = rest;
        }

        if bytes.is_empty() {
            break;
        }

        let mut fields = Vec::with_capacity(count);

        for _ in 0..count {
            let end = bytes
                .iter()
                .position(|byte| *byte == 0)
                .ok_or(RepositoryError::InvalidOutput)?;

            fields.push(&bytes[..end]);
            bytes = &bytes[end + 1..];
        }

        result.push(fields);
    }

    Ok(result)
}

pub(crate) fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

pub(crate) fn path(bytes: &[u8]) -> Result<GitPath, RepositoryError> {
    GitPath::new(bytes).map_err(|_| RepositoryError::InvalidOutput)
}

pub(crate) fn absolute_path(bytes: &[u8]) -> Result<PathBuf, RepositoryError> {
    crate::platform::absolute_path_from_git_bytes(bytes).map_err(|_| RepositoryError::InvalidOutput)
}
