//! Session projection and exact immutable history selection recovery.
use super::{DetailState, Details, HistoryWorkspace, spawn_read};
use crate::workspace::PreviewState;
use crate::workspace::tabs::session::History;
use onegit_git::{CommitInfo, GitPath};
use onegit_ui::{DiffView, SplitState};
use rake::gpui::{self, AppContext, px};
use std::sync::Arc;

impl HistoryWorkspace {
    pub(in crate::workspace) fn session(&self, cx: &gpui::App) -> History {
        History {
            commit: self.selected.as_ref().map(ToString::to_string),
            file: self
                .file
                .as_ref()
                .or(self.restoring_file.as_ref())
                .map(|path| path.as_bytes().to_vec()),
            rows: self
                .restore_rows
                .unwrap_or(self.data.items().len())
                .min(10_000),
            split_diff: self.view == DiffView::Split,
            sidebar: self.sidebar.read(cx).preferred_size().into(),
            detail_fraction: self.detail_split.read(cx).fraction().unwrap_or(0.5),
        }
    }

    pub(in crate::workspace) fn session_splits(
        &self,
    ) -> (gpui::Entity<SplitState>, gpui::Entity<SplitState>) {
        (self.sidebar.clone(), self.detail_split.clone())
    }

    pub(in crate::workspace) fn restore_preferences(
        &mut self,
        saved: &History,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        self.view = if saved.split_diff {
            DiffView::Split
        } else {
            DiffView::Unified
        };
        self.sidebar = cx.new(|cx| SplitState::new(px(saved.sidebar), window, cx));
        self.detail_split =
            cx.new(|cx| SplitState::proportional(saved.detail_fraction, window, cx));
    }

    pub(in crate::workspace) fn restore_selection(
        &mut self,
        saved: &History,
        cx: &mut gpui::Context<Self>,
    ) {
        self.restore_rows = Some(saved.rows);

        if let Some(oid) = &saved.commit {
            let file = saved.file.as_ref().and_then(|path| GitPath::new(path).ok());

            self.load_commit(oid.clone().into(), None, file, cx);
        }
    }

    pub(super) fn load_commit(
        &mut self,
        oid: gpui::SharedString,
        commit: Option<Arc<CommitInfo>>,
        preferred: Option<GitPath>,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(source) = &self.source else {
            return;
        };

        let repository = source.repository.clone();

        self.detail_job = None;
        self.patch_job = None;
        self.selected = Some(oid.clone());
        self.detail = DetailState::Loading;
        self.file = None;
        self.restoring_file = preferred;
        self.preview = PreviewState::Empty;
        self.files_scroll
            .0
            .borrow()
            .base_handle
            .set_offset(gpui::point(px(0.), px(0.)));
        self.detail_job = Some(spawn_read(
            cx,
            move |cancel| {
                let commit = match commit {
                    Some(commit) => commit,
                    None => Arc::new(
                        repository
                            .commit(&oid, Some(&cancel))
                            .map_err(super::super::read::message)?,
                    ),
                };

                let files = repository
                    .commit_files(&commit.oid, Some(&cancel))
                    .map_err(super::super::read::message)?;

                Ok(Arc::new(Details { commit, files }))
            },
            |this, result, cx| {
                this.detail_job = None;

                match result {
                    Ok(details) => {
                        let path = this
                            .restoring_file
                            .take()
                            .filter(|path| details.files.iter().any(|file| &file.path == path))
                            .or_else(|| details.files.first().map(|file| file.path.clone()));

                        this.commits
                            .insert(details.commit.oid.clone().into(), details.commit.clone());
                        this.detail = DetailState::Ready(details);

                        if let Some(path) = path {
                            this.select_file(path, cx);
                        }
                    }
                    Err(error) => {
                        this.detail = DetailState::Failed(format!(
                            "Could not restore or read this commit: {error}"
                        ))
                    }
                }

                cx.notify();
            },
        ));
        cx.notify();
    }
}

#[cfg(all(test, feature = "test-support"))]
impl HistoryWorkspace {
    pub(in crate::workspace) fn session_preview_ready(&self) -> bool {
        matches!(self.preview, PreviewState::Ready(_))
    }
}
