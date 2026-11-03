//! Capture references and immutable topology on the background executor.
use super::super::read::{self, Loaded};
use onegit_git::{BranchKind, Cancellation, CommitInfo, GraphHistoryOptions};
use onegit_ui::{CommitGraphData, CommitItem, CommitRef, CommitRefKind, GraphCommit};

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Reference {
    pub id: String,
    pub label: String,
    pub oid: String,
    pub kind: CommitRefKind,
    pub current: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct References {
    pub head: Option<String>,
    pub items: Vec<Reference>,
}

impl References {
    pub fn tips(&self, selected: Option<&str>) -> Vec<String> {
        if let Some(id) = selected {
            return self
                .items
                .iter()
                .find(|r| r.id == id)
                .map(|r| vec![r.oid.clone()])
                .unwrap_or_default();
        }

        let mut seen = HashSet::new();

        self.head
            .iter()
            .chain(self.items.iter().map(|r| &r.oid))
            .filter(|oid| seen.insert((*oid).clone()))
            .cloned()
            .collect()
    }
}

pub(super) fn references(source: &Loaded, cancel: &Cancellation) -> Result<References, String> {
    let branches = source
        .repository
        .branches(Some(cancel))
        .map_err(read::message)?;

    let tags = source
        .repository
        .tags(Some(cancel))
        .map_err(read::message)?;

    let mut items = branches
        .branches
        .into_iter()
        .map(|b| Reference {
            id: b.full_name,
            label: b.name,
            oid: b.oid,
            kind: if b.kind == BranchKind::Local {
                CommitRefKind::Branch
            } else {
                CommitRefKind::Remote
            },
            current: b.checked_out,
        })
        .collect::<Vec<_>>();

    items.extend(tags.into_iter().map(|t| Reference {
        id: format!("refs/tags/{}", t.name),
        label: t.name,
        oid: t.target_oid,
        kind: CommitRefKind::Tag,
        current: false,
    }));

    Ok(References {
        head: source.snapshot.status.head.oid.clone(),
        items,
    })
}

pub(super) struct Page {
    pub commits: Vec<Arc<CommitInfo>>,
    pub data: CommitGraphData,
    pub next_offset: Option<u64>,
}

pub(super) fn data(
    commits: &[Arc<CommitInfo>],
    refs: &References,
) -> Result<CommitGraphData, String> {
    let mut labels_by_oid: HashMap<&str, Vec<&Reference>> = HashMap::new();

    for reference in &refs.items {
        labels_by_oid
            .entry(&reference.oid)
            .or_default()
            .push(reference);
    }

    CommitGraphData::new(
        commits
            .iter()
            .map(|commit| {
                let mut labels = labels_by_oid
                    .get(commit.oid.as_str())
                    .cloned()
                    .unwrap_or_default();

                labels.sort_by_key(|r| {
                    if r.current {
                        0
                    } else {
                        match r.kind {
                            CommitRefKind::Branch => 1,
                            CommitRefKind::Tag => 2,
                            CommitRefKind::Remote => 3,
                        }
                    }
                });
                let mut references = Vec::new();

                if refs.head.as_ref() == Some(&commit.oid) {
                    references.push(CommitRef {
                        label: "HEAD".into(),
                        kind: CommitRefKind::Branch,
                    });
                }

                references.extend(labels.into_iter().map(|r| CommitRef {
                    label: r.label.clone().into(),
                    kind: r.kind,
                }));

                GraphCommit {
                    item: CommitItem {
                        author: Some(commit.author.name.clone().into()),
                        date: Some(
                            chrono::DateTime::parse_from_rfc3339(&commit.committed_at)
                                .map(|d| {
                                    d.with_timezone(&chrono::Local)
                                        .format("%b %-d, %Y")
                                        .to_string()
                                })
                                .unwrap_or_else(|_| commit.committed_at.clone())
                                .into(),
                        ),
                        hash: Some(commit.oid.chars().take(7).collect::<String>().into()),
                        references,
                        ..CommitItem::new(commit.oid.clone(), commit.summary.clone())
                    },
                    parents: commit.parent_oids.iter().cloned().map(Into::into).collect(),
                }
            })
            .collect(),
    )
    .map_err(|e| e.to_string())
}

pub(super) fn page(
    source: &Loaded,
    refs: &References,
    tips: &[String],
    mut previous: Vec<Arc<CommitInfo>>,
    cancel: &Cancellation,
) -> Result<Page, String> {
    let page = source
        .repository
        .graph_history(
            GraphHistoryOptions {
                tips,
                limit: 100,
                offset: previous.len() as u64,
            },
            Some(cancel),
        )
        .map_err(read::message)?;

    previous.extend(page.commits.into_iter().map(Arc::new));
    let data = data(&previous, refs)?;

    Ok(Page {
        commits: previous,
        data,
        next_offset: page.next_offset,
    })
}
