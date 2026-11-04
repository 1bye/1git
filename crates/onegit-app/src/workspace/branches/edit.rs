//! Local-only branch metadata review reuses the attached picker and window-owned write.
use super::{Phase, Picker};
use onegit_git::{Branch, BranchAction, BranchKind, BranchRequest};
use onegit_ui::{ControlSize, DropdownMenu, MenuItem};
use rake::gpui::{self, Focusable, px};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::workspace) enum Kind {
    Rename,
    Delete,
}

impl Kind {
    pub fn title(self) -> &'static str {
        match self {
            Self::Rename => "Rename branch",
            Self::Delete => "Delete branch?",
        }
    }

    pub fn confirm(self) -> &'static str {
        match self {
            Self::Rename => "Rename branch",
            Self::Delete => "Delete branch",
        }
    }
}

impl Picker {
    pub(super) fn can_edit(&self, branch: &Branch, kind: Kind) -> bool {
        !self.busy
            && !self.operation_blocked()
            && !self.dirty()
            && branch.kind == BranchKind::Local
            && self.data.as_ref().is_some_and(|data| {
                data.branches
                    .iter()
                    .any(|b| b.full_name == branch.full_name && b.oid == branch.oid)
            })
            && match kind {
                Kind::Rename => branch.checked_out || branch.worktree_path.is_none(),
                Kind::Delete => {
                    !branch.checked_out
                        && branch.worktree_path.is_none()
                        && self.source.as_ref().is_some_and(|source| {
                            source.snapshot.status.head.branch.as_ref() != Some(&branch.name)
                        })
                }
            }
    }

    pub(super) fn edit_menu(&self, branch: Branch, cx: &gpui::Context<Self>) -> DropdownMenu {
        let mut menu = DropdownMenu::new(
            format!("branch-actions-{}", branch.full_name),
            format!("Actions for {}", branch.name),
        );

        menu.width = px(200.);
        menu.size = ControlSize::Small;
        menu.entries = vec![
            MenuItem {
                disabled: !self.can_edit(&branch, Kind::Rename),
                ..MenuItem::new("rename", "Rename branch…")
            }
            .into(),
            MenuItem {
                disabled: !self.can_edit(&branch, Kind::Delete),
                ..MenuItem::new("delete", "Delete branch…")
            }
            .into(),
        ];
        let source = self.source.clone();
        let owner = cx.entity().downgrade();

        menu.on_select = Some(Box::new(move |id, window, cx| {
            let kind = if *id == gpui::ElementId::from("rename") {
                Kind::Rename
            } else if *id == gpui::ElementId::from("delete") {
                Kind::Delete
            } else {
                return;
            };

            let _ = owner.update(cx, |this, cx| {
                if source
                    .as_ref()
                    .zip(this.source.as_ref())
                    .is_some_and(|(a, b)| std::sync::Arc::ptr_eq(a, b))
                {
                    this.edit(branch.clone(), kind, window, cx);
                }
            });
        }));

        menu
    }

    fn edit(
        &mut self,
        branch: Branch,
        kind: Kind,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if !self.can_edit(&branch, kind) {
            return;
        }

        self.name
            .update(cx, |input, cx| input.set_text(&branch.name, cx));
        self.phase = Phase::Edit { branch, kind };
        self.error = None;
        window.focus(
            &if kind == Kind::Delete {
                self.cancel_focus.clone()
            } else {
                self.name.read(cx).focus_handle(cx)
            },
            cx,
        );
        cx.notify();
    }

    pub(super) fn edit_request(
        &self,
        branch: &Branch,
        kind: Kind,
        cx: &gpui::App,
    ) -> Option<BranchRequest> {
        if !self.can_edit(branch, kind) {
            return None;
        }

        let source = self.source.as_ref()?;

        let action = match kind {
            Kind::Rename => {
                let new_name = self.name.read(cx).text().trim().to_owned();

                if new_name.is_empty() {
                    return None;
                }

                BranchAction::Rename {
                    name: branch.name.clone(),
                    new_name,
                    expected_target: branch.oid.clone(),
                }
            }
            Kind::Delete => BranchAction::Delete {
                name: branch.name.clone(),
                expected_target: branch.oid.clone(),
            },
        };

        Some(BranchRequest::new(action, &source.snapshot))
    }
}
