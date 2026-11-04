//! Window-local Git settings; drafts stay in retained controls and writes require a frozen review.
mod view;
mod worker;

use super::{ReadJob, WriteJob, read::Loaded};
use gpui_ce_motion::MotionValue;

use onegit_git::{
    Cancellation, CommitIdentity, GitProcess, GitSettings, GlobalGitIdentity, GlobalIdentityReview,
    SettingsChange,
};

use onegit_ui::{DialogHostState, DialogState, InputEvent, InputState};
use rake::gpui::{self, AppContext, Focusable};
use std::{path::PathBuf, sync::Arc, time::Instant};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Page {
    Global,
    Identity,
    Remotes,
}

#[derive(Clone, PartialEq, Eq)]
pub(super) enum Editor {
    Identity,
    Add,
    Edit(String),
}

#[derive(Clone)]
pub(super) enum Review {
    Repository(GitSettings),
    Global(GlobalIdentityReview),
}

impl Review {
    fn identity(&self) -> &CommitIdentity {
        match self {
            Self::Repository(data) => &data.identity,
            Self::Global(data) => &data.identity,
        }
    }

    fn custom(&self) -> bool {
        match self {
            Self::Repository(data) => data.custom(),
            Self::Global(_) => true,
        }
    }
}

#[derive(Clone)]
pub(super) struct Request {
    pub source: Option<Arc<Loaded>>,
    pub review: Review,
    pub change: SettingsChange,
    pub global: GlobalGitIdentity,
}

pub(super) enum Event {
    Submit(Box<Request>),
    Completed(Arc<worker::Completed>),
    Closed,
}

impl gpui::EventEmitter<Event> for Panel {}

pub(super) struct Panel {
    pub visible: bool,
    source: Option<Arc<Loaded>>,
    process: GitProcess,
    global: Option<GlobalGitIdentity>,
    page: Page,
    review: Option<Review>,
    editor: Option<Editor>,
    pub name: gpui::Entity<InputState>,
    pub email: gpui::Entity<InputState>,
    pub remote_name: gpui::Entity<InputState>,
    pub remote_url: gpui::Entity<InputState>,
    custom: bool,
    pub error: Option<String>,
    notice: Option<String>,
    needs_review: bool,
    pub pending: bool,
    read: Option<ReadJob>,
    job: Option<WriteJob>,
    removing: Option<String>,
    dialog: gpui::Entity<DialogState>,
    focus: gpui::FocusHandle,
    cancel_focus: gpui::FocusHandle,
    choice_focus: [gpui::FocusHandle; 2],
    return_focus: Option<gpui::FocusHandle>,
    editor_return: Option<gpui::FocusHandle>,
    scroll: gpui::ScrollHandle,
    editor_scroll: gpui::ScrollHandle,
    epoch: Instant,
    reveal: MotionValue,
    remove_epoch: Instant,
    remove_height: MotionValue,
    remove_opacity: MotionValue,
    _events: Vec<gpui::Subscription>,
}

impl Panel {
    pub fn new(
        host: &DialogHostState,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> Self {
        let name = cx.new(|cx| InputState::new("", window, cx));
        let email = cx.new(|cx| InputState::new("", window, cx));
        let remote_name = cx.new(|cx| InputState::new("", window, cx));
        let remote_url = cx.new(|cx| InputState::new("", window, cx));
        let dialog = host.dialog(cx);
        let mut events = Vec::new();

        for input in [&name, &email, &remote_name, &remote_url] {
            events.push(cx.subscribe(input, |_: &mut Self, _, _: &InputEvent, cx| cx.notify()));
        }

        events.push(cx.subscribe(
            &dialog,
            |this: &mut Self, _, _: &onegit_ui::DialogEvent, cx| {
                if !this.pending {
                    this.removing = None;
                }

                cx.notify();
            },
        ));

        Self {
            visible: false,
            source: None,
            process: GitProcess::default(),
            global: None,
            page: Page::Global,
            review: None,
            editor: None,
            name,
            email,
            remote_name,
            remote_url,
            custom: true,
            error: None,
            notice: None,
            needs_review: false,
            pending: false,
            read: None,
            job: None,
            removing: None,
            dialog,
            focus: cx.focus_handle(),
            cancel_focus: cx.focus_handle(),
            choice_focus: [cx.focus_handle(), cx.focus_handle()],
            return_focus: None,
            editor_return: None,
            scroll: gpui::ScrollHandle::new(),
            editor_scroll: gpui::ScrollHandle::new(),
            epoch: cx.background_executor().now(),
            reveal: MotionValue::new(0.),
            remove_epoch: cx.background_executor().now(),
            remove_height: MotionValue::new(116.),
            remove_opacity: MotionValue::new(0.),
            _events: events,
        }
    }

    pub fn open(
        &mut self,
        source: Option<Arc<Loaded>>,
        process: GitProcess,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let same = self.source.as_ref().map(|s| &s.snapshot.repository.root)
            == source.as_ref().map(|s| &s.snapshot.repository.root);

        self.visible = true;
        self.return_focus = window.focused(cx);
        window.focus(&self.focus, cx);

        if self.pending || self.editor.is_some() {
            if !same {
                self.error=Some("Finish or cancel the current Git settings editor before changing repositories.".into());
            }

            cx.notify();

            return;
        }

        self.source = source;
        self.process = process.clone();
        let cwd = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from);

        self.global = cwd.map(|cwd| GlobalGitIdentity::new(process, cwd));
        self.page = if self.source.is_some() {
            Page::Identity
        } else {
            Page::Global
        };
        self.load(cx);
        cx.notify();
    }

    pub(in crate::workspace) fn close(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.pending {
            return;
        }

        self.visible = false;

        if let Some(focus) = self.return_focus.take() {
            window.focus(&focus, cx);
        }

        cx.emit(Event::Closed);
        cx.notify();
    }

    pub(in crate::workspace) fn choose(&mut self, page: Page, cx: &mut gpui::Context<Self>) {
        if self.pending || self.page == page {
            return;
        }

        if self.editor.is_some() {
            self.error =
                Some("Save or cancel the current editor before changing settings pages.".into());
            cx.notify();

            return;
        }

        if page != Page::Global && self.source.is_none() {
            return;
        }

        self.page = page;
        self.load(cx);
    }

    pub(in crate::workspace) fn load(&mut self, cx: &mut gpui::Context<Self>) {
        if self.pending {
            return;
        }

        self.read = None;
        self.review = None;
        self.error = None;
        self.notice = None;
        self.needs_review = false;
        let source = if self.page == Page::Global {
            None
        } else {
            self.source.clone()
        };

        let global = self.global.clone();
        let cancel = Cancellation::default();
        let worker_cancel = cancel.clone();

        let job = cx.background_executor().spawn(async move {
            if let Some(source) = source {
                source
                    .repository
                    .git_settings(Some(&worker_cancel))
                    .map(Review::Repository)
                    .map_err(super::read::message)
            } else {
                global
                    .ok_or_else(|| "Your home directory is unavailable.".into())
                    .and_then(|global| {
                        global
                            .read(Some(&worker_cancel))
                            .map(Review::Global)
                            .map_err(super::read::message)
                    })
            }
        });

        let completed_cancel = cancel.clone();

        let task = cx.spawn(async move |this, cx| {
            let result = job.await;

            let _ = this.update(cx, |this, cx| {
                if completed_cancel.is_cancelled() {
                    return;
                }

                this.read = None;

                match result {
                    Ok(review) => {
                        this.review = Some(review);
                    }
                    Err(error) => this.error = Some(error),
                }

                cx.notify();
            });
        });

        self.read = Some(ReadJob {
            cancel,
            task: Some(task),
        });
        cx.notify();
    }

    pub(in crate::workspace) fn edit(
        &mut self,
        editor: Editor,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.pending || self.read.is_some() || self.needs_review || self.review.is_none() {
            return;
        }

        self.editor_return = window.focused(cx);
        let review = self.review.as_ref().expect("reviewed editor");

        if editor == Editor::Identity {
            if matches!(review,Review::Repository(data) if data.identity_read_only_reason.is_some())
            {
                return;
            }

            self.custom = review.custom();
            self.name.update(cx, |input, cx| {
                input.set_text(review.identity().name.as_deref().unwrap_or(""), cx)
            });
            self.email.update(cx, |input, cx| {
                input.set_text(review.identity().email.as_deref().unwrap_or(""), cx)
            });
        } else {
            let name = if let Editor::Edit(name) = &editor {
                name.as_str()
            } else {
                ""
            };

            let remote = match review {
                Review::Repository(data) => data.remotes.iter().find(|r| r.name == name),
                _ => None,
            };

            if matches!(editor, Editor::Edit(_)) && remote.is_none_or(|r| r.fetch_urls.len() != 1) {
                return;
            }

            self.remote_name
                .update(cx, |input, cx| input.set_text(name, cx));
            self.remote_url.update(cx, |input, cx| {
                input.set_text(
                    remote
                        .and_then(|r| r.fetch_urls.first())
                        .map_or("", String::as_str),
                    cx,
                )
            });
        }

        self.editor = Some(editor);
        self.error = None;
        self.notice = None;
        self.epoch = cx.background_executor().now();
        self.reveal = MotionValue::new(0.);
        let input = if self.editor == Some(Editor::Identity) {
            &self.name
        } else if self.editor == Some(Editor::Add) {
            &self.remote_name
        } else {
            &self.remote_url
        };

        if self.editor == Some(Editor::Identity) && !self.custom {
            window.focus(&self.choice_focus[0], cx);
        } else {
            window.focus(&input.read(cx).focus_handle(cx), cx);
        }

        cx.notify();
    }

    pub(in crate::workspace) fn cancel(
        &mut self,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.pending {
            return;
        }

        self.editor = None;
        self.error = None;
        self.notice = None;
        window.focus(self.editor_return.as_ref().unwrap_or(&self.focus), cx);

        if self.needs_review {
            self.load(cx);
        }

        cx.notify();
    }

    fn identity(&self, cx: &gpui::App) -> CommitIdentity {
        CommitIdentity {
            name: Some(self.name.read(cx).text().into()),
            email: Some(self.email.read(cx).text().into()),
        }
    }

    fn changed(&self, cx: &gpui::App) -> bool {
        match (&self.editor, &self.review) {
            (Some(Editor::Identity), Some(review)) => {
                self.custom != review.custom()
                    || (self.custom && self.identity(cx) != *review.identity())
            }
            (Some(Editor::Add), _) => {
                !self.remote_name.read(cx).text().trim().is_empty()
                    && !self.remote_url.read(cx).text().trim().is_empty()
            }
            (Some(Editor::Edit(name)), Some(Review::Repository(data))) => data
                .remotes
                .iter()
                .find(|r| r.name == *name)
                .and_then(|r| r.fetch_urls.first())
                .is_some_and(|url| url != self.remote_url.read(cx).text().trim()),
            _ => false,
        }
    }

    pub(in crate::workspace) fn save(&mut self, cx: &mut gpui::Context<Self>) {
        if !self.changed(cx) {
            return;
        }

        let change = match &self.editor {
            Some(Editor::Identity) => {
                let identity = self.identity(cx);

                if self.custom
                    && let Err(error) = identity.validate()
                {
                    self.error = Some(super::read::message(error));
                    cx.notify();

                    return;
                }

                SettingsChange::Identity(self.custom.then_some(identity))
            }
            Some(Editor::Add) => SettingsChange::AddRemote {
                name: self.remote_name.read(cx).text().trim().into(),
                url: self.remote_url.read(cx).text().trim().into(),
            },
            Some(Editor::Edit(name)) => SettingsChange::EditRemote {
                name: name.clone(),
                url: self.remote_url.read(cx).text().trim().into(),
            },
            None => return,
        };

        self.submit(change, cx);
    }

    fn submit(&mut self, change: SettingsChange, cx: &mut gpui::Context<Self>) {
        if self.pending || self.read.is_some() || self.needs_review {
            return;
        }

        let (Some(review), Some(global)) = (self.review.clone(), self.global.clone()) else {
            return;
        };

        self.pending = true;
        self.error = None;
        self.notice = None;
        cx.emit(Event::Submit(Box::new(Request {
            source: if self.page == Page::Global {
                None
            } else {
                self.source.clone()
            },
            review,
            change,
            global,
        })));
        cx.notify();
    }

    pub(in crate::workspace) fn remove(
        &mut self,
        name: String,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.pending || self.editor.is_some() || self.needs_review {
            return;
        }

        self.remove_epoch = cx.background_executor().now();
        self.remove_height = MotionValue::new(116.);
        self.remove_opacity = MotionValue::new(0.);
        self.removing = Some(name);
        self.error = None;
        self.dialog.update(cx, |dialog, cx| dialog.open(window, cx));
        cx.notify();
    }

    pub fn reject(&mut self, message: String, cx: &mut gpui::Context<Self>) {
        self.pending = false;
        self.error = Some(message);
        self.needs_review = true;
        cx.notify();
    }

    pub(in crate::workspace) fn hide(&mut self, cx: &mut gpui::Context<Self>) {
        self.visible = false;
        cx.notify();
    }

    pub fn affects(&self, common: &std::path::Path) -> bool {
        self.pending
            && (self.page == Page::Global
                || self
                    .source
                    .as_ref()
                    .is_some_and(|s| s.snapshot.repository.common_directory == common))
    }

    pub fn start(
        &mut self,
        request: Request,
        peers: Vec<Arc<onegit_git::Repository>>,
        scope: Option<&rake::tasks::TaskScope>,
        cx: &mut gpui::Context<Self>,
    ) {
        let executor = cx.background_executor().clone();
        let entity = cx.weak_entity();
        let mut context = cx.to_async();

        let completion = async move {
            let result = executor
                .spawn(async move { worker::run(request, peers) })
                .await;

            let _ = entity.update_in(&mut context, |this, window, cx| {
                this.job = None;
                this.pending = false;

                match &result.result {
                    Ok(review) => {
                        this.review = Some(review.clone());
                        this.editor = None;
                        this.notice = Some("Git settings saved.".into());
                        this.needs_review = false;
                        this.removing = None;
                        this.dialog
                            .update(cx, |dialog, cx| dialog.close(window, cx));

                        if this.visible {
                            window.focus(this.editor_return.as_ref().unwrap_or(&this.focus), cx);
                        }
                    }
                    Err(error) => {
                        this.error = Some(error.clone());
                        this.needs_review = result.needs_review;
                    }
                }

                cx.emit(Event::Completed(Arc::new(result)));
                cx.notify();
            });
        };

        self.job = if let Some(scope) = scope {
            match scope.spawn("Save Git settings", async move {
                completion.await;

                Ok(())
            }) {
                Ok(_) => Some(WriteJob(None)),
                Err(error) => {
                    self.reject(format!("Could not start settings save: {error}"), cx);

                    None
                }
            }
        } else {
            Some(WriteJob(Some(cx.foreground_executor().spawn(completion))))
        };
    }
}
