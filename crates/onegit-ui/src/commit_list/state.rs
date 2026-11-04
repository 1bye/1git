use super::{CommitListData, CommitListDensity};
use rake::gpui::{self, px};

/// Owner-retained focus and viewport for a commit list in a tabbed workspace.
pub struct ListFocus {
    pub(super) data: CommitListData,
    pub(super) cursor: Option<gpui::SharedString>,
    selected: Option<gpui::SharedString>,
    density: CommitListDensity,
    pub(super) focus: gpui::FocusHandle,
    pub(super) scroll: gpui::UniformListScrollHandle,
}

impl ListFocus {
    /// Create an empty list viewport; rendering reconciles its data and selection.
    pub fn new(cx: &mut gpui::Context<Self>) -> Self {
        Self {
            data: CommitListData::default(),
            cursor: None,
            selected: None,
            density: CommitListDensity::default(),
            focus: cx.focus_handle(),
            scroll: gpui::UniformListScrollHandle::new(),
        }
    }

    pub(super) fn reconcile(
        &mut self,
        data: CommitListData,
        selected: Option<gpui::SharedString>,
        density: CommitListDensity,
    ) {
        let changed = !self.data.same(&data);
        let selection_changed = self.selected != selected;
        let old_cursor = self.cursor.as_ref().and_then(|id| self.data.position(id));

        let old_pixels = -f32::from(self.scroll.0.borrow().base_handle.offset().y);
        let old_top = (old_pixels / self.density.height()).floor().max(0.) as usize;

        let anchor = self
            .data
            .items()
            .get(old_top)
            .and_then(|item| data.position(&item.id));

        let selected_index = selected.as_ref().and_then(|id| data.position(id));
        let retained = self.cursor.as_ref().and_then(|id| data.position(id));

        let cursor = if selection_changed && selected_index.is_some() {
            selected_index
        } else {
            retained.or(selected_index).or_else(|| {
                (!data.items().is_empty())
                    .then(|| old_cursor.unwrap_or(0).min(data.items().len() - 1))
            })
        };

        self.cursor = cursor.map(|index| data.items()[index].id.clone());

        if changed || density != self.density {
            self.scroll
                .0
                .borrow()
                .base_handle
                .set_offset(gpui::point(px(0.), px(0.)));
            let target = if selection_changed {
                selected_index.or(anchor)
            } else {
                anchor
            }
            .unwrap_or(old_top.min(data.items().len().saturating_sub(1)));

            if !selection_changed && !self.data.items().is_empty() {
                // Retain the partial row as well as its immutable commit anchor.
                let remainder = (old_pixels - old_top as f32 * self.density.height()).max(0.);
                let mut scroll = self.scroll.0.borrow_mut();

                scroll.deferred_scroll_to_item = None;
                scroll.base_handle.set_offset(gpui::point(
                    px(0.),
                    px(-(target as f32 * density.height() + remainder)),
                ));
            } else {
                self.scroll
                    .scroll_to_item_strict(target, gpui::ScrollStrategy::Top);
            }
        } else if selection_changed && let Some(index) = selected_index {
            self.scroll
                .scroll_to_item(index, gpui::ScrollStrategy::Nearest);
        }

        self.data = data;
        self.selected = selected;
        self.density = density;
    }

    pub(super) fn choose(&mut self, id: &gpui::SharedString, cx: &mut gpui::Context<Self>) {
        if let Some(index) = self.data.position(id) {
            self.cursor = Some(id.clone());
            self.scroll
                .scroll_to_item(index, gpui::ScrollStrategy::Nearest);
            cx.notify();
        }
    }

    pub(super) fn key(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> Option<gpui::SharedString> {
        if event.keystroke.modifiers.modified() || self.data.items().is_empty() {
            return None;
        }

        let count = self.data.items().len();

        let current = self
            .cursor
            .as_ref()
            .and_then(|id| self.data.position(id))
            .unwrap_or(0);

        let viewport = self.scroll.0.borrow().base_handle.bounds().size.height;

        let page = (f32::from(viewport) / self.density.height())
            .floor()
            .max(1.) as usize;

        let next = match event.keystroke.key.as_str() {
            "up" => current.saturating_sub(1),
            "down" => current.saturating_add(1).min(count - 1),
            "home" => 0,
            "end" => count - 1,
            "pageup" => current.saturating_sub(page),
            "pagedown" => current.saturating_add(page).min(count - 1),
            "enter" | "space" if !event.is_held => current,
            _ => return None,
        };

        let id = self.data.items()[next].id.clone();

        self.choose(&id, cx);
        window.prevent_default();
        cx.stop_propagation();

        Some(id)
    }
}

#[cfg(all(test, feature = "test-support"))]
mod tests {
    use super::*;
    use crate::CommitItem;
    use rake::gpui::AppContext;

    fn data(ids: &[&str]) -> CommitListData {
        CommitListData::new(ids.iter().map(|id| CommitItem::new(*id, *id)).collect()).unwrap()
    }

    #[test]
    fn refreshed_history_retains_the_same_commit_and_partial_row_pixels() {
        let cx = gpui::TestAppContext::single();

        cx.update(|cx| {
            let state = cx.new(ListFocus::new);

            state.update(cx, |state, _| {
                state.reconcile(
                    data(&["a", "b", "c", "d"]),
                    Some("c".into()),
                    CommitListDensity::Compact,
                );
                state.scroll.0.borrow_mut().deferred_scroll_to_item = None;
                state
                    .scroll
                    .0
                    .borrow()
                    .base_handle
                    .set_offset(gpui::point(px(0.), px(-55.)));
                state.reconcile(
                    data(&["new", "a", "b", "c", "d"]),
                    Some("c".into()),
                    CommitListDensity::Compact,
                );
                assert_eq!(state.scroll.0.borrow().base_handle.offset().y, px(-103.));
                assert_eq!(state.cursor.as_deref(), Some("c"));
            });
        });
    }
}
