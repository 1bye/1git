//! Immutable topology prepared outside native rendering.
use crate::{CommitItem, CommitListData, CommitListDataError};
use rake::gpui;

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

/// Presentation metadata and unsimplified parent identities for a graph node.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GraphCommit {
    /// Stable commit identity, subject, labels and formatted metadata.
    pub item: CommitItem,
    /// Parent identities in Git order. Parents may be in a later page.
    pub parents: Vec<gpui::SharedString>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Half {
    Top,
    Bottom,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Edge {
    pub from: usize,
    pub to: usize,
    pub half: Half,
    pub color: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Row {
    pub lane: usize,
    pub color: usize,
    pub edges: Vec<Edge>,
}

#[derive(Debug)]
struct Data {
    commits: Vec<GraphCommit>,
    positions: HashMap<gpui::SharedString, usize>,
    rows: Vec<Row>,
    lanes: usize,
}

/// Cheaply cloned graph data with stable lane allocation across appended pages.
#[derive(Clone, Debug)]
pub struct CommitGraphData(Arc<Data>);

impl CommitGraphData {
    /// Prepare topology from topologically ordered commits. No Git or UI access occurs.
    ///
    /// # Errors
    /// Rejects empty or duplicate identities using the same contract as CommitListData.
    pub fn new(commits: Vec<GraphCommit>) -> Result<Self, CommitListDataError> {
        CommitListData::new(commits.iter().map(|c| c.item.clone()).collect())?;
        let (rows, lanes) = layout(&commits);

        let positions = commits
            .iter()
            .enumerate()
            .map(|(i, c)| (c.item.id.clone(), i))
            .collect();

        Ok(Self(Arc::new(Data {
            commits,
            positions,
            rows,
            lanes,
        })))
    }

    /// Ordered immutable input nodes.
    #[must_use]
    pub fn commits(&self) -> &[GraphCommit] {
        &self.0.commits
    }

    /// Number of graph nodes.
    #[must_use]
    pub fn len(&self) -> usize {
        self.0.commits.len()
    }

    /// Whether this graph has no commits.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.commits.is_empty()
    }

    /// Maximum allocated lane count, including connections to unloaded parents.
    #[must_use]
    pub fn lanes(&self) -> usize {
        self.0.lanes
    }

    /// Node position for one exact identity.
    #[must_use]
    pub fn position(&self, id: &str) -> Option<usize> {
        self.0.positions.get(id).copied()
    }

    pub(super) fn row(&self, i: usize) -> &Row {
        &self.0.rows[i]
    }

    pub(super) fn same(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

impl Default for CommitGraphData {
    fn default() -> Self {
        Self::new(Vec::new()).expect("empty graph identities are valid")
    }
}

fn layout(commits: &[GraphCommit]) -> (Vec<Row>, usize) {
    #[derive(Clone)]
    struct Tip {
        id: gpui::SharedString,
        color: usize,
    }
    let mut lanes: Vec<Option<Tip>> = Vec::new();
    let mut rows: Vec<Row> = Vec::with_capacity(commits.len());
    let mut colors = 0;
    let mut width = 1;

    for commit in commits {
        let lane = lanes
            .iter()
            .position(|tip| tip.as_ref().is_some_and(|tip| tip.id == commit.item.id))
            .unwrap_or_else(|| {
                let slot = lanes
                    .iter()
                    .position(Option::is_none)
                    .unwrap_or(lanes.len());

                if slot == lanes.len() {
                    lanes.push(None);
                }

                lanes[slot] = Some(Tip {
                    id: commit.item.id.clone(),
                    color: colors,
                });
                colors += 1;

                slot
            });

        let node = lanes[lane].take().expect("allocated graph lane");
        let mut edges = Vec::new();

        for (i, tip) in lanes
            .iter()
            .enumerate()
            .filter_map(|(i, tip)| tip.as_ref().map(|t| (i, t)))
        {
            edges.push(Edge {
                from: i,
                to: i,
                half: Half::Top,
                color: tip.color,
            });
            edges.push(Edge {
                from: i,
                to: i,
                half: Half::Bottom,
                color: tip.color,
            });
        }

        if rows.last().is_some_and(|previous| {
            previous
                .edges
                .iter()
                .any(|e| e.half == Half::Bottom && e.to == lane)
        }) {
            edges.push(Edge {
                from: lane,
                to: lane,
                half: Half::Top,
                color: node.color,
            });
        }

        // Preserve source ordering: active lanes precede the node's connections.
        edges.sort_by_key(|edge| (edge.from, if edge.half == Half::Top { 0 } else { 1 }));
        let mut seen = HashSet::new();

        for (i, parent) in commit
            .parents
            .iter()
            .filter(|p| seen.insert(*p))
            .enumerate()
        {
            let target = lanes
                .iter()
                .position(|tip| tip.as_ref().is_some_and(|tip| &tip.id == parent))
                .unwrap_or_else(|| {
                    let slot = if i == 0 {
                        lane
                    } else {
                        lanes
                            .iter()
                            .position(Option::is_none)
                            .unwrap_or(lanes.len())
                    };

                    if slot == lanes.len() {
                        lanes.push(None);
                    }

                    let color = if i == 0 {
                        node.color
                    } else {
                        let color = colors;

                        colors += 1;

                        color
                    };

                    lanes[slot] = Some(Tip {
                        id: parent.clone(),
                        color,
                    });

                    slot
                });

            edges.push(Edge {
                from: lane,
                to: target,
                half: Half::Bottom,
                color: lanes[target].as_ref().map_or(node.color, |tip| tip.color),
            });
        }

        width = width.max(lanes.len()).max(lane + 1);
        rows.push(Row {
            lane,
            color: node.color,
            edges,
        });

        while lanes.last().is_some_and(Option::is_none) {
            lanes.pop();
        }
    }

    (rows, width)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn commit(id: usize, parents: &[usize]) -> GraphCommit {
        GraphCommit {
            item: CommitItem::new(id.to_string(), "Subject"),
            parents: parents.iter().map(|id| id.to_string().into()).collect(),
        }
    }

    #[test]
    fn continues_a_linear_lane_and_stops_at_the_root() {
        let data =
            CommitGraphData::new(vec![commit(3, &[2]), commit(2, &[1]), commit(1, &[])]).unwrap();

        assert_eq!(data.lanes(), 1);
        assert_eq!(
            data.0.rows.iter().map(|r| r.lane).collect::<Vec<_>>(),
            [0, 0, 0]
        );
        assert!(data.row(0).edges.iter().all(|e| e.half != Half::Top));
        assert_eq!(data.row(1).edges.len(), 2);
        assert_eq!(
            data.row(2).edges.iter().map(|e| e.half).collect::<Vec<_>>(),
            [Half::Top]
        );
    }

    #[test]
    fn joins_all_merge_parents_and_preserves_connections_across_page_boundaries() {
        let commits = vec![
            commit(6, &[5, 4, 3]),
            commit(5, &[2]),
            commit(4, &[2]),
            commit(3, &[2]),
            commit(2, &[1]),
            commit(1, &[]),
        ];

        let first = CommitGraphData::new(commits[..2].to_vec()).unwrap();
        let full = CommitGraphData::new(commits).unwrap();

        assert_eq!(full.lanes(), 3);
        assert_eq!(&full.0.rows[..2], first.0.rows.as_slice());
        assert_eq!(
            full.row(0)
                .edges
                .iter()
                .filter(|e| e.half == Half::Bottom)
                .map(|e| e.to)
                .collect::<Vec<_>>(),
            [0, 1, 2]
        );

        for i in 1..full.len() {
            let mut incoming: Vec<_> = full
                .row(i)
                .edges
                .iter()
                .filter(|e| e.half == Half::Top)
                .map(|e| e.from)
                .collect();

            incoming.sort_unstable();
            let mut outgoing: Vec<_> = full
                .row(i - 1)
                .edges
                .iter()
                .filter(|e| e.half == Half::Bottom)
                .map(|e| e.to)
                .collect();

            outgoing.sort_unstable();
            outgoing.dedup();
            assert_eq!(incoming, outgoing, "row {i}");
        }
    }

    #[test]
    fn starts_unrelated_tips_without_inventing_an_incoming_connection() {
        let data = CommitGraphData::new(vec![
            commit(4, &[2]),
            commit(3, &[1]),
            commit(2, &[]),
            commit(1, &[]),
        ])
        .unwrap();

        assert_eq!(data.row(1).lane, 1);
        assert!(!data.row(1).edges.contains(&Edge {
            from: 1,
            to: 1,
            half: Half::Top,
            color: 1
        }));
        assert!(data.row(1).edges.contains(&Edge {
            from: 0,
            to: 0,
            half: Half::Top,
            color: 0
        }));
        assert_eq!(data.row(3).color, 1);
    }

    #[test]
    fn reuses_vacant_lanes_after_disconnected_roots() {
        let data =
            CommitGraphData::new(vec![commit(3, &[]), commit(2, &[]), commit(1, &[])]).unwrap();

        assert_eq!(data.lanes(), 1);
        assert!(data.0.rows.iter().all(|r| r.edges.is_empty()));
    }
}
