//! Reviewed historical commit actions shared by Graph and History.
mod form;
#[cfg(test)]
mod tests;
mod worker;

use super::read::Loaded;
pub(super) use form::Form;
use onegit_git::{BranchIdentity, CherryPickCommit, CommitInfo, ReplayCommit};
use onegit_ui::{DropdownMenu, MenuEntry, MenuItem};
use rake::gpui;
use std::{path::PathBuf, sync::Arc};
pub(super) use worker::run;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Kind {
    CherryPick,
    Revert,
}

impl Kind {
    pub fn title(self) -> &'static str {
        match self {
            Self::CherryPick => "Cherry-pick commit",
            Self::Revert => "Revert commit",
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct Open {
    pub kind: Kind,
    pub commit: Arc<CommitInfo>,
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

    fn request(&self) -> ReplayCommit {
        ReplayCommit {
            commit: self.commit.oid.clone(),
            expected: self.expected.clone(),
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct Action {
    pub review: Review,
    pub destination: Option<(String, String)>,
}

impl Action {
    pub fn kind(&self) -> Kind {
        if self.destination.is_some() {
            Kind::CherryPick
        } else {
            Kind::Revert
        }
    }

    fn cherry_pick(&self) -> Option<CherryPickCommit> {
        self.destination
            .as_ref()
            .map(|(branch, oid)| CherryPickCommit {
                review: self.review.request(),
                target_branch: branch.clone(),
                expected_target: oid.clone(),
            })
    }
}

#[derive(Clone)]
pub(super) struct Submit(pub Action);

pub(super) struct Completed {
    pub snapshots: Vec<(PathBuf, Result<Arc<Loaded>, String>)>,
    pub result: Result<(), String>,
    pub started: bool,
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
    blocked: bool,
    owner: gpui::WeakEntity<T>,
) -> DropdownMenu {
    let mut menu = DropdownMenu::new(format!("commit-actions-{}", commit.oid), "Commit actions");
    let merge = commit.parent_oids.len() > 1;

    menu.entries = vec![
        MenuItem::new("copy-sha", "Copy SHA").into(),
        MenuItem::new("copy-message", "Copy Message").into(),
        MenuEntry::Separator,
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
        } else if !blocked && !merge {
            let kind = if *id == gpui::ElementId::from("cherry-pick") {
                Kind::CherryPick
            } else if *id == gpui::ElementId::from("revert") {
                Kind::Revert
            } else {
                return;
            };

            let _ = owner.update(cx, |_, cx| {
                cx.emit(Open {
                    kind,
                    commit: commit.clone(),
                })
            });
        }
    }));

    menu
}
