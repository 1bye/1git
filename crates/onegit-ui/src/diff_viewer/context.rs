//! Snapshot-bound context expansion. Hidden rows never become staging input.
use super::{DiffDocument, DiffLine, DiffLineKind, syntax};
use std::{collections::HashMap, sync::Arc};

#[derive(Clone, Debug)]
pub(super) struct Source {
    pub full: DiffDocument,
    pub syntax: Vec<syntax::Spans>,
    context: HashMap<(Option<u64>, Option<u64>), usize>,
    end: Option<(u64, u64)>,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct Request {
    pub old: u64,
    pub new: u64,
    pub after: bool,
    pub count: usize,
}

#[derive(Clone)]
struct Hunk {
    old: u64,
    new: u64,
    old_count: u64,
    new_count: u64,
    suffix: String,
    lines: Vec<DiffLine>,
}

fn hunks(document: &DiffDocument) -> Vec<Hunk> {
    let mut result: Vec<Hunk> = Vec::new();

    for line in document.lines() {
        if line.kind == DiffLineKind::Hunk {
            let (ranges, suffix) = line.text[4..].split_once(" @@").expect("validated hunk");
            let (old, new) = ranges.split_once(" +").expect("validated ranges");

            let range = |text: &str| {
                let (start, count) = text.split_once(',').unwrap_or((text, "1"));

                (
                    start.parse().expect("validated start"),
                    count.parse().expect("validated count"),
                )
            };

            let (old, old_count) = range(old);
            let (new, new_count) = range(new);

            result.push(Hunk {
                old,
                new,
                old_count,
                new_count,
                suffix: suffix.to_owned(),
                lines: Vec::new(),
            });
        } else if line.kind != DiffLineKind::Metadata
            && let Some(hunk) = result.last_mut()
        {
            hunk.lines.push(line.clone());
        }
    }

    result
}

fn headers(document: &DiffDocument) -> Vec<&str> {
    document
        .lines()
        .iter()
        .filter(|l| l.kind == DiffLineKind::Metadata)
        .map(|l| l.text.as_ref())
        .collect()
}

type Edit<'a> = (DiffLineKind, Option<u64>, Option<u64>, &'a str, bool);

fn edits(document: &DiffDocument) -> Vec<Edit<'_>> {
    document
        .lines()
        .iter()
        .filter(|l| matches!(l.kind, DiffLineKind::Added | DiffLineKind::Deleted))
        .map(|l| {
            (
                l.kind,
                l.old_line,
                l.new_line,
                l.text.as_ref(),
                l.no_newline,
            )
        })
        .collect()
}

pub(super) fn compatible(visible: &DiffDocument, full: &DiffDocument) -> bool {
    // Repeated file-type sections have ambiguous coordinates; keep their ordinary preview.
    if headers(visible) != headers(full)
        || edits(visible) != edits(full)
        || headers(visible)
            .iter()
            .filter(|l| l.starts_with("diff --git "))
            .count()
            > 1
    {
        return false;
    }

    let contexts: HashMap<_, _> = full
        .lines()
        .iter()
        .filter(|l| l.kind == DiffLineKind::Context)
        .map(|l| ((l.old_line, l.new_line), (&l.text, l.no_newline)))
        .collect();

    visible
        .lines()
        .iter()
        .filter(|l| l.kind == DiffLineKind::Context)
        .all(|l| contexts.get(&(l.old_line, l.new_line)) == Some(&(&l.text, l.no_newline)))
}

pub(super) fn syntax_for(document: &DiffDocument, source: &Source) -> Vec<syntax::Spans> {
    document
        .lines()
        .iter()
        .map(|line| {
            source
                .context
                .get(&(line.old_line, line.new_line))
                .map(|&i| source.syntax[i].clone())
                .unwrap_or_default()
        })
        .collect()
}

impl DiffDocument {
    /// Prepare syntax and optional hidden context outside render. Paths are language hints only.
    /// A full patch from a different snapshot is ignored; visible bytes are never replaced.
    #[must_use]
    pub fn with_source(&self, old_path: &str, new_path: &str, full_patch: Option<&str>) -> Self {
        let full = full_patch
            .and_then(|patch| Self::parse(patch).ok())
            .filter(|full| compatible(self, full));

        let mut data = (*self.0).clone();

        data.paths = [old_path.to_owned(), new_path.to_owned()];

        if let Some(full) = full {
            let syntax = syntax::annotate(full.lines(), [old_path, new_path]);

            let context = full
                .lines()
                .iter()
                .enumerate()
                .filter(|(_, l)| l.kind != DiffLineKind::Hunk && l.kind != DiffLineKind::Metadata)
                .map(|(i, l)| ((l.old_line, l.new_line), i))
                .collect();

            let end = full
                .lines()
                .iter()
                .rfind(|l| l.kind == DiffLineKind::Hunk)
                .map(|l| {
                    super::document::hunk(&l.text, 0)
                        .expect("validated hunk")
                        .end()
                });

            let source = Arc::new(Source {
                full,
                syntax,
                context,
                end,
            });

            data.syntax = syntax_for(self, &source);
            data.context = Some(source);
        } else {
            data.syntax = syntax::annotate(self.lines(), [old_path, new_path]);
            data.context = None;
        }

        if data.syntax.iter().all(|s| s.iter().all(Vec::is_empty)) {
            data.syntax = syntax::annotate(self.lines(), [old_path, new_path]);
        }

        let mut result = Self(Arc::new(data), self.1);

        result.prepare_requests();

        result
    }

    fn prepare_requests(&mut self) {
        let Some(source) = &self.0.context else {
            Arc::make_mut(&mut self.0).requests.clear();

            return;
        };

        let mut requests = Vec::new();
        let mut old_end = 1;
        let mut new_end = 1;

        let headers = self
            .lines()
            .iter()
            .enumerate()
            .filter(|(_, l)| l.kind == DiffLineKind::Hunk)
            .map(|(i, _)| i);

        let hunks = hunks(self);

        for (header, hunk) in headers.zip(&hunks) {
            let old_gap = hunk.old.saturating_sub(old_end);
            let new_gap = hunk.new.saturating_sub(new_end);
            let count = old_gap.min(20) as usize;

            if old_gap > 0
                && old_gap == new_gap
                && (0..count as u64).all(|n| {
                    source.context.contains_key(&(
                        Some(hunk.old - count as u64 + n),
                        Some(hunk.new - count as u64 + n),
                    ))
                })
            {
                requests.push((
                    Some(header),
                    Request {
                        old: hunk.old,
                        new: hunk.new,
                        after: false,
                        count,
                    },
                ));
            }

            old_end = hunk.old + hunk.old_count;
            new_end = hunk.new + hunk.new_count;
        }

        if let (Some(last), Some((old, new))) = (hunks.last(), source.end)
            && let (Some(old), Some(new)) = (old.checked_sub(old_end), new.checked_sub(new_end))
        {
            let count = old.min(new).min(20) as usize;

            if count > 0
                && (0..count as u64).all(|n| {
                    source
                        .context
                        .contains_key(&(Some(old_end + n), Some(new_end + n)))
                })
            {
                requests.push((
                    None,
                    Request {
                        old: last.old,
                        new: last.new,
                        after: true,
                        count,
                    },
                ));
            }
        }

        Arc::make_mut(&mut self.0).requests = requests;
    }

    pub(super) fn request(&self, header: Option<usize>, after: bool) -> Option<Request> {
        self.0
            .requests
            .iter()
            .find(|(index, request)| {
                if after {
                    request.after
                } else {
                    header.is_none() || *index == header
                }
            })
            .map(|(_, request)| *request)
    }

    pub(super) fn expand(&self, request: Request) -> Result<Self, &'static str> {
        let source = self
            .0
            .context
            .as_ref()
            .ok_or("Refresh the diff to load unchanged context.")?;

        let mut hunks = hunks(self);

        let index = hunks
            .iter()
            .position(|h| h.old == request.old && h.new == request.new)
            .ok_or("This diff section is no longer available.")?;

        let hunk = &mut hunks[index];

        let old = if request.after {
            hunk.old + hunk.old_count
        } else {
            hunk.old - request.count as u64
        };

        let new = if request.after {
            hunk.new + hunk.new_count
        } else {
            hunk.new - request.count as u64
        };

        let mut context: Vec<_> = (0..request.count as u64)
            .filter_map(|n| {
                source
                    .context
                    .get(&(Some(old + n), Some(new + n)))
                    .map(|&i| source.full.lines()[i].clone())
            })
            .collect();

        if context.len() != request.count {
            return Err(
                "Git did not return the requested context. Refresh the diff and try again.",
            );
        }

        if request.after {
            hunk.lines.append(&mut context)
        } else {
            context.append(&mut hunk.lines);
            hunk.lines = context;
            hunk.old = old;
            hunk.new = new;
        }

        hunk.old_count += request.count as u64;
        hunk.new_count += request.count as u64;

        if index > 0
            && hunks[index - 1].old + hunks[index - 1].old_count == hunks[index].old
            && hunks[index - 1].new + hunks[index - 1].new_count == hunks[index].new
        {
            let current = hunks.remove(index);
            let previous = &mut hunks[index - 1];

            previous.old_count += current.old_count;
            previous.new_count += current.new_count;
            previous.lines.extend(current.lines);
        }

        let mut patch = headers(self).join("\n");

        if !patch.is_empty() {
            patch.push('\n')
        }

        for hunk in hunks {
            patch.push_str(&format!(
                "@@ -{},{} +{},{} @@{}\n",
                hunk.old, hunk.old_count, hunk.new, hunk.new_count, hunk.suffix
            ));

            for line in hunk.lines {
                patch.push(match line.kind {
                    DiffLineKind::Added => '+',
                    DiffLineKind::Deleted => '-',
                    _ => ' ',
                });
                patch.push_str(&line.text);
                patch.push('\n');

                if line.no_newline {
                    patch.push_str("\\ No newline at end of file\n")
                }
            }
        }

        if patch.len() > 512 * 1024
            || patch.lines().count() > 2000
            || patch.lines().any(|l| l.len() > 4000)
        {
            return Err(
                "This preview reached its safe size limit. Open the file in your editor to read more.",
            );
        }

        let mut expanded = Self::parse(&patch)
            .map_err(|_| "Could not expand this diff. Refresh and try again.")?;

        let mut syntax = syntax_for(&expanded, source);

        if syntax.iter().all(|s| s.iter().all(Vec::is_empty)) {
            syntax = syntax::annotate(expanded.lines(), [&self.0.paths[0], &self.0.paths[1]]);
        }

        let data = Arc::make_mut(&mut expanded.0);

        data.syntax = syntax;
        data.context = Some(source.clone());
        data.paths = self.0.paths.clone();
        expanded.1 = self.1;
        expanded.prepare_requests();

        Ok(expanded)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patch(context: usize, final_newline: bool) -> String {
        let mut patch="diff --git a/context.ts b/context.ts\nindex 1111111..2222222 100644\n--- a/context.ts\n+++ b/context.ts\n".to_owned();

        let ranges = if context >= 30 {
            vec![(1, 150)]
        } else {
            vec![(40 - context, 40 + context), (100 - context, 100 + context)]
        };

        for (start, end) in ranges {
            patch.push_str(&format!(
                "@@ -{start},{} +{start},{} @@ example\n",
                end - start + 1,
                end - start + 1
            ));

            for n in start..=end {
                if n == 40 || n == 100 {
                    patch.push_str(&format!("-line {n}\n+changed {n}\n"))
                } else {
                    patch.push_str(&format!(" line {n}  \r\n"))
                }

                if n == 150 && !final_newline {
                    patch.push_str("\\ No newline at end of file\n")
                }
            }
        }

        patch
    }

    fn document(final_newline: bool) -> DiffDocument {
        DiffDocument::parse(&patch(3, true))
            .unwrap()
            .with_source("a.ts", "a.ts", Some(&patch(150, final_newline)))
            .without_file_metadata()
    }

    fn header(document: &DiffDocument, old: u64) -> usize {
        document
            .lines()
            .iter()
            .position(|l| {
                l.kind == DiffLineKind::Hunk
                    && super::super::document::hunk(&l.text, 0).unwrap().old == old
            })
            .unwrap()
    }

    #[test]
    fn clicked_gap_expands_twenty_then_remainder_and_merges_only_adjacent_hunks() {
        let mut document = document(true);
        let initial = document.patch().to_owned();

        for (start, count) in [(97, 20), (77, 20), (57, 13)] {
            let request = document
                .request(Some(header(&document, start)), false)
                .unwrap();

            assert_eq!(request.count, count);
            document = document.expand(request).unwrap();
            assert_eq!(
                edits(&document),
                edits(&DiffDocument::parse(&initial).unwrap())
            );
        }

        assert_eq!(hunks(&document).len(), 1);
        assert_eq!(hunks(&document)[0].old, 37);
        assert!(document.patch().contains(" line 44  \r\n"));
        assert!(document.patch().contains(" line 96  \r\n"));
        assert!(document.1);
    }

    #[test]
    fn leading_and_trailing_expansion_reaches_eof_without_inventing_newline() {
        for final_newline in [true, false] {
            let mut document = document(final_newline);

            for end in [123, 143, 150] {
                let request = document.request(None, true).unwrap();

                document = document.expand(request).unwrap();
                assert_eq!(document.lines().last().unwrap().old_line, Some(end));
            }

            assert!(document.request(None, true).is_none());
            assert_eq!(document.lines().last().unwrap().no_newline, !final_newline);
            let request = document.request(None, false).unwrap();

            assert_eq!(request.count, 20);
            document = document.expand(request).unwrap();
            assert_eq!(document.request(None, false).unwrap().count, 16);
            document = document
                .expand(document.request(None, false).unwrap())
                .unwrap();
            assert_eq!(hunks(&document)[0].old, 1);
        }
    }

    #[test]
    fn mismatched_edits_headers_and_context_are_rejected_without_changing_visible_patch() {
        let visible = patch(3, true);

        for full in [
            patch(150, true).replace("changed 40", "external edit"),
            patch(150, true).replace("1111111", "aaaaaaa"),
            patch(150, true).replace(" line 39  \r", " changed 39"),
        ] {
            let document =
                DiffDocument::parse(&visible)
                    .unwrap()
                    .with_source("a.ts", "a.ts", Some(&full));

            assert!(document.0.context.is_none());
            assert!(document.request(None, false).is_none());
            assert_eq!(document.patch(), visible);
        }
    }

    #[test]
    fn additions_and_deletions_have_no_context_and_expansion_respects_display_budget() {
        for patch in [
            "--- /dev/null\n+++ b/new\n@@ -0,0 +1 @@\n+text\n",
            "--- a/deleted\n+++ /dev/null\n@@ -1 +0,0 @@\n-text\n",
        ] {
            let document =
                DiffDocument::parse(patch)
                    .unwrap()
                    .with_source("a.ts", "a.ts", Some(patch));

            assert!(document.request(None, false).is_none());
        }

        let prefix = "old mode 100644\n".repeat(1990);
        let prepend = |patch: String| patch.replacen("index ", &format!("{prefix}index "), 1);

        let document = DiffDocument::parse(&prepend(patch(3, true)))
            .unwrap()
            .with_source("a.ts", "a.ts", Some(&prepend(patch(150, true))));

        assert!(
            document
                .expand(document.request(None, true).unwrap())
                .unwrap_err()
                .contains("safe size")
        );
    }

    #[test]
    fn hidden_multiline_context_is_highlighted_but_not_displayed_and_sides_use_distinct_languages()
    {
        let visible = "--- a/old.py\n+++ b/new.ts\n@@ -2 +2 @@\n-old\n+return 42;\n";
        let full = "--- a/old.py\n+++ b/new.ts\n@@ -1,3 +1,3 @@\n-\"\"\"\n-old\n-\"\"\"\n+/*\n+return 42;\n+*/\n";

        // Different edit sequences must be rejected even when coordinates overlap.
        let document =
            DiffDocument::parse(visible)
                .unwrap()
                .with_source("old.py", "new.ts", Some(full));

        assert!(document.0.context.is_none());
        let visible = "@@ -2 +2 @@\n-old\n+new\n";
        let full = "@@ -1,3 +1,3 @@\n /*\n-old\n+new\n */\n";

        let document =
            DiffDocument::parse(visible)
                .unwrap()
                .with_source("a.ts", "a.ts", Some(full));

        assert_eq!(document.lines().len(), 3);
        assert!(document.0.syntax[1][0].iter().all(|s| s.kind == 0));
        assert!(!document.0.syntax[1][0].is_empty());
        assert!(!document.0.syntax[2][1].is_empty());
        let syntax = &document.0.context.as_ref().unwrap().syntax;

        let expanded = document
            .expand(document.request(None, false).unwrap())
            .unwrap();

        assert!(Arc::ptr_eq(
            document.0.context.as_ref().unwrap(),
            expanded.0.context.as_ref().unwrap()
        ));
        assert_eq!(syntax.len(), 5);
    }
}
