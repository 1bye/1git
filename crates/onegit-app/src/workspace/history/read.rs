//! Immutable commit reads; pages share one exact tip and never follow a moving HEAD.
use crate::workspace::read::{self, Loaded, Preview};

use onegit_git::{
    Cancellation, CommitFile, CommitInfo, DiffOptions, DiffTarget, FileStatus, HistoryOptions,
    Repository,
};

use onegit_ui::{CommitItem, CommitListData};

pub(super) struct Page {
    pub commits: Vec<CommitInfo>,
    pub data: CommitListData,
    pub next_offset: Option<u64>,
    pub total: Option<u64>,
}

#[cfg(test)]
pub(super) fn page(
    source: &Loaded,
    offset: u64,
    previous: CommitListData,
    cancel: &Cancellation,
) -> Result<Page, String> {
    page_with_query(source, offset, previous, 50, "", cancel)
}

#[cfg(test)]
pub(super) fn page_with_query(
    source: &Loaded,
    offset: u64,
    previous: CommitListData,
    limit: usize,
    query: &str,
    cancel: &Cancellation,
) -> Result<Page, String> {
    page_for_query(source, offset, previous, limit, query, None, cancel)
}

/// Search uses source offsets, not match offsets, so pagination can scan sparse history.
pub(super) fn page_for_query(
    source: &Loaded,
    offset: u64,
    previous: CommitListData,
    limit: usize,
    query: &str,
    known_total: Option<u64>,
    cancel: &Cancellation,
) -> Result<Page, String> {
    let needle = query.trim().to_lowercase();

    let page = match source.snapshot.status.head.oid.as_deref() {
        Some(tip) if !needle.is_empty() => {
            search(&source.repository, tip, offset, limit, &needle, cancel)?
        }
        Some(tip) => normal_page(&source.repository, tip, offset, limit, cancel)?,
        None => onegit_git::CommitPage::default(),
    };

    let total = if offset == 0 {
        known_total.or_else(|| {
            source
                .snapshot
                .status
                .head
                .oid
                .as_deref()
                .and_then(|tip| source.repository.history_count(tip, Some(cancel)).ok())
        })
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

fn normal_page(
    repository: &Repository,
    tip: &str,
    offset: u64,
    limit: usize,
    cancel: &Cancellation,
) -> Result<onegit_git::CommitPage, String> {
    let mut commits = Vec::new();
    let mut cursor = offset;

    loop {
        let mut page = repository
            .history(
                HistoryOptions {
                    revision: Some(tip),
                    offset: cursor,
                    limit: (limit - commits.len()).min(500),
                    ..Default::default()
                },
                Some(cancel),
            )
            .map_err(read::message)?;

        commits.append(&mut page.commits);

        if !page.has_more || commits.len() >= limit {
            return Ok(onegit_git::CommitPage {
                commits,
                has_more: page.has_more,
                next_offset: page.next_offset,
            });
        }

        cursor = page.next_offset.ok_or("History page did not advance.")?;
    }
}

fn search(
    repository: &Repository,
    tip: &str,
    offset: u64,
    limit: usize,
    needle: &str,
    cancel: &Cancellation,
) -> Result<onegit_git::CommitPage, String> {
    let mut commits = Vec::new();
    let mut cursor = offset;
    let mut next_offset = None;

    loop {
        if cancel.is_cancelled() {
            return Err("History search was cancelled.".into());
        }

        let page = repository
            .history(
                HistoryOptions {
                    revision: Some(tip),
                    offset: cursor,
                    limit: 250,
                    ..Default::default()
                },
                Some(cancel),
            )
            .map_err(read::message)?;

        for commit in page.commits {
            cursor += 1;

            if [
                &commit.oid,
                &commit.summary,
                &commit.body,
                &commit.author.name,
                &commit.author.email,
            ]
            .into_iter()
            .any(|value| value.to_lowercase().contains(needle))
            {
                commits.push(commit);
            }

            if commits.len() == limit {
                next_offset = Some(cursor);
            }

            if commits.len() > limit {
                commits.truncate(limit);

                return Ok(onegit_git::CommitPage {
                    commits,
                    has_more: true,
                    next_offset,
                });
            }
        }

        if !page.has_more {
            return Ok(onegit_git::CommitPage {
                commits,
                has_more: false,
                next_offset: None,
            });
        }
    }
}

pub(in crate::workspace) fn patch(
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
        .diff(options.clone(), Some(cancel))
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

    read::document(
        repository,
        options,
        &diff.patch,
        &file.path,
        file.original_path.as_ref(),
        cancel,
    )
    .map(|document| Preview::Patch {
        document,
        line_staging: false,
    })
}
