use super::{DiffDocument, DiffView};
use rake::gpui::{self, px};

pub(super) struct Scroll {
    pub document: DiffDocument,
    pub view: DiffView,
    pub focus: gpui::FocusHandle,
    pub handle: gpui::UniformListScrollHandle,
}

impl Scroll {
    pub fn new(document: DiffDocument, view: DiffView, cx: &mut gpui::Context<Self>) -> Self {
        Self {
            document,
            view,
            focus: cx.focus_handle(),
            handle: gpui::UniformListScrollHandle::new(),
        }
    }

    // Uniform lists do not populate the base handle's child bounds; derive the row from pixels.
    fn top(&self) -> usize {
        let handle = self.handle.0.borrow();

        handle.deferred_scroll_to_item.as_ref().map_or_else(
            || {
                (-f32::from(handle.base_handle.offset().y) / super::rows::HEIGHT)
                    .floor()
                    .max(0.) as usize
            },
            |pending| pending.item_index,
        )
    }

    pub fn configure(&mut self, document: DiffDocument, view: DiffView) {
        if !self.document.same(&document) {
            self.handle
                .0
                .borrow()
                .base_handle
                .set_offset(gpui::point(px(0.), px(0.)));
            self.handle
                .scroll_to_item_strict(0, gpui::ScrollStrategy::Top);
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

            self.handle
                .0
                .borrow()
                .base_handle
                .set_offset(gpui::point(px(0.), px(0.)));
            self.handle
                .scroll_to_item_strict(destination, gpui::ScrollStrategy::Top);
        }

        self.document = document;
        self.view = view;
    }

    pub fn key(
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
        let viewport = self.handle.0.borrow().base_handle.bounds().size.height;
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

        self.handle
            .scroll_to_item_strict(target, gpui::ScrollStrategy::Top);
        window.prevent_default();
        cx.stop_propagation();
        cx.notify();
    }
}
