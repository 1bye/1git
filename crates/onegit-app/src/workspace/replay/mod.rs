//! Reviewed historical commit actions shared by Graph and History.
mod form;
mod rewrite;
mod selection;
#[cfg(test)]
mod selection_tests;
#[cfg(test)]
mod tests;
mod worker;

pub(in crate::workspace) use selection::Selection;

use super::read::Loaded;
pub(super) use form::Form;

use onegit_git::{
    BranchIdentity, Cancellation, CommitInfo, HistoryRange, ReorderCommits, ReplayCommit,
    ResetCommit, SquashCommits,
};

use onegit_ui::{DropdownMenu, MenuEntry, MenuItem};
use rake::gpui;
use std::{path::PathBuf, sync::Arc};
pub(super) use worker::run;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Kind {
    CherryPick,
    Revert,
    Reset,
    Squash,
    Reorder,
}

impl Kind {
    pub fn is_rewrite(self) -> bool {
        matches!(self, Self::Squash | Self::Reorder)
    }

    pub fn title(self) -> &'static str {
        match self {
            Self::CherryPick => "Cherry-pick commit",
            Self::Revert => "Revert commit",
            Self::Reset => "Reset to commit",
            Self::Squash => "Squash commits",
            Self::Reorder => "Reorder commits",
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct Open {
    pub kind: Kind,
    pub commits: Vec<Arc<CommitInfo>>,
}

#[derive(Clone, Debug)]
pub(super) struct Review {
    pub root: PathBuf,
    pub expected: BranchIdentity,
    pub commit: Arc<CommitInfo>,
}

impl Review {
    fn new(source: &Loaded, commit: Arc<CommitInfo>) -> Self {
        Self {
            root: source.snapshot.repository.root.clone(),
            expected: BranchIdentity::from_snapshot(&source.snapshot),
            commit,
        }
    }

    pub fn matches(&self, source: &Loaded) -> bool {
        self.root == source.snapshot.repository.root
            && self.expected == BranchIdentity::from_snapshot(&source.snapshot)
    }

    fn reset_request(&self) -> ResetCommit {
        ResetCommit {
            target: self.commit.oid.clone(),
            expected: self.expected.clone(),
        }
    }

    fn request(&self) -> ReplayCommit {
        ReplayCommit {
            commit: self.commit.oid.clone(),
            expected: self.expected.clone(),
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct RangeReview {
    pub source: Review,
    pub commits: Vec<Arc<CommitInfo>>,
}

impl RangeReview {
    fn request(&self) -> HistoryRange {
        HistoryRange {
            commits: self
                .commits
                .iter()
                .map(|commit| commit.oid.clone())
                .collect(),
            expected: self.source.expected.clone(),
        }
    }

    fn squash(&self, message: String) -> SquashCommits {
        SquashCommits {
            range: self.request(),
            message,
        }
    }

    fn reorder(&self, order: Vec<String>) -> ReorderCommits {
        ReorderCommits {
            range: self.request(),
            order,
        }
    }
}

fn consecutive(commits: &[Arc<CommitInfo>]) -> bool {
    commits.len() >= 2
        && commits.iter().all(|c| c.parent_oids.len() <= 1)
        && commits
            .windows(2)
            .all(|pair| pair[0].parent_oids.first() == Some(&pair[1].oid))
}

#[derive(Clone, Debug)]
pub(super) enum Action {
    CherryPick {
        review: Review,
        destination: (String, String),
    },
    Revert(Review),
    Reset(Review),
    Squash {
        review: RangeReview,
        message: String,
        cancel: Cancellation,
    },
    Reorder {
        review: RangeReview,
        order: Vec<String>,
        cancel: Cancellation,
    },
}

impl Action {
    pub fn review(&self) -> &Review {
        match self {
            Self::CherryPick { review, .. } | Self::Revert(review) | Self::Reset(review) => review,
            Self::Squash { review, .. } | Self::Reorder { review, .. } => &review.source,
        }
    }

    pub fn kind(&self) -> Kind {
        match self {
            Self::CherryPick { .. } => Kind::CherryPick,
            Self::Revert(_) => Kind::Revert,
            Self::Reset(_) => Kind::Reset,
            Self::Squash { .. } => Kind::Squash,
            Self::Reorder { .. } => Kind::Reorder,
        }
    }
}

#[derive(Clone)]
pub(super) struct Submit(pub Action);

pub(super) struct Completed {
    pub snapshots: Vec<(PathBuf, Result<Arc<Loaded>, String>)>,
    pub result: Result<(), String>,
    pub started: bool,
    pub kind: Kind,
    pub needs_review: bool,
}

impl gpui::EventEmitter<Open> for super::history::HistoryWorkspace {}

impl gpui::EventEmitter<Open> for super::graph::Graph {}

impl gpui::EventEmitter<Submit> for Form {}

impl gpui::EventEmitter<Submit> for super::RepositoryWorkspace {}

impl gpui::EventEmitter<Completed> for super::RepositoryWorkspace {}

pub(super) fn unavailable(source: &Loaded) -> Option<&'static str> {
    if source.snapshot.status.head.is_detached()
        || source.snapshot.status.head.oid.is_none()
        || source.snapshot.status.head.branch.is_none()
    {
        Some("Choose a branch with at least one commit.")
    } else if !super::write::available(source) || !source.snapshot.status.files.is_empty() {
        Some("Commit or stash your changes and finish the current Git operation first.")
    } else {
        None
    }
}

pub(super) fn menu<T: gpui::EventEmitter<Open> + 'static>(
    commit: Arc<CommitInfo>,
    selected: Vec<Arc<CommitInfo>>,
    blocked: bool,
    head: Option<&str>,
    owner: gpui::WeakEntity<T>,
) -> DropdownMenu {
    let mut menu = DropdownMenu::new(format!("commit-actions-{}", commit.oid), "Commit actions");
    let merge = commit.parent_oids.len() > 1;

    let range = if selected.iter().any(|c| c.oid == commit.oid) {
        selected
    } else {
        vec![commit.clone()]
    };

    let rewrite_blocked = blocked || !consecutive(&range);
    let reset_blocked = blocked || head == Some(commit.oid.as_str());

    menu.entries = vec![
        MenuItem::new("copy-sha", "Copy SHA").into(),
        MenuItem::new("copy-message", "Copy Message").into(),
        MenuEntry::Separator,
        MenuItem {
            disabled: rewrite_blocked,
            ..MenuItem::new("squash", "Squash selected commits…")
        }
        .into(),
        MenuItem {
            disabled: rewrite_blocked,
            ..MenuItem::new("reorder", "Reorder selected commits…")
        }
        .into(),
        MenuItem {
            disabled: reset_blocked,
            ..MenuItem::new("reset", "Reset to commit…")
        }
        .into(),
        MenuItem {
            disabled: blocked || merge,
            ..MenuItem::new("cherry-pick", "Cherry-pick commit…")
        }
        .into(),
        MenuItem {
            disabled: blocked || merge,
            ..MenuItem::new("revert", "Revert commit…")
        }
        .into(),
    ];

    if merge {
        menu.entries.push(
            MenuItem {
                disabled: true,
                ..MenuItem::new("merge-help", "Merge commits require an external Git tool.")
            }
            .into(),
        );
    }

    menu.on_select = Some(Box::new(move |id, _, cx| {
        if *id == gpui::ElementId::from("copy-sha") {
            cx.write_to_clipboard(gpui::ClipboardItem::new_string(commit.oid.clone()));
        } else if *id == gpui::ElementId::from("copy-message") {
            cx.write_to_clipboard(gpui::ClipboardItem::new_string(if commit.body.is_empty() {
                commit.summary.clone()
            } else {
                commit.body.clone()
            }));
        } else if !blocked {
            let kind = if *id == gpui::ElementId::from("squash") && !rewrite_blocked {
                Kind::Squash
            } else if *id == gpui::ElementId::from("reorder") && !rewrite_blocked {
                Kind::Reorder
            } else if *id == gpui::ElementId::from("reset") && !reset_blocked {
                Kind::Reset
            } else if *id == gpui::ElementId::from("cherry-pick") && !merge {
                Kind::CherryPick
            } else if *id == gpui::ElementId::from("revert") && !merge {
                Kind::Revert
            } else {
                return;
            };

            let _ = owner.update(cx, |_, cx| {
                cx.emit(Open {
                    kind,
                    commits: if kind.is_rewrite() {
                        range.clone()
                    } else {
                        vec![commit.clone()]
                    },
                })
            });
        }
    }));

    menu
}
