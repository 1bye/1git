//! Retained account setup stays independent of repository drafts and has no automatic transport retries.
use super::{
    cli::CliAccount,
    model::*,
    oauth::Progress,
    service::Accounts,
    store::{Review, Store},
    vault::NativeVault,
};

use gpui_ce_motion::MotionValue;
use onegit_git::Cancellation;
use onegit_ui::{DialogHostState, DialogState, InputEvent, InputState};
use rake::gpui::{self, AppContext};
use std::{collections::HashMap, rc::Rc, time::Instant};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Method {
    Browser,
    Token,
    Cli,
}

struct Job {
    cancel: Cancellation,
    task: Option<gpui::Task<()>>,
}

impl Drop for Job {
    fn drop(&mut self) {
        self.cancel.cancel();

        if let Some(task) = self.task.take() {
            task.detach();
        }
    }
}

pub(crate) struct Panel {
    pub(super) active: bool,
    pub(super) accounts: Option<Rc<Accounts>>,
    pub(super) review: Option<Review>,
    pub(super) error: Option<String>,
    pub(super) status: HashMap<String, String>,
    pub(super) form: bool,
    pub(super) replacing: Option<Account>,
    pub(super) provider: Provider,
    pub(super) method: Method,
    pub(super) advanced: bool,
    pub(super) repositories: bool,
    pub(super) host: gpui::Entity<InputState>,
    pub(super) client: gpui::Entity<InputState>,
    pub(super) callback: gpui::Entity<InputState>,
    pub(super) token: gpui::Entity<InputState>,
    pub(super) device: Option<String>,
    pub(super) pending: bool,
    pub(super) waiting: bool,
    pub(super) loading: bool,
    pub(super) cli_accounts: Vec<CliAccount>,
    pub(super) cli_selected: Option<usize>,
    pub(super) cli_loading: bool,
    pub(super) cli_error: Option<String>,
    pub(super) removing: Option<Account>,
    pub(super) dialog: gpui::Entity<DialogState>,
    pub(super) add_focus: gpui::FocusHandle,
    pub(super) cancel_focus: gpui::FocusHandle,
    pub(super) choice_focus: Vec<gpui::FocusHandle>,
    pub(super) scroll: gpui::ScrollHandle,
    pub(super) editor_scroll: gpui::ScrollHandle,
    pub(super) epoch: Instant,
    pub(super) reveal: MotionValue,
    pub(super) remove_epoch: Instant,
    pub(super) remove_height: MotionValue,
    pub(super) remove_opacity: MotionValue,
    pub(super) copied: Option<&'static str>,
    job: Option<Job>,
    read: Option<gpui::Task<()>>,
    cli_job: Option<Job>,
    details: Option<gpui::Task<()>>,
    revision: u64,
    _events: Vec<gpui::Subscription>,
}

impl Panel {
    pub fn new(
        dialog_host: &DialogHostState,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> Self {
        let [host, client, callback, token] = ["https://github.com/", "", CALLBACK, ""]
            .map(|value| cx.new(|cx| InputState::new(value, window, cx)));

        let dialog = dialog_host.dialog(cx);
        let mut events = Vec::new();

        for input in [&host, &client, &callback, &token] {
            events.push(cx.subscribe(input, |_: &mut Self, _, _: &InputEvent, cx| cx.notify()));
        }

        events.push(cx.subscribe(
            &dialog,
            |this: &mut Self, _, _: &onegit_ui::DialogEvent, cx| {
                if !this.pending {
                    this.removing = None;
                    this.error = None;
                }

                cx.notify();
            },
        ));
        let accounts = Store::default_path().map(|path| {
            Rc::new(Accounts::new(
                Store::new(path),
                Rc::new(NativeVault::new(cx)),
                cx,
            ))
        });

        Self {
            active: false,
            accounts,
            review: None,
            error: None,
            status: HashMap::new(),
            form: false,
            replacing: None,
            provider: Provider::GitHub,
            method: Method::Browser,
            advanced: false,
            repositories: false,
            host,
            client,
            callback,
            token,
            device: None,
            pending: false,
            waiting: false,
            loading: false,
            cli_accounts: Vec::new(),
            cli_selected: None,
            cli_loading: false,
            cli_error: None,
            removing: None,
            dialog,
            add_focus: cx.focus_handle().tab_stop(true),
            cancel_focus: cx.focus_handle(),
            choice_focus: (0..6).map(|_| cx.focus_handle().tab_stop(true)).collect(),
            scroll: gpui::ScrollHandle::new(),
            editor_scroll: gpui::ScrollHandle::new(),
            epoch: cx.background_executor().now(),
            reveal: MotionValue::new(0.),
            remove_epoch: cx.background_executor().now(),
            remove_height: MotionValue::new(110.),
            remove_opacity: MotionValue::new(0.),
            copied: None,
            job: None,
            read: None,
            cli_job: None,
            details: None,
            revision: 0,
            _events: events,
        }
    }

    pub fn open(&mut self, cx: &mut gpui::Context<Self>) {
        self.active = true;

        if !self.pending && !self.form {
            self.load(cx);
        }
    }

    pub fn editing(&self) -> bool {
        self.form
    }

    #[cfg(all(test, feature = "test-support"))]
    pub(crate) fn test_store(&mut self, path: std::path::PathBuf, cx: &mut gpui::Context<Self>) {
        self.accounts = Some(Rc::new(Accounts::new(
            Store::new(path),
            Rc::new(super::service_tests::MemoryVault::default()),
            cx,
        )));
    }

    pub(super) fn form_locked(&self) -> bool {
        self.pending || self.details.is_some()
    }

    pub fn busy(&self) -> bool {
        self.pending
    }

    pub fn leave(&mut self, cx: &mut gpui::Context<Self>) -> bool {
        self.clear_token(cx);

        if self.pending {
            if self.waiting
                && let Some(job) = &self.job
            {
                job.cancel.cancel();
            }

            return false;
        }

        self.active = false;
        self.form = false;
        self.replacing = None;
        self.cli_job = None;
        self.details = None;
        self.revision += 1;
        self.error = None;
        cx.notify();

        true
    }

    pub fn hide(&mut self, cx: &mut gpui::Context<Self>) {
        self.active = false;
        self.clear_token(cx);

        if self.waiting
            && let Some(job) = &self.job
        {
            job.cancel.cancel();
        }

        cx.notify();
    }

    pub(super) fn clear_token(&mut self, cx: &mut gpui::Context<Self>) {
        self.token.update(cx, |input, cx| {
            let _discard = zeroize::Zeroizing::new(input.take_secret(cx));
        });
    }

    pub(super) fn load(&mut self, cx: &mut gpui::Context<Self>) {
        if self.pending {
            return;
        }

        self.error = None;
        self.loading = true;
        self.review = None;

        let Some(accounts) = self.accounts.clone() else {
            self.loading = false;
            self.error = Some("Your private account directory is unavailable.".into());
            cx.notify();

            return;
        };

        self.read = Some(cx.spawn(async move |this, cx| {
            let result = accounts.load().await;

            let _ = this.update(cx, |this, cx| {
                this.loading = false;
                this.read = None;

                match result {
                    Ok(review) => this.review = Some(review),
                    Err(error) => this.error = Some(error),
                }

                cx.notify();
            });
        }));
        cx.notify();
    }

    pub(super) fn begin(
        &mut self,
        account: Option<Account>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.pending || self.loading || self.review.is_none() {
            return;
        }

        self.clear_token(cx);
        self.revision += 1;
        let revision = self.revision;

        self.provider = account.as_ref().map_or(Provider::GitHub, |a| a.provider);
        self.method = if account
            .as_ref()
            .and_then(|a| a.credential_source.as_deref())
            == Some("github-cli")
        {
            Method::Cli
        } else {
            Method::Browser
        };
        let host = account
            .as_ref()
            .map_or(self.provider.default_host(), |a| a.web_url.as_str());

        self.advanced = host != self.provider.default_host();
        self.host.update(cx, |input, cx| input.set_text(host, cx));
        self.client.update(cx, |input, cx| input.set_text("", cx));
        self.callback
            .update(cx, |input, cx| input.set_text(CALLBACK, cx));
        self.repositories = false;
        self.device = None;
        self.error = None;
        self.copied = None;
        self.replacing = account.clone();
        self.form = true;
        self.epoch = cx.background_executor().now();
        self.reveal = MotionValue::new(0.);
        self.editor_scroll
            .set_offset(gpui::point(gpui::px(0.), gpui::px(0.)));
        window.focus(&self.choice_focus[0], cx);

        if self.method == Method::Cli {
            self.discover(cx);
        } else if let (Some(account), Some(accounts)) = (account, self.accounts.clone()) {
            self.details = Some(cx.spawn(async move |this, cx| {
                let result = accounts.details(account).await;

                let _ = this.update(cx, |this, cx| {
                    if this.revision != revision || !this.form {
                        return;
                    }

                    this.details = None;

                    match result {
                        Ok((registration, access)) => {
                            this.repositories = access;

                            if let Some(r) = registration {
                                this.client.update(cx, |i, cx| i.set_text(r.client_id, cx));

                                if let Some(callback) = r.redirect_uri {
                                    this.callback.update(cx, |i, cx| i.set_text(callback, cx));
                                }
                            }
                        }
                        Err(error) => this.error = Some(error),
                    }

                    cx.notify();
                });
            }));
        }

        cx.notify();
    }

    pub(super) fn provider(&mut self, provider: Provider, cx: &mut gpui::Context<Self>) {
        if self.pending || self.replacing.is_some() || self.provider == provider {
            return;
        }

        self.clear_token(cx);
        self.revision += 1;
        self.details = None;
        self.cli_job = None;
        self.provider = provider;
        self.method = Method::Browser;
        self.advanced = false;
        self.error = None;
        self.copied = None;
        self.host
            .update(cx, |i, cx| i.set_text(provider.default_host(), cx));
        self.client.update(cx, |i, cx| i.set_text("", cx));
        self.callback.update(cx, |i, cx| i.set_text(CALLBACK, cx));
        cx.notify();
    }

    pub(super) fn method(&mut self, method: Method, cx: &mut gpui::Context<Self>) {
        if self.pending
            || self.method == method
            || method == Method::Cli && self.provider != Provider::GitHub
        {
            return;
        }

        self.clear_token(cx);
        self.method = method;
        self.error = None;
        self.cli_job = None;

        if method == Method::Cli {
            self.discover(cx);
        }

        cx.notify();
    }

    pub(super) fn discover(&mut self, cx: &mut gpui::Context<Self>) {
        let Some(accounts) = &self.accounts else {
            return;
        };

        let cli = accounts.cli.clone();
        let executor = accounts.executor.clone();

        self.cli_job = None;
        self.cli_accounts.clear();
        self.cli_selected = None;
        self.cli_error = None;
        self.cli_loading = true;
        let cancel = Cancellation::default();
        let checked = cancel.clone();
        let completed_cancel = cancel.clone();
        let revision = self.revision;

        let task = cx.spawn(async move |this, cx| {
            let result = executor.spawn(async move { cli.accounts(&checked) }).await;

            if completed_cancel.is_cancelled() {
                return;
            }

            let _ = this.update(cx, |this, cx| {
                if revision != this.revision || this.method != Method::Cli {
                    return;
                }

                this.cli_job = None;
                this.cli_loading = false;

                match result {
                    Ok(found) => {
                        this.cli_selected = (found.len() == 1).then_some(0);
                        this.cli_accounts = found;
                    }
                    Err(error) => this.cli_error = Some(error),
                }

                cx.notify();
            });
        });

        self.cli_job = Some(Job {
            cancel,
            task: Some(task),
        });
        cx.notify();
    }

    pub(crate) fn cancel(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if self.pending {
            if self.waiting
                && let Some(job) = &self.job
            {
                job.cancel.cancel();
            }

            return;
        }

        self.clear_token(cx);
        self.form = false;
        window.focus(&self.add_focus, cx);
        self.error = None;
        self.replacing = None;
        self.cli_job = None;
        self.details = None;
        self.revision += 1;
        self.load(cx);
        cx.notify();
    }

    pub(super) fn connect(&mut self, cx: &mut gpui::Context<Self>) {
        if self.pending || !self.form || self.details.is_some() {
            return;
        }

        let (Some(accounts), Some(review)) = (self.accounts.clone(), self.review.clone()) else {
            return;
        };

        let host = match Host::new(
            self.provider,
            if self.method == Method::Cli {
                self.provider.default_host()
            } else {
                self.host.read(cx).text()
            },
        ) {
            Ok(host) => host,
            Err(e) => {
                self.error = Some(e);
                cx.notify();

                return;
            }
        };

        let method = self.method;
        let replacing = self.replacing.clone();

        let cli = self
            .cli_selected
            .and_then(|i| self.cli_accounts.get(i))
            .cloned();

        let registration = Registration {
            client_id: self.client.read(cx).text().trim().into(),
            redirect_uri: (self.provider == Provider::GitLab)
                .then(|| self.callback.read(cx).text().trim().into()),
        };

        let credential = if method == Method::Token {
            let text = self.token.update(cx, |input, cx| input.take_secret(cx));

            match Secret::token(text, 2048) {
                Ok(token) => Some(Credential { token, oauth: None }),
                Err(e) => {
                    self.error = Some(e);
                    cx.notify();

                    return;
                }
            }
        } else {
            None
        };

        if method == Method::Browser
            && let Err(e) = registration.validate(self.provider)
        {
            self.error = Some(e);
            cx.notify();

            return;
        }

        if method == Method::Cli && cli.is_none() {
            self.error = Some("Choose a GitHub CLI account.".into());
            cx.notify();

            return;
        }

        let repositories = self.repositories;
        let cancel = Cancellation::default();
        let checked = cancel.clone();

        self.pending = true;
        self.waiting = method != Method::Token;
        self.error = None;
        self.device = None;
        let (sender, receiver) = async_channel::unbounded();

        let progress_task = cx.spawn(async move |this, cx| {
            while let Ok(progress) = receiver.recv().await {
                let _ = this.update(cx, |this, cx| {
                    if !this.pending || this.job.as_ref().is_some_and(|j| j.cancel.is_cancelled()) {
                        return;
                    }

                    match progress {
                        Progress::Browser(url) => cx.open_url(url.as_str()),
                        Progress::DeviceCode(code) => this.device = Some(code),
                        Progress::Verifying => {
                            this.waiting = false;
                            this.device = None;
                        }
                    }

                    cx.notify();
                });
            }
        });

        let task = cx.spawn(async move |this, cx| {
            let result = if method == Method::Cli {
                drop(sender);

                accounts
                    .connect_cli(review, cli.expect("chosen CLI account"), replacing, checked)
                    .await
            } else if let Some(credential) = credential {
                drop(sender);

                accounts
                    .connect(review, host, credential, replacing, checked)
                    .await
            } else {
                let network = accounts.network.clone();
                let worker_host = host.clone();
                let worker_cancel = checked.clone();
                let (finished, done) = async_channel::bounded(1);

                let launched = std::thread::Builder::new()
                    .name("1git-account-sign-in".into())
                    .spawn(move || {
                        let result = network.authorize(
                            &worker_host,
                            registration,
                            repositories,
                            &worker_cancel,
                            &|p| {
                                let _ = sender.try_send(p);
                            },
                        );

                        let _ = finished.send_blocking(result);
                    });

                match launched {
                    Ok(_) => match done.recv().await {
                        Ok(Ok(credential)) => {
                            accounts
                                .connect(review, host, credential, replacing, checked.clone())
                                .await
                        }
                        Ok(Err(e)) => Err(e),
                        Err(_) => Err("The sign-in worker stopped. Start again.".into()),
                    },
                    Err(_) => Err("Could not start browser sign-in. Try again.".into()),
                }
            };

            drop(progress_task);
            let _ = this.update_in(cx, |this, window, cx| {
                let cancelled = this.job.as_ref().is_some_and(|j| j.cancel.is_cancelled());

                this.job = None;
                this.pending = false;
                this.waiting = false;
                this.device = None;

                match result {
                    Ok(review) => {
                        if let Some(a) = review.accounts.last() {
                            this.status.insert(a.key(), "Connected".into());
                        }

                        this.review = Some(review);
                        this.form = false;
                        this.replacing = None;

                        if this.active {
                            window.focus(&this.add_focus, cx);
                        }
                    }
                    Err(e) => {
                        if !cancelled {
                            this.error = Some(e);
                        } else {
                            this.error =
                                Some("Sign-in cancelled. Your saved account is unchanged.".into());
                        }
                    }
                }

                cx.notify();
            });
        });

        self.job = Some(Job {
            cancel,
            task: Some(task),
        });
        cx.notify();
    }

    pub(super) fn check(&mut self, account: Account, cx: &mut gpui::Context<Self>) {
        if self.pending || self.form {
            return;
        }

        let Some(accounts) = self.accounts.clone() else {
            return;
        };

        self.pending = true;
        self.error = None;
        let key = account.key();

        self.status.insert(key.clone(), "Checking…".into());
        let cancel = Cancellation::default();
        let checked = cancel.clone();

        let task = cx.spawn(async move |this, cx| {
            let result = accounts.check(account, checked).await;

            let _ = this.update(cx, |this, cx| {
                this.job = None;
                this.pending = false;

                match result {
                    Ok(status) => {
                        this.status.insert(key, status);
                    }
                    Err(e) => {
                        this.status
                            .insert(key, "Could not check — try again".into());
                        this.error = Some(e);
                    }
                }

                cx.notify();
            });
        });

        self.job = Some(Job {
            cancel,
            task: Some(task),
        });
        cx.notify();
    }

    pub(super) fn remove(
        &mut self,
        account: Account,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.pending || self.form {
            return;
        }

        self.error = None;
        self.removing = Some(account);
        self.remove_epoch = cx.background_executor().now();
        self.remove_height = MotionValue::new(110.);
        self.remove_opacity = MotionValue::new(0.);
        self.dialog.update(cx, |d, cx| d.open(window, cx));
        cx.notify();
    }

    pub(super) fn confirm_remove(&mut self, cx: &mut gpui::Context<Self>) {
        if self.pending {
            return;
        }

        let (Some(accounts), Some(review), Some(account)) = (
            self.accounts.clone(),
            self.review.clone(),
            self.removing.clone(),
        ) else {
            return;
        };

        self.pending = true;
        self.error = None;
        let cancel = Cancellation::default();

        let task = cx.spawn(async move |this, cx| {
            let result = accounts.disconnect(review, account).await;

            let _ = this.update_in(cx, |this, window, cx| {
                this.job = None;
                this.pending = false;

                match result {
                    Ok(review) => {
                        this.review = Some(review);
                        this.removing = None;
                        this.dialog.update(cx, |d, cx| d.close(window, cx));
                    }
                    Err(error) => this.error = Some(error),
                }

                cx.notify();
            });
        });

        self.job = Some(Job {
            cancel,
            task: Some(task),
        });
        cx.notify();
    }
}
