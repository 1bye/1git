//! Owner-retained graph focus and exact source-row viewport.
use super::{CommitGraphData, ROW_HEIGHT};
use rake::gpui::{self, px};

/// Portable graph viewport intent; an identity anchors updates that insert earlier commits.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct GraphViewport {
    /// Top visible commit identity, if any.
    pub anchor: Option<gpui::SharedString>,
    /// Fallback row when its identity is unavailable.
    pub row: usize,
    /// Offset within the top row in native pixels.
    pub offset: f32,
    /// Horizontal native scroll offset.
    pub horizontal: f32,
}

/// Retained focus and scroll state for one graph, including inactive repository tabs.
pub struct CommitGraphState {
    pub(super) data: CommitGraphData,
    pub(super) cursor: Option<gpui::SharedString>,
    selected: Option<gpui::SharedString>,
    pub(super) focus: gpui::FocusHandle,
    pub(super) list: gpui::ListState,
    pub(super) horizontal: gpui::ScrollHandle,
    pending: Option<GraphViewport>,
    pub(super) measured: gpui::Size<gpui::Pixels>,
    pub(super) measured_horizontal: gpui::Pixels,
    pub(super) drag: Option<super::scrollbar::Drag>,
}

/// Native viewport change, used for bounded pagination and session persistence.
pub struct CommitGraphScroll {
    /// Whether the visible range is near the last loaded node.
    pub near_end: bool,
}

impl gpui::EventEmitter<CommitGraphScroll> for CommitGraphState {}

impl gpui::Focusable for CommitGraphState {
    fn focus_handle(&self, _: &gpui::App) -> gpui::FocusHandle {
        self.focus.clone()
    }
}

impl CommitGraphState {
    /// Create an empty graph viewport.
    pub fn new(cx: &mut gpui::Context<Self>) -> Self {
        let list = gpui::ListState::new(0, gpui::ListAlignment::Top, px(100.));

        list.set_scroll_handler(cx.listener(|_, event: &gpui::ListScrollEvent, _, cx| {
            cx.emit(CommitGraphScroll {
                near_end: event.visible_range.end.saturating_add(10) >= event.count,
            });
            cx.notify();
        }));

        Self {
            data: CommitGraphData::default(),
            cursor: None,
            selected: None,
            focus: cx.focus_handle(),
            list,
            horizontal: gpui::ScrollHandle::new(),
            pending: None,
            measured: Default::default(),
            measured_horizontal: px(0.),
            drag: None,
        }
    }

    /// Capture the current commit anchor and both scroll axes.
    #[must_use]
    pub fn viewport(&self) -> GraphViewport {
        if let Some(pending) = &self.pending {
            return pending.clone();
        }

        let top = self.list.logical_scroll_top();

        GraphViewport {
            anchor: self
                .data
                .commits()
                .get(top.item_ix)
                .map(|c| c.item.id.clone()),
            row: top.item_ix,
            offset: top.offset_in_item.into(),
            horizontal: self.horizontal.offset().x.into(),
        }
    }

    /// Restore after data arrives. Missing anchors wait for subsequent pages.
    pub fn restore(&mut self, mut viewport: GraphViewport) {
        viewport.offset = if viewport.offset.is_finite() {
            viewport.offset.clamp(0., ROW_HEIGHT)
        } else {
            0.
        };
        viewport.horizontal = if viewport.horizontal.is_finite() {
            viewport.horizontal.min(0.)
        } else {
            0.
        };
        self.pending = Some(viewport);
    }

    /// Finish bounded restoration, falling back to the saved row if the commit disappeared.
    pub fn finish_restore(&mut self, data: &CommitGraphData) {
        if let Some(saved) = &mut self.pending
            && saved
                .anchor
                .as_ref()
                .is_some_and(|id| data.position(id).is_none())
        {
            saved.anchor = None;
        }
    }

    /// Start a different reference scope at its beginning.
    pub fn reset(&mut self) {
        self.end_scroll_drag();
        self.pending = None;
        self.cursor = None;
        self.selected = None;
        self.list.scroll_to(gpui::ListOffset::default());
        self.horizontal.set_offset(gpui::point(px(0.), px(0.)));
    }

    pub(super) fn configure(
        &mut self,
        data: CommitGraphData,
        selected: Option<gpui::SharedString>,
    ) {
        let changed = !self.data.same(&data);
        let selection_changed = self.selected != selected;
        let viewport = self.viewport();

        if changed {
            self.list.reset(data.len());
            let row = viewport
                .anchor
                .as_ref()
                .and_then(|id| data.position(id))
                .unwrap_or(viewport.row.min(data.len().saturating_sub(1)));

            self.list.scroll_to(gpui::ListOffset {
                item_ix: row,
                offset_in_item: px(viewport.offset),
            });
        }

        if self.pending.as_ref().is_some_and(|v| {
            v.anchor
                .as_ref()
                .is_none_or(|id| data.position(id).is_some())
        }) && !data.is_empty()
        {
            let saved = self.pending.take().expect("pending viewport");

            let row = saved
                .anchor
                .as_ref()
                .and_then(|id| data.position(id))
                .unwrap_or(saved.row.min(data.len() - 1));

            self.list.scroll_to(gpui::ListOffset {
                item_ix: row,
                offset_in_item: px(saved.offset),
            });
            self.horizontal
                .set_offset(gpui::point(px(saved.horizontal), px(0.)));
        }

        if selection_changed
            && let Some(id) = &selected
            && let Some(index) = data.position(id)
        {
            self.cursor = Some(id.clone());

            if !changed {
                self.reveal(index);
            }
        }

        if self
            .cursor
            .as_ref()
            .is_some_and(|id| data.position(id).is_none())
        {
            self.cursor = None;
        }

        self.data = data;
        self.selected = selected;
    }

    fn reveal(&self, index: usize) {
        // ListState has not measured distant virtual rows. Use the fixed source
        // geometry rather than treating those rows as zero-height.
        let top = self.list.logical_scroll_top();
        let current = top.item_ix as f32 * ROW_HEIGHT + f32::from(top.offset_in_item);
        let height = f32::from(self.list.viewport_bounds().size.height);
        let start = index as f32 * ROW_HEIGHT;

        let destination = if start < current {
            start
        } else if start + ROW_HEIGHT > current + height {
            (start + ROW_HEIGHT - height).max(0.)
        } else {
            return;
        };

        self.list.scroll_to(gpui::ListOffset {
            item_ix: (destination / ROW_HEIGHT).floor() as usize,
            offset_in_item: px(destination % ROW_HEIGHT),
        });
    }

    pub(super) fn key(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> Option<gpui::SharedString> {
        let mut modifiers = event.keystroke.modifiers;

        modifiers.shift = false;

        if modifiers.modified() || self.data.is_empty() {
            return None;
        }

        let current = self.cursor.as_ref().and_then(|id| self.data.position(id));

        let page = (f32::from(self.list.viewport_bounds().size.height) / ROW_HEIGHT)
            .floor()
            .max(1.) as usize;

        let at = current.unwrap_or(0);

        let target = match event.keystroke.key.as_str() {
            "up" => at.saturating_sub(1),
            "down" => current.map_or(0, |i| (i + 1).min(self.data.len() - 1)),
            "home" => 0,
            "end" => self.data.len() - 1,
            "pageup" => at.saturating_sub(page),
            "pagedown" => (at + page).min(self.data.len() - 1),
            "enter" | "space" => at,
            _ => return None,
        };

        let id = self.data.commits()[target].item.id.clone();

        self.cursor = Some(id.clone());
        self.reveal(target);
        window.prevent_default();
        cx.stop_propagation();
        cx.notify();

        Some(id)
    }
}
