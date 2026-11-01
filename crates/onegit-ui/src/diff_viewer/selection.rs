//! Raw-source selection with native shaping and a pinned split column.
use super::{DiffDocument, DiffLineKind, DiffView, rows::Side, state::Scroll};
use rake::gpui::{self, prelude::*, px};
use std::collections::HashMap;
use unicode_segmentation::UnicodeSegmentation;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct Point {
    pub line: usize,
    pub byte: usize,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct Selection {
    pub anchor: Point,
    pub head: Point,
    pub side: Side,
}

pub(super) struct Cell {
    bounds: gpui::Bounds<gpui::Pixels>,
    shaped: gpui::ShapedLine,
}

#[derive(Default)]
pub(super) struct TextSelection {
    pub selection: Option<Selection>,
    pub dragging: bool,
    pub pointer: Option<gpui::Point<gpui::Pixels>>,
    pub cells: HashMap<(usize, Side), Cell>,
    pub viewport: gpui::Bounds<gpui::Pixels>,
}

fn available(document: &DiffDocument, index: usize, view: DiffView, side: Side) -> bool {
    let line = &document.lines()[index];

    matches!(
        line.kind,
        DiffLineKind::Context | DiffLineKind::Added | DiffLineKind::Deleted
    ) && (view == DiffView::Unified
        || match side {
            Side::Old => line.old_line.is_some(),
            Side::New => line.new_line.is_some(),
        })
}

#[cfg(test)]
fn display_byte(text: &str, raw: usize) -> usize {
    super::document::display(&text[..raw.min(text.len())]).len()
}

fn raw_byte(text: &str, display: usize) -> usize {
    let mut shown = 0usize;

    for (raw, character) in text.char_indices() {
        let width = match character {
            '\t' => "→   ".len(),
            '\r' => '␍'.len_utf8(),
            c if c.is_control() => c.escape_default().count(),
            c => c.len_utf8(),
        };

        if display <= shown + width {
            return if display - shown <= shown + width - display {
                raw
            } else {
                raw + character.len_utf8()
            };
        }

        shown += width;
    }

    text.len()
}

impl TextSelection {
    pub fn range(
        &self,
        index: usize,
        side: Side,
        document: &DiffDocument,
        view: DiffView,
    ) -> Option<std::ops::Range<usize>> {
        let selection = self.selection?;

        if selection.side != side || !available(document, index, view, side) {
            return None;
        }

        let (a, b) = (
            selection.anchor.min(selection.head),
            selection.anchor.max(selection.head),
        );

        if a == b || index < a.line || index > b.line {
            return None;
        }

        let text = &document.lines()[index].text;
        let start = if index == a.line { a.byte } else { 0 };
        let end = if index == b.line { b.byte } else { text.len() };

        Some(start.min(text.len())..end.min(text.len()))
    }

    pub fn has_text(&self, document: &DiffDocument, view: DiffView) -> bool {
        let Some(selection) = self.selection else {
            return false;
        };

        let start = selection.anchor.line.min(selection.head.line);
        let end = selection.anchor.line.max(selection.head.line);
        let mut source_lines = 0;

        for index in start..=end {
            if let Some(range) = self.range(index, selection.side, document, view) {
                source_lines += 1;

                if !range.is_empty() || source_lines > 1 {
                    return true;
                }
            }
        }

        false
    }

    pub fn copied(&self, document: &DiffDocument, view: DiffView) -> String {
        let Some(selection) = self.selection else {
            return String::new();
        };

        let (a, b) = (
            selection.anchor.min(selection.head),
            selection.anchor.max(selection.head),
        );

        if a == b {
            return String::new();
        }

        (a.line..=b.line)
            .filter(|&i| available(document, i, view, selection.side))
            .filter_map(|i| {
                self.range(i, selection.side, document, view)
                    .map(|range| document.lines()[i].text[range].to_string())
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub(super) fn hit(
        &self,
        position: gpui::Point<gpui::Pixels>,
        side: Side,
        document: &DiffDocument,
    ) -> Option<Point> {
        let (&(line, _), cell) = self
            .cells
            .iter()
            .filter(|((_, s), cell)| {
                *s == side
                    && cell.bounds.bottom() > self.viewport.top()
                    && cell.bounds.top() < self.viewport.bottom()
            })
            .min_by_key(|(_, cell)| {
                let dy = if position.y < cell.bounds.top() {
                    cell.bounds.top() - position.y
                } else if position.y > cell.bounds.bottom() {
                    position.y - cell.bounds.bottom()
                } else {
                    px(0.)
                };

                (
                    (f32::from(dy) * 1000.) as i64,
                    if position.y >= cell.bounds.bottom() {
                        1
                    } else {
                        0
                    },
                )
            })?;

        let byte = cell
            .shaped
            .closest_index_for_x(position.x - cell.bounds.left());

        Some(Point {
            line,
            byte: raw_byte(&document.lines()[line].text, byte),
        })
    }

    pub fn remap(&mut self, old: &DiffDocument, new: &DiffDocument) {
        if let Some(mut selection) = self.selection {
            let remap = |point: Point| {
                let source = old.lines().get(point.line)?;

                let index = new.lines().iter().position(|line| {
                    line.kind == source.kind
                        && line.old_line == source.old_line
                        && line.new_line == source.new_line
                        && line.text == source.text
                })?;

                Some(Point {
                    line: index,
                    byte: point.byte,
                })
            };

            self.selection =
                remap(selection.anchor)
                    .zip(remap(selection.head))
                    .map(|(anchor, head)| {
                        selection.anchor = anchor;
                        selection.head = head;

                        selection
                    });
        }

        self.dragging = false;
        self.pointer = None;
        self.cells.clear();
    }
}

impl Scroll {
    pub(super) fn select_at(
        &mut self,
        index: usize,
        side: Side,
        event: &gpui::MouseDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(head) = self.text.hit(event.position, side, &self.document) else {
            return;
        };

        let head = Point {
            line: index,
            ..head
        };

        let anchor = if event.modifiers.shift {
            self.text
                .selection
                .filter(|s| s.side == side)
                .map(|s| s.anchor)
                .unwrap_or(head)
        } else {
            head
        };

        let mut selection = Selection { anchor, head, side };

        if event.click_count >= 3 {
            selection.anchor.byte = 0;
            selection.head.byte = self.document.lines()[index].text.len();
        } else if event.click_count == 2 {
            let text = &self.document.lines()[index].text;

            if let Some((start, word)) = text
                .split_word_bound_indices()
                .find(|(start, word)| *start <= head.byte && *start + word.len() > head.byte)
            {
                selection.anchor.byte = start;
                selection.head.byte = start + word.len();
            }
        }

        self.text.selection = Some(selection);
        self.text.dragging = true;
        self.text.pointer = Some(event.position);
        window.focus(&self.focus, cx);
        cx.stop_propagation();
        cx.notify();
    }

    fn move_selection(&mut self, event: &gpui::MouseMoveEvent, cx: &mut gpui::Context<Self>) {
        if !self.text.dragging {
            return;
        }

        if event.pressed_button != Some(gpui::MouseButton::Left) {
            self.text.dragging = false;

            return;
        }

        self.text.pointer = Some(event.position);

        if let Some(selection) = self.text.selection
            && let Some(head) = self
                .text
                .hit(event.position, selection.side, &self.document)
        {
            self.text.selection = Some(Selection { head, ..selection });
            cx.notify();
        }
    }

    pub(super) fn selection_key(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        let mods = event.keystroke.modifiers;

        let primary = if cfg!(target_os = "macos") {
            mods.platform
        } else {
            mods.control
        };

        let key = event.keystroke.key.as_str();

        if key == "escape" && self.text.selection.take().is_some() {
            self.text.dragging = false;
            cx.notify();

            return true;
        }

        if primary && key == "c" {
            let selected = self.selected_text();

            if !selected.is_empty() {
                cx.write_to_clipboard(gpui::ClipboardItem::new_string(selected));
            }

            return true;
        }

        if !(primary && key == "a"
            || mods.shift && matches!(key, "left" | "right" | "up" | "down" | "home" | "end"))
        {
            return false;
        }

        let side = self.text.selection.map(|s| s.side).unwrap_or(Side::Old);

        let indices: Vec<_> = (0..self.document.lines().len())
            .filter(|&i| available(&self.document, i, self.view, side))
            .collect();

        if indices.is_empty() {
            return false;
        }

        if primary && key == "a" {
            let first = indices[0];
            let last = *indices.last().expect("nonempty source lines");

            self.text.selection = Some(Selection {
                anchor: Point {
                    line: first,
                    byte: 0,
                },
                head: Point {
                    line: last,
                    byte: self.document.lines()[last].text.len(),
                },
                side,
            });
            cx.notify();

            return true;
        }

        if !mods.shift || !matches!(key, "left" | "right" | "up" | "down" | "home" | "end") {
            return false;
        }

        let initial = self
            .document
            .rows(self.view)
            .get(self.handle.logical_scroll_top().item_ix)
            .map(|r| r.anchor())
            .unwrap_or(indices[0]);

        let line = *indices
            .iter()
            .find(|&&i| i >= initial)
            .unwrap_or(&indices[0]);

        let selection = self.text.selection.unwrap_or(Selection {
            anchor: Point { line, byte: 0 },
            head: Point { line, byte: 0 },
            side,
        });

        let mut head = selection.head;
        let text = &self.document.lines()[head.line].text;
        let at = indices.iter().position(|&i| i == head.line).unwrap_or(0);

        match key {
            "home" => head.byte = 0,
            "end" => head.byte = text.len(),
            "left" => {
                if let Some((i, _)) = text[..head.byte].grapheme_indices(true).next_back() {
                    head.byte = i
                } else if at > 0 {
                    head.line = indices[at - 1];

                    head.byte = self.document.lines()[head.line].text.len()
                }
            }
            "right" => {
                if head.byte < text.len() {
                    head.byte += text[head.byte..].graphemes(true).next().map_or(0, str::len)
                } else if at + 1 < indices.len() {
                    head.line = indices[at + 1];

                    head.byte = 0
                }
            }
            "up" | "down" => {
                let next = if key == "up" {
                    at.saturating_sub(1)
                } else {
                    (at + 1).min(indices.len() - 1)
                };

                head.line = indices[next];
                let text = &self.document.lines()[head.line].text;

                head.byte = head.byte.min(text.len());

                while !text.is_char_boundary(head.byte) {
                    head.byte -= 1;
                }
            }
            _ => {}
        }

        self.text.selection = Some(Selection { head, ..selection });

        if let Some(row) = self
            .document
            .rows(self.view)
            .iter()
            .position(|r| r.anchor() == head.line)
        {
            self.handle.scroll_to_reveal_item(row);
        }

        window.prevent_default();
        cx.notify();

        true
    }

    /// Selected raw code only, without diff markers, line numbers or synthetic newline notes.
    #[must_use]
    pub fn selected_text(&self) -> String {
        self.text.copied(&self.document, self.view)
    }

    pub(super) fn selected_keys(&self) -> Vec<String> {
        let Some(selection) = self.text.selection else {
            return Vec::new();
        };

        (selection.anchor.line.min(selection.head.line)
            ..=selection.anchor.line.max(selection.head.line))
            .filter(|&i| {
                self.text
                    .range(i, selection.side, &self.document, self.view)
                    .is_some_and(|r| {
                        !r.is_empty()
                            || (self.document.lines()[i].text.is_empty()
                                && i >= selection.anchor.line.min(selection.head.line)
                                && i < selection.anchor.line.max(selection.head.line))
                    })
            })
            .filter_map(|i| super::staging::line_key(&self.document.lines()[i]))
            .collect()
    }
}

pub(super) fn layer(state: &gpui::Entity<Scroll>) -> gpui::AnyElement {
    let prepaint = state.clone();
    let paint = state.clone();

    gpui::canvas(
        move |bounds, _, cx| {
            prepaint.update(cx, |state, _| {
                state.text.viewport = bounds;
                state.text.cells.clear();
            })
        },
        move |_, _, window, _| {
            let moved = paint.clone();

            window.on_mouse_event(move |event: &gpui::MouseMoveEvent, phase, _, cx| {
                if phase == gpui::DispatchPhase::Capture {
                    moved.update(cx, |state, cx| state.move_selection(event, cx));
                }
            });
            let up = paint.clone();

            window.on_mouse_event(move |event: &gpui::MouseUpEvent, phase, _, cx| {
                if phase == gpui::DispatchPhase::Capture && event.button == gpui::MouseButton::Left
                {
                    up.update(cx, |state, _| {
                        state.text.dragging = false;
                        state.text.pointer = None;
                    });
                }
            });
        },
    )
    .absolute()
    .inset_0()
    .into_any_element()
}

pub(super) fn measure(
    state: &gpui::Entity<Scroll>,
    index: usize,
    side: Side,
    text: gpui::SharedString,
) -> gpui::AnyElement {
    let state = state.clone();

    gpui::canvas(
        move |bounds, window, cx| {
            let theme = crate::Theme::current();

            let shaped = window.text_system().shape_line(
                text.clone(),
                theme.code.size,
                &[gpui::TextRun {
                    len: text.len(),
                    font: gpui::font(theme.mono),
                    color: theme.diff_ink,
                    background_color: None,
                    underline: None,
                    strikethrough: None,
                    letter_spacing: None,
                }],
                None,
            );

            state.update(cx, |state, _| {
                state
                    .text
                    .cells
                    .insert((index, side), Cell { bounds, shaped });
            });
        },
        |_, _, _, _| {},
    )
    .absolute()
    .inset_0()
    .into_any_element()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_text_omits_gutters_markers_and_newline_notes_and_pins_split_side() {
        let document=DiffDocument::parse("@@ -1,3 +1,3 @@\n context\n-\tcafé old\r\n+\tcafé new\r\n tail\n\\ No newline at end of file\n").unwrap();

        let selection = TextSelection {
            selection: Some(Selection {
                anchor: Point { line: 1, byte: 0 },
                head: Point { line: 4, byte: 4 },
                side: Side::Old,
            }),
            ..Default::default()
        };

        assert_eq!(
            selection.copied(&document, DiffView::Split),
            "context\n\tcafé old\r\ntail"
        );
        assert_eq!(
            selection.copied(&document, DiffView::Unified),
            "context\n\tcafé old\r\n\tcafé new\r\ntail"
        );
        let reversed = TextSelection {
            selection: selection.selection.map(|s| Selection {
                anchor: s.head,
                head: s.anchor,
                ..s
            }),
            ..Default::default()
        };

        assert_eq!(
            reversed.copied(&document, DiffView::Split),
            selection.copied(&document, DiffView::Split)
        );

        for raw in [0, 1, 3, 6] {
            let text = "\tcafé";

            assert_eq!(raw_byte(text, display_byte(text, raw)), raw);
        }
    }
}
