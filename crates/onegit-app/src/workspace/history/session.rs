//! Session projection and exact immutable history selection recovery.
use super::{DetailState, Details, HistoryWorkspace, spawn_read};
use crate::workspace::PreviewState;
use crate::workspace::tabs::session::{History, HistorySearch};
use onegit_git::{CommitInfo, GitPath};
use onegit_ui::{DiffView, SplitState};
use rake::gpui::{self, AppContext, px};
use std::sync::Arc;

impl HistoryWorkspace {
    pub(in crate::workspace) fn session(&self, cx: &gpui::App) -> History {
        let mut saved = History {
            search: None,
            range: self.selection.saved(),
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
            tree_layout: self.tree_layout,
            collapsed: {
                let mut paths = self.collapsed.iter().cloned().collect::<Vec<_>>();

                paths.sort();

                paths
            },
            sidebar: f32::from(self.sidebar.read(cx).preferred_size())
                + if self.presentation == super::Presentation::Inspector {
                    1.
                } else {
                    0.
                },
            detail_fraction: self.detail_split.read(cx).fraction().unwrap_or(0.5),
        };

        if let Some(normal) = &self.normal {
            saved.search = Some(HistorySearch {
                query: self.search_query.clone(),
                commit: saved.commit.clone(),
                file: saved.file.clone(),
                rows: saved.rows,
                range: saved.range.clone(),
                split_diff: saved.split_diff,
                tree_layout: saved.tree_layout,
                collapsed: saved.collapsed.clone(),
            });
            saved.commit = normal.selected.as_ref().map(ToString::to_string);
            saved.file = normal
                .file
                .as_ref()
                .or(normal.restoring_file.as_ref())
                .map(|p| p.as_bytes().to_vec());
            saved.range = normal.selection.saved();
            saved.rows = normal
                .restore_rows
                .unwrap_or(normal.data.items().len())
                .min(10_000);
            saved.split_diff = normal.view == DiffView::Split;
            saved.tree_layout = normal.tree_layout;
            saved.collapsed = normal.collapsed.iter().cloned().collect();
            saved.collapsed.sort();
        }

        saved
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
        self.tree_layout = saved.tree_layout;
        self.collapsed = saved.collapsed.iter().cloned().collect();
        self.rebuild_files();
        self.view = if saved.split_diff {
            DiffView::Split
        } else {
            DiffView::Unified
        };
        self.sidebar = cx.new(|cx| {
            SplitState::new(
                px((saved.sidebar
                    - if self.presentation == super::Presentation::Inspector {
                        1.
                    } else {
                        0.
                    })
                .max(0.)),
                window,
                cx,
            )
        });
        self.detail_split =
            cx.new(|cx| SplitState::proportional(saved.detail_fraction, window, cx));
    }

    pub(in crate::workspace) fn restore_selection(
        &mut self,
        saved: &History,
        cx: &mut gpui::Context<Self>,
    ) {
        self.restore_rows = Some(saved.rows);
        self.selection = super::super::replay::Selection::restore(&saved.range);

        if let Some(oid) = &saved.commit {
            let file = saved.file.as_ref().and_then(|path| GitPath::new(path).ok());

            self.load_commit(oid.clone().into(), None, file, cx);
        }

        if self.presentation == super::Presentation::History
            && let Some(search) = &saved.search
        {
            self.set_query(search.query.clone(), cx);
            self.search_open = true;
            self.search_input
                .update(cx, |input, cx| input.set_text(search.query.clone(), cx));
            self.page_job = None;
            self.restore_rows = Some(search.rows);
            self.selection = super::super::replay::Selection::restore(&search.range);
            self.view = if search.split_diff {
                DiffView::Split
            } else {
                DiffView::Unified
            };
            self.tree_layout = search.tree_layout;
            self.collapsed = search.collapsed.iter().cloned().collect();

            if let Some(oid) = &search.commit {
                let file = search.file.as_ref().and_then(|p| GitPath::new(p).ok());

                self.load_commit(oid.clone().into(), None, file, cx);
            }

            self.load_page(cx);
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

        if self.selected.as_ref().is_some_and(|old| old != &oid) {
            self.collapsed.clear();
        }

        self.file_cursor = None;
        self.file_rows = Arc::from([]);
        self.description_expanded = false;
        self.copied = false;
        self.detail_job = None;
        self.patch_job = None;
        self.selected = Some(oid.clone());
        self.update_selected_tags();
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

                let tree = super::files::Tree::new(&files);

                Ok(Arc::new(Details {
                    commit,
                    files,
                    tree,
                }))
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
                        this.rebuild_files();

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
