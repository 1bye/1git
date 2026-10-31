//! Reviewed conflict previews and explicit resolution/operation decisions.
mod form;
mod read;
#[cfg(test)]
pub(in crate::workspace) mod tests;
mod view;
mod worker;

pub(super) use form::Form;
pub(super) use read::{Preview, preview};
pub(super) use worker::run;

use super::read::Loaded;

use onegit_git::{
    BranchIdentity, ConflictReview, ConflictSide, FinishKind, FinishOperation, OperationState,
    ResolveConflict, Snapshot,
};

use std::{path::PathBuf, sync::Arc};

#[derive(Clone, Debug)]
pub(super) enum Action {
    Resolve {
        request: ResolveConflict,
        review: ConflictReview,
        label: String,
    },
    Finish(FinishOperation),
}

impl Action {
    pub fn title(&self) -> String {
        match self {
            Self::Resolve { label, .. } => format!("Use {label}?"),
            Self::Finish(request) => format!("Abort {}?", operation_name(request.operation)),
        }
    }

    pub fn height(&self) -> f64 {
        if matches!(self, Self::Resolve { .. }) {
            108.
        } else {
            136.
        }
    }

    pub fn confirm(&self) -> String {
        match self {
            Self::Resolve { .. } => "Replace and resolve".into(),
            Self::Finish(request) => format!("Abort {}", operation_name(request.operation)),
        }
    }
}

pub(super) struct Submit(pub Action);

impl rake::gpui::EventEmitter<Submit> for Form {}

impl rake::gpui::EventEmitter<Submit> for super::RepositoryWorkspace {}

#[derive(Clone)]
pub(super) struct Completed {
    pub snapshots: Vec<(PathBuf, Result<Arc<Loaded>, String>)>,
    pub result: Result<(), String>,
}

impl rake::gpui::EventEmitter<Completed> for super::RepositoryWorkspace {}

pub(super) fn finish_request(snapshot: &Snapshot, kind: FinishKind) -> Option<Action> {
    if !matches!(
        snapshot.operation,
        OperationState::Merge | OperationState::Rebase
    ) {
        return None;
    }

    Some(Action::Finish(FinishOperation {
        kind,
        operation: snapshot.operation,
        expected: BranchIdentity::from_snapshot(snapshot),
        token: snapshot
            .operation_token
            .clone()
            .filter(|token| !token.is_empty())?,
    }))
}

pub(super) fn can_continue(snapshot: &Snapshot) -> bool {
    snapshot.status.files.iter().all(|file| {
        file.record_type != onegit_git::RecordType::Unmerged
            && (matches!(
                file.record_type,
                onegit_git::RecordType::Untracked | onegit_git::RecordType::Ignored
            ) || file.worktree_status == onegit_git::FileStatus::Unmodified)
    })
}

pub(super) fn markers(text: &str) -> (usize, bool) {
    let mut starts = 0;
    let mut unresolved = false;

    for line in text.split(['\n', '\r', '\u{2028}', '\u{2029}']) {
        let bytes = line.as_bytes();

        let Some(marker @ (b'<' | b'>' | b'=' | b'|')) = bytes.first() else {
            continue;
        };

        let length = bytes.iter().take_while(|byte| *byte == marker).count();

        // Match the Git writer's conservative marker guard, including custom marker sizes.
        if length >= 3 && (length == bytes.len() || matches!(bytes[length], b' ' | b'\t')) {
            unresolved = true;
            starts += usize::from(*marker == b'<');
        }
    }

    (starts, unresolved)
}

impl Preview {
    pub fn resolve(&self, side: Option<ConflictSide>) -> Action {
        let version = match side {
            Some(ConflictSide::Theirs) => Some(&self.theirs),
            Some(ConflictSide::Ours) => Some(&self.ours),
            None => None,
        };

        Action::Resolve {
            request: ResolveConflict {
                path: self.path.clone(),
                expected: self.expected.clone(),
                content_hash: self.working.content_hash.clone(),
                side,
            },
            review: ConflictReview {
                operation: self.operation,
                operation_token: self.operation_token.clone(),
                side_oid: version.and_then(|source| source.oid.clone()),
            },
            label: version
                .map_or("Working result", |source| source.label.as_str())
                .into(),
        }
    }
}

pub(super) fn operation_name(operation: OperationState) -> &'static str {
    match operation {
        OperationState::Normal => "normal",
        OperationState::Merge => "merge",
        OperationState::Rebase => "rebase",
        OperationState::CherryPick => "cherry-pick",
        OperationState::Revert => "revert",
        OperationState::SquashMerge => "squash merge",
    }
}
