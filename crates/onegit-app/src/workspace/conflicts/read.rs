//! Exact index-stage and working-text reads; comparisons are prepared off the UI thread.
use super::super::read;

use onegit_git::{
    BranchIdentity, Cancellation, ConflictPreview, ConflictSide, FileData, FileSource, GitCommand,
    GitError, GitPath, OperationState, Repository,
};

use onegit_ui::DiffDocument;
use std::{ffi::OsString, fs, time::Duration};

pub(in crate::workspace) struct Version {
    pub label: String,
    pub description: String,
    pub oid: Option<String>,
    pub document: Option<DiffDocument>,
    pub notice: Option<String>,
    pub usable: bool,
}

pub(in crate::workspace) struct Preview {
    pub path: GitPath,
    pub expected: BranchIdentity,
    pub operation: OperationState,
    pub operation_token: Option<String>,
    pub working: ConflictPreview,
    pub ours: Version,
    pub theirs: Version,
}

impl Preview {
    pub fn version(&self, side: ConflictSide) -> &Version {
        if side == ConflictSide::Ours {
            &self.ours
        } else {
            &self.theirs
        }
    }
}

fn bounded(text: &str) -> bool {
    text.len() <= 512 * 1024
        && !text.contains('\0')
        && text.split('\n').count() <= 2000
        && text.split('\n').all(|line| line.len() <= 4000)
}

pub(in crate::workspace) fn preview(
    repository: &Repository,
    path: &GitPath,
    cancel: &Cancellation,
) -> Result<super::super::read::Preview, String> {
    let snapshot = repository
        .snapshot(false, Some(cancel))
        .map_err(read::message)?;

    let working = repository
        .conflict_preview(path, Some(cancel))
        .map_err(read::message)?;

    let Some(working) = working else {
        return Ok(read::Preview::Notice {
            title: "Conflict preview unavailable",
            detail: "Resolve binary or oversized files using Git outside this app.".into(),
        });
    };

    let rebase = snapshot.operation == OperationState::Rebase;
    let branch = snapshot.status.head.branch.as_deref().unwrap_or("HEAD");

    let incoming_ref = match snapshot.operation {
        OperationState::Merge => Some("MERGE_HEAD"),
        OperationState::Rebase => Some("REBASE_HEAD"),
        OperationState::CherryPick => Some("CHERRY_PICK_HEAD"),
        OperationState::Revert => Some("REVERT_HEAD"),
        _ => None,
    };

    let incoming = incoming_ref.and_then(|revision| repository.commit(revision, Some(cancel)).ok());

    let incoming_label = format!(
        "{}{}",
        if rebase {
            "Replayed commit"
        } else {
            "Incoming"
        },
        incoming
            .as_ref()
            .map(|commit| format!(" · {}", commit.oid.chars().take(7).collect::<String>()))
            .unwrap_or_default()
    );

    let version = |stage: u8, label: String, description: String| -> Result<Version, String> {
        // Revision appends the exact GitPath bytes, including non-UTF-8 Unix names.
        let content = repository.file_content(
            FileSource::Revision(if stage == 2 { ":2" } else { ":3" }),
            path,
            Some(cancel),
        );

        let mut result = Version { label, description, oid: None, document: None,
            notice: Some("This indexed version is unavailable. Choose the other version or resolve outside the app.".into()), usable: false };

        if let Ok(content) = content {
            result.oid = Some(content.revision);

            if let FileData::Utf8(text) = content.content
                && text.len() <= 512 * 1024
                && !text.contains('\0')
            {
                result.usable = !super::markers(&text).1;

                match compare(&text, &working.text, cancel) {
                    Ok(document) => {
                        result.notice = document.is_none().then(|| "The working result matches this version. Review it before marking it resolved.".into());
                        result.document = document;
                    }
                    Err(message) => result.notice = Some(message),
                }
            }
        }

        Ok(result)
    };

    let ours = version(
        2,
        if rebase {
            "Upstream version".into()
        } else {
            format!("Current · {branch}")
        },
        if rebase {
            "The version being rebased onto"
        } else {
            "The current branch’s indexed version"
        }
        .into(),
    )?;

    let theirs = version(
        3,
        incoming_label,
        incoming
            .map(|commit| commit.summary)
            .unwrap_or_else(|| "The other indexed version".into()),
    )?;

    let fresh = repository
        .snapshot(false, Some(cancel))
        .map_err(read::message)?;

    if BranchIdentity::from_snapshot(&fresh) != BranchIdentity::from_snapshot(&snapshot)
        || fresh.operation != snapshot.operation
        || fresh.operation_token != snapshot.operation_token
    {
        return Err(
            "The Git operation changed while reading. Refresh to review its current versions."
                .into(),
        );
    }

    Ok(read::Preview::Conflict(Box::new(Preview {
        path: path.clone(),
        expected: BranchIdentity::from_snapshot(&snapshot),
        operation: snapshot.operation,
        operation_token: snapshot.operation_token,
        working,
        ours,
        theirs,
    })))
}

pub(super) fn compare(
    source: &str,
    result: &str,
    cancel: &Cancellation,
) -> Result<Option<DiffDocument>, String> {
    if !bounded(source) || !bounded(result) {
        return Err("This comparison is too large to preview. Resolve it in your editor.".into());
    }

    if source == result {
        return Ok(None);
    }

    let directory = tempfile::tempdir().map_err(|error| error.to_string())?;

    fs::write(directory.path().join("indexed"), source).map_err(|error| error.to_string())?;
    fs::write(directory.path().join("working"), result).map_err(|error| error.to_string())?;
    let mut command = GitCommand::new(
        directory.path(),
        [
            OsString::from("diff"),
            "--no-index".into(),
            "--no-ext-diff".into(),
            "--no-textconv".into(),
            "--no-color".into(),
            "--no-renames".into(),
            "--src-prefix=a/".into(),
            "--dst-prefix=b/".into(),
            "--unified=3".into(),
            "--".into(),
            "indexed".into(),
            "working".into(),
        ],
    );

    command.cancellation = Some(cancel);
    command.timeout = Some(Duration::from_secs(2));
    command.max_output_bytes = Some(1024 * 1024);
    let output = match read::process().run(command) {
        Ok(output) => output,
        Err(GitError::CommandFailed { output, status }) if status.code() == Some(1) => output,
        Err(error) => {
            return Err(format!(
                "Could not compare the indexed and working versions: {error}"
            ));
        }
    };

    let patch = std::str::from_utf8(&output.stdout).map_err(|error| error.to_string())?;

    DiffDocument::parse(patch)
        .map(Some)
        .map_err(|error| error.to_string())
}

pub(super) fn open_editor(root: &std::path::Path, path: &GitPath) -> Result<(), String> {
    let root = fs::canonicalize(root).map_err(|error| error.to_string())?;

    let absolute = root.join(
        path.to_str()
            .ok_or("This path cannot be opened as text. Resolve it outside the app.")?,
    );

    let canonical = fs::canonicalize(&absolute).map_err(|error| error.to_string())?;

    if canonical != absolute || !canonical.starts_with(&root) || !canonical.is_file() {
        return Err("Only regular files inside this repository can be opened here.".into());
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Open this file in your text editor, save it, then Refresh. Editor launching is currently available on macOS.".into())
    }

    #[cfg(target_os = "macos")]
    {
        // The launcher exits after handing the file to the editor; never time-bound the editor itself.
        let args = vec![OsString::from("-t"), absolute.into_os_string()];

        onegit_git::execute_tool(onegit_git::ToolCommand::new(
            std::path::Path::new("/usr/bin/open"),
            &root,
            args,
        ))
        .map(|_| ())
        .map_err(|error| format!("Could not open the editor: {error}"))
    }
}
