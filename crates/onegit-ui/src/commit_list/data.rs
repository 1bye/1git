use rake::gpui::SharedString;
use std::{collections::HashMap, fmt, sync::Arc};

/// Semantic reference decoration; labels are supplied by the application.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommitRefKind {
    /// A local branch.
    Branch,
    /// A remote-tracking branch.
    Remote,
    /// A tag.
    Tag,
}

/// A branch or tag badge attached to a commit row.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommitRef {
    /// Reference category, also announced independently of color.
    pub kind: CommitRefKind,
    /// Display label, such as `main`, `origin/main` or `v1.0.0`.
    pub label: SharedString,
}

impl CommitRef {
    /// Create a typed decoration without Git ref parsing or resolution.
    #[must_use]
    pub fn new(kind: CommitRefKind, label: impl Into<SharedString>) -> Self {
        Self {
            kind,
            label: label.into(),
        }
    }
}

/// Application-formatted history entry; the UI performs no Git, clock or network access.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommitItem {
    /// Unique, nonempty stable identity, normally the full object ID.
    pub id: SharedString,
    /// One-line subject. The complete text remains available to accessibility.
    pub summary: SharedString,
    /// Optional author display name.
    pub author: Option<SharedString>,
    /// Optional application-formatted date or relative-time label.
    pub date: Option<SharedString>,
    /// Optional application-formatted short object ID.
    pub hash: Option<SharedString>,
    /// Ordered branch/tag decorations. The first two are shown, followed by an overflow count.
    pub references: Vec<CommitRef>,
}

impl CommitItem {
    /// Create a subject-only entry. Fill metadata fields before constructing [`CommitListData`].
    #[must_use]
    pub fn new(id: impl Into<SharedString>, summary: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            summary: summary.into(),
            author: None,
            date: None,
            hash: None,
            references: Vec::new(),
        }
    }
}

#[derive(Debug)]
struct Data {
    items: Vec<CommitItem>,
    positions: HashMap<SharedString, usize>,
}

/// Immutable history snapshot with cheap clones and constant-time identity lookup.
#[derive(Clone, Debug)]
pub struct CommitListData(Arc<Data>);

/// Invalid row identity, with the original entries retained for correction.
pub struct CommitListDataError {
    index: usize,
    reason: &'static str,
    items: Vec<CommitItem>,
}

impl CommitListDataError {
    /// Zero-based entry whose ID is empty or duplicates a preceding entry.
    #[must_use]
    pub fn index(&self) -> usize {
        self.index
    }

    /// Recover the supplied entries without cloning them.
    #[must_use]
    pub fn into_items(self) -> Vec<CommitItem> {
        self.items
    }
}

impl fmt::Debug for CommitListDataError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CommitListDataError")
            .field("index", &self.index)
            .field("reason", &self.reason)
            .finish_non_exhaustive()
    }
}

impl fmt::Display for CommitListDataError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid commit entry {}: {}", self.index, self.reason)
    }
}

impl std::error::Error for CommitListDataError {}

impl CommitListData {
    /// Freeze an ordered history snapshot. Rebuild only when the entries change, outside render.
    ///
    /// # Errors
    /// Rejects empty or duplicate IDs; the error retains the input entries.
    pub fn new(items: Vec<CommitItem>) -> Result<Self, CommitListDataError> {
        let mut positions = HashMap::with_capacity(items.len());

        for (index, item) in items.iter().enumerate() {
            let reason = if item.id.is_empty() {
                Some("empty ID")
            } else if positions.insert(item.id.clone(), index).is_some() {
                Some("duplicate ID")
            } else {
                None
            };

            if let Some(reason) = reason {
                return Err(CommitListDataError {
                    index,
                    reason,
                    items,
                });
            }
        }

        Ok(Self(Arc::new(Data { items, positions })))
    }

    /// Entries in caller-supplied history order.
    #[must_use]
    pub fn items(&self) -> &[CommitItem] {
        &self.0.items
    }

    /// Entry with this exact stable ID, if present.
    #[must_use]
    pub fn find(&self, id: &str) -> Option<&CommitItem> {
        self.position(id).map(|index| &self.0.items[index])
    }

    pub(super) fn position(&self, id: &str) -> Option<usize> {
        self.0.positions.get(id).copied()
    }

    pub(super) fn same(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

impl Default for CommitListData {
    fn default() -> Self {
        Self::new(Vec::new()).expect("an empty commit list has no invalid IDs")
    }
}
