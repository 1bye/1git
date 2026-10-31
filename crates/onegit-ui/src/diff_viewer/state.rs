use super::{DiffDocument, DiffView};
use rake::gpui::{self, px};

/// Retained scroll and focus state for a viewer that can leave the render tree.
pub struct Scroll {
    pub(super) document: DiffDocument,
    pub(super) view: DiffView,
    pub(super) focus: gpui::FocusHandle,
    pub(super) handle: gpui::ListState,
    pub(super) horizontal: gpui::ScrollHandle,
}

impl Scroll {
    /// Create state for a parsed document and presentation.
    pub fn new(document: DiffDocument, view: DiffView, cx: &mut gpui::Context<Self>) -> Self {
        Self {
            document: document.clone(),
            view,
            focus: cx.focus_handle(),
            handle: gpui::ListState::new(
                document.rows(view).len(),
                gpui::ListAlignment::Top,
                px(100.),
            ),
            horizontal: gpui::ScrollHandle::new(),
        }
    }

    /// Replace a refreshed version of the same file while retaining the viewport.
    pub fn refresh(&mut self, document: DiffDocument, view: DiffView) {
        let offset = self.handle.logical_scroll_top();
        let horizontal = self.horizontal.offset();

        self.configure(document, view);
        self.handle.scroll_to(gpui::ListOffset {
            item_ix: offset
                .item_ix
                .min(self.document.rows(view).len().saturating_sub(1)),
            offset_in_item: offset.offset_in_item,
        });
        self.horizontal.set_offset(horizontal);
    }

    fn top(&self) -> usize {
        self.handle.logical_scroll_top().item_ix
    }

    pub(super) fn configure(&mut self, document: DiffDocument, view: DiffView) {
        if !self.document.same(&document) {
            self.handle.reset(document.rows(view).len());
            self.horizontal.set_offset(gpui::point(px(0.), px(0.)));
        } else if self.view != view {
            let current = self.top();

            let anchor = self
                .document
                .rows(self.view)
                .get(current)
                .map(|row| row.anchor());

            let destination = anchor
                .and_then(|index| {
                    document
                        .rows(view)
                        .iter()
                        .position(|row| row.contains(index))
                })
                .unwrap_or(0);

            self.handle.reset(document.rows(view).len());
            self.handle.scroll_to(gpui::ListOffset {
                item_ix: destination,
                offset_in_item: px(0.),
            });
        }

        self.document = document;
        self.view = view;
    }

    pub(super) fn key(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if event.keystroke.modifiers.modified() {
            return;
        }

        let count = self.document.rows(self.view).len();

        if count == 0 {
            return;
        }

        let current = self.top();
        let viewport = self.handle.viewport_bounds().size.height;
        let page = (f32::from(viewport) / super::rows::HEIGHT).floor().max(1.) as usize;

        let target = match event.keystroke.key.as_str() {
            "up" => current.saturating_sub(1),
            "down" => current.saturating_add(1),
            "pageup" => current.saturating_sub(page),
            "pagedown" => current.saturating_add(page),
            "home" => 0,
            "end" => count - 1,
            _ => return,
        }
        .min(count - 1);

        self.handle.scroll_to(gpui::ListOffset {
            item_ix: target,
            offset_in_item: px(0.),
        });
        window.prevent_default();
        cx.stop_propagation();
        cx.notify();
    }
}
