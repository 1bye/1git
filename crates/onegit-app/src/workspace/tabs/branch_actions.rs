//! Branch results update every tab for the exact worktree without disposing its retained state.
use super::{RepositoryState, Workspace, gpui};
use crate::workspace::{branches, write};

impl Workspace {
    pub(super) fn open_branches(
        &mut self,
        origin: Option<gpui::Point<gpui::Pixels>>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(tab) = self
            .active
            .and_then(|id| self.tabs.iter().find(|tab| tab.id == id))
        else {
            return;
        };

        let RepositoryState::Ready(source) = &tab.workspace.read(cx).state else {
            return;
        };

        if self.busy(&source.snapshot.repository.root, cx) || tab.workspace.read(cx).refresh_blocked
        {
            return;
        }

        let id = tab.id;
        let source = source.clone();

        self.branches.update(cx, |picker, cx| {
            picker.open(
                id,
                source,
                origin.unwrap_or_else(|| gpui::point(gpui::px(48.), gpui::px(84.))),
                window,
                cx,
            )
        });
    }

    pub(super) fn submit_branch(
        &mut self,
        event: &branches::Submit,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let target = self
            .tabs
            .iter()
            .find(|tab| tab.id == event.tab)
            .map(|tab| tab.workspace.clone());

        let accepted = if let Some(target) = target {
            let root = match &target.read(cx).state {
                RepositoryState::Ready(source) => Some(source.snapshot.repository.root.clone()),
                _ => None,
            };

            if root.is_some_and(|root| !self.busy(&root, cx)) {
                target.update(cx, |view, cx| {
                    view.start_write(write::Operation::Branch(event.request.clone()), window, cx)
                });

                target.read(cx).write_job.is_some()
            } else {
                false
            }
        } else {
            false
        };

        if !accepted {
            self.branches.update(cx,|picker,cx|picker.finish(Err("The repository is busy or unavailable. Finish the current operation, then reopen Branches.".into()),None,window,cx));
        }

        self.reconcile(cx);
        cx.notify();
    }

    pub(super) fn branch_completed(
        &mut self,
        id: u64,
        event: &branches::Completed,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        match &event.loaded {
            Ok(loaded) => {
                let origin = self
                    .tabs
                    .iter()
                    .find(|tab| tab.id == id)
                    .map(|tab| tab.workspace.entity_id());

                for tab in self.matching(&event.root, cx) {
                    if Some(tab.entity_id()) == origin {
                        continue;
                    }

                    tab.update(cx, |view, cx| {
                        view.load_job = None;

                        if matches!(view.state, RepositoryState::Ready(_)) {
                            view.apply_automatic(loaded.clone(), cx);
                        } else {
                            view.apply_loaded(loaded.clone(), view.selected.clone(), cx);
                            cx.notify();
                        }
                    });
                }

                self.home
                    .update(cx, |home, cx| home.refresh_overview(&loaded.snapshot, cx));
            }
            Err(error) => {
                self.report(
                    &event.root,
                    &format!("Could not refresh after the branch operation: {error}"),
                    cx,
                );
                self.invalidate(&event.root, cx);
            }
        }

        self.branches.update(cx, |picker, cx| {
            if picker.owns(id) {
                picker.finish(
                    event.result.clone(),
                    event.loaded.as_ref().ok().map(|loaded| loaded.as_ref()),
                    window,
                    cx,
                );
            }
        });
        self.reconcile(cx);
        self.session_changed(cx);
        cx.notify();
    }
}
