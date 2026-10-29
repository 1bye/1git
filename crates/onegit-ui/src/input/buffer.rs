//! Unicode-safe editing and bounded undo history, independent of the native window.
use std::ops::Range;
use unicode_segmentation::UnicodeSegmentation;

const HISTORY_LIMIT: usize = 100;

#[derive(Clone, Debug, PartialEq, Eq)]
struct Snapshot {
    text: String,
    anchor: usize,
    head: usize,
}

#[derive(Debug)]
pub(super) struct Buffer {
    pub text: String,
    pub anchor: usize,
    pub head: usize,
    pub marked: Option<Range<usize>>,
    undo: Vec<Snapshot>,
    redo: Vec<Snapshot>,
    composition: Option<Snapshot>,
}

impl Buffer {
    pub fn new(text: String) -> Self {
        let head = text.len();

        Self {
            text,
            anchor: head,
            head,
            marked: None,
            undo: Vec::new(),
            redo: Vec::new(),
            composition: None,
        }
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            text: self.text.clone(),
            anchor: self.anchor,
            head: self.head,
        }
    }

    fn restore(&mut self, snapshot: Snapshot) {
        self.text = snapshot.text;
        self.anchor = snapshot.anchor;
        self.head = snapshot.head;
        self.marked = None;
        self.composition = None;
    }

    pub fn selection(&self) -> Range<usize> {
        self.anchor.min(self.head)..self.anchor.max(self.head)
    }

    pub fn select(&mut self, range: Range<usize>) {
        self.anchor = floor_boundary(&self.text, range.start);
        self.head = floor_boundary(&self.text, range.end);
    }

    pub fn replace(&mut self, range: Range<usize>, text: &str, composing: bool) {
        let before = self.snapshot();

        if composing && self.composition.is_none() {
            self.composition = Some(before.clone());
        }

        let range = floor_boundary(&self.text, range.start)
            ..ceil_boundary(&self.text, range.end.max(range.start));

        self.text.replace_range(range.clone(), text);
        self.head = range.start + text.len();
        self.anchor = self.head;

        if composing {
            self.marked = Some(range.start..self.head);
        } else {
            let before = self.composition.take().unwrap_or(before);

            self.marked = None;
            self.record(before);
        }
    }

    fn record(&mut self, before: Snapshot) {
        if before.text == self.text {
            return;
        }

        if self.undo.len() == HISTORY_LIMIT {
            self.undo.remove(0);
        }

        self.undo.push(before);
        self.redo.clear();
    }

    pub fn unmark(&mut self) {
        self.marked = None;

        if let Some(before) = self.composition.take() {
            self.record(before);
        }
    }

    pub fn undo(&mut self) {
        self.unmark();

        if let Some(before) = self.undo.pop() {
            self.redo.push(self.snapshot());
            self.restore(before);
        }
    }

    pub fn redo(&mut self) {
        self.unmark();

        if let Some(after) = self.redo.pop() {
            self.undo.push(self.snapshot());
            self.restore(after);
        }
    }

    pub fn move_to(&mut self, index: usize, extend: bool) {
        self.head = floor_boundary(&self.text, index);

        if !extend {
            self.anchor = self.head;
        }
    }

    pub fn previous(&self, index: usize) -> usize {
        self.text
            .grapheme_indices(true)
            .rev()
            .find_map(|(i, _)| (i < index).then_some(i))
            .unwrap_or(0)
    }

    pub fn next(&self, index: usize) -> usize {
        self.text
            .grapheme_indices(true)
            .find_map(|(i, _)| (i > index).then_some(i))
            .unwrap_or(self.text.len())
    }

    pub fn previous_word(&self, index: usize) -> usize {
        self.text[..floor_boundary(&self.text, index)]
            .unicode_word_indices()
            .next_back()
            .map_or(0, |(i, _)| i)
    }

    pub fn next_word(&self, index: usize) -> usize {
        let index = floor_boundary(&self.text, index);

        self.text[index..]
            .unicode_word_indices()
            .next()
            .map_or(self.text.len(), |(i, w)| index + i + w.len())
    }
}

pub(super) fn floor_boundary(text: &str, index: usize) -> usize {
    let mut index = index.min(text.len());

    while !text.is_char_boundary(index) {
        index -= 1;
    }

    index
}

fn ceil_boundary(text: &str, index: usize) -> usize {
    let mut index = index.min(text.len());

    while !text.is_char_boundary(index) {
        index += 1;
    }

    index
}

pub(super) fn to_utf16(text: &str, index: usize) -> usize {
    text[..floor_boundary(text, index)].encode_utf16().count()
}

fn from_utf16(text: &str, index: usize, ceil: bool) -> usize {
    let mut count = 0;

    for (i, ch) in text.char_indices() {
        if count == index {
            return i;
        }

        if count + ch.len_utf16() > index {
            return if ceil { i + ch.len_utf8() } else { i };
        }

        count += ch.len_utf16();
    }

    text.len()
}

pub(super) fn utf16_range(text: &str, range: Range<usize>) -> Range<usize> {
    let start = from_utf16(text, range.start, false);

    let end = if range.is_empty() {
        start
    } else {
        from_utf16(text, range.end.max(range.start), true)
    };

    start..end
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn navigation_and_deletion_keep_extended_graphemes_intact() {
        for text in ["e\u{301}", "👨‍👩‍👧‍👦", "🇺🇦", "日"] {
            let mut buffer = Buffer::new(text.to_owned());

            assert_eq!(buffer.previous(buffer.head), 0, "grapheme {text}");
            assert_eq!(buffer.next(0), text.len(), "grapheme {text}");
            buffer.replace(0..buffer.head, "", false);
            assert!(buffer.text.is_empty());
            buffer.undo();
            assert_eq!(buffer.text, text);
            buffer.redo();
            assert!(buffer.text.is_empty());
        }
    }

    #[test]
    fn utf16_ranges_expand_surrogates_and_clamp_external_offsets() {
        let text = "a😀日本e\u{301}";

        assert_eq!(utf16_range(text, 2..3), 1..5);
        assert_eq!(utf16_range(text, 2..2), 1..1);
        assert_eq!(to_utf16(text, 5), 3);

        for start in 0..15 {
            for end in start..15 {
                let range = utf16_range(text, start..end);

                assert!(range.start <= range.end && range.end <= text.len());
                assert!(text.is_char_boundary(range.start) && text.is_char_boundary(range.end));
            }
        }
    }

    #[test]
    fn composition_updates_replace_one_marked_range_and_undo_as_one_edit() {
        let mut buffer = Buffer::new("a".to_owned());

        buffer.replace(1..1, "n", true);
        buffer.replace(buffer.marked.clone().unwrap(), "に", true);
        buffer.replace(buffer.marked.clone().unwrap(), "日本", false);
        assert_eq!(buffer.text, "a日本");
        assert_eq!(buffer.marked, None);
        buffer.undo();
        assert_eq!(buffer.text, "a");
        buffer.redo();
        assert_eq!(buffer.text, "a日本");
    }

    #[test]
    fn typing_after_undo_discards_redo_and_external_selection_is_safe() {
        let mut buffer = Buffer::new("café".into());

        buffer.select(4..99);
        assert_eq!(buffer.selection(), 3..5);
        buffer.replace(buffer.selection(), "e", false);
        assert_eq!(buffer.text, "cafe");
        buffer.undo();
        assert_eq!(buffer.text, "café");
        buffer.replace(0..5, "日", false);
        buffer.redo();
        assert_eq!(buffer.text, "日");
    }
}
