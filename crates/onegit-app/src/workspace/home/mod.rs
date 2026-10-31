//! Searchable Home library; browsing preserves the mounted repository and its commit draft.
pub(in crate::workspace) mod library;
#[cfg(test)]
mod tests;
mod view;

use super::{ReadJob, WriteJob, read};
use library::{Folder, Layout, Library, Overview};
use onegit_git::{Cancellation, CloneOptions, Repository};
use onegit_ui::{DialogHostState, DialogState, InputState};
use rake::gpui::{self, prelude::*, px};

use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
};

pub(super) enum HomeEvent {
    Open(PathBuf),
    Pick,
    Restored(Option<f32>),
}

impl gpui::EventEmitter<HomeEvent> for Home {}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Form {
    Create,
    Clone,
    Machines,
    Accounts,
}

pub(super) struct Home {
    library: Library,
    query: gpui::Entity<InputState>,
    matches: Vec<PathBuf>,
    overview: HashMap<PathBuf, Result<Overview, String>>,
    queue: VecDeque<PathBuf>,
    jobs: HashMap<PathBuf, ReadJob>,
    load_job: Option<ReadJob>,
    scan_job: Option<ReadJob>,
    picker: Option<gpui::Task<()>>,
    save_job: Option<gpui::Task<()>>,
    setup_job: Option<WriteJob>,
    write_scope: Option<rake::tasks::TaskScope>,
    store: Option<PathBuf>,
    error: Option<String>,
    scroll: gpui::UniformListScrollHandle,
    library_width: gpui::Pixels,
    host: DialogHostState,
    dialog: gpui::Entity<DialogState>,
    form: Form,
    destination: gpui::Entity<InputState>,
    remote: gpui::Entity<InputState>,
    form_error: Option<String>,
    focus: gpui::FocusHandle,
    view_focus: [gpui::FocusHandle; 2],
    item_focus: HashMap<PathBuf, gpui::FocusHandle>,
    _subscriptions: Vec<gpui::Subscription>,
}

impl Drop for Home {
    fn drop(&mut self) {
        if let Some(task) = self.save_job.take() {
            task.detach();
        }
    }
}

impl Home {
    pub(super) fn refresh_overview(
        &mut self,
        snapshot: &onegit_git::Snapshot,
        cx: &mut gpui::Context<Self>,
    ) {
        if let Some(Ok(overview)) = self.overview.get_mut(&snapshot.repository.root) {
            let head = &snapshot.status.head;

            overview.branch = head.branch.clone().unwrap_or_else(|| {
                format!(
                    "detached {}",
                    head.oid
                        .as_deref()
                        .unwrap_or("HEAD")
                        .chars()
                        .take(7)
                        .collect::<String>()
                )
            });
            overview.changes = snapshot
                .status
                .files
                .iter()
                .filter(|file| file.record_type != onegit_git::RecordType::Ignored)
                .count();
            overview.tracking = if head.upstream.is_some() {
                format!("↓{} ↑{}", head.behind, head.ahead)
            } else {
                "No upstream".into()
            };
            cx.notify();
        }
    }

    pub fn new(
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
        write_scope: Option<rake::tasks::TaskScope>,
    ) -> Self {
        let query = cx.new(|cx| InputState::new("", window, cx));
        let host = DialogHostState::new(cx);
        let dialog = host.dialog(cx);
        let subscriptions = vec![cx.subscribe(&query, |this: &mut Self, _, _, cx| this.filter(cx))];

        Self {
            library: Library::default(),
            query,
            matches: Vec::new(),
            overview: HashMap::new(),
            queue: VecDeque::new(),
            jobs: HashMap::new(),
            load_job: None,
            scan_job: None,
            picker: None,
            save_job: None,
            setup_job: None,
            write_scope,
            store: None,
            error: None,
            scroll: gpui::UniformListScrollHandle::new(),
            library_width: px(0.),
            host,
            dialog,
            form: Form::Create,
            destination: cx.new(|cx| InputState::new("", window, cx)),
            remote: cx.new(|cx| InputState::new("", window, cx)),
            form_error: None,
            focus: cx.focus_handle(),
            view_focus: [cx.focus_handle(), cx.focus_handle()],
            item_focus: HashMap::new(),
            _subscriptions: subscriptions,
        }
    }

    pub fn repository_avatar(
        &self,
        path: Option<&std::path::Path>,
        name: &str,
        size: f32,
    ) -> gpui::AnyElement {
        let image = path
            .and_then(|path| self.overview.get(path))
            .and_then(|overview| overview.as_ref().ok())
            .and_then(|overview| overview.avatar.clone());

        view::avatar(name, image, size)
    }

    pub fn accounts(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        self.show(Form::Accounts, window, cx);
    }

    pub fn load(&mut self, cx: &mut gpui::Context<Self>) {
        let Some(legacy) = library::data_directory("1git-gpuix") else {
            return;
        };

        let Some(own) = library::data_directory("1git-rust").map(|path| path.join("home.json"))
        else {
            return;
        };

        let worker_store = own.clone();

        self.load_job = Some(spawn(
            cx,
            move |_| Library::load(&legacy, &worker_store),
            move |this, result, cx| {
                this.load_job = None;

                match result {
                    Ok(mut library) => {
                        for path in &this.library.paths {
                            library.include(path.clone());
                        }

                        this.library = library;
                        this.store = Some(own);
                    }
                    Err(error) => this.error = Some(error),
                }

                this.filter(cx);
                cx.emit(HomeEvent::Restored(this.library.sidebar_width));
            },
        ));
    }

    fn star(&mut self, path: PathBuf, cx: &mut gpui::Context<Self>) {
        if self.library.starred.contains(&path) {
            self.library.starred.retain(|saved| saved != &path);
        } else {
            self.library.starred.push(path);
        }

        self.filter(cx);
        self.persist(cx);
    }

    fn forget(&mut self, path: &std::path::Path, cx: &mut gpui::Context<Self>) {
        self.library.paths.retain(|saved| saved != path);
        self.library.starred.retain(|saved| saved != path);
        self.filter(cx);
        self.persist(cx);
    }

    fn filter(&mut self, cx: &mut gpui::Context<Self>) {
        let query = self.query.read(cx).text().trim().to_lowercase();

        self.matches = self
            .library
            .scope()
            .into_iter()
            .filter(|path| path.to_string_lossy().to_lowercase().contains(&query))
            .filter(|path| {
                self.library.folder.is_some()
                    || !query.is_empty()
                    || self.library.starred.contains(path)
            })
            .collect();
        self.scroll
            .0
            .borrow()
            .base_handle
            .set_offset(gpui::point(px(0.), px(0.)));
        cx.notify();
    }

    fn persist(&mut self, cx: &mut gpui::Context<Self>) {
        let Some(path) = self.store.clone() else {
            return;
        };

        let library = self.library.clone();
        let previous = self.save_job.take();

        self.save_job = Some(cx.spawn(async move |this, cx| {
            if let Some(previous) = previous {
                previous.await;
            }

            let result = cx
                .background_executor()
                .spawn(async move { library.save(&path) })
                .await;

            if let Err(error) = result {
                let _ = this.update(cx, |this, cx| {
                    this.error = Some(error);
                    this.store = None;
                    cx.notify();
                });
            }
        }));
    }

    pub fn remember(&mut self, path: PathBuf, cx: &mut gpui::Context<Self>) {
        self.library.include(path);
        self.filter(cx);
        self.persist(cx);
    }

    fn layout(&mut self, layout: Layout, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        self.library.layout = layout;
        self.scroll
            .0
            .borrow()
            .base_handle
            .set_offset(gpui::point(px(0.), px(0.)));
        window.focus(&self.view_focus[usize::from(layout == Layout::List)], cx);
        self.persist(cx);
        cx.notify();
    }

    fn back(&mut self, cx: &mut gpui::Context<Self>) {
        self.library.folder = None;
        self.query.update(cx, |query, cx| query.set_text("", cx));
        self.filter(cx);
        self.persist(cx);
    }

    fn folder(&mut self, path: PathBuf, cx: &mut gpui::Context<Self>) {
        self.library.folder = Some(Folder::Path(path));
        self.query.update(cx, |query, cx| query.set_text("", cx));
        self.filter(cx);
        self.persist(cx);
    }

    fn schedule(&mut self, paths: &[PathBuf], cx: &mut gpui::Context<Self>) {
        for path in paths {
            if !self.overview.contains_key(path)
                && !self.jobs.contains_key(path)
                && !self.queue.contains(path)
            {
                self.queue.push_back(path.clone());
            }
        }

        while self.jobs.len() < 4 {
            let Some(path) = self.queue.pop_front() else {
                break;
            };

            let work_path = path.clone();
            let completed_path = path.clone();

            let job = spawn(
                cx,
                move |cancel| library::overview(&work_path, read::process(), &cancel),
                move |this, result, cx| {
                    this.jobs.remove(&completed_path);
                    this.overview.insert(completed_path, result);
                    this.schedule(&[], cx);
                    cx.notify();
                },
            );

            self.jobs.insert(path, job);
        }
    }

    fn scan(&mut self, cx: &mut gpui::Context<Self>) {
        if self.scan_job.is_some() {
            return;
        }

        let roots = self.library.folders.clone();

        if roots.is_empty() {
            self.pick_folder(cx);

            return;
        }

        self.scan_job = Some(spawn(
            cx,
            move |cancel| Ok(library::scan(&roots, &cancel)),
            |this, result, cx| {
                this.scan_job = None;

                if let Ok((paths, skipped)) = result {
                    for path in paths {
                        this.library.include(path);
                    }

                    this.overview.clear();
                    this.jobs.clear();
                    this.queue.clear();
                    this.error = (skipped > 0)
                        .then(|| format!("Scan completed with {skipped} unavailable folders."));
                    this.filter(cx);
                    this.persist(cx);
                }
            },
        ));
        cx.notify();
    }

    fn pick_folder(&mut self, cx: &mut gpui::Context<Self>) {
        if self.picker.is_some() {
            return;
        }

        let prompt = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("Add scan folder".into()),
        });

        self.picker = Some(cx.spawn(async move |this, cx| {
            let result = prompt.await;

            let _ = this.update(cx, |this, cx| {
                this.picker = None;

                match result {
                    Ok(Ok(Some(paths))) => {
                        if let Some(path) = paths.into_iter().next() {
                            if !this.library.folders.contains(&path) {
                                this.library.folders.push(path.clone());
                            }

                            this.library.folder = Some(Folder::Path(path));
                            this.scan(cx);
                        }
                    }
                    Ok(Ok(None)) => {}
                    _ => {
                        this.error = Some("Could not open the folder picker. Try again.".into());
                        cx.notify();
                    }
                }
            });
        }));
    }

    fn show(&mut self, form: Form, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        self.form = form;
        self.form_error = None;
        self.dialog.update(cx, |dialog, cx| {
            dialog.open(window, cx);
        });
        cx.notify();
    }

    fn submit(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if self.setup_job.is_some() {
            return;
        }

        let destination = PathBuf::from(self.destination.read(cx).text().trim());
        let remote = self.remote.read(cx).text().trim().to_owned();

        if !destination.is_absolute() || destination.file_name().is_none() {
            self.form_error =
                Some("Choose an absolute destination path with a repository name.".into());
            cx.notify();

            return;
        }

        if destination.exists() {
            self.form_error = Some("Use a new destination folder. Existing files are kept.".into());
            cx.notify();

            return;
        }

        if self.form == Form::Clone && remote.is_empty() {
            self.form_error = Some("Enter a repository URL.".into());
            cx.notify();

            return;
        }

        let form = self.form;
        let mut context = window.to_async(cx);
        let entity = cx.weak_entity();
        let executor = cx.background_executor().clone();

        let completion = async move {
            let result = executor
                .spawn(async move {
                    let process = read::process();

                    let result = if form == Form::Clone {
                        Repository::clone(CloneOptions::new(&remote, &destination), process, None)
                    } else {
                        Repository::initialize(&destination, Some("main"), process, None)
                    };

                    result
                        .map(|repository| repository.info().root.clone())
                        .map_err(|error| error.to_string())
                })
                .await;

            let _ = entity.update_in(&mut context, |this, window, cx| {
                this.setup_job = None;

                match result {
                    Ok(path) => {
                        this.dialog.update(cx, |dialog, cx| {
                            dialog.close(window, cx);
                        });
                        this.remember(path.clone(), cx);
                        cx.emit(HomeEvent::Open(path));
                    }
                    Err(error) => this.form_error = Some(error),
                }

                cx.notify();
            });
        };

        if let Some(scope) = &self.write_scope {
            match scope.spawn(
                if form == Form::Clone {
                    "Cloning repository"
                } else {
                    "Creating repository"
                },
                async move {
                    completion.await;

                    Ok(())
                },
            ) {
                Ok(_) => self.setup_job = Some(WriteJob(None)),
                Err(error) => {
                    self.form_error = Some(format!("Could not start repository setup: {error}"))
                }
            }
        } else {
            self.setup_job = Some(WriteJob(Some(cx.spawn(async move |_, _| completion.await))));
        }

        cx.notify();
    }
}

fn spawn<T: Send + 'static>(
    cx: &mut gpui::Context<Home>,
    work: impl FnOnce(Cancellation) -> Result<T, String> + Send + 'static,
    apply: impl FnOnce(&mut Home, Result<T, String>, &mut gpui::Context<Home>) + 'static,
) -> ReadJob {
    let cancel = Cancellation::default();
    let worker_cancel = cancel.clone();
    let completion = cancel.clone();

    let worker = cx
        .background_executor()
        .spawn(async move { work(worker_cancel) });

    let task = cx.spawn(async move |this, cx| {
        let result = worker.await;

        if !completion.is_cancelled() {
            let _ = this.update(cx, |this, cx| apply(this, result, cx));
        }
    });

    ReadJob {
        cancel,
        task: Some(task),
    }
}
