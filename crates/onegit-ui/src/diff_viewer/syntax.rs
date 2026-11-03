//! Prepared reference-grammar spans; parsing never runs during rendering or scrolling.
mod scopes;

use super::DiffLine;
use std::ops::Range;

use syntect::{
    easy::ScopeRangeIterator,
    parsing::{ParseState, ScopeStack},
};

const NAMES: &[&str] = &[
    "comment",
    "keyword",
    "string",
    "string.special",
    "escape",
    "number",
    "boolean",
    "type",
    "type.builtin",
    "constructor",
    "function",
    "function.builtin",
    "function.macro",
    "property",
    "constant",
    "variable",
    "variable.builtin",
    "variable.parameter",
    "operator",
    "punctuation",
    "tag",
    "attribute",
    "label",
    "embedded",
    "error",
];

#[derive(Clone, Debug)]
pub(super) struct Span {
    pub range: Range<usize>,
    pub kind: usize,
}

pub(super) type Spans = [Vec<Span>; 2];

/// Independent side streams reset at gaps, so missing context cannot leak parser state.
pub(super) fn annotate(lines: &[DiffLine], paths: [&str; 2]) -> Vec<Spans> {
    let mut output = vec![[Vec::new(), Vec::new()]; lines.len()];

    for (side, path) in paths.into_iter().enumerate() {
        let Some(language) =
            scopes::detect_language(Some(path), None, lines.first().map(|l| l.text.as_str()))
        else {
            continue;
        };

        let Some(config) = scopes::syntax_for_language(language) else {
            continue;
        };

        let mut block = Vec::new();
        let mut previous = None;

        for (index, line) in lines.iter().enumerate() {
            let coordinate = if side == 0 {
                line.old_line
            } else {
                line.new_line
            };

            let Some(coordinate) = coordinate else {
                continue;
            };

            if previous.is_some_and(|previous| coordinate != previous + 1) {
                highlight(&block, lines, side, language, config, &mut output);
                block.clear();
            }

            block.push(index);
            previous = Some(coordinate);
        }

        highlight(&block, lines, side, language, config, &mut output);
    }

    output
}

fn highlight(
    block: &[usize],
    lines: &[DiffLine],
    side: usize,
    language: scopes::LanguageId,
    syntax: &syntect::parsing::SyntaxReference,
    output: &mut [Spans],
) {
    if block.len() > 2000
        || block
            .iter()
            .map(|&i| lines[i].text.len() + 1)
            .sum::<usize>()
            > 512 * 1024
        || block.iter().any(|&i| lines[i].text.len() > 4000)
    {
        return;
    }

    let mut parser = ParseState::new(syntax);
    let mut stack = ScopeStack::new();
    let set = scopes::syntax_set();

    for &index in block {
        let line = &lines[index];
        let source = format!("{}\n", line.text);

        let Ok(ops) = parser.parse_line(&source, set) else {
            clear(block, side, output);

            return;
        };

        for (range, op) in ScopeRangeIterator::new(&ops, &source) {
            if stack.apply(op).is_err() {
                clear(block, side, output);

                return;
            }

            let end = range.end.min(line.text.len());

            if range.start >= end {
                continue;
            }

            let Some(kind) = scopes::kind_for_region(language, &source[range.start..end], &stack)
            else {
                continue;
            };

            let display_offset = |end| super::document::display(&line.text[..end]).len();

            output[index][side].push(Span {
                range: display_offset(range.start)..display_offset(end),
                kind: kind as usize,
            });
        }
    }
}

fn clear(block: &[usize], side: usize, output: &mut [Spans]) {
    for &index in block {
        output[index][side].clear();
    }
}

pub(super) fn color(kind: usize, theme: &crate::Theme) -> rake::gpui::Hsla {
    let dark = theme.appearance == crate::Appearance::Dark;

    let (light, night) = match NAMES[kind] {
        "comment" => (0x6a737d, 0xb1bac4),
        "keyword" | "operator" => (0xd73a49, 0xff7b72),
        "string" | "string.special" => (0x032f62, 0xa5d6ff),
        "escape" => (0x005cc5, 0xff7b72),
        "number" | "boolean" | "constant" | "variable.builtin" => (0x005cc5, 0x79c0ff),
        "type" | "constructor" => (0x6f42c1, 0xffa657),
        "type.builtin" | "function.builtin" | "attribute" => (0x6f42c1, 0x79c0ff),
        "function.macro" => (0xd73a49, 0xd2a8ff),
        "label" => (0x24292e, 0xffa657),
        "function" => (0x6f42c1, 0xd2a8ff),
        "tag" => (0x22863a, 0x7ee787),
        "error" => (0xb31d28, 0xffa198),
        _ => (0x24292e, 0xe6edf3),
    };

    rake::gpui::rgb_to_hsla(rake::gpui::rgb(if dark { night } else { light }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DiffDocument;

    #[test]
    fn grammars_compile_and_multiline_state_and_utf8_ranges_are_valid() {
        for path in [
            "a.js", "a.jsx", "a.ts", "a.tsx", "a.rs", "a.py", "a.go", "a.json", "a.jsonc", "a.css",
            "a.html", "a.sh", "a.c", "a.toml", "a.md", "a.yaml",
        ] {
            let language = scopes::detect_language(Some(path), None, None).unwrap();

            assert!(scopes::syntax_for_language(language).is_some(), "{path}");
        }

        for (path, body) in [
            ("a.ts", "/* café\nexport const value = 'test';\n*/"),
            ("a.rs", "/* café\nlet value = 42;\n*/"),
            ("a.py", "\"\"\"café\nreturn True\n\"\"\""),
        ] {
            let patch = format!("@@ -1,3 +1,3 @@\n {}\n", body.replace('\n', "\n "));
            let document = DiffDocument::parse(&patch).unwrap();
            let spans = annotate(document.lines(), [path, path]);

            assert!(!spans[2][0].is_empty(), "{path}");
            assert!(
                spans[2][0]
                    .iter()
                    .all(|s| matches!(NAMES[s.kind], "comment" | "string"))
            );

            for (line, spans) in document.lines().iter().zip(spans) {
                for span in spans.into_iter().flatten() {
                    assert!(line.display.get(span.range).is_some());
                }
            }
        }
    }

    #[test]
    fn gaps_reset_parser_state_and_renames_keep_separate_language_hints() {
        let document =
            DiffDocument::parse("@@ -1 +1 @@\n /*\n@@ -50 +50 @@\n-return true;\n+return false;\n")
                .unwrap();

        let spans = annotate(document.lines(), ["a.ts", "a.ts"]);

        assert!(spans[4][1].iter().any(|s| NAMES[s.kind] == "keyword"));
        assert!(!spans[4][1].iter().any(|s| NAMES[s.kind] == "comment"));
        let document = DiffDocument::parse("@@ -1 +1 @@\n value = True\n").unwrap();
        let spans = annotate(document.lines(), ["old.py", "new.ts"]);

        assert!(spans[1][0].iter().any(|s| NAMES[s.kind] == "boolean"));
        assert!(!spans[1][1].iter().any(|s| NAMES[s.kind] == "boolean"));
    }

    #[test]
    fn reference_rust_return_type_is_plain_while_primitives_and_functions_are_colored() {
        let line = "pub fn greeting(name: &str) -> String {";
        let document = DiffDocument::parse(&format!("@@ -0,0 +1 @@\n+{line}\n")).unwrap();
        let spans = annotate(document.lines(), ["a.rs", "a.rs"]);
        let start = line.find("String").unwrap();

        assert!(
            spans[1][1]
                .iter()
                .filter(|s| s.range.contains(&start))
                .all(|s| !matches!(NAMES[s.kind], "type" | "type.builtin")),
            "the reference grammar leaves String in this signature plain"
        );
        assert!(spans[1][1].iter().any(|s| NAMES[s.kind] == "function"));
    }

    #[test]
    fn unsupported_paths_and_over_budget_lines_remain_readable_without_syntax() {
        let document = DiffDocument::parse("@@ -1 +1 @@\n let value = 42;\n").unwrap();

        assert!(
            annotate(document.lines(), ["a.unknown", "a.txt"])
                .iter()
                .all(|s| s.iter().all(Vec::is_empty))
        );
        let document =
            DiffDocument::parse(&format!("@@ -1 +1 @@\n {}\n", "x".repeat(4001))).unwrap();

        assert!(
            annotate(document.lines(), ["a.rs", "a.rs"])
                .iter()
                .all(|s| s.iter().all(Vec::is_empty))
        );
        assert_eq!(document.lines()[1].text.len(), 4001);
    }
}
