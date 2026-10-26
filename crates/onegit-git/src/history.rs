//! Read-only history, committed file identities and publication metadata.

use crate::GitPath;
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::sync::LazyLock;

use regex::Regex;

use super::{Repository, RepositoryError};
use crate::output::{path, rows, text, trim_end};
use crate::validation::{full_oid, require_paths, require_revision};
use crate::{Cancellation, FileStatus, GitCommand, GitError};

const HISTORY_FORMAT: &str = "%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%B%x00";
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

static RAW_HEADER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^:\d{6} \d{6} ([a-f0-9]+) ([a-f0-9]+) ([ADMRCT])\d*$")
        .expect("literal raw header pattern is valid")
});

/// Commit author or committer identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Identity {
    /// Display name recorded in the object.
    pub name: String,
    /// Email recorded in the object.
    pub email: String,
}

/// Path and blob identities relative to a commit's first parent, or an empty tree.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommitFile {
    /// Path after this change (original path for a deletion).
    pub path: GitPath,
    /// Source path for rename/copy.
    pub original_path: Option<GitPath>,
    /// Added/deleted/modified/renamed/copied/type-changed status.
    pub status: FileStatus,
    /// Before blob, or the zero object for additions.
    pub before_oid: String,
    /// After blob, or the zero object for deletions.
    pub after_oid: String,
}

/// Owned commit metadata; dates retain Git's strict ISO representation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommitInfo {
    /// Full object ID.
    pub oid: String,
    /// Unsimplified parent IDs, including all merge parents.
    pub parent_oids: Vec<String>,
    /// Recorded author.
    pub author: Identity,
    /// Author date.
    pub authored_at: String,
    /// Recorded committer.
    pub committer: Identity,
    /// Committer date.
    pub committed_at: String,
    /// Subject as rendered by Git's %s field.
    pub summary: String,
    /// Full %B message with the legacy trailing-whitespace normalization.
    pub body: String,
    /// File/blob identity at this commit, for single-file history only.
    pub history_file: Option<CommitFile>,
}

/// One bounded history page. Pagination never fetches unavailable shallow history.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct CommitPage {
    /// Selected commits in Git's history order.
    pub commits: Vec<CommitInfo>,
    /// Whether an additional commit was observed beyond the page.
    pub has_more: bool,
    /// Next numeric offset, if another page exists.
    pub next_offset: Option<u64>,
}

/// Validated when read; defaults match the existing 50-commit page.
pub struct HistoryOptions<'a> {
    /// Page size, from 1 through 500.
    pub limit: usize,
    /// Skip count, from 0 through JavaScript's safe-integer limit.
    pub offset: u64,
    /// Explicit commit-ish; remains browseable from an unborn checked-out branch.
    pub revision: Option<&'a str>,
    /// Literal repository-relative path filters; cannot accompany file_path.
    pub paths: Option<&'a [GitPath]>,
    /// One literal path whose history follows renames, first parent only.
    pub file_path: Option<&'a GitPath>,
}

impl Default for HistoryOptions<'_> {
    fn default() -> Self {
        Self {
            limit: 50,
            offset: 0,
            revision: None,
            paths: None,
            file_path: None,
        }
    }
}

/// Resolved incoming comparison anchored to immutable commits and one merge base.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BranchComparison {
    /// Resolved base commit.
    pub base: String,
    /// Resolved incoming commit.
    pub head: String,
    /// Single common ancestor.
    pub merge_base: String,
    /// Changes from that ancestor to the incoming commit.
    pub files: Vec<CommitFile>,
}

impl Repository {
    /// Read a validated history page. No explicit revision on an unborn branch yields an empty page.
    pub fn history(
        &self,
        mut options: HistoryOptions<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<CommitPage, RepositoryError> {
        self.mutations.wait_for_pending();
        options.revision = options.revision.filter(|revision| !revision.is_empty());

        if !(1..=500).contains(&options.limit) || options.offset > MAX_SAFE_INTEGER {
            return Err(RepositoryError::InvalidInput(
                "History limit or offset is out of range",
            ));
        }

        if let Some(revision) = options.revision {
            require_revision(revision)?;
        }

        if let Some(paths) = options.paths {
            require_paths(paths.iter())?;
        }

        if let Some(path) = options.file_path {
            require_paths([path])?;
        }

        if options.file_path.is_some() && options.paths.is_some() {
            return Err(RepositoryError::InvalidInput(
                "Choose single-file history or a path filter, not both",
            ));
        }

        if options.revision.is_none() && self.snapshot(false, cancellation)?.status.head.is_unborn()
        {
            return Ok(CommitPage::default());
        }

        if let Some(file) = options.file_path {
            return self.file_history(file, &options, cancellation);
        }

        let mut args: Vec<OsString> = vec![
            "--literal-pathspecs".into(),
            "-c".into(),
            "log.showSignature=false".into(),
            "log".into(),
            "--no-notes".into(),
            "--no-decorate".into(),
            format!("--max-count={}", options.limit + 1).into(),
            format!("--skip={}", options.offset).into(),
            format!("--format={HISTORY_FORMAT}").into(),
        ];

        if let Some(revision) = options.revision {
            args.push(revision.into());
        }

        args.push("--".into());

        if let Some(paths) = options.paths {
            for path in paths {
                args.push(path.to_argument()?);
            }
        }

        let output = self.run(args, cancellation)?;
        let mut commits = parse_history(&output.stdout)?;
        let has_more = commits.len() > options.limit;

        commits.truncate(options.limit);

        Ok(CommitPage {
            commits,
            has_more,
            next_offset: has_more.then_some(options.offset + options.limit as u64),
        })
    }

    /// Count locally available commits reachable from a validated revision.
    pub fn history_count(
        &self,
        revision: &str,
        cancellation: Option<&Cancellation>,
    ) -> Result<u64, RepositoryError> {
        self.mutations.wait_for_pending();
        require_revision(revision)?;

        let output = self.run(["rev-list", "--count", revision, "--"], cancellation)?;

        let count: u64 = text(&output.stdout)
            .trim()
            .parse()
            .map_err(|_| RepositoryError::InvalidOutput)?;

        if count > MAX_SAFE_INTEGER {
            return Err(RepositoryError::InvalidOutput);
        }

        Ok(count)
    }

    /// Read one commit-ish without running signature viewers, notes or external converters.
    pub fn commit(
        &self,
        revision: &str,
        cancellation: Option<&Cancellation>,
    ) -> Result<CommitInfo, RepositoryError> {
        self.mutations.wait_for_pending();

        self.commit_uncoordinated(revision, cancellation)
    }

    pub(super) fn commit_uncoordinated(
        &self,
        revision: &str,
        cancellation: Option<&Cancellation>,
    ) -> Result<CommitInfo, RepositoryError> {
        require_revision(revision)?;

        let output = self.run(
            [
                "-c",
                "log.showSignature=false",
                "show",
                "--no-notes",
                "--no-patch",
                &format!("--format={HISTORY_FORMAT}"),
                revision,
                "--",
            ],
            cancellation,
        )?;

        parse_history(&output.stdout)?
            .into_iter()
            .next()
            .ok_or(RepositoryError::InvalidOutput)
    }

    /// Read first-parent file/blob identities, including root additions and rename sources.
    pub fn commit_files(
        &self,
        revision: &str,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<CommitFile>, RepositoryError> {
        self.mutations.wait_for_pending();
        require_revision(revision)?;

        let output = self.run(
            [
                "-c",
                "log.showSignature=false",
                "show",
                "--no-notes",
                "--format=",
                "--raw",
                "-z",
                "--no-abbrev",
                "--first-parent",
                "--root",
                "--find-renames",
                "--no-ext-diff",
                "--no-textconv",
                revision,
                "--",
            ],
            cancellation,
        )?;

        parse_commit_files(&output.stdout)
    }

    /// Resolve a comparison once; unrelated or ambiguous merge bases return an input error.
    pub fn compare_branches(
        &self,
        base: &str,
        head: &str,
        cancellation: Option<&Cancellation>,
    ) -> Result<BranchComparison, RepositoryError> {
        self.mutations.wait_for_pending();
        let base = self.commit(base, cancellation)?.oid;
        let head = self.commit(head, cancellation)?.oid;

        let ancestors = match self.run(["merge-base", "--all", &base, &head], cancellation) {
            Ok(output) => text(&output.stdout).trim().to_owned(),
            Err(RepositoryError::Git(GitError::CommandFailed { status, .. }))
                if status.code() == Some(1) =>
            {
                return Err(RepositoryError::InvalidInput(
                    "These branches do not share a common ancestor",
                ));
            }
            Err(error) => return Err(error),
        };

        if !full_oid(&ancestors) {
            return Err(RepositoryError::InvalidInput(
                "This comparison requires a single common ancestor",
            ));
        }

        let output = self.run(
            [
                "diff",
                "--raw",
                "-z",
                "--no-abbrev",
                "--find-renames",
                "--no-ext-diff",
                "--no-textconv",
                &ancestors,
                &head,
                "--",
            ],
            cancellation,
        )?;

        Ok(BranchComparison {
            base,
            head,
            merge_base: ancestors,
            files: parse_commit_files(&output.stdout)?,
        })
    }

    /// Return requested commits absent from all known remote refs; never fetches or infers by date.
    pub fn unpushed_commits(
        &self,
        oids: &[String],
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<String>, RepositoryError> {
        self.mutations.wait_for_pending();

        if oids.iter().any(|oid| !full_oid(oid)) {
            return Err(RepositoryError::InvalidInput(
                "Commit IDs must be full hexadecimal object IDs",
            ));
        }

        let mut seen = HashSet::new();

        let unique: Vec<_> = oids
            .iter()
            .map(|oid| oid.to_ascii_lowercase())
            .filter(|oid| seen.insert(oid.clone()))
            .collect();

        if unique.is_empty() {
            return Ok(unique);
        }

        let input = unique.join("\n") + "\n";

        let mut check =
            GitCommand::new(&self.info.root, ["cat-file", "--batch-check=%(objecttype)"]);

        check.stdin = input.as_bytes();
        check.cancellation = cancellation;

        let objects = self.process.run(check)?;
        let objects = text(&objects.stdout);

        if objects.lines().count() != unique.len() || objects.lines().any(|kind| kind != "commit") {
            return Err(RepositoryError::InvalidInput(
                "Every object ID must identify an existing commit",
            ));
        }

        let mut query = GitCommand::new(
            &self.info.root,
            ["name-rev", "--annotate-stdin", "--refs=refs/remotes/*"],
        );

        query.stdin = input.as_bytes();
        query.cancellation = cancellation;

        let output = self.process.run(query)?;
        let names = text(&output.stdout);
        let names: Vec<_> = names.lines().collect();

        if names.len() != unique.len()
            || names.iter().zip(&unique).any(|(name, oid)| {
                *name != oid && !(name.starts_with(&format!("{oid} (")) && name.ends_with(')'))
            })
        {
            return Err(RepositoryError::InvalidOutput);
        }

        Ok(unique
            .iter()
            .zip(names)
            .filter(|(oid, name)| oid.as_str() == *name)
            .map(|(oid, _)| oid.clone())
            .collect())
    }

    fn file_history(
        &self,
        file: &GitPath,
        options: &HistoryOptions<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<CommitPage, RepositoryError> {
        let args: Vec<OsString> = [
            "--literal-pathspecs",
            "-c",
            "log.showSignature=false",
            "log",
            "--follow",
            "--first-parent",
            "--no-notes",
            "--no-decorate",
            "--raw",
            "-z",
            "--no-abbrev",
            "--root",
            "--find-renames",
            "--no-ext-diff",
            "--no-textconv",
            "--format=%H",
        ]
        .into_iter()
        .map(Into::into)
        .chain([
            format!("--max-count={}", options.offset + options.limit as u64 + 1).into(),
            options.revision.unwrap_or("HEAD").into(),
            "--".into(),
            file.to_argument()?,
        ])
        .collect();

        let output = self.run(args, cancellation)?;
        // --follow needs the prefix, since --skip can discard the state needed to follow a rename.
        let records = parse_file_history(&output.stdout)?;

        let selected: Vec<_> = records
            .into_iter()
            .skip(usize::try_from(options.offset).unwrap_or(usize::MAX))
            .take(options.limit + 1)
            .collect();

        let has_more = selected.len() > options.limit;
        let selected = &selected[..selected.len().min(options.limit)];

        if selected.is_empty() {
            return Ok(CommitPage::default());
        }

        let mut args: Vec<OsString> = [
            "-c",
            "log.showSignature=false",
            "log",
            "--no-notes",
            "--no-walk=unsorted",
            "--no-decorate",
        ]
        .into_iter()
        .map(Into::into)
        .collect();

        args.push(format!("--format={HISTORY_FORMAT}").into());
        args.extend(selected.iter().map(|(oid, _)| OsString::from(oid)));
        args.push("--".into());

        let output = self.run(args, cancellation)?;

        let mut metadata: HashMap<_, _> = parse_history(&output.stdout)?
            .into_iter()
            .map(|commit| (commit.oid.clone(), commit))
            .collect();

        let mut commits = Vec::new();

        for (oid, file) in selected {
            let mut commit = metadata.remove(oid).ok_or(RepositoryError::InvalidOutput)?;

            commit.history_file = Some(file.clone());
            commits.push(commit);
        }

        Ok(CommitPage {
            commits,
            has_more,
            next_offset: has_more.then_some(options.offset + options.limit as u64),
        })
    }
}

fn parse_history(bytes: &[u8]) -> Result<Vec<CommitInfo>, RepositoryError> {
    rows(bytes, 10)?
        .into_iter()
        .map(|fields| {
            if !full_oid(&text(fields[0])) || fields[4].is_empty() || fields[7].is_empty() {
                return Err(RepositoryError::InvalidOutput);
            }

            Ok(CommitInfo {
                oid: text(fields[0]),
                parent_oids: text(fields[1])
                    .split(' ')
                    .filter(|oid| !oid.is_empty())
                    .map(str::to_owned)
                    .collect(),
                author: Identity {
                    name: text(fields[2]),
                    email: text(fields[3]),
                },
                authored_at: text(fields[4]),
                committer: Identity {
                    name: text(fields[5]),
                    email: text(fields[6]),
                },
                committed_at: text(fields[7]),
                summary: text(fields[8]),
                body: trim_end(&text(fields[9])).to_owned(),
                history_file: None,
            })
        })
        .collect()
}

fn parse_commit_files(bytes: &[u8]) -> Result<Vec<CommitFile>, RepositoryError> {
    if !bytes.is_empty() && !bytes.ends_with(&[0]) {
        return Err(RepositoryError::InvalidOutput);
    }

    let mut tokens = bytes.split(|byte| *byte == 0).peekable();
    let mut result = Vec::new();

    while let Some(header) = tokens.next() {
        if header.is_empty() && tokens.peek().is_none() {
            break;
        }

        result.push(raw_file(header, &mut tokens)?);
    }

    Ok(result)
}

fn raw_file<'a>(
    header: &[u8],
    tokens: &mut impl Iterator<Item = &'a [u8]>,
) -> Result<CommitFile, RepositoryError> {
    let header = text(header);

    let capture = RAW_HEADER
        .captures(&header)
        .ok_or(RepositoryError::InvalidOutput)?;

    let first = tokens
        .next()
        .filter(|path| !path.is_empty())
        .ok_or(RepositoryError::InvalidOutput)?;

    let status = match &capture[3] {
        "A" => FileStatus::Added,
        "D" => FileStatus::Deleted,
        "M" => FileStatus::Modified,
        "R" => FileStatus::Renamed,
        "C" => FileStatus::Copied,
        "T" => FileStatus::TypeChanged,
        _ => return Err(RepositoryError::InvalidOutput),
    };

    let renamed = matches!(status, FileStatus::Renamed | FileStatus::Copied);

    let current = if renamed {
        tokens
            .next()
            .filter(|path| !path.is_empty())
            .ok_or(RepositoryError::InvalidOutput)?
    } else {
        first
    };

    Ok(CommitFile {
        path: path(current)?,
        original_path: renamed.then(|| path(first)).transpose()?,
        status,
        before_oid: capture[1].into(),
        after_oid: capture[2].into(),
    })
}

fn parse_file_history(bytes: &[u8]) -> Result<Vec<(String, CommitFile)>, RepositoryError> {
    if !bytes.is_empty() && !bytes.ends_with(&[0]) {
        return Err(RepositoryError::InvalidOutput);
    }

    let mut tokens = bytes.split(|byte| *byte == 0).peekable();
    let mut records = Vec::new();

    while let Some(oid) = tokens.next() {
        if oid.is_empty() {
            continue;
        }

        if !full_oid(&text(oid)) {
            return Err(RepositoryError::InvalidOutput);
        }

        let header = tokens.next().ok_or(RepositoryError::InvalidOutput)?;
        let file = raw_file(header.strip_prefix(b"\n").unwrap_or(header), &mut tokens)?;

        records.push((text(oid), file));
    }

    Ok(records)
}

#[cfg(test)]
#[path = "history_tests.rs"]
mod tests;
