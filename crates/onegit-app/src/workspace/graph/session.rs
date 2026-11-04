use super::Graph;
use crate::workspace::tabs::session::GraphView;
use onegit_ui::{GraphViewport, SplitState};
use rake::gpui::{self, AppContext, px};

impl Graph {
    pub(in crate::workspace) fn session(&self, cx: &gpui::App) -> GraphView {
        let viewport = self.state.read(cx).viewport();

        let mut details = self
            .pending_details
            .clone()
            .unwrap_or_else(|| self.inspector.read(cx).session(cx));

        if self.pending_details.is_none() {
            details.range = self.selection.saved();
        }

        GraphView {
            visible: false,
            reference: self.reference.clone(),
            query: self.query.read(cx).text().into(),
            kind: self.kind,
            details,
            selected: self.selected.is_some()
                || self
                    .pending_details
                    .as_ref()
                    .is_some_and(|h| h.commit.is_some()),
            rows: self.restoring_rows.max(self.data.len()).min(10_000),
            sidebar: f32::from(self.sidebar.read(cx).preferred_size()) + 1.,
            detail_fraction: self.detail_split.read(cx).fraction().unwrap_or(0.52),
            anchor: viewport.anchor.map(|s| s.to_string()),
            row: viewport.row.min(9999),
            offset: viewport.offset,
            horizontal: viewport.horizontal,
        }
    }

    pub(in crate::workspace) fn restore(
        &mut self,
        saved: &GraphView,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        self.selection = super::super::replay::Selection::restore(&saved.details.range);
        self.reference = saved.reference.clone();
        self.kind = saved.kind;
        self.query
            .update(cx, |query, cx| query.set_text(saved.query.clone(), cx));
        self.restoring_rows = saved.rows;
        self.restoring_anchor = saved.anchor.clone();
        self.sidebar = cx.new(|cx| SplitState::new(px((saved.sidebar - 1.).max(0.)), window, cx));
        self.detail_split =
            cx.new(|cx| SplitState::proportional(saved.detail_fraction, window, cx));
        self.inspector.update(cx, |view, cx| {
            view.restore_preferences(&saved.details, window, cx)
        });

        if saved.selected {
            self.pending_details = Some(saved.details.clone());
        }

        self.state.update(cx, |state, _| {
            state.restore(GraphViewport {
                anchor: saved.anchor.clone().map(Into::into),
                row: saved.row,
                offset: saved.offset,
                horizontal: saved.horizontal,
            })
        });
    }
}
