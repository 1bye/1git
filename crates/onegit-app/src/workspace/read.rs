//! Blocking repository reads, executed only on GPUI's background executor.
use onegit_git::{
    Cancellation, DiffOptions, DiffTarget, FileChange, FileStatus, GitError, GitPath, GitProcess,
    RecordType, Repository, RepositoryError, Snapshot,
};

use onegit_ui::DiffDocument;
use std::{collections::HashMap, path::Path, sync::Arc};

// Match the viewer's patch budget; oversized output is represented explicitly.
const OUTPUT_LIMIT: usize = 16 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(super) enum Side {
    Staged,
    Working,
}

impl Side {
    pub fn label(self) -> &'static str {
        match self {
            Self::Staged => "Staged",
            Self::Working => "Unstaged",
        }
    }

    fn target(self) -> DiffTarget {
        match self {
            Self::Staged => DiffTarget::Staged,
            Self::Working => DiffTarget::Working,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(super) struct ChangeKey {
    pub path: GitPath,
    pub side: Side,
}

#[derive(Clone, Debug)]
pub(super) struct ChangedFile {
    pub key: ChangeKey,
    pub original: Option<GitPath>,
    pub status: FileStatus,
    pub submodule: bool,
    pub label: String,
    pub description: String,
}

impl ChangedFile {
    fn new(file: &FileChange, side: Side, status: FileStatus) -> Self {
        let original = if matches!(status, FileStatus::Renamed | FileStatus::Copied) {
            file.original_path.clone()
        } else {
            None
        };

        let description = if let Some(original) = &original {
            format!(
                "{} · {} from {}",
                side.label(),
                status_name(status),
                path_label(original)
            )
        } else {
            format!("{} · {}", side.label(), status_name(status))
        };

        Self {
            key: ChangeKey {
                path: file.path.clone(),
                side,
            },
            original,
            status,
            submodule: file.submodule.starts_with('S'),
            label: path_label(&file.path),
            description,
        }
    }
}

pub(super) struct Loaded {
    pub repository: Arc<Repository>,
    pub snapshot: Snapshot,
    pub last_commit: Option<Arc<onegit_git::CommitInfo>>,
    pub files: Vec<ChangedFile>,
    positions: HashMap<ChangeKey, usize>,
}

impl Loaded {
    pub fn index(&self, key: &ChangeKey) -> Option<usize> {
        self.positions.get(key).copied()
    }

    pub fn file(&self, key: &ChangeKey) -> Option<&ChangedFile> {
        self.index(key).map(|index| &self.files[index])
    }
}

pub(super) enum Preview {
    Patch(DiffDocument),
    Conflict(Box<super::conflicts::Preview>),
    Notice { title: &'static str, detail: String },
}

pub(super) fn path_label(path: &GitPath) -> String {
    let mut bytes = path.as_bytes();
    let mut label = String::new();

    while !bytes.is_empty() {
        match std::str::from_utf8(bytes) {
            Ok(text) => {
                label.push_str(&text.escape_debug().to_string());
                break;
            }
            Err(error) => {
                let end = error.valid_up_to();

                label.push_str(
                    &String::from_utf8_lossy(&bytes[..end])
                        .escape_debug()
                        .to_string(),
                );
                let invalid = error.error_len().unwrap_or(bytes.len() - end);

                for byte in &bytes[end..end + invalid] {
                    label.push_str(&format!("\\x{byte:02x}"));
                }

                bytes = &bytes[end + invalid..];
            }
        }
    }

    label
}

pub(super) fn status_name(status: FileStatus) -> &'static str {
    match status {
        FileStatus::Added => "Added",
        FileStatus::Copied => "Copied",
        FileStatus::Deleted => "Deleted",
        FileStatus::Ignored => "Ignored",
        FileStatus::Modified => "Modified",
        FileStatus::Renamed => "Renamed",
        FileStatus::TypeChanged => "Type changed",
        FileStatus::Unmerged => "Conflict",
        FileStatus::Unmodified => "Unchanged",
        FileStatus::Untracked => "Untracked",
    }
}

pub(super) fn message(error: RepositoryError) -> String {
    if let RepositoryError::Git(GitError::CommandFailed { output, .. }) = &error {
        let detail = String::from_utf8_lossy(&output.stderr);

        if !detail.trim().is_empty() {
            return detail.trim().chars().take(2000).collect();
        }
    }

    error.to_string()
}

pub(super) fn load(
    path: &Path,
    process: GitProcess,
    cancel: &Cancellation,
) -> Result<Arc<Loaded>, String> {
    let repository = Arc::new(Repository::open(path, process, Some(cancel)).map_err(message)?);
    let snapshot = repository.snapshot(false, Some(cancel)).map_err(message)?;

    Ok(from_snapshot(repository, snapshot))
}

pub(super) fn from_snapshot(repository: Arc<Repository>, snapshot: Snapshot) -> Arc<Loaded> {
    let mut files = Vec::new();

    for side in [Side::Staged, Side::Working] {
        for file in &snapshot.status.files {
            let status = match side {
                Side::Staged => file.index_status,
                Side::Working => file.worktree_status,
            };

            if side == Side::Staged
                && matches!(
                    file.record_type,
                    RecordType::Untracked | RecordType::Unmerged | RecordType::Ignored
                )
            {
                continue;
            }

            if matches!(status, FileStatus::Unmodified | FileStatus::Ignored) {
                continue;
            }

            let status = if file.record_type == RecordType::Unmerged {
                FileStatus::Unmerged
            } else {
                status
            };

            files.push(ChangedFile::new(file, side, status));
        }
    }

    files.sort_by_key(|file| file.status != FileStatus::Unmerged);

    let positions = files
        .iter()
        .enumerate()
        .map(|(index, file)| (file.key.clone(), index))
        .collect();

    let last_commit = snapshot
        .status
        .head
        .oid
        .as_deref()
        .and_then(|oid| repository.commit(oid, None).ok())
        .map(Arc::new);

    Arc::new(Loaded {
        last_commit,
        repository,
        snapshot,
        files,
        positions,
    })
}

pub(super) fn process() -> GitProcess {
    GitProcess::new("git", OUTPUT_LIMIT)
}

pub(super) fn preview(
    repository: &Repository,
    file: &ChangedFile,
    cancel: &Cancellation,
) -> Result<Preview, String> {
    if file.status == FileStatus::Unmerged {
        return super::conflicts::preview(repository, &file.key.path, cancel);
    }

    let mut paths = vec![file.key.path.clone()];

    if let Some(original) = &file.original
        && file.status == FileStatus::Renamed
        && *original != file.key.path
    {
        paths.push(original.clone());
    }

    let mut options = DiffOptions::new(file.key.side.target());

    options.paths = Some(&paths);
    let diff = repository.diff(options, Some(cancel)).map_err(message)?;

    if diff.stats.iter().any(|stat| stat.path != file.key.path) {
        return Err(
            "The preview includes another file. Refresh the repository before retrying.".into(),
        );
    }

    if diff.patch_omitted.is_some() {
        return Ok(Preview::Notice {
            title: "Patch is too large to display",
            detail: "The file remains listed. Inspect its changes in your editor.".into(),
        });
    }

    if diff.patch.is_empty() {
        return Ok(Preview::Notice {
            title: "No textual patch available",
            detail: if file.submodule {
                "Open this submodule to inspect its changed files."
            } else {
                "This selection has no remaining patch. Refresh to load the current file state."
            }
            .into(),
        });
    }

    let document = DiffDocument::parse(&diff.patch)
        .map_err(|error| format!("Could not display this patch: {error}"))?;

    Ok(Preview::Patch(document))
}
