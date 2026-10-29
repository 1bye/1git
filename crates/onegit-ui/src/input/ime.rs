//! UTF-16 platform ranges are translated at the native input boundary.
use super::{
    InputAvailability, InputState,
    buffer::{to_utf16, utf16_range},
};
use rake::gpui::{self, EntityInputHandler, px};
use std::ops::Range;

impl EntityInputHandler for InputState {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        adjusted: &mut Option<Range<usize>>,
        _: &mut gpui::Window,
        _: &mut gpui::Context<Self>,
    ) -> Option<String> {
        let range = utf16_range(&self.buffer.text, range);
        *adjusted =
            Some(to_utf16(&self.buffer.text, range.start)..to_utf16(&self.buffer.text, range.end));
        Some(self.buffer.text[range].to_owned())
    }
    fn selected_text_range(
        &mut self,
        ignore_disabled: bool,
        _: &mut gpui::Window,
        _: &mut gpui::Context<Self>,
    ) -> Option<gpui::UTF16Selection> {
        if !ignore_disabled && !self.editable() {
            return None;
        }
        let range = self.buffer.selection();
        Some(gpui::UTF16Selection {
            range: to_utf16(&self.buffer.text, range.start)..to_utf16(&self.buffer.text, range.end),
            reversed: self.buffer.head < self.buffer.anchor,
        })
    }
    fn marked_text_range(
        &self,
        _: &mut gpui::Window,
        _: &mut gpui::Context<Self>,
    ) -> Option<Range<usize>> {
        self.buffer.marked.as_ref().map(|range| {
            to_utf16(&self.buffer.text, range.start)..to_utf16(&self.buffer.text, range.end)
        })
    }
    fn unmark_text(&mut self, _: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        self.buffer.unmark();
        cx.notify();
    }
    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        _: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let range = range
            .map(|range| utf16_range(&self.buffer.text, range))
            .or_else(|| self.buffer.marked.clone())
            .unwrap_or_else(|| self.buffer.selection());
        self.replace(range, text, false, cx);
    }
    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        selection: Option<Range<usize>>,
        _: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if !self.editable() {
            return;
        }
        let range = range
            .map(|range| utf16_range(&self.buffer.text, range))
            .or_else(|| self.buffer.marked.clone())
            .unwrap_or_else(|| self.buffer.selection());
        self.replace(range, text, true, cx);
        if let Some(selection) = selection
            && let Some(marked) = &self.buffer.marked
        {
            let start = marked.start;
            let local = utf16_range(&self.buffer.text[marked.clone()], selection);
            self.buffer.select(start + local.start..start + local.end);
            self.moved(cx);
        }
    }
    fn bounds_for_range(
        &mut self,
        range: Range<usize>,
        _: gpui::Bounds<gpui::Pixels>,
        _: &mut gpui::Window,
        _: &mut gpui::Context<Self>,
    ) -> Option<gpui::Bounds<gpui::Pixels>> {
        let layout = self.layout.as_ref()?;
        let range = utf16_range(&self.buffer.text, range);
        let start = layout.position(range.start);
        let end = layout.position(range.end);
        let width = if start.y == end.y {
            (end.x - start.x).abs()
        } else {
            layout.bounds.size.width - start.x
        };
        Some(gpui::Bounds::new(
            layout.bounds.origin + start - self.scroll,
            gpui::size(width.max(px(1.)), layout.line_height),
        ))
    }
    fn character_index_for_point(
        &mut self,
        point: gpui::Point<gpui::Pixels>,
        _: &mut gpui::Window,
        _: &mut gpui::Context<Self>,
    ) -> Option<usize> {
        let layout = self.layout.as_ref()?;
        let index = layout.index_at(point - layout.bounds.origin + self.scroll);
        Some(to_utf16(&self.buffer.text, index))
    }
    fn set_selected_text_range(
        &mut self,
        range: Range<usize>,
        _: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.config.availability == InputAvailability::Disabled {
            return;
        }
        let range = utf16_range(&self.buffer.text, range);
        self.buffer.select(range);
        self.moved(cx);
    }
    fn text_length_utf16(
        &mut self,
        _: &mut gpui::Window,
        _: &mut gpui::Context<Self>,
    ) -> Option<usize> {
        Some(self.buffer.text.encode_utf16().count())
    }
    fn accepts_text_input(&self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> bool {
        self.editable()
    }
}
