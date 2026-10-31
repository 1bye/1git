//! Original native renderer's bounded token-boundary prefix/suffix comparison.
use super::{DiffLine, DiffLineKind};
use std::ops::Range;

pub(super) fn annotate(lines: &[DiffLine]) -> Vec<Vec<Range<usize>>> {
    let mut ranges = vec![Vec::new(); lines.len()];
    let mut index = 0;

    while index < lines.len() {
        let start = index;

        while index < lines.len() && lines[index].kind == DiffLineKind::Deleted {
            index += 1;
        }

        let middle = index;

        while index < lines.len() && lines[index].kind == DiffLineKind::Added {
            index += 1;
        }

        if middle > start && middle - start == index - middle {
            for offset in 0..middle - start {
                let (old, new) = word_diff(
                    &lines[start + offset].display,
                    &lines[middle + offset].display,
                );

                ranges[start + offset] = old;
                ranges[middle + offset] = new;
            }
        }

        if index == start {
            index += 1;
        }
    }

    ranges
}

fn word_diff(old: &str, new: &str) -> (Vec<Range<usize>>, Vec<Range<usize>>) {
    if old == new {
        return (Vec::new(), Vec::new());
    }

    let old_words = split_words(old);
    let new_words = split_words(new);

    let mut prefix = 0;

    while prefix < old_words.len()
        && prefix < new_words.len()
        && old[old_words[prefix].clone()] == new[new_words[prefix].clone()]
    {
        prefix += 1;
    }

    let mut suffix = 0;

    while suffix < old_words.len() - prefix
        && suffix < new_words.len() - prefix
        && old[old_words[old_words.len() - 1 - suffix].clone()]
            == new[new_words[new_words.len() - 1 - suffix].clone()]
    {
        suffix += 1;
    }

    let collapse = |words: &[Range<usize>]| -> Vec<Range<usize>> {
        let changed = &words[prefix..words.len() - suffix];

        match (changed.first(), changed.last()) {
            (Some(first), Some(last)) => std::iter::once(first.start..last.end).collect(),
            _ => Vec::new(),
        }
    };

    (collapse(&old_words), collapse(&new_words))
}

/// Byte ranges of the tokens in a line. Runs of word characters are one token;
/// every other character is its own token, so `foo(x)` differs from `foo(y)` in
/// exactly one token.
fn split_words(line: &str) -> Vec<Range<usize>> {
    let mut words = Vec::new();
    let mut start: Option<usize> = None;

    for (ix, ch) in line.char_indices() {
        let is_word = ch.is_alphanumeric() || ch == '_';

        match (is_word, start) {
            (true, None) => start = Some(ix),
            (false, Some(s)) => {
                words.push(s..ix);
                start = None;
                words.push(ix..ix + ch.len_utf8());
            }
            (false, None) => words.push(ix..ix + ch.len_utf8()),
            (true, Some(_)) => {}
        }
    }

    if let Some(s) = start {
        words.push(s..line.len());
    }

    words
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn word_diff_isolates_the_changed_token() {
        let (old, new) = word_diff("const b = 2", "const b = 3");

        assert_eq!(old.len(), 1);
        assert_eq!(new.len(), 1);
        assert_eq!(&"const b = 2"[old[0].clone()], "2");
        assert_eq!(&"const b = 3"[new[0].clone()], "3");
    }

    #[test]
    fn word_diff_spans_a_middle_run() {
        let a = "foo(alpha, beta)";
        let b = "foo(gamma, beta)";
        let (old, new) = word_diff(a, b);

        assert_eq!(&a[old[0].clone()], "alpha");
        assert_eq!(&b[new[0].clone()], "gamma");
    }

    /// The trim walks `words.len() - prefix` and `words.len() - 1 - suffix`.
    /// Degenerate inputs are where an off-by-one becomes a panic.
    #[test]
    fn word_diff_survives_degenerate_inputs() {
        for (old, new) in [
            ("", "x"),
            ("x", ""),
            ("", ""),
            ("a", "a b"),
            ("a b", "a"),
            (" ", "  "),
            ("aaa", "aaaa"),
        ] {
            let (old_ranges, new_ranges) = word_diff(old, new);

            for range in &old_ranges {
                assert!(old.get(range.clone()).is_some(), "{old:?} {range:?}");
            }

            for range in &new_ranges {
                assert!(new.get(range.clone()).is_some(), "{new:?} {range:?}");
            }
        }
    }

    #[test]
    fn word_diff_of_identical_lines_is_empty() {
        let (old, new) = word_diff("same", "same");

        assert!(old.is_empty() && new.is_empty());
    }

    #[test]
    fn word_diff_handles_unicode_without_panicking() {
        let (old, new) = word_diff("let café = 1", "let café = 2");

        assert_eq!(&"let café = 1"[old[0].clone()], "1");
        assert_eq!(&"let café = 2"[new[0].clone()], "2");
    }

    #[test]
    fn annotation_pairs_equal_length_runs_only() {
        let doc = super::super::DiffDocument::parse("@@ -1,1 +1,2 @@\n-x\n+y\n+z\n").unwrap();

        assert!(annotate(doc.lines()).iter().all(Vec::is_empty));
        let doc = super::super::DiffDocument::parse("@@ -1 +1 @@\n-version = 62\n+version = 63\n")
            .unwrap();

        let ranges = annotate(doc.lines());

        assert_eq!(&doc.lines()[1].display[ranges[1][0].clone()], "62");
        assert_eq!(&doc.lines()[2].display[ranges[2][0].clone()], "63");
    }
}
