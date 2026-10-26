//! Source-compatible line inclusion, ported from packages/git/src/partial-patch.ts.

use std::collections::HashSet;
use std::fmt;
use std::sync::LazyLock;

use regex::Regex;

static HUNK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^@@ -([0-9]+)(?:,([0-9]+))? \+([0-9]+)(?:,([0-9]+))? @@")
        .expect("literal partial hunk header")
});

// ECMAScript multiline anchors/dots recognize CR, LF and both Unicode separators.
static UNSUPPORTED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"(?:^|[\r\n\u{2028}\u{2029}])(?:rename |copy |old mode |new mode |",
        r"GIT binary patch|Binary files|(?:new|deleted) file mode (?:120000|160000)|",
        r"index [^\r\n\u{2028}\u{2029}]* (?:120000|160000))"
    ))
    .expect("literal unsupported partial patch forms")
});

/// An unsupported/malformed text patch or an obsolete line selection.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PartialPatchError {
    /// Binary, link, submodule, rename, copy or mode changes need whole-file inclusion.
    WholeFileOnly,
    /// A new hunk starts before the preceding hunk finishes.
    Incomplete,
    /// More than one file header appears before a hunk.
    MultipleFiles,
    /// A no-newline marker has no preceding line.
    InvalidNewlineMarker,
    /// A hunk body contains an unrecognized prefix.
    InvalidLine,
    /// A hunk consumes more lines than its header declares.
    InvalidCounts,
    /// No complete selectable changes remain after parsing.
    NoTextChanges,
    /// The selection is empty or names an unavailable coordinate.
    InvalidSelection,
    /// A partial deletion lacks the old/destination header needed to retain the file.
    InvalidDeletedFile,
}

impl fmt::Display for PartialPatchError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::WholeFileOnly => "This change only supports whole-file inclusion.",
            Self::Incomplete => "Incomplete diff.",
            Self::MultipleFiles => "Select one file at a time.",
            Self::InvalidNewlineMarker => "Invalid newline marker.",
            Self::InvalidLine => "Invalid diff line.",
            Self::InvalidCounts => "Invalid diff counts.",
            Self::NoTextChanges => "No complete text changes to select.",
            Self::InvalidSelection => "The selected lines no longer exist.",
            Self::InvalidDeletedFile => "Invalid deleted-file patch.",
        })
    }
}

impl std::error::Error for PartialPatchError {}

#[derive(Debug)]
struct Line<'a> {
    text: &'a str,
    key: Option<String>,
    no_newline: bool,
}

#[derive(Debug)]
struct Hunk<'a> {
    old_start: f64,
    lines: Vec<Line<'a>>,
}

/// Borrowed, read-only text patch with stable old/deleted and new/added coordinates.
/// Parsing/selection performs no I/O and never applies a patch or changes Git staging.
/// Keep the original patch alive while using this value. The commit owner must
/// separately recheck its reviewed patch against Git before writing an isolated index.
///
/// ```
/// use onegit_git::PartialPatch;
/// let source = "diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n";
/// let patch = PartialPatch::new(source)?;
/// assert_eq!(patch.lines(), &["-:1", "+:1"]);
/// let selected = patch.select(&["+:1".to_owned()])?;
/// assert!(selected.contains(" old\n+new\n"));
/// # Ok::<(), onegit_git::PartialPatchError>(())
/// ```
#[derive(Debug)]
pub struct PartialPatch<'a> {
    header: Vec<&'a str>,
    hunks: Vec<Hunk<'a>>,
    lines: Vec<String>,
}

impl<'a> PartialPatch<'a> {
    /// Parse the exact LF-delimited source patch, preserving CR and newline markers.
    /// Coordinates retain the source's ECMAScript number/string semantics.
    ///
    /// # Errors
    /// Returns the source-compatible unsupported/header/body/count error.
    pub fn new(patch: &'a str) -> Result<Self, PartialPatchError> {
        let mut source: Vec<_> = patch.split('\n').collect();

        if source.last() == Some(&"") {
            source.pop();
        }

        if source
            .first()
            .is_none_or(|line| !line.starts_with("diff --git "))
            || UNSUPPORTED.is_match(patch)
        {
            return Err(PartialPatchError::WholeFileOnly);
        }

        let mut parsed = Self {
            header: Vec::new(),
            hunks: Vec::new(),
            lines: Vec::new(),
        };

        let mut current = None;

        let (mut old_line, mut new_line, mut old_remaining, mut new_remaining) =
            (0.0, 0.0, 0.0, 0.0);

        for text in source {
            if let Some(captures) = HUNK.captures(text) {
                if old_remaining != 0.0 || new_remaining != 0.0 {
                    return Err(PartialPatchError::Incomplete);
                }

                old_line = coordinate(&captures[1]);
                new_line = coordinate(&captures[3]);
                old_remaining = captures
                    .get(2)
                    .map_or(1.0, |value| coordinate(value.as_str()));
                new_remaining = captures
                    .get(4)
                    .map_or(1.0, |value| coordinate(value.as_str()));
                current = Some(parsed.hunks.len());
                parsed.hunks.push(Hunk {
                    old_start: old_line,
                    lines: Vec::new(),
                });
                continue;
            }

            let Some(index) = current else {
                if !parsed.header.is_empty() && text.starts_with("diff --git ") {
                    return Err(PartialPatchError::MultipleFiles);
                }

                parsed.header.push(text);
                continue;
            };

            let hunk = &mut parsed.hunks[index];

            if text == "\\ No newline at end of file" {
                let Some(previous) = hunk.lines.last_mut() else {
                    return Err(PartialPatchError::InvalidNewlineMarker);
                };

                previous.no_newline = true;
                continue;
            }

            let key = match text.as_bytes().first() {
                Some(b'-') => {
                    let key = format!("-:{}", coordinate_text(old_line));

                    old_line += 1.0;
                    old_remaining -= 1.0;

                    Some(key)
                }
                Some(b'+') => {
                    let key = format!("+:{}", coordinate_text(new_line));

                    new_line += 1.0;
                    new_remaining -= 1.0;

                    Some(key)
                }
                Some(b' ') => {
                    old_line += 1.0;
                    new_line += 1.0;
                    old_remaining -= 1.0;
                    new_remaining -= 1.0;

                    None
                }
                _ => return Err(PartialPatchError::InvalidLine),
            };

            if old_remaining < 0.0 || new_remaining < 0.0 {
                return Err(PartialPatchError::InvalidCounts);
            }

            if let Some(key) = &key {
                parsed.lines.push(key.clone());
            }

            hunk.lines.push(Line {
                text,
                key,
                no_newline: false,
            });
        }

        if old_remaining != 0.0 || new_remaining != 0.0 || parsed.lines.is_empty() {
            return Err(PartialPatchError::NoTextChanges);
        }

        Ok(parsed)
    }

    /// Ordered source coordinates, including duplicates in overlapping/malformed hunks.
    pub fn lines(&self) -> &[String] {
        &self.lines
    }

    /// Build only selected changes: retain excluded deletions as context and drop
    /// excluded additions. Strip stale index headers; retain exact newline markers.
    /// Duplicate selected coordinates have the source's set semantics.
    ///
    /// # Errors
    /// Returns an empty/obsolete selection or a malformed partial-deletion header.
    pub fn select(&self, included_lines: &[String]) -> Result<String, PartialPatchError> {
        let selected: HashSet<_> = included_lines.iter().map(String::as_str).collect();
        let available: HashSet<_> = self.lines.iter().map(String::as_str).collect();

        if selected.is_empty() || !selected.is_subset(&available) {
            return Err(PartialPatchError::InvalidSelection);
        }

        let mut output: Vec<_> = self
            .header
            .iter()
            .filter(|line| !line.starts_with("index "))
            .map(|line| (*line).to_owned())
            .collect();

        if let Some(index) = output
            .iter()
            .position(|line| line.starts_with("deleted file mode "))
            && selected.len() < available.len()
        {
            output.remove(index);
            let old_path = output.iter().find_map(|line| line.strip_prefix("--- "));
            let destination = output.iter().position(|line| line == "+++ /dev/null");

            let (Some(old_path), Some(destination)) =
                (old_path.filter(|path| !path.is_empty()), destination)
            else {
                return Err(PartialPatchError::InvalidDeletedFile);
            };

            let path = if let Some(path) = old_path.strip_prefix("a/") {
                format!("b/{path}")
            } else if let Some(path) = old_path.strip_prefix("\"a/") {
                format!("\"b/{path}")
            } else {
                old_path.to_owned()
            };

            output[destination] = format!("+++ {path}");
        }

        let mut delta = 0.0;

        for hunk in &self.hunks {
            if !hunk.lines.iter().any(|line| {
                line.key
                    .as_deref()
                    .is_some_and(|key| selected.contains(key))
            }) {
                continue;
            }

            let mut body = Vec::new();
            let (mut old_count, mut new_count) = (0_usize, 0_usize);

            for line in &hunk.lines {
                let included = line
                    .key
                    .as_deref()
                    .is_some_and(|key| selected.contains(key));

                if line.text.starts_with('+') && !included {
                    continue;
                }

                let text = if line.text.starts_with('-') && !included {
                    format!(" {}", &line.text[1..])
                } else {
                    line.text.to_owned()
                };

                old_count += usize::from(!text.starts_with('+'));
                new_count += usize::from(!text.starts_with('-'));
                body.push(text);

                if line.no_newline {
                    body.push("\\ No newline at end of file".to_owned());
                }
            }

            let mut new_start = hunk.old_start + delta;

            if old_count == 0 {
                new_start += 1.0;
            }

            if new_count == 0 {
                new_start -= 1.0;
            }

            output.push(format!(
                "@@ -{},{old_count} +{},{new_count} @@",
                coordinate_text(hunk.old_start),
                coordinate_text(new_start)
            ));
            output.extend(body);
            delta += new_count as f64 - old_count as f64;
        }

        Ok(output.join("\n") + "\n")
    }
}

fn coordinate(value: &str) -> f64 {
    value.parse().unwrap_or(f64::INFINITY)
}

fn coordinate_text(value: f64) -> String {
    if value == 0.0 {
        return "0".to_owned();
    }

    if value.is_infinite() {
        return if value.is_sign_negative() {
            "-Infinity"
        } else {
            "Infinity"
        }
        .to_owned();
    }

    let text = value.to_string();

    if value.abs() < 1e21 {
        return text;
    }

    let (sign, digits) = text
        .strip_prefix('-')
        .map_or(("", text.as_str()), |digits| ("-", digits));

    let exponent = digits.len() - 1;
    let significant = digits.trim_end_matches('0');
    let tail = &significant[1..];

    if tail.is_empty() {
        format!("{sign}{}e+{exponent}", &significant[..1])
    } else {
        format!("{sign}{}.{}e+{exponent}", &significant[..1], tail)
    }
}
