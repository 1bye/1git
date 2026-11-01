//! Prepared Tree-sitter spans; no parsing during render, scroll, or theme changes.
use super::DiffLine;

use std::{
    collections::HashMap,
    ops::Range,
    sync::{Arc, LazyLock},
};

use tree_sitter_highlight::{HighlightConfiguration, HighlightEvent, Highlighter};

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
    "error",
];

#[derive(Clone, Debug)]
pub(super) struct Span {
    pub range: Range<usize>,
    pub kind: usize,
}

pub(super) type Spans = [Vec<Span>; 2];

static CONFIGS: LazyLock<HashMap<&'static str, Arc<HighlightConfiguration>>> =
    LazyLock::new(|| {
        let js = tree_sitter_javascript::HIGHLIGHT_QUERY;
        let ts = format!("{js}\n{}", tree_sitter_typescript::HIGHLIGHTS_QUERY);
        let mut result = HashMap::new();

        macro_rules! add {
            ($name:expr, $language:expr, $query:expr, $locals:expr) => {
                if let Ok(mut config) =
                    HighlightConfiguration::new($language.into(), $name, $query, "", $locals)
                {
                    config.configure(NAMES);
                    result.insert($name, Arc::new(config));
                }
            };
        }
        add!(
            "js",
            tree_sitter_javascript::LANGUAGE,
            js,
            tree_sitter_javascript::LOCALS_QUERY
        );
        add!(
            "ts",
            tree_sitter_typescript::LANGUAGE_TYPESCRIPT,
            &ts,
            tree_sitter_typescript::LOCALS_QUERY
        );
        add!(
            "tsx",
            tree_sitter_typescript::LANGUAGE_TSX,
            &ts,
            tree_sitter_typescript::LOCALS_QUERY
        );
        add!(
            "rs",
            tree_sitter_rust::LANGUAGE,
            tree_sitter_rust::HIGHLIGHTS_QUERY,
            ""
        );
        add!(
            "py",
            tree_sitter_python::LANGUAGE,
            tree_sitter_python::HIGHLIGHTS_QUERY,
            ""
        );
        add!(
            "go",
            tree_sitter_go::LANGUAGE,
            tree_sitter_go::HIGHLIGHTS_QUERY,
            ""
        );
        add!(
            "json",
            tree_sitter_json::LANGUAGE,
            tree_sitter_json::HIGHLIGHTS_QUERY,
            ""
        );
        add!(
            "css",
            tree_sitter_css::LANGUAGE,
            tree_sitter_css::HIGHLIGHTS_QUERY,
            ""
        );
        add!(
            "html",
            tree_sitter_html::LANGUAGE,
            tree_sitter_html::HIGHLIGHTS_QUERY,
            ""
        );
        add!(
            "sh",
            tree_sitter_bash::LANGUAGE,
            tree_sitter_bash::HIGHLIGHT_QUERY,
            ""
        );
        add!(
            "c",
            tree_sitter_c::LANGUAGE,
            tree_sitter_c::HIGHLIGHT_QUERY,
            ""
        );

        result
    });

fn language(path: &str) -> Option<&'static str> {
    match path.rsplit('.').next()? {
        "js" | "jsx" | "mjs" | "cjs" => Some("js"),
        "ts" | "mts" | "cts" => Some("ts"),
        "tsx" => Some("tsx"),
        "rs" => Some("rs"),
        "py" | "pyw" => Some("py"),
        "go" => Some("go"),
        "json" | "jsonc" => Some("json"),
        "css" => Some("css"),
        "html" | "htm" => Some("html"),
        "sh" | "bash" | "zsh" => Some("sh"),
        "c" | "h" => Some("c"),
        _ => None,
    }
}

/// Independent side streams reset at gaps, so missing context cannot leak parser state.
pub(super) fn annotate(lines: &[DiffLine], paths: [&str; 2]) -> Vec<Spans> {
    let mut output = vec![[Vec::new(), Vec::new()]; lines.len()];

    for (side, path) in paths.into_iter().enumerate() {
        let Some(config) = language(path).and_then(|name| CONFIGS.get(name)) else {
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
                highlight(&block, lines, side, config, &mut output);
                block.clear();
            }

            block.push(index);
            previous = Some(coordinate);
        }

        highlight(&block, lines, side, config, &mut output);
    }

    output
}

fn highlight(
    block: &[usize],
    lines: &[DiffLine],
    side: usize,
    config: &HighlightConfiguration,
    output: &mut [Spans],
) {
    let mut source = String::new();
    let mut offsets = Vec::with_capacity(block.len());

    for &index in block {
        offsets.push(source.len());
        source.push_str(&lines[index].text);
        source.push('\n');
    }

    // Match the current app's syntax budget; ordinary patch rendering remains available.
    if source.len() > 512 * 1024
        || block.len() > 2000
        || block.iter().any(|&i| lines[i].text.len() > 4000)
    {
        return;
    }

    let mut highlighter = Highlighter::new();

    let Ok(events) = highlighter.highlight(config, source.as_bytes(), None, |_| None) else {
        return;
    };

    let mut stack = Vec::new();
    let mut row = 0;

    for event in events {
        match event {
            Ok(HighlightEvent::HighlightStart(kind)) => stack.push(kind.0),
            Ok(HighlightEvent::HighlightEnd) => {
                stack.pop();
            }
            Ok(HighlightEvent::Source { start, end }) => {
                while row < block.len() && offsets[row] + lines[block[row]].text.len() < start {
                    row += 1;
                }

                let Some(&kind) = stack.last() else { continue };

                let mut current = row;

                while current < block.len() && offsets[current] < end {
                    let line = &lines[block[current]];
                    let from = start.saturating_sub(offsets[current]).min(line.text.len());
                    let to = (end - offsets[current]).min(line.text.len());

                    if from < to {
                        // Transform UTF-8 source offsets through visible tabs/control characters.
                        let display_offset =
                            |end| super::document::display(&line.text[..end]).len();

                        output[block[current]][side].push(Span {
                            range: display_offset(from)..display_offset(to),
                            kind,
                        });
                    }

                    current += 1;
                }
            }
            Err(_) => {
                for &index in block {
                    output[index][side].clear();
                }

                return;
            }
        }
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
        assert_eq!(CONFIGS.len(), 11);

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

        assert!(spans[1][0].iter().any(|s| NAMES[s.kind] == "constant"));
        assert!(!spans[1][1].iter().any(|s| NAMES[s.kind] == "constant"));
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
