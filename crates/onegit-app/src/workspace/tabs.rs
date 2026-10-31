//! Window-owned tabs retain independent workspaces; filesystem reads are shared by canonical root.
mod branch_actions;
#[cfg(all(test, feature = "test-support"))]
mod branch_tests;
mod motion;
mod refresh;
pub(in crate::workspace) mod session;
#[cfg(all(test, feature = "test-support"))]
mod tests;
mod view;

use super::{ReadJob, RepositoryState, RepositoryWorkspace, home, native, read, watch};
use onegit_git::{Cancellation, RepositoryInfo};
use onegit_ui::Theme;
use rake::gpui::{self, prelude::*, px};
use std::{cell::RefCell, collections::HashMap, path::PathBuf, rc::Rc, time::Instant};

#[derive(Clone)]
pub(super) enum Request {
    Home,
    Pick,
    Activate(u64),
    Close(u64),
    Move(u64, u64),
    Branches(Option<gpui::Point<gpui::Pixels>>),
}

impl gpui::EventEmitter<Request> for RepositoryWorkspace {}

#[derive(Clone)]
struct Label {
    id: u64,
    root: Option<PathBuf>,
    name: String,
    branch: String,
    changes: usize,
    busy: bool,
    focus: gpui::FocusHandle,
    close_focus: gpui::FocusHandle,
}

#[derive(Clone)]
pub(super) struct TabStrip {
    labels: Vec<Label>,
    presentation: motion::Shared,
    active: Option<u64>,
    scroll: gpui::ScrollHandle,
}

struct Tab {
    id: u64,
    workspace: gpui::Entity<RepositoryWorkspace>,
    focus: gpui::FocusHandle,
    close_focus: gpui::FocusHandle,
    _observe: gpui::Subscription,
    _events: gpui::Subscription,
    _state: Vec<gpui::Subscription>,
}

struct Monitor {
    info: RepositoryInfo,
    queue: refresh::Queue,
    timer: Option<gpui::Task<()>>,
    read: Option<ReadJob>,
    failed: bool,
    _events: gpui::Task<()>,
}

pub(crate) struct Workspace {
    home: gpui::Entity<home::Home>,
    branch_host: onegit_ui::DialogHostState,
    branches: gpui::Entity<super::branches::Picker>,
    welcome: gpui::Entity<RepositoryWorkspace>,
    tabs: Vec<Tab>,
    active: Option<u64>,
    next_id: u64,
    scroll: gpui::ScrollHandle,
    picker: Option<gpui::Task<()>>,
    sidebar_width: Option<f32>,
    monitors: HashMap<PathBuf, Monitor>,
    presentation: motion::Shared,
    write_scope: Option<rake::tasks::TaskScope>,
    process: onegit_git::GitProcess,
    session: Option<session::Session>,
    session_load: Option<gpui::Task<()>>,
    session_error: Option<String>,
    _subscriptions: Vec<gpui::Subscription>,
}

impl Workspace {
    pub fn new(
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
        write_scope: Option<rake::tasks::TaskScope>,
    ) -> Self {
        let native_error = native::install(window, Theme::current().appearance).err();
        let home = cx.new(|cx| home::Home::new(window, cx, write_scope.clone()));
        let branch_host = onegit_ui::DialogHostState::new(cx);

        let branches =
            cx.new(|cx| super::branches::Picker::new(&branch_host, home.clone(), window, cx));

        let branch_events = cx.subscribe_in(
            &branches,
            window,
            |this: &mut Self, _, event: &super::branches::Submit, window, cx| {
                this.submit_branch(event, window, cx)
            },
        );

        let welcome = cx
            .new(|cx| RepositoryWorkspace::for_tab(window, cx, write_scope.clone(), home.clone()));

        welcome.update(cx, |view, _| view.picker_error = native_error);
        let subscriptions = vec![
            branch_events,
            cx.subscribe_in(
                &home,
                window,
                |this: &mut Self, _, event, window, cx| match event {
                    home::HomeEvent::Open(path) => this.open(path.clone(), window, cx),
                    home::HomeEvent::Pick => this.choose_repository(cx),
                    home::HomeEvent::Restored(width) => {
                        this.sidebar_width = *width;
                    }
                },
            ),
            cx.subscribe_in(
                &cx.entity(),
                window,
                |this: &mut Self, _, event: &OpenPicked, window, cx| {
                    this.open(event.0.clone(), window, cx)
                },
            ),
            cx.subscribe_in(&welcome, window, |this: &mut Self, _, event, window, cx| {
                this.request(event, window, cx)
            }),
            cx.observe_window_activation(window, |this: &mut Self, window, cx| {
                if !window.is_window_active() {
                    this.presentation.borrow_mut().cancel();
                    this.presentation.borrow_mut().hovered = None;
                    cx.notify();
                }
                if window.is_window_active() {
                    for root in this.monitors.keys().cloned().collect::<Vec<_>>() {
                        this.invalidate(&root, cx);
                    }
                }
            }),
        ];

        let mut workspace = Self {
            home,
            branch_host,
            branches,
            welcome,
            tabs: Vec::new(),
            active: None,
            next_id: 1,
            scroll: gpui::ScrollHandle::new(),
            picker: None,
            sidebar_width: None,
            monitors: HashMap::new(),
            presentation: Rc::new(RefCell::new(motion::Presentation::new(
                cx.background_executor().now(),
            ))),
            write_scope,
            process: read::process(),
            session: None,
            session_load: None,
            session_error: None,
            _subscriptions: subscriptions,
        };

        workspace.session_subscriptions(window, cx);

        workspace
    }

    pub fn load_home(&mut self, cx: &mut gpui::Context<Self>) {
        self.home.update(cx, |home, cx| home.load(cx));
        self.load_session(cx);
    }

    fn request(
        &mut self,
        request: &Request,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        match *request {
            Request::Home => {
                self.presentation.borrow_mut().cancel();
                self.active = None;
                window.focus(&self.welcome.read(cx).focus.clone(), cx);
            }
            Request::Pick => self.choose_repository(cx),
            Request::Branches(origin) => self.open_branches(origin, window, cx),
            Request::Activate(id) => {
                self.activate(id, window, cx);

                if let Some(tab) = self.tabs.iter().find(|tab| tab.id == id) {
                    window.focus(&tab.focus, cx);
                }
            }
            Request::Close(id) => self.close(id, window, cx),
            Request::Move(id, target) => {
                if let (Some(from), Some(to)) = (
                    self.tabs.iter().position(|tab| tab.id == id),
                    self.tabs.iter().position(|tab| tab.id == target),
                ) {
                    let tab = self.tabs.remove(from);

                    self.tabs.insert(to, tab);
                }
            }
        }

        self.session_changed(cx);
        cx.notify();
    }

    fn open(&mut self, path: PathBuf, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        self.add_tab(path, None, window, cx);
    }

    fn add_tab(
        &mut self,
        path: PathBuf,
        saved: Option<session::SavedTab>,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let id = self.next_id;

        self.next_id += 1;
        let workspace = cx.new(|cx| {
            RepositoryWorkspace::for_tab(window, cx, self.write_scope.clone(), self.home.clone())
        });

        workspace.update(cx, |view, _| view.process = self.process.clone());

        if let Some(width) = self.sidebar_width {
            workspace.update(cx, |view, cx| {
                view.split
                    .update(cx, |split, cx| split.resize(px(width - 1.), window, cx));
                view.history.update(cx, |history, cx| {
                    history.sidebar_width(px(width - 1.), window, cx)
                });
            });
        }

        let restoring = saved.is_some();

        if let Some(saved) = saved {
            workspace.update(cx, |view, cx| {
                view.state = RepositoryState::Loading(path.clone());
                view.home_visible = false;
                saved.install(view, window, cx);
            });
        }

        let mut state = vec![cx.subscribe_in(
            &workspace,
            window,
            move |this: &mut Self, _, event: &super::branches::Completed, window, cx| {
                this.branch_completed(id, event, window, cx)
            },
        )];

        let view = workspace.read(cx);
        let history = view.history.clone();
        let split = view.split.clone();
        let splits = history.read(cx).session_splits();

        state.push(cx.observe(&history, |this: &mut Self, _, cx| this.session_changed(cx)));

        for split in [split, splits.0, splits.1] {
            state.push(cx.observe(&split, |this: &mut Self, _, cx| this.session_changed(cx)));
        }

        let observe = cx.observe(&workspace, |this: &mut Self, _, cx| {
            this.reconcile(cx);
            this.pump_restore(cx);
            this.session_changed(cx);
            cx.notify();
        });

        let events = cx.subscribe_in(
            &workspace,
            window,
            |this: &mut Self, _, event, window, cx| this.request(event, window, cx),
        );

        self.tabs.push(Tab {
            id,
            workspace: workspace.clone(),
            focus: cx.focus_handle(),
            close_focus: cx.focus_handle(),
            _observe: observe,
            _events: events,
            _state: state,
        });
        self.active = Some(id);

        if !restoring {
            workspace.update(cx, |view, cx| view.open(path, None, cx));
        }

        window.focus(&workspace.read(cx).focus.clone(), cx);
        self.reveal_tab(self.tabs.len() - 1, window);
        self.session_changed(cx);
        cx.notify();
    }

    fn activate(&mut self, id: u64, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if let Some(index) = self.tabs.iter().position(|tab| tab.id == id) {
            self.active = Some(id);
            self.session_changed(cx);
            window.focus(&self.tabs[index].workspace.read(cx).focus.clone(), cx);

            if !self.presentation.borrow().dragging() {
                self.reveal_tab(index, window);
            }
        }
    }

    fn reveal_tab(&self, index: usize, window: &gpui::Window) {
        let bounds = self.scroll.bounds();

        let visible = if bounds.size.width > px(0.) {
            f64::from(bounds.size.width) - 20.
        } else {
            f64::from(window.viewport_size().width) - 160.
        };

        let visible = visible.max(motion::WIDTH);
        let current = -f64::from(self.scroll.offset().x);
        let left = index as f64 * motion::WIDTH;

        let target = if left < current {
            left
        } else if left + motion::WIDTH > current + visible {
            left + motion::WIDTH - visible
        } else {
            current
        };

        self.scroll
            .set_offset(gpui::point(px(-(target.max(0.) as f32)), px(0.)));
    }

    fn close(&mut self, id: u64, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        let Some(index) = self.tabs.iter().position(|tab| tab.id == id) else {
            return;
        };

        if self.tabs[index].workspace.read(cx).write_job.is_some() {
            return;
        }

        self.presentation.borrow_mut().cancel();
        self.tabs.remove(index);

        if self.active == Some(id) {
            self.active = self
                .tabs
                .get(index)
                .or_else(|| index.checked_sub(1).and_then(|index| self.tabs.get(index)))
                .map(|tab| tab.id);

            if let Some(id) = self.active {
                self.activate(id, window, cx);
            } else {
                window.focus(&self.welcome.read(cx).focus.clone(), cx);
            }
        }

        self.reconcile(cx);
    }

    fn choose_repository(&mut self, cx: &mut gpui::Context<Self>) {
        if self.picker.is_some() {
            return;
        }

        let paths = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("Open repository".into()),
        });

        self.picker = Some(cx.spawn(async move |this, cx| {
            let result = paths.await;

            let _ = this.update(cx, |this, cx| {
                this.picker = None;

                match result {
                    Ok(Ok(Some(paths))) => {
                        if let Some(path) = paths.into_iter().next() {
                            // Deliver through the current window so new input state gets its native focus handles.
                            cx.emit(OpenPicked(path));
                        }
                    }
                    Ok(Ok(None)) => {}
                    error => {
                        let message = format!("Could not open the folder picker: {error:?}");

                        this.welcome.update(cx, |view, cx| {
                            view.picker_error = Some(message);
                            cx.notify();
                        });
                        this.active = None;
                    }
                }

                cx.notify();
            });
        }));
        cx.notify();
    }

    fn roots(&self, cx: &gpui::App) -> HashMap<PathBuf, RepositoryInfo> {
        self.tabs
            .iter()
            .filter_map(|tab| {
                let view = tab.workspace.read(cx);

                match &view.state {
                    RepositoryState::Ready(loaded) => Some((
                        loaded.snapshot.repository.root.clone(),
                        loaded.snapshot.repository.clone(),
                    )),
                    _ => None,
                }
            })
            .collect()
    }

    fn matching(
        &self,
        root: &std::path::Path,
        cx: &gpui::App,
    ) -> Vec<gpui::Entity<RepositoryWorkspace>> {
        self.tabs
            .iter()
            .filter(|tab| {
                let view = tab.workspace.read(cx);

                match &view.state {
                    RepositoryState::Ready(loaded) => loaded.snapshot.repository.root == root,
                    RepositoryState::Loading(path) | RepositoryState::Failed { path, .. } => {
                        path == root
                    }
                    RepositoryState::Welcome => false,
                }
            })
            .map(|tab| tab.workspace.clone())
            .collect()
    }

    fn busy(&self, root: &std::path::Path, cx: &gpui::App) -> bool {
        self.matching(root, cx).iter().any(|tab| {
            let view = tab.read(cx);

            view.write_job.is_some() || view.load_job.is_some()
        })
    }

    fn reconcile(&mut self, cx: &mut gpui::Context<Self>) {
        let roots = self.roots(cx);

        for tab in &self.tabs {
            let root = match &tab.workspace.read(cx).state {
                RepositoryState::Ready(loaded) => Some(loaded.snapshot.repository.root.clone()),
                RepositoryState::Loading(path) | RepositoryState::Failed { path, .. } => {
                    Some(path.clone())
                }
                _ => None,
            };

            let busy = root.is_some_and(|root| self.busy(&root, cx));

            tab.workspace.update(cx, |view, cx| {
                if view.repository_busy != busy {
                    view.repository_busy = busy;
                    cx.notify();
                }
            });
        }

        // Keep a monitor through explicit refresh (Loading), but release it after the last close.
        let existing: Vec<_> = self.monitors.keys().cloned().collect();

        for root in existing {
            if self.matching(&root, cx).is_empty() {
                self.monitors.remove(&root);
            }
        }

        for (root, info) in roots {
            let changed = self.monitors.get(&root).is_some_and(|monitor| {
                monitor.info.git_directory != info.git_directory
                    || monitor.info.common_directory != info.common_directory
            });

            if changed {
                self.monitors.remove(&root);
            }

            if !self.monitors.contains_key(&root) {
                let watcher = watch::Watch::start(info.clone());
                let failed = watcher.is_err();

                let events = match watcher {
                    Ok(watcher) => {
                        let root = root.clone();

                        cx.spawn(async move |this, cx| {
                            while let Some(event) = watcher.next().await {
                                if this.update(cx, |this, cx| {
                                    if event.failed { if let Some(monitor) = this.monitors.get_mut(&root) { monitor.failed = true; }

                                        this.report(&root, "File watching is unavailable. Use Refresh or refocus the window to update.", cx); }

                                    if event.changed { this.invalidate(&root, cx); }
                                }).is_err() { break; }
                            }
                        })
                    }
                    Err(_) => {
                        self.report(&root, "File watching is unavailable. Use Refresh or refocus the window to update.", cx);

                        cx.spawn(async |_, _| {})
                    }
                };

                self.monitors.insert(
                    root.clone(),
                    Monitor {
                        info,
                        queue: refresh::Queue::default(),
                        timer: None,
                        read: None,
                        failed,
                        _events: events,
                    },
                );
            }
        }

        for root in self.monitors.keys().cloned().collect::<Vec<_>>() {
            if self.busy(&root, cx) {
                let monitor = self.monitors.get_mut(&root).expect("monitor exists");

                monitor.timer = None;

                if monitor.read.take().is_some() {
                    monitor.queue.invalidate(Instant::now());
                }
            } else {
                self.schedule(&root, cx);
            }
        }
    }

    fn report(&self, root: &std::path::Path, message: &str, cx: &mut gpui::Context<Self>) {
        for tab in self.matching(root, cx) {
            tab.update(cx, |view, cx| {
                view.refresh_error = Some(message.to_owned());
                cx.notify();
            });
        }
    }

    fn invalidate(&mut self, root: &std::path::Path, cx: &mut gpui::Context<Self>) {
        if let Some(monitor) = self.monitors.get_mut(root) {
            monitor.queue.invalidate(Instant::now());
            monitor.timer = None;
        }

        self.schedule(root, cx);
    }

    fn schedule(&mut self, root: &std::path::Path, cx: &mut gpui::Context<Self>) {
        if self.busy(root, cx) {
            return;
        }

        let Some(monitor) = self.monitors.get_mut(root) else {
            return;
        };

        if monitor.read.is_some() || monitor.timer.is_some() {
            return;
        }

        let Some(delay) = monitor.queue.delay(Instant::now()) else {
            return;
        };

        let root = root.to_owned();
        let timer = cx.background_executor().timer(delay);

        monitor.timer = Some(cx.spawn(async move |this, cx| {
            timer.await;
            let _ = this.update(cx, |this, cx| this.refresh(&root, cx));
        }));
    }

    fn refresh(&mut self, root: &std::path::Path, cx: &mut gpui::Context<Self>) {
        if self.busy(root, cx) {
            return;
        }

        let Some(first) = self.matching(root, cx).first().cloned() else {
            return;
        };

        let process = first.read(cx).process.clone();

        let Some(monitor) = self.monitors.get_mut(root) else {
            return;
        };

        monitor.timer = None;

        if monitor.read.is_some() {
            return;
        }

        monitor.queue.take();
        let cancel = Cancellation::default();
        let worker_cancel = cancel.clone();
        let completion_cancel = cancel.clone();
        let worker_root = root.to_owned();
        let root = root.to_owned();

        let worker = cx
            .background_executor()
            .spawn(async move { read::load(&worker_root, process, &worker_cancel) });

        let task = cx.spawn(async move |this, cx| {
            let result = worker.await;

            if !completion_cancel.is_cancelled() {
                let _ = this.update(cx, |this, cx| {
                    if let Some(monitor) = this.monitors.get_mut(&root) { monitor.read = None; }

                    if !this.busy(&root, cx) {
                        match result {
                            Ok(loaded) => {
                                for tab in this.matching(&root, cx) { tab.update(cx, |view, cx| view.apply_automatic(loaded.clone(), cx)); }

                                this.home.update(cx, |home, cx| home.refresh_overview(&loaded.snapshot, cx));

                                if this.monitors.get(&root).is_some_and(|monitor| monitor.failed) {
                                    this.report(&root, "File watching is unavailable. Use Refresh or refocus the window to update.", cx);
                                }
                            },
                            Err(error) => this.report(&root, &format!("Could not refresh this repository: {error}"), cx),
                        }
                    }

                    this.schedule(&root, cx);
                    cx.notify();
                });
            }
        });

        monitor.read = Some(ReadJob {
            cancel,
            task: Some(task),
        });
    }
}

struct OpenPicked(PathBuf);

impl gpui::EventEmitter<OpenPicked> for Workspace {}

impl gpui::Render for Workspace {
    fn render(
        &mut self,
        _: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl gpui::IntoElement {
        let labels = self
            .tabs
            .iter()
            .map(|tab| {
                let view = tab.workspace.read(cx);

                let (path, branch, changes) = match &view.state {
                    RepositoryState::Ready(loaded) => (
                        Some(loaded.snapshot.repository.root.clone()),
                        loaded
                            .snapshot
                            .status
                            .head
                            .branch
                            .clone()
                            .unwrap_or_else(|| "Detached HEAD".into()),
                        loaded.snapshot.status.files.len(),
                    ),
                    RepositoryState::Loading(path) | RepositoryState::Failed { path, .. } => {
                        (Some(path.clone()), String::new(), 0)
                    }
                    RepositoryState::Welcome => (None, String::new(), 0),
                };

                let name = path
                    .as_ref()
                    .map(|path| {
                        path.file_name()
                            .unwrap_or(path.as_os_str())
                            .to_string_lossy()
                            .escape_debug()
                            .to_string()
                    })
                    .unwrap_or_else(|| "Repository".into());

                Label {
                    id: tab.id,
                    root: path,
                    name,
                    branch,
                    changes,
                    busy: view.write_job.is_some(),
                    focus: tab.focus.clone(),
                    close_focus: tab.close_focus.clone(),
                }
            })
            .collect();

        let view = self
            .active
            .and_then(|id| self.tabs.iter().find(|tab| tab.id == id))
            .map(|tab| tab.workspace.clone())
            .unwrap_or_else(|| self.welcome.clone());

        let strip = TabStrip {
            labels,
            presentation: self.presentation.clone(),
            active: self.active,
            scroll: self.scroll.clone(),
        };

        view.update(cx, |view, _| {
            view.tab_strip = Some(strip);
            view.session_error = self.session_error.clone();
        });

        rake::view! {<onegit_ui::DialogHost state={self.branch_host.clone()} body={view.into_any_element()}>
            {self.branches.clone()}
        </onegit_ui::DialogHost>}
    }
}

impl TabStrip {
    pub(super) fn key(&self, event: &gpui::KeyDownEvent) -> Option<Request> {
        let key = event.keystroke.key.as_str();
        let modifiers = event.keystroke.modifiers;

        if modifiers.secondary() && !modifiers.alt {
            match key {
                "o" | "t" => return Some(Request::Pick),
                "w" => return self.active.map(Request::Close),
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" => {
                    let index = key.parse::<usize>().ok()? - 1;

                    return self
                        .labels
                        .get(index)
                        .map(|label| Request::Activate(label.id));
                }
                _ => {}
            }
        }

        if modifiers.control && key == "tab" && !self.labels.is_empty() {
            let current = self
                .active
                .and_then(|id| self.labels.iter().position(|label| label.id == id));

            let index = if modifiers.shift {
                current
                    .unwrap_or(0)
                    .checked_sub(1)
                    .unwrap_or(self.labels.len() - 1)
            } else {
                current.map_or(0, |index| (index + 1) % self.labels.len())
            };

            return Some(Request::Activate(self.labels[index].id));
        }

        None
    }
}
