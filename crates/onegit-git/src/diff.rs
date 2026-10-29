//! Patch/stat previews. Changes owns a temporary index and never stages working content.

use crate::GitPath;
use std::ffi::OsString;
use std::path::Path;

use super::{Repository, RepositoryError};
use crate::output::{path, text, trim};
use crate::validation::{full_oid, require_paths, require_revision};
use crate::{Cancellation, GitCommand, GitError, GitOutput};

/// Source represented by a patch preview.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DiffTarget {
    /// Worktree relative to the real index, including untracked files.
    Working,
    /// Real index relative to HEAD (empty tree on an unborn branch).
    Staged,
    /// Complete HEAD-to-working-file contents, independent of staging inclusion.
    Changes,
    /// One commit relative to its first parent, including root additions.
    Commit(String),
    /// Two revisions, optionally using a three-dot merge-base comparison.
    Range {
        /// Base revision.
        base: String,
        /// Incoming revision.
        head: String,
        /// Whether to compare from the merge base.
        merge_base: bool,
    },
}

/// Patch options; path inputs are literal filenames and validated before execution.
#[derive(Clone, Debug)]
pub struct DiffOptions<'a> {
    /// Requested source.
    pub target: DiffTarget,
    /// Optional non-empty repository-relative path filter.
    pub paths: Option<&'a [GitPath]>,
    /// Unified context, from 0 through i32::MAX.
    pub context_lines: u32,
    /// Ignore whitespace in the patch; statistics retain the legacy unfiltered counts.
    pub ignore_whitespace: bool,
}

impl DiffOptions<'_> {
    /// Construct the legacy three-context-line, whitespace-sensitive preview.
    #[must_use]
    pub fn new(target: DiffTarget) -> Self {
        Self {
            target,
            paths: None,
            context_lines: 3,
            ignore_whitespace: false,
        }
    }
}

/// Per-file line counts. None denotes binary data, not zero changed lines.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DiffStat {
    /// Current path.
    pub path: GitPath,
    /// Original name for rename/copy stats.
    pub original_path: Option<GitPath>,
    /// Added line count, absent for binary data.
    pub added_lines: Option<u64>,
    /// Deleted line count, absent for binary data.
    pub deleted_lines: Option<u64>,
}

/// Why a patch was deliberately omitted while retaining available statistics.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PatchOmission {
    /// Patch output or aggregate patch exceeded the runner's byte budget.
    TooLarge,
}

/// Owned preview preserving worktree contents, index bytes, objects and refs.
/// Git may refresh a split index's usage timestamp while reading it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileDiff {
    /// Decoded patch text (Git's path quoting remains intact).
    pub patch: String,
    /// Deliberate omission, distinct from a genuinely empty diff.
    pub patch_omitted: Option<PatchOmission>,
    /// Native paths and text/binary line counts.
    pub stats: Vec<DiffStat>,
    /// Requested source, retained for consumer identity checks.
    pub target: DiffTarget,
}

impl Repository {
    /// Read a patch and stats without external diff/text converters, optional index writes,
    /// object creation, staging or ref updates. Changes uses a private disposable index.
    ///
    /// # Errors
    /// Rejects invalid revisions, paths or context counts, malformed Git output, and
    /// filesystem/process failures, including cancellation. Oversized patch output
    /// returns [`PatchOmission::TooLarge`] with available statistics instead of an error.
    pub fn diff(
        &self,
        options: DiffOptions<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<FileDiff, RepositoryError> {
        self.mutations.wait_for_pending();

        self.diff_uncoordinated(options, cancellation)
    }

    pub(super) fn diff_uncoordinated(
        &self,
        options: DiffOptions<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<FileDiff, RepositoryError> {
        if options.context_lines > i32::MAX as u32 {
            return Err(RepositoryError::InvalidInput(
                "Context line count is out of range",
            ));
        }

        if let Some(paths) = options.paths {
            require_paths(paths.iter())?;
        }

        match &options.target {
            DiffTarget::Commit(revision) => require_revision(revision)?,
            DiffTarget::Range { base, head, .. } => {
                require_revision(base)?;
                require_revision(head)?;
            }
            _ => {}
        }

        if options.target != DiffTarget::Changes {
            return self.diff_with_index(&options, None, None, cancellation);
        }

        let head = match self.run(["rev-parse", "--verify", "--quiet", "HEAD"], cancellation) {
            Ok(output) => {
                let oid = trim(&text(&output.stdout)).to_owned();

                if !full_oid(&oid) {
                    return Err(RepositoryError::InvalidOutput);
                }

                Some(oid)
            }
            Err(RepositoryError::Git(GitError::CommandFailed { status, .. }))
                if status.code() == Some(1) =>
            {
                None
            }
            Err(error) => return Err(error),
        };

        let directory = tempfile::Builder::new().prefix("1git-diff-").tempdir()?;
        let index = directory.path().join("index");

        let result = (|| {
            self.diff_run(
                [
                    "-c",
                    "core.splitIndex=false",
                    "-c",
                    "core.fsmonitor=false",
                    "read-tree",
                    head.as_deref().unwrap_or("--empty"),
                ],
                Some(&index),
                &[],
                cancellation,
            )?;

            if head.is_some() {
                let mut args = vec![
                    OsString::from("--literal-pathspecs"),
                    "ls-files".into(),
                    "--stage".into(),
                    "-z".into(),
                ];

                add_paths(&mut args, options.paths)?;

                let entries = self.diff_run(args, None, &[], cancellation)?;

                self.diff_run(
                    [
                        "-c",
                        "core.splitIndex=false",
                        "-c",
                        "core.fsmonitor=false",
                        "update-index",
                        "-z",
                        "--index-info",
                    ],
                    Some(&index),
                    &entries.stdout,
                    cancellation,
                )?;
            }

            self.diff_with_index(&options, Some(&index), head.as_deref(), cancellation)
        })();

        directory.close()?;

        result
    }

    /// Check Git's decoded apply destination rather than trusting display-oriented diff headers.
    pub(super) fn check_patch_destination(
        &self,
        patch: &[u8],
        expected: &GitPath,
        cancellation: Option<&Cancellation>,
    ) -> Result<(), RepositoryError> {
        let mut command =
            GitCommand::new(&self.info.root, ["apply", "--numstat", "-z", "--recount"]);

        command.directory = Some(&self.root_directory);
        command.stdin = patch;
        command.cancellation = cancellation;
        let output = self.process.run(command)?;

        let destination = output
            .stdout
            .strip_suffix(b"\0")
            .and_then(|line| line.splitn(3, |byte| *byte == b'\t').nth(2));

        if destination != Some(expected.as_bytes()) {
            return Err(RepositoryError::InvalidInput(
                "The patch header does not identify only the selected path. Review diff prefixes or select the complete file.",
            ));
        }

        Ok(())
    }

    fn diff_run(
        &self,
        args: impl IntoIterator<Item = impl Into<OsString>>,
        index: Option<&Path>,
        stdin: &[u8],
        cancellation: Option<&Cancellation>,
    ) -> Result<GitOutput, RepositoryError> {
        let mut command = GitCommand::new(&self.info.root, args);

        command.args.insert(0, "--no-optional-locks".into());
        command.index_file = index;
        command.stdin = stdin;
        command.cancellation = cancellation;

        Ok(self.process.run(command)?)
    }

    fn diff_with_index(
        &self,
        options: &DiffOptions<'_>,
        index: Option<&Path>,
        head: Option<&str>,
        cancellation: Option<&Cancellation>,
    ) -> Result<FileDiff, RepositoryError> {
        let counts = self.diff_run(
            diff_arguments(options, true, head)?,
            index,
            &[],
            cancellation,
        )?;

        let stats = parse_stats(&counts.stdout, None)?;
        let tracked_stats = stats.clone();

        let result = (|| {
            let patch = self.diff_run(
                diff_arguments(options, false, head)?,
                index,
                &[],
                cancellation,
            )?;

            let mut patch = text(&patch.stdout);

            if patch.len() > self.process.output_limit() {
                return Err(GitError::OutputTooLarge {
                    limit: self.process.output_limit(),
                }
                .into());
            }

            let mut stats = stats;

            if matches!(options.target, DiffTarget::Changes | DiffTarget::Working) {
                let mut args = vec![
                    OsString::from("--literal-pathspecs"),
                    "ls-files".into(),
                    "--others".into(),
                    "--exclude-standard".into(),
                    "-z".into(),
                ];

                add_paths(&mut args, options.paths)?;

                let output = self.diff_run(args, index, &[], cancellation)?;

                if !output.stdout.is_empty() && !output.stdout.ends_with(&[0]) {
                    return Err(RepositoryError::InvalidOutput);
                }

                for bytes in output
                    .stdout
                    .split(|byte| *byte == 0)
                    .filter(|bytes| !bytes.is_empty())
                {
                    let file = path(bytes)?;
                    let part = self.untracked_diff(&file, options, false, cancellation)?;
                    let count = self.untracked_diff(&file, options, true, cancellation)?;

                    append_patch(&mut patch, &text(&part), self.process.output_limit())?;

                    stats.extend(parse_stats(&count, Some(&file))?);
                }
            }

            Ok((patch, stats))
        })();

        match result {
            Ok((patch, stats)) => Ok(FileDiff {
                patch,
                stats,
                target: options.target.clone(),
                patch_omitted: None,
            }),
            Err(RepositoryError::Git(GitError::OutputTooLarge { .. })) => Ok(FileDiff {
                patch: String::new(),
                stats: tracked_stats,
                target: options.target.clone(),
                patch_omitted: Some(PatchOmission::TooLarge),
            }),
            Err(error) => Err(error),
        }
    }

    fn untracked_diff(
        &self,
        file: &GitPath,
        options: &DiffOptions<'_>,
        counts: bool,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<u8>, RepositoryError> {
        let mut args: Vec<OsString> = [
            "--literal-pathspecs",
            "diff",
            "--no-index",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
        ]
        .into_iter()
        .map(Into::into)
        .collect();

        if counts {
            args.extend(["--numstat".into(), "-z".into()]);
        } else {
            args.push("--patch".into());
            args.push(format!("--unified={}", options.context_lines).into());
        }

        if options.ignore_whitespace {
            args.push("--ignore-all-space".into());
        }

        args.extend(["--".into(), "/dev/null".into(), file.to_argument()?]);

        match self.diff_run(args, None, &[], cancellation) {
            Ok(output) => Ok(output.stdout),
            Err(RepositoryError::Git(GitError::CommandFailed { status, output }))
                if status.code() == Some(1) =>
            {
                Ok(output.stdout)
            }
            Err(error) => Err(error),
        }
    }
}

fn diff_arguments(
    options: &DiffOptions<'_>,
    counts: bool,
    head: Option<&str>,
) -> Result<Vec<OsString>, RepositoryError> {
    let commit = matches!(options.target, DiffTarget::Commit(_));

    let mut args: Vec<OsString> = [
        "--literal-pathspecs",
        "-c",
        "log.showSignature=false",
        if commit { "show" } else { "diff" },
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--find-renames",
    ]
    .into_iter()
    .map(Into::into)
    .collect();

    if commit {
        args.extend([
            "--no-notes".into(),
            "--format=".into(),
            "--first-parent".into(),
            "--root".into(),
        ]);
    }

    if counts {
        args.extend(["--numstat".into(), "-z".into()]);
    } else {
        args.extend([
            "--patch".into(),
            format!("--unified={}", options.context_lines).into(),
        ]);

        if options.ignore_whitespace {
            args.push("--ignore-all-space".into());
        }
    }

    match &options.target {
        DiffTarget::Changes => {
            if let Some(head) = head {
                args.push(head.into());
            }
        }
        DiffTarget::Staged => args.push("--cached".into()),
        DiffTarget::Commit(revision) => args.push(revision.into()),
        DiffTarget::Range {
            base,
            head,
            merge_base,
        } => args.push(format!("{base}{}{head}", if *merge_base { "..." } else { ".." }).into()),
        DiffTarget::Working => {}
    }

    add_paths(&mut args, options.paths)?;

    Ok(args)
}

fn add_paths(args: &mut Vec<OsString>, paths: Option<&[GitPath]>) -> Result<(), RepositoryError> {
    args.push("--".into());

    if let Some(paths) = paths {
        for path in paths {
            args.push(path.to_argument()?);
        }
    }

    Ok(())
}

fn append_patch(output: &mut String, patch: &str, limit: usize) -> Result<(), GitError> {
    let separator = usize::from(!output.is_empty() && !patch.is_empty());

    if output
        .len()
        .saturating_add(patch.len())
        .saturating_add(separator)
        > limit
    {
        return Err(GitError::OutputTooLarge { limit });
    }

    if separator > 0 {
        output.push('\n');
    }

    output.push_str(patch);

    Ok(())
}

fn parse_stats(
    bytes: &[u8],
    untracked: Option<&GitPath>,
) -> Result<Vec<DiffStat>, RepositoryError> {
    if !bytes.is_empty() && !bytes.ends_with(&[0]) {
        return Err(RepositoryError::InvalidOutput);
    }

    let mut records = bytes.split(|byte| *byte == 0).peekable();
    let mut stats = Vec::new();

    while let Some(record) = records.next() {
        if record.is_empty() && records.peek().is_none() {
            break;
        }

        let mut fields = record.splitn(3, |byte| *byte == b'\t');
        let added_lines = count(fields.next().ok_or(RepositoryError::InvalidOutput)?)?;
        let deleted_lines = count(fields.next().ok_or(RepositoryError::InvalidOutput)?)?;
        let inline = fields.next().ok_or(RepositoryError::InvalidOutput)?;

        let (original_path, current) = if inline.is_empty() {
            let original = records
                .next()
                .filter(|path| !path.is_empty())
                .ok_or(RepositoryError::InvalidOutput)?;

            let current = records
                .next()
                .filter(|path| !path.is_empty())
                .ok_or(RepositoryError::InvalidOutput)?;

            (Some(original), current)
        } else {
            (None, inline)
        };

        stats.push(DiffStat {
            // No-index output can name the native /dev/null sentinel. The caller
            // already knows the exact selected Git name for untracked counts.
            path: match untracked {
                Some(file) => file.clone(),
                None => path(current)?,
            },
            original_path: if untracked.is_some() {
                None
            } else {
                original_path.map(path).transpose()?
            },
            added_lines,
            deleted_lines,
        });
    }

    Ok(stats)
}

fn count(bytes: &[u8]) -> Result<Option<u64>, RepositoryError> {
    if bytes == b"-" {
        return Ok(None);
    }

    if bytes.is_empty() || !bytes.iter().all(u8::is_ascii_digit) {
        return Err(RepositoryError::InvalidOutput);
    }

    Ok(Some(
        text(bytes)
            .parse()
            .map_err(|_| RepositoryError::InvalidOutput)?,
    ))
}

#[cfg(test)]
mod tests {

    use super::parse_stats;

    #[test]
    fn numstat_preserves_tab_newline_and_non_utf8_paths_and_rejects_partial_records() {
        let stats = parse_stats(b"12\t3\tname\t\n\xff\0-\t-\timage\0", None).unwrap();

        assert_eq!(stats[0].path.as_bytes(), b"name\t\n\xff");
        assert_eq!(
            (stats[0].added_lines, stats[0].deleted_lines),
            (Some(12), Some(3))
        );
        assert_eq!((stats[1].added_lines, stats[1].deleted_lines), (None, None));
        assert!(parse_stats(b"1\t2\t\0only-old\0", None).is_err());
        assert!(parse_stats(b"1\t2\tmissing-terminator", None).is_err());
    }

    #[test]
    fn numstat_keeps_reserved_colon_and_literal_backslash_git_names() {
        let stats = parse_stats(b"1\t2\taux.c\0-\t-\ta:b\0", None).unwrap();

        assert_eq!(stats[0].path.as_bytes(), b"aux.c");
        assert_eq!(stats[1].path.as_bytes(), b"a:b");
        let renamed = parse_stats(b"1\t0\t\0folder\\file\0folder/file\0", None).unwrap();

        assert_eq!(
            renamed[0].original_path.as_ref().unwrap().as_bytes(),
            b"folder\\file"
        );
        assert_eq!(renamed[0].path.as_bytes(), b"folder/file");
        assert_ne!(renamed[0].original_path.as_ref().unwrap(), &renamed[0].path);
        let literal = parse_stats(b"1\t0\tfolder\\file\0", None).unwrap();

        assert_eq!(literal[0].path.as_bytes(), b"folder\\file");
        let selected = crate::GitPath::new(b"folder\\file").unwrap();
        let untracked = parse_stats(b"1\t0\t\0/dev/null\0folder\\file\0", Some(&selected)).unwrap();

        assert_eq!(untracked[0].path, selected);
        assert_eq!(untracked[0].original_path, None);
    }
}
