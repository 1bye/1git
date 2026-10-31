//! Saved files keep their immutable revision, including the optional untracked third parent.
use super::super::{
    history,
    read::{self, Preview},
};

use onegit_git::{Cancellation, CommitFile, Repository};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct File {
    pub revision: String,
    pub file: CommitFile,
}

pub(super) fn files(
    repository: &Repository,
    oid: &str,
    cancel: &Cancellation,
) -> Result<Vec<File>, String> {
    let metadata = repository
        .commit(oid, Some(cancel))
        .map_err(read::message)?;

    let mut revisions = vec![oid.to_owned()];

    if let Some(untracked) = metadata.parent_oids.get(2) {
        revisions.push(untracked.clone());
    }

    let mut files = Vec::new();

    for revision in revisions {
        files.extend(
            repository
                .commit_files(&revision, Some(cancel))
                .map_err(read::message)?
                .into_iter()
                .map(|file| File {
                    revision: revision.clone(),
                    file,
                }),
        );
    }

    Ok(files)
}

pub(super) fn patch(
    repository: &Repository,
    file: &File,
    cancel: &Cancellation,
) -> Result<Preview, String> {
    history::read::patch(repository, &file.revision, &file.file, cancel)
}
