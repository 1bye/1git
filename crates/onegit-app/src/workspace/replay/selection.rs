//! Per-view range intent follows the source History reducer without replacing detail state.
use rake::gpui::{Modifiers, SharedString};
use std::{collections::HashSet, sync::Arc};

#[derive(Clone, Default)]
pub(in crate::workspace) struct Selection {
    pub members: Arc<HashSet<SharedString>>,
    anchor: Option<SharedString>,
}

impl Selection {
    pub fn saved(&self) -> crate::workspace::tabs::session::CommitRange {
        let mut ids: Vec<_> = self.members.iter().map(ToString::to_string).collect();

        ids.sort();

        crate::workspace::tabs::session::CommitRange {
            ids,
            anchor: self.anchor.as_ref().map(ToString::to_string),
        }
    }

    pub fn restore(saved: &crate::workspace::tabs::session::CommitRange) -> Self {
        Self {
            members: Arc::new(saved.ids.iter().cloned().map(Into::into).collect()),
            anchor: saved.anchor.clone().map(Into::into),
        }
    }

    pub fn choose(
        &mut self,
        id: SharedString,
        modifiers: &Modifiers,
        order: impl IntoIterator<Item = SharedString>,
        primary: Option<&SharedString>,
    ) {
        let order: Vec<_> = order.into_iter().collect();

        if !order.contains(&id) {
            return;
        }

        let current = if self.anchor.is_none() {
            primary.cloned().into_iter().collect()
        } else {
            (*self.members).clone()
        };

        let mut members = HashSet::from([id.clone()]);
        let mut anchor = id.clone();

        if modifiers.shift {
            anchor = self
                .anchor
                .as_ref()
                .or(primary)
                .filter(|id| order.contains(id))
                .cloned()
                .unwrap_or_else(|| id.clone());
            let start = order
                .iter()
                .position(|v| v == &anchor)
                .expect("available anchor");

            let end = order
                .iter()
                .position(|v| v == &id)
                .expect("available target");

            members = order[start.min(end)..=start.max(end)]
                .iter()
                .cloned()
                .collect();
        } else if modifiers.platform || (!cfg!(target_os = "macos") && modifiers.control) {
            members = current;

            if !members.remove(&id) {
                members.insert(id);
            }
        }

        self.members = Arc::new(members);
        self.anchor = Some(anchor);
    }

    pub fn effective(&self, primary: Option<&SharedString>) -> Arc<HashSet<SharedString>> {
        if self.anchor.is_none() {
            Arc::new(primary.cloned().into_iter().collect())
        } else {
            self.members.clone()
        }
    }

    pub fn ordered(&self, order: impl IntoIterator<Item = SharedString>) -> Vec<SharedString> {
        order
            .into_iter()
            .filter(|id| self.members.contains(id))
            .collect()
    }
}
