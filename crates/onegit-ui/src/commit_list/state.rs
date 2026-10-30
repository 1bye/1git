use super::{CommitListData, CommitListDensity};
use rake::gpui::{self, px};

pub(super) struct ListFocus {
    pub data: CommitListData,
    pub cursor: Option<gpui::SharedString>,
    selected: Option<gpui::SharedString>,
    density: CommitListDensity,
    pub focus: gpui::FocusHandle,
    pub scroll: gpui::UniformListScrollHandle,
}

impl ListFocus {
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

    pub fn reconcile(
        &mut self,
        data: CommitListData,
        selected: Option<gpui::SharedString>,
        density: CommitListDensity,
    ) {
        let changed = !self.data.same(&data);
        let selection_changed = self.selected != selected;
        let old_cursor = self.cursor.as_ref().and_then(|id| self.data.position(id));

        let old_top = (-f32::from(self.scroll.0.borrow().base_handle.offset().y)
            / self.density.height())
        .floor()
        .max(0.) as usize;

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

            self.scroll
                .scroll_to_item_strict(target, gpui::ScrollStrategy::Top);
        } else if selection_changed && let Some(index) = selected_index {
            self.scroll
                .scroll_to_item(index, gpui::ScrollStrategy::Nearest);
        }

        self.data = data;
        self.selected = selected;
        self.density = density;
    }

    pub fn choose(&mut self, id: &gpui::SharedString, cx: &mut gpui::Context<Self>) {
        if let Some(index) = self.data.position(id) {
            self.cursor = Some(id.clone());
            self.scroll
                .scroll_to_item(index, gpui::ScrollStrategy::Nearest);
            cx.notify();
        }
    }

    pub fn key(
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
