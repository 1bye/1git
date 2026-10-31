//! Read-only unified-patch parsing. Display rows are not a patch-editing or staging API.
use rake::gpui::SharedString;
use std::{fmt, sync::Arc};

const MAX_PATCH_BYTES: usize = 16 * 1024 * 1024;
const MAX_LINES: usize = 200_000;
const MAX_LINE_BYTES: usize = 64 * 1024;

/// Presentation of the same source patch.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DiffView {
    /// Old/new line-number gutters beside one ordered patch stream.
    #[default]
    Unified,
    /// Aligned before/after columns with synchronized scrolling.
    Split,
}

/// Meaning of a source row, independent of its color.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiffLineKind {
    /// File metadata, including binary/mode/rename descriptions.
    Metadata,
    /// A unified hunk header.
    Hunk,
    /// Unchanged context, consuming an old and a new line.
    Context,
    /// New content, consuming only a new line.
    Added,
    /// Removed content, consuming only an old line.
    Deleted,
}

/// One immutable source row. Code text excludes its patch prefix, but retains all source characters.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiffLine {
    /// Metadata, hunk, context, insertion or deletion.
    pub kind: DiffLineKind,
    /// Original-file coordinate; absent for additions and metadata.
    pub old_line: Option<u64>,
    /// Updated-file coordinate; absent for deletions and metadata.
    pub new_line: Option<u64>,
    /// Exact code text without the patch prefix or LF delimiter. CR characters are retained.
    pub text: SharedString,
    /// Git marked this source line as lacking a final newline.
    pub no_newline: bool,
    pub(super) display: SharedString,
}

#[derive(Clone, Copy, Debug)]
pub(super) enum Row {
    Single(usize),
    Pair {
        old: Option<usize>,
        new: Option<usize>,
    },
}

impl Row {
    pub fn anchor(self) -> usize {
        match self {
            Self::Single(index) => index,
            Self::Pair { old, new } => old
                .or(new)
                .expect("paired diff rows contain at least one source line"),
        }
    }

    pub fn contains(self, source: usize) -> bool {
        match self {
            Self::Single(index) => source == index,
            Self::Pair { old, new } => old == Some(source) || new == Some(source),
        }
    }
}

#[derive(Debug)]
struct Document {
    patch: String,
    lines: Vec<DiffLine>,
    unified: Vec<Row>,
    split: Vec<Row>,
    words: Vec<Vec<std::ops::Range<usize>>>,
    compact_unified: Vec<Row>,
    compact_split: Vec<Row>,
    added: usize,
    deleted: usize,
    binary: bool,
    columns: usize,
    digits: usize,
}

/// Cheaply cloned, immutable single-file diff, parsed once outside render. Contains no Git or filesystem access.
#[derive(Clone, Debug)]
pub struct DiffDocument(Arc<Document>, bool);

/// Invalid, unsupported or over-budget input; source coordinates are never invented for malformed patches.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiffParseError {
    line: usize,
    reason: &'static str,
}

impl DiffParseError {
    /// One-based patch line where validation failed; zero denotes the total byte budget.
    #[must_use]
    pub fn line(&self) -> usize {
        self.line
    }
}

impl fmt::Display for DiffParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "invalid diff at patch line {}: {}",
            self.line, self.reason
        )
    }
}

impl std::error::Error for DiffParseError {}

fn error(line: usize, reason: &'static str) -> DiffParseError {
    DiffParseError { line, reason }
}

struct Cursor {
    old: u64,
    new: u64,
    old_left: u64,
    new_left: u64,
}

impl Cursor {
    fn complete(&self) -> bool {
        self.old_left == 0 && self.new_left == 0
    }
}

fn range(text: &str, line: usize) -> Result<(u64, u64), DiffParseError> {
    let (start, count) = text.split_once(',').unwrap_or((text, "1"));

    if !start.bytes().all(|byte| byte.is_ascii_digit())
        || !count.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(error(line, "invalid hunk range"));
    }

    let start: u64 = start
        .parse()
        .map_err(|_| error(line, "hunk coordinate overflow"))?;

    let count: u64 = count
        .parse()
        .map_err(|_| error(line, "hunk count overflow"))?;

    if (start == 0 && count > 0) || start.checked_add(count).is_none() {
        return Err(error(line, "invalid hunk range"));
    }

    Ok((start, count))
}

fn hunk(text: &str, line: usize) -> Result<Cursor, DiffParseError> {
    let body = text
        .strip_prefix("@@ -")
        .ok_or_else(|| error(line, "invalid hunk header"))?;

    let (old, body) = body
        .split_once(" +")
        .ok_or_else(|| error(line, "missing new hunk range"))?;

    let (new, _) = body
        .split_once(" @@")
        .ok_or_else(|| error(line, "missing hunk terminator"))?;

    let (old, old_left) = range(old, line)?;
    let (new, new_left) = range(new, line)?;

    Ok(Cursor {
        old,
        new,
        old_left,
        new_left,
    })
}

fn display(text: &str) -> SharedString {
    let mut result = String::with_capacity(text.len());

    for character in text.chars() {
        match character {
            '\t' => result.push_str("→   "),
            '\r' => result.push('␍'),
            character if character.is_control() => result.extend(character.escape_default()),
            character => result.push(character),
        }
    }

    result.into()
}

fn split_rows(lines: &[DiffLine]) -> Vec<Row> {
    let mut rows = Vec::new();
    let mut index = 0;

    while index < lines.len() {
        match lines[index].kind {
            DiffLineKind::Added | DiffLineKind::Deleted => {
                let start = index;

                while index < lines.len()
                    && matches!(
                        lines[index].kind,
                        DiffLineKind::Added | DiffLineKind::Deleted
                    )
                {
                    index += 1;
                }

                let block = &lines[start..index];

                let mut old = block
                    .iter()
                    .enumerate()
                    .filter(|(_, line)| line.kind == DiffLineKind::Deleted)
                    .map(|(offset, _)| start + offset);

                let mut new = block
                    .iter()
                    .enumerate()
                    .filter(|(_, line)| line.kind == DiffLineKind::Added)
                    .map(|(offset, _)| start + offset);

                loop {
                    let (old, new) = (old.next(), new.next());

                    if old.is_none() && new.is_none() {
                        break;
                    }

                    rows.push(Row::Pair { old, new });
                }
            }
            DiffLineKind::Context => {
                rows.push(Row::Pair {
                    old: Some(index),
                    new: Some(index),
                });
                index += 1;
            }
            _ => {
                rows.push(Row::Single(index));
                index += 1;
            }
        }
    }

    rows
}

impl DiffDocument {
    /// Parse a single-file Git/unified patch, including repeated sections for file-type changes.
    /// Line counts and zero-length ranges are validated.
    ///
    /// # Errors
    /// Rejects combined/multiple-file patches, malformed or incomplete hunks, orphan newline markers,
    /// and inputs over 16 MiB, 200,000 rows or 64 KiB per source line. Pass individual files separately.
    pub fn parse(patch: &str) -> Result<Self, DiffParseError> {
        if patch.len() > MAX_PATCH_BYTES {
            return Err(error(0, "patch exceeds the 16 MiB display budget"));
        }

        let mut lines: Vec<DiffLine> = Vec::new();
        let mut cursor: Option<Cursor> = None;
        let mut previous = None;
        let mut file_header = None;
        let mut file_headers = 0;
        let mut binary = false;
        let mut binary_payload = false;
        let mut patch_lines = 0;

        for (index, text) in patch.split_terminator('\n').enumerate() {
            let number = index + 1;

            patch_lines = number;

            if number > MAX_LINES || text.len() > MAX_LINE_BYTES {
                return Err(error(
                    number,
                    "patch exceeds the row or line display budget",
                ));
            }

            if text.starts_with("@@@")
                || text.starts_with("diff --cc ")
                || text.starts_with("diff --combined ")
            {
                return Err(error(number, "combined diffs are unsupported"));
            }

            if text.starts_with("diff --git ") {
                if file_header.is_some_and(|first| first != text)
                    || (file_header.is_none() && !lines.is_empty())
                {
                    return Err(error(number, "display one file at a time"));
                }

                file_header = Some(text);
                // Type changes have deletion/addition sections with the same file header.
                file_headers = 0;
                binary_payload = false;
            }

            if binary_payload {
                continue;
            }

            if text.starts_with("@@") {
                if cursor.as_ref().is_some_and(|cursor| !cursor.complete()) {
                    return Err(error(number, "incomplete preceding hunk"));
                }

                cursor = Some(hunk(text, number)?);
                previous = None;
                lines.push(DiffLine {
                    kind: DiffLineKind::Hunk,
                    old_line: None,
                    new_line: None,
                    text: text.to_owned().into(),
                    no_newline: false,
                    display: display(text),
                });
                continue;
            }

            if text.strip_suffix('\r').unwrap_or(text) == "\\ No newline at end of file" {
                let position = previous
                    .take()
                    .ok_or_else(|| error(number, "orphan newline marker"))?;

                let line: &mut DiffLine = &mut lines[position];

                line.no_newline = true;
                line.display = format!("{}  ⟵ no final newline", line.display).into();
                continue;
            }

            if let Some(current) = &mut cursor {
                let kind = match text.as_bytes().first() {
                    Some(b' ') => Some(DiffLineKind::Context),
                    Some(b'+') => Some(DiffLineKind::Added),
                    Some(b'-') => Some(DiffLineKind::Deleted),
                    _ => None,
                };

                if let Some(kind) = kind {
                    let consumes_old = kind != DiffLineKind::Added;
                    let consumes_new = kind != DiffLineKind::Deleted;

                    if (consumes_old && current.old_left == 0)
                        || (consumes_new && current.new_left == 0)
                    {
                        return Err(error(number, "hunk exceeds its declared line counts"));
                    }

                    let old_line = consumes_old.then_some(current.old);
                    let new_line = consumes_new.then_some(current.new);

                    if consumes_old {
                        current.old += 1;
                        current.old_left -= 1;
                    }

                    if consumes_new {
                        current.new += 1;
                        current.new_left -= 1;
                    }

                    previous = Some(lines.len());
                    let source = &text[1..];

                    lines.push(DiffLine {
                        kind,
                        old_line,
                        new_line,
                        text: source.to_owned().into(),
                        no_newline: false,
                        display: display(source),
                    });
                    continue;
                }

                if !current.complete() {
                    return Err(error(number, "invalid or incomplete hunk body"));
                }
            }

            cursor = None;
            previous = None;

            if text.is_empty() {
                continue;
            }

            let metadata = [
                "diff --git ",
                "index ",
                "--- ",
                "+++ ",
                "old mode ",
                "new mode ",
                "new file mode ",
                "deleted file mode ",
                "similarity index ",
                "dissimilarity index ",
                "rename from ",
                "rename to ",
                "copy from ",
                "copy to ",
                "Binary files ",
                "GIT binary patch",
            ];

            if !metadata.iter().any(|prefix| text.starts_with(prefix)) {
                return Err(error(number, "unrecognized patch metadata"));
            }

            if text.starts_with("--- ") {
                file_headers += 1;

                if file_headers > 1 {
                    return Err(error(number, "display one file at a time"));
                }
            }

            binary_payload = text.starts_with("Binary files ") || text == "GIT binary patch";
            binary |= binary_payload;
            lines.push(DiffLine {
                kind: DiffLineKind::Metadata,
                old_line: None,
                new_line: None,
                text: text.to_owned().into(),
                no_newline: false,
                display: display(text),
            });
        }

        if cursor.as_ref().is_some_and(|cursor| !cursor.complete()) {
            return Err(error(patch_lines, "incomplete final hunk"));
        }

        let added = lines
            .iter()
            .filter(|line| line.kind == DiffLineKind::Added)
            .count();

        let deleted = lines
            .iter()
            .filter(|line| line.kind == DiffLineKind::Deleted)
            .count();

        // UTF-8 byte lengths bound monospace columns, including wide fallback glyphs.
        let columns = lines
            .iter()
            .map(|line| line.display.len())
            .max()
            .unwrap_or(0);

        let maximum = lines
            .iter()
            .flat_map(|line| [line.old_line, line.new_line])
            .flatten()
            .max()
            .unwrap_or(1);

        let digits = maximum.to_string().len().max(2);
        let unified: Vec<Row> = (0..lines.len()).map(Row::Single).collect();
        let split = split_rows(&lines);
        let words = super::words::annotate(&lines);
        let has_hunks = lines.iter().any(|line| line.kind == DiffLineKind::Hunk);

        let compact = |rows: &[Row]| {
            rows.iter()
                .copied()
                .filter(|row| !has_hunks || lines[row.anchor()].kind != DiffLineKind::Metadata)
                .collect()
        };

        let compact_unified = compact(&unified);
        let compact_split = compact(&split);

        Ok(Self(
            Arc::new(Document {
                patch: patch.to_owned(),
                lines,
                unified,
                split,
                words,
                compact_unified,
                compact_split,
                added,
                deleted,
                binary,
                columns,
                digits,
            }),
            false,
        ))
    }

    pub(super) fn word_ranges(&self, index: usize) -> &[std::ops::Range<usize>] {
        &self.0.words[index]
    }

    /// Exact input patch, useful for an application-owned Copy patch action.
    #[must_use]
    pub fn patch(&self) -> &str {
        &self.0.patch
    }

    /// Source rows with old/new coordinates and newline information.
    #[must_use]
    pub fn lines(&self) -> &[DiffLine] {
        &self.0.lines
    }

    /// Added source line count; binary changes have no textual line counts.
    #[must_use]
    pub fn added_lines(&self) -> usize {
        self.0.added
    }

    /// Deleted source line count.
    #[must_use]
    pub fn deleted_lines(&self) -> usize {
        self.0.deleted
    }

    /// Whether Git reported a binary change.
    #[must_use]
    pub fn is_binary(&self) -> bool {
        self.0.binary
    }

    /// Hide Git's file-envelope metadata when text hunks are present, retaining exact patch bytes.
    /// Binary and metadata-only changes remain visible. Derived row maps are prepared during parsing.
    #[must_use]
    pub fn without_file_metadata(&self) -> Self {
        Self(self.0.clone(), true)
    }

    pub(super) fn rows(&self, view: DiffView) -> &[Row] {
        if self.1 {
            return match view {
                DiffView::Unified => &self.0.compact_unified,
                DiffView::Split => &self.0.compact_split,
            };
        }

        match view {
            DiffView::Unified => &self.0.unified,
            DiffView::Split => &self.0.split,
        }
    }

    pub(super) fn same(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0) && self.1 == other.1
    }

    pub(super) fn columns(&self) -> usize {
        self.0.columns
    }

    pub(super) fn digits(&self) -> usize {
        self.0.digits
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_views_hide_only_file_headers_and_keep_exact_patch_and_binary_metadata() {
        let patch = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n";
        let document = DiffDocument::parse(patch).unwrap();
        let compact = document.without_file_metadata();

        assert_eq!(compact.patch(), patch);
        assert_eq!(compact.lines().len(), document.lines().len());
        assert_eq!(compact.rows(DiffView::Unified).len(), 3);
        assert_eq!(compact.rows(DiffView::Split).len(), 2);
        assert_eq!((compact.added_lines(), compact.deleted_lines()), (1, 1));
        assert!(!document.same(&compact));
        assert!(compact.same(&compact.without_file_metadata()));
        let metadata =
            DiffDocument::parse("diff --git a/a b/a\nBinary files a/a and b/a differ\n").unwrap();

        assert_eq!(
            metadata.rows(DiffView::Unified).len(),
            metadata
                .without_file_metadata()
                .rows(DiffView::Unified)
                .len()
        );
    }

    #[test]
    fn coordinates_counts_and_unequal_replacements_are_exact() {
        let document = DiffDocument::parse("--- a/test\n+++ b/test\n@@ -10,4 +20,5 @@ section\n context\n-old one\n-old two\n+new one\n+new two\n+new three\n end\n@@ -50 +60 @@\n-before\n+after\n").unwrap();
        let lines = document.lines();

        assert_eq!((document.added_lines(), document.deleted_lines()), (4, 3));
        assert_eq!((lines[3].old_line, lines[3].new_line), (Some(10), Some(20)));
        assert_eq!((lines[4].old_line, lines[4].new_line), (Some(11), None));
        assert_eq!((lines[6].old_line, lines[6].new_line), (None, Some(21)));
        assert_eq!((lines[9].old_line, lines[9].new_line), (Some(13), Some(24)));
        assert_eq!(
            (lines[11].old_line, lines[12].new_line),
            (Some(50), Some(60))
        );
        let split = document.rows(DiffView::Split);

        assert!(matches!(
            split[4],
            Row::Pair {
                old: Some(4),
                new: Some(6)
            }
        ));
        assert!(matches!(
            split[5],
            Row::Pair {
                old: Some(5),
                new: Some(7)
            }
        ));
        assert!(matches!(
            split[6],
            Row::Pair {
                old: None,
                new: Some(8)
            }
        ));
        assert!(matches!(
            split[7],
            Row::Pair {
                old: Some(9),
                new: Some(9)
            }
        ));
    }

    #[test]
    fn creation_deletion_and_empty_ranges_do_not_invent_coordinates() {
        for (patch, old, new) in [
            ("@@ -0,0 +1,2 @@\n+a\n+b\n", None, Some(1)),
            ("@@ -1,2 +0,0 @@\n-a\n-b\n", Some(1), None),
        ] {
            let document = DiffDocument::parse(patch).unwrap();

            assert_eq!(
                (document.lines()[1].old_line, document.lines()[1].new_line),
                (old, new)
            );
        }

        assert!(DiffDocument::parse("@@ -0,0 +0,0 @@\n").is_ok());
        assert!(DiffDocument::parse("").unwrap().lines().is_empty());
    }

    #[test]
    fn source_unicode_control_characters_and_newline_information_are_preserved() {
        let patch = "@@ -1 +1 @@\n-\told\r\n\\ No newline at end of file\n+\tこんにちは café 👋\r\n\\ No newline at end of file\n";
        let document = DiffDocument::parse(patch).unwrap();

        assert_eq!(document.patch(), patch);
        assert_eq!(document.lines()[1].text.as_ref(), "\told\r");
        assert_eq!(document.lines()[2].text.as_ref(), "\tこんにちは café 👋\r");
        assert!(document.lines()[1..].iter().all(|line| line.no_newline));
        assert!(
            document.lines()[2]
                .display
                .contains("→   こんにちは café 👋␍")
        );
        assert_eq!(display("\0\u{1b}"), "\\u{0}\\u{1b}");
    }

    #[test]
    fn header_like_code_is_source_inside_a_hunk() {
        let document =
            DiffDocument::parse("@@ -1 +1 @@\n--- removed code\n+++ added code\n").unwrap();

        assert_eq!(document.lines()[1].text, "-- removed code");
        assert_eq!(document.lines()[2].text, "++ added code");
    }

    #[test]
    fn binary_payload_and_file_only_changes_have_no_text_counts() {
        for patch in [
            "diff --git a/a b/a\nBinary files a/a and b/a differ\n",
            "diff --git a/a b/a\nGIT binary patch\nliteral 3\nencoded payload\n",
            "diff --git a/a b/b\nsimilarity index 100%\nrename from a\nrename to b\nold mode 100644\nnew mode 100755\n",
        ] {
            let document = DiffDocument::parse(patch).unwrap();

            assert_eq!((document.added_lines(), document.deleted_lines()), (0, 0));
            assert!(
                document
                    .lines()
                    .iter()
                    .all(|line| line.kind == DiffLineKind::Metadata)
            );
            assert_eq!(
                document.is_binary(),
                patch.contains("Binary") || patch.contains("binary")
            );
            assert_eq!(document.patch(), patch);
        }
    }

    #[test]
    fn file_type_changes_keep_both_sections_and_binary_payload_boundaries() {
        let patch = "diff --git a/changed b/changed\ndeleted file mode 120000\n--- a/changed\n+++ /dev/null\n@@ -1 +0,0 @@\n-target\n\\ No newline at end of file\ndiff --git a/changed b/changed\nnew file mode 100644\n--- /dev/null\n+++ b/changed\n@@ -0,0 +1 @@\n+regular file\n";
        let document = DiffDocument::parse(patch).unwrap();

        assert_eq!(document.patch(), patch);
        assert_eq!((document.deleted_lines(), document.added_lines()), (1, 1));
        assert!(
            document
                .lines()
                .iter()
                .any(|line| line.kind == DiffLineKind::Deleted
                    && line.old_line == Some(1)
                    && line.no_newline)
        );
        assert!(
            document
                .lines()
                .iter()
                .any(|line| line.kind == DiffLineKind::Added && line.new_line == Some(1))
        );
        let binary = "diff --git a/changed b/changed\ndeleted file mode 100644\nGIT binary patch\nliteral 3\nencoded payload\ndiff --git a/changed b/changed\nnew file mode 120000\n--- /dev/null\n+++ b/changed\n@@ -0,0 +1 @@\n+target\n\\ No newline at end of file\n";
        let document = DiffDocument::parse(binary).unwrap();

        assert!(document.is_binary());
        assert_eq!(document.added_lines(), 1);
        assert!(document.lines().last().unwrap().no_newline);
        assert!(DiffDocument::parse("--- a/a\n+++ b/a\ndiff --git a/b b/b\n").is_err());
        assert!(
            DiffDocument::parse(&binary.replace(
                "diff --git a/changed b/changed\nnew",
                "diff --git a/other b/other\nnew"
            ))
            .is_err()
        );
    }

    #[test]
    fn malformed_incomplete_and_unsupported_patches_fail_with_a_location() {
        for patch in [
            "@@ -1,2 +1,2 @@\n a\n",
            "@@ -1 +1 @@\n a\n+extra\n",
            "@@ -1 +1 @@\n a\n context overflow\n",
            "@@ -1,2 +1,2 @@\n a\n@@ -5 +5 @@\n b\n",
            "@@ -1 +1 @@\nunprefixed\n",
            "@@ -0 +1 @@\n-a\n+b\n",
            "@@ -18446744073709551615 +1 @@\n-a\n+b\n",
            "@@ -1,18446744073709551616 +1 @@\n",
            "@@ -1,-2 +1 @@\n",
            "@@ -1 +1\n",
            "@@@ -1,1 -1,1 +1,1 @@@\n",
            "diff --cc a\n",
            "--- a/a\n+++ b/a\n--- a/b\n+++ b/b\n",
            "diff --combined a\n",
            "\\ No newline at end of file\n",
            "@@ -1 +1 @@\n a\n\\ No newline at end of file\n\\ No newline at end of file\n",
            "diff --git a/a b/a\n@@ -1 +1 @@\n a\ndiff --git a/b b/b\n",
            "diff --git a/a b/a\nBinary files a/a and b/a differ\ndiff --git a/b b/b\n",
        ] {
            let error = DiffDocument::parse(patch).expect_err(patch);

            assert!(error.line() > 0, "{patch}");
            assert!(error.to_string().contains("patch line"));
        }

        assert_eq!(
            DiffDocument::parse("@@ -1 +1 @@\n a\n+extra\n")
                .unwrap_err()
                .line(),
            3
        );
    }

    #[test]
    fn budgets_reject_pathological_input_before_render() {
        assert!(DiffDocument::parse(&"x".repeat(MAX_PATCH_BYTES + 1)).is_err());
        assert!(
            DiffDocument::parse(&format!("@@ -0,0 +1 @@\n+{}", "x".repeat(MAX_LINE_BYTES)))
                .is_err()
        );
        assert!(DiffDocument::parse(&"\n".repeat(MAX_LINES + 1)).is_err());
        fn send_sync<T: Send + Sync>() {}
        send_sync::<DiffDocument>();
    }
}
