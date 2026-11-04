//! Path changes keep tab identities and navigation; removal retains recoverable unavailable tabs.
use super::{RepositoryState, Workspace, gpui};
use crate::workspace::{branches::worktrees::Change, read::Loaded};
use std::{path::PathBuf, sync::Arc};

impl Workspace {
    pub(super) fn worktree_completed(
        &mut self,
        change: &Change,
        snapshots: &[(PathBuf, Result<Arc<Loaded>, String>)],
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        match change {
            Change::Created(path) => {
                self.home
                    .update(cx, |home, cx| home.remember(path.clone(), cx));
                self.open(path.clone(), window, cx);
            }
            Change::Moved { from, to } => {
                self.monitors.remove(from);
                let loaded = snapshots
                    .iter()
                    .find(|(path, _)| path == to)
                    .map(|(_, loaded)| loaded);

                for tab in self.matching(from, cx) {
                    tab.update(cx,|tab,cx|{
                        tab.load_job=None;tab.diff_job=None;

                        if let Some(Ok(source))=loaded{
                            tab.history.update(cx,|history,cx|history.retarget(source.clone(),cx));
                            tab.graph.update(cx,|graph,cx|graph.retarget(source.clone(),cx));
                            tab.stashes.update(cx,|stashes,cx|stashes.retarget(source.clone(),cx));
                            tab.state=RepositoryState::Ready(source.clone());
                            tab.apply_automatic(source.clone(),cx);
                        }else{
                            tab.state=RepositoryState::Failed{path:to.clone(),error:"The worktree moved, but could not be refreshed. Your draft and navigation were retained. Retry after checking the destination.".into()};
                        }

                        cx.notify();
                    });
                }

                self.home
                    .update(cx, |home, cx| home.worktree_moved(from, to, cx));
            }
            Change::Removed(path) => {
                self.monitors.remove(path);

                for tab in self.matching(path, cx) {
                    tab.update(cx,|tab,cx|{
                        tab.load_job=None;tab.diff_job=None;
                        tab.state=RepositoryState::Failed{path:path.clone(),error:"This worktree was removed. Your commit draft and selections are retained in this tab and saved session. Open another checkout or restore this folder before retrying.".into()};
                        cx.notify();
                    });
                }
            }
        }

        self.reconcile(cx);
        self.session_changed(cx);
        cx.notify();
    }
}
