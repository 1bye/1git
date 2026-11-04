//! Worktree menu/forms share the branch picker's reviewed source and animated surface.
mod view;
mod worker;

use super::{Phase, Picker};
use crate::workspace::{ReadJob, read};

use onegit_git::{
    BranchIdentity, BranchKind, Cancellation, Worktree, WorktreeBranch, WorktreeRequest,
};

use onegit_ui::{AnchorBounds, InputState};
use rake::gpui::{self, Focusable, prelude::*};

use std::{
    path::{Path, PathBuf},
    time::Duration,
};

pub(in crate::workspace) use worker::run;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::workspace) enum Form {
    Create,
    Move,
    Remove,
}

#[derive(Clone, Debug)]
pub(in crate::workspace) enum Change {
    Created(PathBuf),
    Moved { from: PathBuf, to: PathBuf },
    Removed(PathBuf),
}

pub(in crate::workspace) struct Open(pub PathBuf);

impl gpui::EventEmitter<Open> for Picker {}

pub(in crate::workspace) struct State {
    pub items: Vec<Worktree>,
    pub name: gpui::Entity<InputState>,
    pub path: gpui::Entity<InputState>,
    pub destination: Option<PathBuf>,
    pub target: Option<Worktree>,
    pub submenu: bool,
    anchor: AnchorBounds,
    focus: gpui::FocusHandle,
    location_focus: gpui::FocusHandle,
    rows: Vec<gpui::FocusHandle>,
    cursor: Option<usize>,
    scroll: gpui::UniformListScrollHandle,
    hover_timer: Option<gpui::Task<()>>,
}

impl State {
    pub(super) fn new(window: &mut gpui::Window, cx: &mut gpui::Context<Picker>) -> Self {
        Self {
            items: Vec::new(),
            name: cx.new(|cx| InputState::new("", window, cx)),
            path: cx.new(|cx| InputState::new("", window, cx)),
            destination: None,
            target: None,
            submenu: false,
            anchor: Default::default(),
            focus: cx.focus_handle().tab_stop(true),
            location_focus: cx.focus_handle().tab_stop(true),
            rows: Vec::new(),
            cursor: None,
            scroll: gpui::UniformListScrollHandle::new(),
            hover_timer: None,
        }
    }

    pub(super) fn reset(&mut self, cx: &mut gpui::Context<Picker>) {
        self.items.clear();
        self.destination = None;
        self.target = None;
        self.submenu = false;
        self.cursor = None;
        self.rows.clear();
        self.hover_timer = None;
        self.name.update(cx, |input, cx| input.set_text("", cx));
        self.path.update(cx, |input, cx| input.set_text("", cx));
    }
}

pub(super) fn branch_label(
    branch: &onegit_git::Branch,
    data: &onegit_git::BranchCollection,
) -> String {
    if branch.kind == BranchKind::Remote
        && data
            .branches
            .iter()
            .any(|local| local.kind == BranchKind::Local && local.name == branch.name)
    {
        format!("{} (remote)", branch.name)
    } else {
        branch.name.clone()
    }
}

pub(super) fn branch_error(name: &str) -> Option<&'static str> {
    if name.is_empty() {
        return None;
    }

    let invalid = matches!(name, "HEAD" | "@")
        || name.starts_with('-')
        || name.ends_with('.')
        || name.contains("..")
        || name.contains("@{")
        || name.chars().any(|c| {
            c <= ' ' || c == '\u{7f}' || matches!(c, '~' | '^' | ':' | '?' | '*' | '[' | '\\')
        })
        || name
            .split('/')
            .any(|part| part.is_empty() || part.starts_with('.') || part.ends_with(".lock"));

    invalid.then_some("Enter a valid Git branch name.")
}

fn default_destination(root: &Path, branch: &str) -> PathBuf {
    let suffix = branch
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("worktree");

    let mut safe = String::new();

    for c in suffix.chars() {
        if c.is_alphanumeric() || matches!(c, '.' | '_' | '-') {
            safe.push(c);
        } else if !safe.ends_with('-') {
            safe.push('-');
        }
    }

    root.with_file_name(format!(
        "{}-{safe}",
        root.file_name().unwrap_or_default().to_string_lossy()
    ))
}

impl Picker {
    pub(in crate::workspace) fn create_worktree(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if !self.can_manage_worktrees() {
            return;
        }

        self.phase = Phase::Worktree(Form::Create);
        self.error = None;
        self.worktrees.submenu = false;
        self.worktrees.target = None;
        self.worktrees.destination = None;
        self.worktrees
            .name
            .update(cx, |input, cx| input.set_text("", cx));
        window.focus(&self.worktrees.name.read(cx).focus_handle(cx), cx);
        cx.notify();
    }

    pub(in crate::workspace) fn can_manage_worktrees(&self) -> bool {
        !self.busy
            && !self.operation_blocked()
            && self.data.is_some()
            && self
                .source
                .as_ref()
                .is_some_and(|s| s.snapshot.status.head.oid.is_some())
    }

    fn can_edit_worktree(&self, item: &Worktree) -> bool {
        self.can_manage_worktrees()
            && !item.locked
            && !item.prunable
            && self
                .source
                .as_ref()
                .is_some_and(|s| s.snapshot.repository.root != item.path)
            && self
                .worktrees
                .items
                .first()
                .is_some_and(|main| main.path != item.path)
    }

    pub(in crate::workspace) fn edit_worktree(
        &mut self,
        item: Worktree,
        form: Form,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if form == Form::Create || !self.can_edit_worktree(&item) {
            return;
        }

        self.worktrees.path.update(cx, |input, cx| {
            input.set_text(item.path.to_str().unwrap_or_default(), cx)
        });
        self.worktrees.target = Some(item);
        self.worktrees.submenu = false;
        self.phase = Phase::Worktree(form);
        self.error = None;
        window.focus(
            &if form == Form::Remove {
                self.cancel_focus.clone()
            } else {
                self.worktrees.path.read(cx).focus_handle(cx)
            },
            cx,
        );
        cx.notify();
    }

    pub(super) fn worktree_request(&self, cx: &gpui::App) -> Option<WorktreeRequest> {
        if !self.can_manage_worktrees() || self.read.is_some() {
            return None;
        }

        let source = self.source.as_ref()?;

        let Phase::Worktree(form) = self.phase else {
            return None;
        };

        if form == Form::Create {
            let name = self.worktrees.name.read(cx).text().trim();

            if name.is_empty() {
                return None;
            }

            let branch = self.worktree_branch(cx).ok()?;

            Some(WorktreeRequest::Create {
                source: BranchIdentity::from_snapshot(&source.snapshot),
                branch,
                path: self.destination(cx),
            })
        } else {
            let target = self
                .worktrees
                .target
                .as_ref()
                .filter(|t| self.can_edit_worktree(t))?;

            let expected = BranchIdentity {
                oid: target.head_oid.clone(),
                branch: target.branch.clone(),
            };

            if form == Form::Remove {
                Some(WorktreeRequest::Remove {
                    path: target.path.clone(),
                    expected,
                })
            } else {
                let path = PathBuf::from(self.worktrees.path.read(cx).text());

                (path.is_absolute()
                    && path != target.path
                    && !self.worktrees.path.read(cx).text().contains('\0'))
                .then_some(WorktreeRequest::Move {
                    path: target.path.clone(),
                    expected,
                    new_path: path,
                })
            }
        }
    }

    fn worktree_branch(&self, cx: &gpui::App) -> Result<WorktreeBranch, String> {
        let name = self.worktrees.name.read(cx).text().trim();
        let data = self.data.as_ref().ok_or("Loading branches…")?;

        if let Some(branch) = data.branches.iter().find(|b| branch_label(b, data) == name) {
            if branch.checked_out || branch.worktree_path.is_some() {
                return Err(if Some(&branch.name) == data.current.as_ref() {
                    "Already used by this workspace."
                } else {
                    "Already open in another worktree."
                }
                .into());
            }

            if branch.kind == BranchKind::Remote {
                super::model::remote_target(branch, data)?;

                Ok(WorktreeBranch::Remote(branch.full_name.clone()))
            } else {
                Ok(WorktreeBranch::Existing(branch.name.clone()))
            }
        } else if let Some(error) = branch_error(name) {
            Err(error.into())
        } else {
            Ok(WorktreeBranch::New(name.into()))
        }
    }

    fn destination(&self, cx: &gpui::App) -> PathBuf {
        self.worktrees.destination.clone().unwrap_or_else(|| {
            default_destination(
                &self
                    .source
                    .as_ref()
                    .expect("worktree form has source")
                    .snapshot
                    .repository
                    .root,
                self.worktrees.name.read(cx).text().trim(),
            )
        })
    }

    fn worktree_help(&self, cx: &gpui::App) -> String {
        let name = self.worktrees.name.read(cx).text().trim();

        if name.is_empty() {
            return "Choose an existing branch or enter a new name.".into();
        }

        match self.worktree_branch(cx) {
            Err(error) => error,
            Ok(WorktreeBranch::Existing(_)) => "Uses existing branch.".into(),
            Ok(WorktreeBranch::Remote(reference)) => format!(
                "Creates “{}” tracking {}.",
                reference
                    .rsplit_once('/')
                    .map_or(reference.as_str(), |(_, name)| name),
                name
            ),
            Ok(WorktreeBranch::New(_)) => format!(
                "Creates a new branch from {}.",
                self.data
                    .as_ref()
                    .and_then(|d| d.current.as_deref())
                    .unwrap_or("HEAD")
            ),
        }
    }

    fn choose_worktree_location(&mut self, cx: &mut gpui::Context<Self>) {
        if self.busy || self.read.is_some() {
            return;
        }

        let paths = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("Choose worktree folder".into()),
        });

        let cancel = Cancellation::default();
        let done = cancel.clone();

        let task = cx.spawn(async move |this, cx| {
            let result = paths.await;

            if !done.is_cancelled() {
                let _ = this.update(cx, |this, cx| {
                    this.read = None;

                    match result {
                        Ok(Ok(Some(paths))) => {
                            if let Some(path) = paths.into_iter().next() {
                                this.worktrees.destination = Some(path);
                            }
                        }
                        Ok(Ok(None)) => {}
                        _ => this.error = Some("Could not select a destination folder.".into()),
                    }

                    cx.notify();
                });
            }
        });

        self.read = Some(ReadJob {
            cancel,
            task: Some(task),
        });
    }

    pub(in crate::workspace) fn show_worktrees(
        &mut self,
        focus: bool,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.busy || self.data.is_none() || !matches!(self.phase, Phase::List) {
            return;
        }

        self.worktrees.hover_timer = None;
        self.worktrees.submenu = true;
        self.worktrees
            .rows
            .resize_with(self.worktrees.items.len(), || {
                cx.focus_handle().tab_stop(true)
            });

        if focus {
            self.worktrees.cursor = self.worktrees.items.iter().position(|t| !t.prunable);

            if let Some(i) = self.worktrees.cursor {
                window.focus(&self.worktrees.rows[i], cx);
            }
        }

        cx.notify();
    }

    fn schedule_worktree_close(&mut self, cx: &mut gpui::Context<Self>) {
        self.worktrees.hover_timer = Some(cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(180))
                .await;
            let _ = this.update(cx, |this, cx| {
                this.worktrees.submenu = false;
                this.worktrees.hover_timer = None;
                cx.notify();
            });
        }));
    }

    pub(super) fn worktree_key(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        let key = event.keystroke.key.as_str();

        if self.worktrees.submenu && matches!(key, "left" | "escape") {
            self.worktrees.submenu = false;
            window.focus(&self.worktrees.focus, cx);
        } else if self.worktrees.submenu && matches!(key, "up" | "down" | "home" | "end" | "enter")
        {
            let enabled = self
                .worktrees
                .items
                .iter()
                .enumerate()
                .filter(|(_, t)| !t.prunable)
                .map(|(i, _)| i)
                .collect::<Vec<_>>();

            let next = match key {
                "home" => enabled.first().copied(),
                "end" => enabled.last().copied(),
                "down" => enabled
                    .iter()
                    .find(|&&i| self.worktrees.cursor.is_none_or(|old| i > old))
                    .copied()
                    .or_else(|| enabled.first().copied()),
                "up" => enabled
                    .iter()
                    .rev()
                    .find(|&&i| self.worktrees.cursor.is_none_or(|old| i < old))
                    .copied()
                    .or_else(|| enabled.last().copied()),
                _ => {
                    if let Some(i) = self.worktrees.cursor {
                        self.open_worktree(i, window, cx);
                    }

                    window.prevent_default();
                    cx.stop_propagation();

                    return true;
                }
            };

            self.worktrees.cursor = next;

            if let Some(i) = next {
                window.focus(&self.worktrees.rows[i], cx);
                self.worktrees
                    .scroll
                    .scroll_to_item(i, gpui::ScrollStrategy::Nearest);
            }
        } else if self.worktrees.focus.contains_focused(window, cx)
            && matches!(key, "right" | "enter" | "space")
        {
            self.show_worktrees(true, window, cx);
        } else {
            return false;
        }

        window.prevent_default();
        cx.stop_propagation();
        cx.notify();

        true
    }

    fn open_worktree(
        &mut self,
        index: usize,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.busy {
            return;
        }

        let Some(item) = self
            .worktrees
            .items
            .get(index)
            .filter(|t| !t.prunable)
            .cloned()
        else {
            return;
        };

        let Some(source) = self.source.clone() else {
            return;
        };

        if item.path == source.snapshot.repository.root {
            self.close(window, cx);

            return;
        }

        self.read = None;
        let process = self.process.clone();
        let cancel = Cancellation::default();
        let worker_cancel = cancel.clone();
        let complete = cancel.clone();

        let worker = cx.background_executor().spawn(async move {
            let registrations = source
                .repository
                .worktrees(Some(&worker_cancel))
                .map_err(read::message)?;

            if !registrations.iter().any(|t| {
                t.path == item.path
                    && t.head_oid == item.head_oid
                    && t.branch == item.branch
                    && !t.prunable
            }) {
                return Err("The worktree changed. Reopen Worktrees before trying again.".into());
            }

            let loaded = read::load(&item.path, process, &worker_cancel)?;

            if loaded.snapshot.repository.root != item.path
                || loaded.snapshot.repository.common_directory
                    != source.snapshot.repository.common_directory
            {
                return Err("The worktree folder changed. Nothing was opened.".into());
            }

            Ok::<_, String>(item.path)
        });

        let task = cx.spawn(async move |this, cx| {
            let result = worker.await;

            if !complete.is_cancelled() {
                let _ = this.update(cx, |this, cx| {
                    this.read = None;

                    match result {
                        Ok(path) => cx.emit(Open(path)),
                        Err(error) => this.error = Some(error),
                    }

                    cx.notify();
                });
            }
        });

        self.read = Some(ReadJob {
            cancel,
            task: Some(task),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worktree_branch_names_match_source_ref_feedback_and_default_folder() {
        for name in ["", "main", "feature/search", "Feature", "fix-123", "日本語"] {
            assert_eq!(branch_error(name), None);
        }

        for name in [
            "HEAD",
            "@",
            "@{-1}",
            "-branch",
            "bad name",
            "a..b",
            "a//b",
            ".hidden",
            "a/.hidden",
            "a.lock",
            "a.lock/b",
            "a/",
            "/a",
            "a.",
            "a~1",
            "a^",
            "a:b",
            "a?",
            "a*",
            "a[",
            "a\\b",
            "a\0b",
            "a\nb",
        ] {
            assert!(branch_error(name).is_some(), "{name:?}");
        }

        assert_eq!(
            default_destination(Path::new("/repos/app"), "feature/search"),
            Path::new("/repos/app-search")
        );
    }
}
