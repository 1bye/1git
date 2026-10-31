//! Window-owned synchronization shared by tabs and linked worktrees, with explicit transport actions.
mod model;
mod rail;
mod view;

pub(super) use rail::Rail;
pub(super) use worker::Completed;

mod worker;

use super::{ReadJob, read::Loaded};
use gpui_ce_motion::MotionValue;
use model::Review;
pub(super) use model::{Action, Request};
use onegit_git::{Cancellation, Repository, TransferPhase, TransferProgress};
use onegit_ui::{DialogEvent, DialogHostState, DialogState};
use rake::gpui;

use std::{
    sync::Arc,
    time::{Duration, Instant},
};

pub(super) enum Event {
    Submit(Request),
    Reviewed(Arc<Loaded>),
    Completed(Arc<Completed>),
}

impl gpui::EventEmitter<Event> for Sync {}

struct Job {
    cancel: Cancellation,
    completion: Option<gpui::Task<()>>,
    _progress: gpui::Task<()>,
    _deadline: gpui::Task<()>,
}

impl Drop for Job {
    fn drop(&mut self) {
        self.cancel.cancel();

        if let Some(completion) = self.completion.take() {
            completion.detach();
        }
    }
}

pub(super) struct Sync {
    dialog: gpui::Entity<DialogState>,
    close_focus: gpui::FocusHandle,
    source: Option<Arc<Loaded>>,
    review: Option<Arc<Review>>,
    read: Option<ReadJob>,
    job: Option<Job>,
    pub pending: Option<Action>,
    pub complete: bool,
    complete_timer: Option<gpui::Task<()>>,
    pub fetch_after_review: bool,
    progress: Option<TransferProgress>,
    pub error: Option<String>,
    notice: Option<String>,
    pub fetched_at: Option<i64>,
    publishing: bool,
    pub remote: Option<String>,
    needs_review: bool,
    stopping: bool,
    timed_out: bool,
    epoch: Instant,
    height: MotionValue,
    width: MotionValue,
    opacity: MotionValue,
    _events: gpui::Subscription,
}

impl Sync {
    pub fn new(host: &DialogHostState, cx: &mut gpui::Context<Self>) -> Self {
        let dialog = host.dialog(cx);

        let events = cx.subscribe(&dialog, |this: &mut Self, _, _: &DialogEvent, cx| {
            this.read = None;
            this.fetch_after_review = false;
            this.publishing = false;
            this.remote = None;
            cx.notify();
        });

        Self {
            dialog,
            close_focus: cx.focus_handle().tab_stop(true),
            source: None,
            review: None,
            read: None,
            job: None,
            pending: None,
            complete: false,
            complete_timer: None,
            fetch_after_review: false,
            progress: None,
            error: None,
            notice: None,
            fetched_at: None,
            publishing: false,
            remote: None,
            needs_review: false,
            stopping: false,
            timed_out: false,
            epoch: cx.background_executor().now(),
            height: MotionValue::new(0.),
            width: MotionValue::new(340.),
            opacity: MotionValue::new(0.),
            _events: events,
        }
    }

    pub fn busy(&self) -> bool {
        self.pending.is_some()
    }

    pub fn open(
        &mut self,
        source: Arc<Loaded>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if !self.busy() {
            self.source = Some(source);
            self.publishing = false;
            self.remote = None;
            self.load(cx);
        }

        self.epoch = cx.background_executor().now();
        self.height = MotionValue::new(0.);
        self.opacity = MotionValue::new(0.);
        self.width = MotionValue::new(340.);
        self.dialog.update(cx, |dialog, cx| dialog.open(window, cx));
        cx.notify();
    }

    fn close(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        self.dialog
            .update(cx, |dialog, cx| dialog.close(window, cx));
    }

    fn load(&mut self, cx: &mut gpui::Context<Self>) {
        if self.busy() {
            return;
        }

        self.read = None;
        self.review = None;
        self.remote = None;
        self.publishing = false;

        let Some(source) = self.source.clone() else {
            return;
        };

        let cancel = Cancellation::default();
        let worker_cancel = cancel.clone();
        let completion_cancel = cancel.clone();

        let worker = cx
            .background_executor()
            .spawn(async move { model::review(source, &worker_cancel) });

        let task = cx.spawn(async move |this, cx| {
            let result = worker.await;

            if !completion_cancel.is_cancelled() {
                let _ = this.update(cx, |this, cx| {
                    this.read = None;

                    match result {
                        Ok(review) => {
                            this.source = Some(review.loaded.clone());
                            this.needs_review = false;
                            cx.emit(Event::Reviewed(review.loaded.clone()));
                            let has_remotes = !review.remotes.is_empty();

                            this.review = Some(review);

                            if this.fetch_after_review {
                                this.fetch_after_review = false;

                                if has_remotes {
                                    this.submit(Action::Fetch, cx);
                                } else {
                                    this.notice = Some(
                                        "Local status refreshed; no remotes configured.".into(),
                                    );
                                }
                            }
                        }
                        Err(error) => {
                            this.error = Some(error);
                            this.needs_review = true;
                        }
                    }

                    cx.notify();
                });
            }
        });

        self.read = Some(ReadJob {
            cancel,
            task: Some(task),
        });
        cx.notify();
    }

    pub fn begin_publish(&mut self, cx: &mut gpui::Context<Self>) {
        if self.busy() || self.read.is_some() || self.needs_review {
            return;
        }

        let Some(review) = &self.review else {
            return;
        };

        if let Some(error) = review.blocked(Action::Publish) {
            self.error = Some(error.into());
            cx.notify();

            return;
        }

        self.publishing = true;
        self.remote = None;

        if let [remote] = review.remotes.as_slice()
            && remote.push_urls.len() == 1
        {
            self.remote = Some(remote.name.clone());
        }

        cx.notify();
    }

    pub fn select_remote(&mut self, name: String, cx: &mut gpui::Context<Self>) {
        if !self.busy()
            && self.publishing
            && self.review.as_ref().is_some_and(|review| {
                review
                    .remotes
                    .iter()
                    .any(|remote| remote.name == name && remote.push_urls.len() == 1)
            })
        {
            self.remote = Some(name);
            cx.notify();
        }
    }

    pub fn submit(&mut self, action: Action, cx: &mut gpui::Context<Self>) {
        if self.busy() || self.read.is_some() || self.needs_review {
            return;
        }

        let Some(review) = self.review.clone() else {
            return;
        };

        if let Some(error) = review.blocked(action) {
            self.error = Some(error.into());
            cx.notify();

            return;
        }

        let remote = if action == Action::Publish {
            if !self.publishing {
                return;
            }

            self.remote
                .as_ref()
                .and_then(|name| {
                    review
                        .remotes
                        .iter()
                        .find(|remote| remote.name == *name && remote.push_urls.len() == 1)
                })
                .cloned()
        } else {
            review.upstream().map(|(remote, _)| remote.clone())
        };

        if action != Action::Fetch && remote.is_none() {
            return;
        }

        self.complete = false;
        self.complete_timer = None;
        self.pending = Some(action);
        self.progress = Some(TransferProgress {
            phase: TransferPhase::Connecting,
            percent: None,
        });
        self.error = None;
        self.notice = None;
        self.stopping = false;
        self.timed_out = false;
        cx.emit(Event::Submit(Request {
            action,
            review,
            remote,
        }));
        cx.notify();
    }

    pub fn reject(&mut self, message: &str, cx: &mut gpui::Context<Self>) {
        self.pending = None;
        self.progress = None;
        self.error = Some(message.into());
        self.needs_review = true;
        cx.notify();
    }

    pub fn start(
        &mut self,
        request: Request,
        peers: Vec<Arc<Repository>>,
        scope: Option<&rake::tasks::TaskScope>,
        cx: &mut gpui::Context<Self>,
    ) {
        let cancel = Cancellation::default();
        let worker_cancel = cancel.clone();
        let (sender, receiver) = async_channel::bounded(1);
        let replace = receiver.clone();
        let owner = cx.weak_entity();
        let mut context = cx.to_async();

        let completion = async move {
            let roots = peers
                .iter()
                .map(|repository| repository.info().root.clone())
                .collect::<Vec<_>>();

            let (finished, result) = async_channel::bounded(1);

            // Network waits have their own worker; the UI and GPUI read pool remain available.
            let worker = std::thread::Builder::new()
                .name("1git-sync".into())
                .spawn(move || {
                    let progress = move |value| {
                        if sender.is_full() {
                            let _ = replace.try_recv();
                        }

                        let _ = sender.try_send(value);
                    };

                    let completed = worker::run(&request, peers, &worker_cancel, &progress);
                    let _ = finished.send_blocking(completed);
                });

            let completed=match worker {
                Ok(_)=>result.recv().await.map_err(|_|"The transport worker stopped unexpectedly. Review local and remote status before trying again.".to_owned()),
                Err(error)=>Err(format!("The operation did not start: {error}")),
            }.unwrap_or_else(|error|worker::Completed {
                result:Err(error.clone()),snapshots:roots.into_iter().map(|root|(root,Err(error.clone()))).collect(),
            });

            let _ = owner.update(&mut context, |this, cx| this.finish(completed, cx));
        };

        let completion = if let Some(scope) = scope {
            match scope.spawn("Synchronize repository", async move {
                completion.await;

                Ok(())
            }) {
                Ok(_) => None,
                Err(error) => {
                    self.reject(&format!("The operation did not start: {error}"), cx);

                    return;
                }
            }
        } else {
            Some(cx.foreground_executor().spawn(completion))
        };

        let progress = cx.spawn(async move |this, cx| {
            while let Ok(value) = receiver.recv().await {
                if this
                    .update(cx, |this, cx| {
                        if this.busy() && this.progress != Some(value) {
                            this.progress = Some(value);
                            cx.notify();
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        });

        let timeout_cancel = cancel.clone();

        let deadline = cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_secs(120))
                .await;
            let _ = this.update(cx, |this, cx| {
                this.timed_out = true;
                this.stopping = true;
                timeout_cancel.cancel();
                cx.notify();
            });
        });

        self.job = Some(Job {
            cancel,
            completion,
            _progress: progress,
            _deadline: deadline,
        });
        cx.notify();
    }

    pub fn stop(&mut self, cx: &mut gpui::Context<Self>) {
        if let Some(job) = &self.job {
            job.cancel.cancel();
            self.stopping = true;
            cx.notify();
        }
    }

    fn finish(&mut self, mut completed: worker::Completed, cx: &mut gpui::Context<Self>) {
        self.job = None;
        let action = self.pending.take();

        self.progress = None;
        self.publishing = false;
        self.remote = None;

        if self.timed_out {
            completed.result=Err("Synchronization timed out. It may have completed; review local and remote status before trying again.".into());
        } else if self.stopping && completed.result.is_err() {
            completed.result = Err(format!(
                "{} cancelled. Review local and remote status before trying again.",
                action.map_or("Operation", Action::label)
            ));
        }

        if completed.result.is_ok() {
            if matches!(action, Some(Action::Fetch | Action::Pull)) {
                self.fetched_at = Some(chrono::Utc::now().timestamp_millis());
            }

            self.notice = Some(
                match action {
                    Some(Action::Fetch) => "Fetch complete.",
                    Some(Action::Pull) => "Pull complete.",
                    Some(Action::Push) => "Push complete.",
                    Some(Action::Publish) => "Branch published.",
                    None => "Synchronization complete.",
                }
                .into(),
            );
        }

        self.error = completed.result.as_ref().err().cloned().or_else(|| {
            completed.snapshots.iter().find_map(|(_,result)|result.as_ref().err()).map(|error|format!("Git finished, but repository status could not be refreshed: {error}. Refresh before writing again."))
        });

        if self.error.is_none() {
            self.complete = true;
            self.complete_timer = Some(cx.spawn(async move |this, cx| {
                cx.background_executor().timer(Duration::from_secs(3)).await;
                let _ = this.update(cx, |this, cx| {
                    this.complete = false;
                    this.complete_timer = None;
                    cx.notify();
                });
            }));
        }

        self.needs_review = self.error.is_some()
            || completed
                .snapshots
                .iter()
                .any(|(_, loaded)| loaded.is_err());

        if let Some(root) = self
            .source
            .as_ref()
            .map(|source| source.snapshot.repository.root.clone())
            && let Some((_, Ok(loaded))) =
                completed.snapshots.iter().find(|(path, _)| *path == root)
        {
            self.source = Some(loaded.clone());
        }

        self.review = None;
        cx.emit(Event::Completed(Arc::new(completed)));
        cx.notify();

        // Only read metadata after completion; no transport is repeated implicitly.
        if self.dialog.read(cx).is_open() {
            self.load(cx);
        }
    }
}
