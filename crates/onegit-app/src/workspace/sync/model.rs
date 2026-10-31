use super::super::read::{self, Loaded};

use onegit_git::{
    Branch, BranchIdentity, BranchKind, Cancellation, Failure, Operation, Remote, TransferPhase,
    TransferProgress,
};

use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::workspace) enum Action {
    Fetch,
    Pull,
    Push,
    Publish,
}

impl Action {
    pub fn label(self) -> &'static str {
        match self {
            Self::Fetch => "Fetch",
            Self::Pull => "Pull",
            Self::Push => "Push",
            Self::Publish => "Publish branch",
        }
    }

    pub fn pending(self) -> &'static str {
        match self {
            Self::Fetch => "Fetching…",
            Self::Pull => "Pulling…",
            Self::Push => "Pushing…",
            Self::Publish => "Publishing…",
        }
    }

    pub fn operation(self) -> Operation {
        match self {
            Self::Fetch => Operation::Fetch,
            Self::Pull => Operation::Pull,
            _ => Operation::Push,
        }
    }
}

pub(in crate::workspace) struct Review {
    pub loaded: Arc<Loaded>,
    pub branch: Option<Branch>,
    pub remotes: Vec<Remote>,
}

impl Review {
    pub fn identity(&self) -> BranchIdentity {
        BranchIdentity::from_snapshot(&self.loaded.snapshot)
    }

    pub fn upstream(&self) -> Option<(&Remote, &str)> {
        let branch = self.branch.as_ref()?;

        let name = branch
            .upstream_remote
            .as_deref()
            .filter(|name| *name != ".")?;

        let remote = self.remotes.iter().find(|remote| remote.name == name)?;

        Some((remote, branch.upstream_ref.as_deref()?))
    }

    pub fn blocked(&self, action: Action) -> Option<&'static str> {
        if self.remotes.is_empty() {
            return Some(
                "No remotes configured. Add a remote with Git before fetching or publishing.",
            );
        }

        if action == Action::Fetch {
            return None;
        }

        if self.loaded.snapshot.status.head.oid.is_none() || self.branch.is_none() {
            return Some("Choose a committed local branch before synchronizing.");
        }

        if !super::super::write::available(&self.loaded) {
            return Some("Finish the current Git operation and resolve conflicts first.");
        }

        if action == Action::Publish {
            if self
                .branch
                .as_ref()
                .is_some_and(|branch| branch.upstream.is_some() || branch.upstream_remote.is_some())
            {
                return Some("This branch already has an upstream. Use Push for that destination.");
            }
        } else {
            let Some((remote, _)) = self.upstream() else {
                return Some(
                    "This branch has no usable remote upstream. Publish it first, or configure tracking with Git.",
                );
            };

            if action == Action::Push && remote.push_urls.len() != 1 {
                return Some("Configure a single push URL for this remote before pushing.");
            }
        }

        if action == Action::Pull {
            if self
                .loaded
                .snapshot
                .status
                .files
                .iter()
                .any(|file| file.record_type != onegit_git::RecordType::Ignored)
            {
                return Some(
                    "Commit or stash your changes before pulling. Pull never stashes automatically.",
                );
            }

            if self
                .branch
                .as_ref()
                .is_some_and(|branch| branch.ahead > 0 && branch.behind > 0)
            {
                return Some(
                    "Branches have diverged. Review the commits before merging or rebasing; Pull only fast-forwards.",
                );
            }
        }

        None
    }
}

pub(super) fn review(loaded: Arc<Loaded>, cancel: &Cancellation) -> Result<Arc<Review>, String> {
    let repository = &loaded.repository;

    let snapshot = repository
        .snapshot(false, Some(cancel))
        .map_err(|error| failure(Operation::GetSnapshot, &error))?;

    let branches = repository
        .branches(Some(cancel))
        .map_err(|error| failure(Operation::GetBranches, &error))?;

    let remotes = repository
        .remotes(Some(cancel))
        .map_err(|error| failure(Operation::GetRemotes, &error))?;

    let branch = branches.branches.into_iter().find(|branch| {
        branch.kind == BranchKind::Local
            && Some(&branch.name) == snapshot.status.head.branch.as_ref()
    });

    Ok(Arc::new(Review {
        loaded: read::from_snapshot(repository.clone(), snapshot),
        branch,
        remotes,
    }))
}

pub(super) fn failure(operation: Operation, error: &onegit_git::RepositoryError) -> String {
    let failure = Failure::from_repository(operation, error);
    let mut message = failure.message;

    if let Some(detail) = failure.details {
        message.push('\n');
        message.push_str(&detail);
    }

    if failure.code == onegit_git::ErrorCode::AuthenticationRequired {
        message.push_str(
            "\nCheck your Git credential helper or SSH access, then review and retry explicitly.",
        );
    }

    message
}

pub(super) fn progress_label(value: TransferProgress) -> String {
    if value.phase == TransferPhase::Sending && value.percent == Some(100) {
        return "Waiting for remote confirmation…".into();
    }

    let label = match value.phase {
        TransferPhase::Connecting => "Connecting…",
        TransferPhase::Counting => "Counting objects",
        TransferPhase::Compressing => "Compressing objects",
        TransferPhase::Sending => "Sending objects",
        TransferPhase::Receiving => "Receiving objects",
        TransferPhase::Resolving => "Resolving deltas",
        TransferPhase::Confirming => "Waiting for remote confirmation…",
        TransferPhase::Refreshing => "Refreshing repository status…",
    };

    value.percent.map_or_else(
        || label.into(),
        |percent| format!("{label} — {}%", percent.min(100)),
    )
}

#[derive(Clone)]
pub(in crate::workspace) struct Request {
    pub action: Action,
    pub review: Arc<Review>,
    pub remote: Option<Remote>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sending_100_waits_for_git_and_unknown_work_never_fabricates_a_percentage() {
        assert_eq!(
            progress_label(TransferProgress {
                phase: TransferPhase::Sending,
                percent: Some(100)
            }),
            "Waiting for remote confirmation…"
        );
        assert_eq!(
            progress_label(TransferProgress {
                phase: TransferPhase::Connecting,
                percent: None
            }),
            "Connecting…"
        );
        assert_eq!(
            progress_label(TransferProgress {
                phase: TransferPhase::Receiving,
                percent: Some(45)
            }),
            "Receiving objects — 45%"
        );
    }
}
