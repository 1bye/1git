//! Native filesystem subscriptions; one owner watches a worktree and its shared metadata.
use notify::{Event, EventKind, RecursiveMode, Watcher};
use onegit_git::RepositoryInfo;

use std::{
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicU8, Ordering},
        mpsc,
    },
};

const CHANGED: u8 = 1;
const FAILED: u8 = 2;

pub(super) struct Events {
    pub changed: bool,
    pub failed: bool,
}

pub(super) struct Watch {
    stop: Option<mpsc::Sender<()>>,
    receiver: async_channel::Receiver<()>,
    flags: Arc<AtomicU8>,
}

impl Watch {
    pub fn start(info: RepositoryInfo) -> Result<Self, std::io::Error> {
        let (sender, receiver) = async_channel::bounded(1);
        let (stop, stopped) = mpsc::channel();
        let flags = Arc::new(AtomicU8::new(0));
        let pending = flags.clone();

        std::thread::Builder::new()
            .name("repository-watch".into())
            .spawn(move || {
                let signal = move |bits| {
                    pending.fetch_or(bits, Ordering::Release);
                    // One wake-up represents any number of changes, so bursts cannot grow a queue.
                    let _ = sender.try_send(());
                };

                let metadata = [info.git_directory.clone(), info.common_directory.clone()];
                let mut roots = vec![info.root.clone(), info.git_directory, info.common_directory];

                roots.sort();
                roots.dedup();
                let roots: Vec<_> = roots
                    .iter()
                    .filter(|path| {
                        !roots
                            .iter()
                            .any(|parent| parent != *path && path.starts_with(parent))
                    })
                    .cloned()
                    .collect();

                let initial = signal.clone();

                let watcher =
                    notify::recommended_watcher(
                        move |result: notify::Result<Event>| match result {
                            Ok(event) if relevant(&event, &metadata) => signal(CHANGED),
                            Ok(_) => {}
                            Err(_) => signal(FAILED | CHANGED),
                        },
                    );

                if let Ok(mut watcher) = watcher {
                    for root in roots {
                        if watcher.watch(&root, RecursiveMode::Recursive).is_err() {
                            initial(FAILED);
                        }
                    }

                    // Close the gap between the first snapshot and subscription setup.
                    initial(CHANGED);
                    let _ = stopped.recv();

                    // Watcher teardown can join native threads; keep it off the UI thread.
                    drop(watcher);
                } else {
                    initial(FAILED);
                }
            })?;

        Ok(Self {
            stop: Some(stop),
            receiver,
            flags,
        })
    }

    pub async fn next(&self) -> Option<Events> {
        self.receiver.recv().await.ok()?;
        let flags = self.flags.swap(0, Ordering::AcqRel);

        Some(Events {
            changed: flags & CHANGED != 0,
            failed: flags & FAILED != 0,
        })
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        self.stop.take();
    }
}

fn relevant(event: &Event, metadata: &[std::path::PathBuf; 2]) -> bool {
    if matches!(event.kind, EventKind::Access(_)) {
        return false;
    }

    event.need_rescan()
        || event.paths.is_empty()
        || event.paths.iter().any(|path| {
            let Some(parent) = metadata
                .iter()
                .filter(|root| path.starts_with(root))
                .max_by_key(|root| root.components().count())
            else {
                return true;
            };

            path.strip_prefix(parent).is_ok_and(metadata_path)
        })
}

fn metadata_path(path: &Path) -> bool {
    if path.extension().is_some_and(|ext| ext == "lock") {
        return false;
    }

    let mut parts = path.components();

    let Some(first) = parts.next() else {
        return true;
    };

    let name = first.as_os_str();

    if ["refs", "rebase-merge", "rebase-apply", "sequencer"]
        .iter()
        .any(|prefix| name == *prefix)
    {
        return true;
    }

    if name == "info" {
        return path == Path::new("info/exclude") || path == Path::new("info");
    }

    parts.next().is_none()
        && [
            "HEAD",
            "index",
            "packed-refs",
            "config",
            "config.worktree",
            "MERGE_HEAD",
            "ORIG_HEAD",
            "SQUASH_MSG",
            "CHERRY_PICK_HEAD",
            "REVERT_HEAD",
        ]
        .iter()
        .any(|file| name == *file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_filter_matches_source_watcher_and_ignores_read_noise() {
        let metadata = ["/repo/.git".into(), "/shared".into()];

        for path in [
            "/repo/file",
            "/repo/.git/index",
            "/repo/.git/HEAD",
            "/repo/.git/refs/heads/main",
            "/shared/refs/remotes/origin/main",
            "/repo/.git/rebase-merge/head-name",
            "/repo/.git/info/exclude",
        ] {
            assert!(
                relevant(&Event::new(EventKind::Any).add_path(path.into()), &metadata),
                "{path}"
            );
        }

        for path in [
            "/repo/.git/index.lock",
            "/repo/.git/objects/aa/bb",
            "/repo/.git/logs/HEAD",
            "/shared/refs/heads/main.lock",
        ] {
            assert!(
                !relevant(&Event::new(EventKind::Any).add_path(path.into()), &metadata),
                "{path}"
            );
        }

        assert!(!relevant(
            &Event::new(EventKind::Access(notify::event::AccessKind::Read))
                .add_path("/repo/file".into()),
            &metadata
        ));
    }

    fn wait(watch: &Watch) -> Events {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);

        loop {
            if watch.receiver.try_recv().is_ok() {
                let flags = watch.flags.swap(0, Ordering::AcqRel);

                return Events {
                    changed: flags & CHANGED != 0,
                    failed: flags & FAILED != 0,
                };
            }

            assert!(
                std::time::Instant::now() < deadline,
                "native watcher did not signal"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }

    #[test]
    fn native_watcher_sees_nested_saves_and_linked_worktree_shared_refs_and_stops_on_drop() {
        let f = crate::workspace::tests::Fixture::new();

        f.write("base.txt", "base\n");
        f.commit();
        let linked = f.directory.path().join("linked");

        f.git(&["worktree", "add", "-b", "linked", linked.to_str().unwrap()]);
        let repository = onegit_git::Repository::open(&linked, f.process(), None).unwrap();
        let info = repository.info().clone();

        assert!(!info.common_directory.starts_with(&info.root));
        let watch = Watch::start(info).unwrap();

        assert!(wait(&watch).changed);
        std::fs::create_dir(linked.join("nested")).unwrap();
        std::fs::write(linked.join("nested/file.txt"), "external\n").unwrap();
        assert!(wait(&watch).changed);
        f.git(&["branch", "new-shared-ref"]);
        assert!(wait(&watch).changed);
        let closed = watch.receiver.clone();

        drop(watch);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);

        while !closed.is_closed() {
            assert!(
                std::time::Instant::now() < deadline,
                "watch subscription was not released"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
}
