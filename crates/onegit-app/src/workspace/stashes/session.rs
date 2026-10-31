//! Persist only stash navigation intent, never write requests or confirmation consent.
use super::Stashes;
use crate::workspace::tabs::session::StashView;
use onegit_ui::{DiffView, SplitState};
use rake::gpui::{self, AppContext, px};

impl Stashes {
    pub(in crate::workspace) fn session(&self, cx: &gpui::App) -> StashView {
        let pending = self.restoring.as_ref();

        StashView {
            visible: false,
            selected: self
                .selected
                .clone()
                .or_else(|| pending.and_then(|p| p.selected.clone())),
            file: self
                .file
                .as_ref()
                .map(|file| (file.revision.clone(), file.file.path.as_bytes().to_vec()))
                .or_else(|| pending.and_then(|p| p.file.clone())),
            split_diff: self.view == DiffView::Split,
            sidebar: self.sidebar.read(cx).preferred_size().into(),
            detail_fraction: self.detail_split.read(cx).fraction().unwrap_or(0.5),
        }
    }

    pub(in crate::workspace) fn restore(
        &mut self,
        saved: &StashView,
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
        self.restoring = Some(saved.clone());
    }
}
