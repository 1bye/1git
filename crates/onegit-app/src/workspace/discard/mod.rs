//! Reviewed file discard and short-lived restore; commit drafts never belong to this form.
mod form;
#[cfg(test)]
mod tests;
mod worker;

use super::read::Loaded;
pub(super) use form::Form;

use onegit_git::{
    BranchIdentity, DiscardScope, DiscardUndo, FileStatus, GitPath, RecordType, RecoveryBackup,
    Repository,
};

use std::{path::PathBuf, sync::Arc};
pub(super) use worker::run;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Selection {
    pub source: BranchIdentity,
    pub paths: Vec<GitPath>,
    pub scope: DiscardScope,
    pub label: String,
}

impl Selection {
    pub fn new(source: &Loaded, path: Option<&GitPath>, scope: DiscardScope) -> Option<Self> {
        if !super::write::available(source) {
            return None;
        }

        let entries: Vec<_> = source
            .snapshot
            .status
            .files
            .iter()
            .filter(|file| {
                path.is_none_or(|path| *path == file.path)
                    && match scope {
                        DiscardScope::Tracked => !matches!(
                            file.record_type,
                            RecordType::Untracked | RecordType::Ignored
                        ),
                        DiscardScope::Untracked => file.record_type == RecordType::Untracked,
                    }
            })
            .collect();

        if entries.is_empty()
            || entries.iter().any(|file| {
                file.original_path.is_some()
                    || file.submodule.starts_with('S')
                    || file.record_type == RecordType::Unmerged
                    || file.index_status == FileStatus::TypeChanged
                    || file.worktree_status == FileStatus::TypeChanged
                    || file.path.to_str().is_none()
            })
        {
            return None;
        }

        let label = match path {
            Some(path) => super::read::path_label(path),
            None => format!(
                "all {} {} {}",
                entries.len(),
                if scope == DiscardScope::Tracked {
                    "tracked"
                } else {
                    "untracked"
                },
                if entries.len() == 1 { "file" } else { "files" }
            ),
        };

        Some(Self {
            source: BranchIdentity::from_snapshot(&source.snapshot),
            paths: entries.into_iter().map(|file| file.path.clone()).collect(),
            scope,
            label,
        })
    }
}

#[derive(Clone)]
pub(super) struct Recovery {
    pub repository: Arc<Repository>,
    pub source: BranchIdentity,
    pub undo: DiscardUndo,
    pub backup: RecoveryBackup,
}

impl Recovery {
    pub fn available(&self) -> bool {
        chrono::DateTime::parse_from_rfc3339(&self.undo.expires_at)
            .is_ok_and(|time| time > chrono::Utc::now())
    }
}

#[derive(Clone)]
pub(super) enum Action {
    Discard {
        selection: Selection,
        parent: PathBuf,
    },
    Restore(Recovery),
}

pub(super) struct Submit(pub Action);

pub(super) struct Completed {
    pub snapshots: Vec<(PathBuf, Result<Arc<Loaded>, String>)>,
    pub result: Result<(), String>,
    pub recovery: Option<Recovery>,
    pub restored: Option<String>,
}

impl rake::gpui::EventEmitter<Submit> for Form {}

impl rake::gpui::EventEmitter<Submit> for super::RepositoryWorkspace {}

impl rake::gpui::EventEmitter<Completed> for super::RepositoryWorkspace {}
