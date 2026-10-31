//! Immutable commit reads; pages share one exact tip and never follow a moving HEAD.
use crate::workspace::read::{self, Loaded, Preview};

use onegit_git::{
    Cancellation, CommitFile, CommitInfo, DiffOptions, DiffTarget, FileStatus, HistoryOptions,
    Repository,
};

use onegit_ui::{CommitItem, CommitListData, DiffDocument};

pub(super) struct Page {
    pub commits: Vec<CommitInfo>,
    pub data: CommitListData,
    pub next_offset: Option<u64>,
    pub total: Option<u64>,
}

pub(super) fn page(
    source: &Loaded,
    offset: u64,
    previous: CommitListData,
    cancel: &Cancellation,
) -> Result<Page, String> {
    let page = match source.snapshot.status.head.oid.as_deref() {
        Some(tip) => source
            .repository
            .history(
                HistoryOptions {
                    limit: 50,
                    offset,
                    revision: Some(tip),
                    ..Default::default()
                },
                Some(cancel),
            )
            .map_err(read::message)?,
        None => onegit_git::CommitPage::default(),
    };

    let total = if offset == 0 {
        source
            .snapshot
            .status
            .head
            .oid
            .as_deref()
            .and_then(|tip| source.repository.history_count(tip, Some(cancel)).ok())
    } else {
        None
    };

    let ids = page
        .commits
        .iter()
        .map(|commit| commit.oid.clone())
        .collect::<Vec<_>>();

    let outgoing = source
        .repository
        .unpushed_commits(&ids, Some(cancel))
        .unwrap_or_default()
        .into_iter()
        .collect::<std::collections::HashSet<_>>();

    let mut items = previous.items().to_vec();

    items.extend(page.commits.iter().map(|commit| {
        CommitItem {
            author: Some(
                format!(
                    "{} · {} · {}",
                    commit.author.name,
                    chrono::DateTime::parse_from_rfc3339(&commit.authored_at)
                        .map(|date| date
                            .with_timezone(&chrono::Local)
                            .format("%b %-d, %Y")
                            .to_string())
                        .unwrap_or_else(|_| commit.authored_at.clone()),
                    commit.oid.chars().take(7).collect::<String>()
                )
                .into(),
            ),
            date: None,
            hash: None,
            references: Vec::new(),
            status: outgoing
                .contains(&commit.oid)
                .then(|| onegit_ui::CommitStatus {
                    icon: onegit_ui::IconName::ArrowUp,
                    label: "Not pushed (based on last fetch)".into(),
                }),
            ..CommitItem::new(commit.oid.clone(), commit.summary.clone())
        }
    }));
    let data = CommitListData::new(items).map_err(|error| error.to_string())?;

    Ok(Page {
        commits: page.commits,
        data,
        next_offset: page.next_offset,
        total,
    })
}

pub(super) fn patch(
    repository: &Repository,
    oid: &str,
    file: &CommitFile,
    cancel: &Cancellation,
) -> Result<Preview, String> {
    let mut paths = vec![file.path.clone()];

    if file.status == FileStatus::Renamed
        && let Some(original) = &file.original_path
        && *original != file.path
    {
        paths.push(original.clone());
    }

    let mut options = DiffOptions::new(DiffTarget::Commit(oid.into()));

    options.paths = Some(&paths);
    let diff = repository
        .diff(options, Some(cancel))
        .map_err(read::message)?;

    if diff.stats.iter().any(|stat| stat.path != file.path) {
        return Err(
            "This patch includes another file. Select a different file or refresh history.".into(),
        );
    }

    if diff.patch_omitted.is_some() {
        return Ok(Preview::Notice {
            title: "Patch is too large to display",
            detail: "The file remains listed. Inspect this commit in an external Git tool.".into(),
        });
    }

    if diff.patch.is_empty() {
        return Ok(Preview::Notice {
            title: "No textual patch available",
            detail: "This commit has no text patch for the selected file.".into(),
        });
    }

    DiffDocument::parse(&diff.patch)
        .map(Preview::Patch)
        .map_err(|error| format!("Could not display this patch: {error}"))
}
