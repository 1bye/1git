//! Parses porcelain v2 snapshots without quoting or decoding repository paths.

use crate::GitPath;
/// One side of an index/worktree change.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FileStatus {
    /// Added content.
    Added,
    /// Copied from another path.
    Copied,
    /// Deleted content.
    Deleted,
    /// Excluded by ignore rules.
    Ignored,
    /// Modified content.
    Modified,
    /// Renamed from another path.
    Renamed,
    /// File mode/type changed.
    TypeChanged,
    /// Unresolved merge stages.
    Unmerged,
    /// No change on this side.
    Unmodified,
    /// Not tracked by Git.
    Untracked,
}

/// The porcelain record category, independent of each side's change status.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecordType {
    /// A tracked path without a rename/copy relationship.
    Ordinary,
    /// A rename or copy with an original path and similarity score.
    Renamed,
    /// A path with unresolved merge stages.
    Unmerged,
    /// An untracked path.
    Untracked,
    /// An ignored path.
    Ignored,
}

/// Owned path state. `GitPath` preserves tabs, newlines and non-UTF-8 Unix names.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileChange {
    /// Current repository-relative path.
    pub path: GitPath,
    /// Source name for a rename or copy.
    pub original_path: Option<GitPath>,
    /// Porcelain record category.
    pub record_type: RecordType,
    /// Index relative to HEAD.
    pub index_status: FileStatus,
    /// Worktree relative to the index.
    pub worktree_status: FileStatus,
    /// Git's four-byte submodule state, including dirty/untracked flags.
    pub submodule: String,
    /// HEAD object when present in an ordinary/rename record.
    pub head_oid: Option<String>,
    /// Index object when present in an ordinary/rename record.
    pub index_oid: Option<String>,
    /// Rename/copy similarity, from 0 to 100.
    pub rename_score: Option<u8>,
}

/// HEAD and its tracking relationship at the time status was collected.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct HeadState {
    /// Current branch; absent for detached HEAD.
    pub branch: Option<String>,
    /// Current commit; absent for an unborn repository.
    pub oid: Option<String>,
    /// Configured upstream name, if any.
    pub upstream: Option<String>,
    /// Local commits ahead of the upstream.
    pub ahead: u64,
    /// Upstream commits missing locally.
    pub behind: u64,
}

impl HeadState {
    /// Whether HEAD names a commit directly rather than a branch.
    pub fn is_detached(&self) -> bool {
        self.branch.is_none() && self.oid.is_some()
    }

    /// Whether the current branch has no commit yet.
    pub fn is_unborn(&self) -> bool {
        self.oid.is_none()
    }
}

/// Owned status snapshot, invalidated by subsequent Git or filesystem changes.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Status {
    /// Changes in Git's returned order.
    pub files: Vec<FileChange>,
    /// HEAD and tracking state.
    pub head: HeadState,
    /// Count requested by `--show-stash`.
    pub stash_count: u64,
}

/// Malformed or truncated porcelain output. Never treat an incomplete read as a clean tree.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StatusParseError;

impl std::fmt::Display for StatusParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Git returned malformed or truncated porcelain v2 status")
    }
}

impl std::error::Error for StatusParseError {}

/// Parse `git status --porcelain=v2 --branch --show-stash --untracked-files=all -z`.
///
/// Unknown headers are allowed by Git's extensibility contract. Unknown records,
/// missing rename sources and truncated records return an error rather than silently
/// omitting a potentially destructive change. Filenames retain their original bytes.
pub fn parse_status(bytes: &[u8]) -> Result<Status, StatusParseError> {
    if !bytes.is_empty() && !bytes.ends_with(&[0]) {
        return Err(StatusParseError);
    }

    let mut result = Status::default();
    let mut records = bytes.split(|byte| *byte == 0).peekable();

    while let Some(record) = records.next() {
        if record.is_empty() && records.peek().is_none() {
            break;
        }

        if record.starts_with(b"# ") {
            apply_header(record, &mut result)?;

            continue;
        }

        let kind = record.get(..2).ok_or(StatusParseError)?;

        let change = match kind {
            b"1 " => tracked(&record[2..], false)?,
            b"2 " => {
                let mut change = tracked(&record[2..], true)?;
                let source = records.next().ok_or(StatusParseError)?;

                change.original_path = Some(path(source)?);

                change
            }
            b"u " => {
                let fields = fields(&record[2..], 10)?;

                FileChange {
                    submodule: text(fields[1])?,
                    ..simple(fields[9], RecordType::Unmerged, FileStatus::Unmerged)?
                }
            }
            b"? " => simple(&record[2..], RecordType::Untracked, FileStatus::Untracked)?,
            b"! " => simple(&record[2..], RecordType::Ignored, FileStatus::Ignored)?,
            _ => return Err(StatusParseError),
        };

        result.files.push(change);
    }

    Ok(result)
}

fn apply_header(record: &[u8], status: &mut Status) -> Result<(), StatusParseError> {
    if let Some(oid) = record.strip_prefix(b"# branch.oid ") {
        status.head.oid = if oid == b"(initial)" {
            None
        } else {
            Some(object_id(oid)?)
        };
    } else if let Some(branch) = record.strip_prefix(b"# branch.head ") {
        status.head.branch = if branch == b"(detached)" {
            None
        } else {
            Some(text(branch)?)
        };
    } else if let Some(upstream) = record.strip_prefix(b"# branch.upstream ") {
        status.head.upstream = Some(text(upstream)?);
    } else if let Some(counts) = record.strip_prefix(b"# branch.ab ") {
        let mut parts = counts.splitn(2, |byte| *byte == b' ');
        let ahead = parts.next().ok_or(StatusParseError)?;
        let behind = parts.next().ok_or(StatusParseError)?;

        status.head.ahead = number(ahead.strip_prefix(b"+").ok_or(StatusParseError)?)?;
        status.head.behind = number(behind.strip_prefix(b"-").ok_or(StatusParseError)?)?;
    } else if let Some(count) = record.strip_prefix(b"# stash ") {
        status.stash_count = number(count)?;
    }

    Ok(())
}

fn tracked(record: &[u8], renamed: bool) -> Result<FileChange, StatusParseError> {
    let fields = fields(record, if renamed { 9 } else { 8 })?;
    let xy = fields[0];

    if xy.len() != 2 {
        return Err(StatusParseError);
    }

    let rename_score = if renamed {
        let score = fields[7];

        if !matches!(score.first(), Some(b'R' | b'C')) {
            return Err(StatusParseError);
        }

        let value = number(&score[1..])?;

        if value > 100 {
            return Err(StatusParseError);
        }

        Some(value as u8)
    } else {
        None
    };

    Ok(FileChange {
        path: path(fields[fields.len() - 1])?,
        original_path: None,
        record_type: if renamed {
            RecordType::Renamed
        } else {
            RecordType::Ordinary
        },
        index_status: code(xy[0])?,
        worktree_status: code(xy[1])?,
        submodule: text(fields[1])?,
        head_oid: Some(object_id(fields[5])?),
        index_oid: Some(object_id(fields[6])?),
        rename_score,
    })
}

fn simple(
    path_bytes: &[u8],
    record_type: RecordType,
    status: FileStatus,
) -> Result<FileChange, StatusParseError> {
    Ok(FileChange {
        path: path(path_bytes)?,
        original_path: None,
        record_type,
        index_status: if status == FileStatus::Unmerged {
            status
        } else {
            FileStatus::Unmodified
        },
        worktree_status: status,
        submodule: "N...".into(),
        head_oid: None,
        index_oid: None,
        rename_score: None,
    })
}

fn fields(record: &[u8], count: usize) -> Result<Vec<&[u8]>, StatusParseError> {
    let fields: Vec<_> = record.splitn(count, |byte| *byte == b' ').collect();

    if fields.len() != count || fields.iter().any(|field| field.is_empty()) {
        return Err(StatusParseError);
    }

    Ok(fields)
}

fn text(bytes: &[u8]) -> Result<String, StatusParseError> {
    std::str::from_utf8(bytes)
        .map(str::to_owned)
        .map_err(|_| StatusParseError)
}

fn path(bytes: &[u8]) -> Result<GitPath, StatusParseError> {
    if bytes.is_empty() {
        return Err(StatusParseError);
    }

    GitPath::new(bytes).map_err(|_| StatusParseError)
}

fn object_id(bytes: &[u8]) -> Result<String, StatusParseError> {
    if !matches!(bytes.len(), 40 | 64) || !bytes.iter().all(u8::is_ascii_hexdigit) {
        return Err(StatusParseError);
    }

    text(bytes)
}

fn number(bytes: &[u8]) -> Result<u64, StatusParseError> {
    if bytes.is_empty() || !bytes.iter().all(u8::is_ascii_digit) {
        return Err(StatusParseError);
    }

    text(bytes)?.parse().map_err(|_| StatusParseError)
}

fn code(byte: u8) -> Result<FileStatus, StatusParseError> {
    match byte {
        b'.' => Ok(FileStatus::Unmodified),
        b'A' => Ok(FileStatus::Added),
        b'C' => Ok(FileStatus::Copied),
        b'D' => Ok(FileStatus::Deleted),
        b'M' => Ok(FileStatus::Modified),
        b'R' => Ok(FileStatus::Renamed),
        b'T' => Ok(FileStatus::TypeChanged),
        b'U' => Ok(FileStatus::Unmerged),
        _ => Err(StatusParseError),
    }
}
