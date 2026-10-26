//! Isolated local Git fixtures shared by consumer suites.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use onegit_git::{GitCommand, GitProcess};
use tempfile::TempDir;

pub struct Fixture {
    pub temporary: TempDir,
    pub root: PathBuf,
}

impl Fixture {
    pub fn new() -> Self {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("repository été\n ");

        fs::create_dir(&root).unwrap();

        let fixture = Self { temporary, root };

        fixture.git(&["init", "--initial-branch=main"]);

        fixture
    }

    pub fn process(&self) -> GitProcess {
        self.process_with_limit(64 * 1024 * 1024)
    }

    pub fn process_with_limit(&self, limit: usize) -> GitProcess {
        GitProcess::new("git", limit).with_environment([
            ("GIT_CONFIG_GLOBAL".into(), "/dev/null".into()),
            ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
            ("GIT_CONFIG_COUNT".into(), "2".into()),
            ("GIT_CONFIG_KEY_0".into(), "core.hooksPath".into()),
            ("GIT_CONFIG_VALUE_0".into(), "/dev/null".into()),
            ("GIT_CONFIG_KEY_1".into(), "commit.gpgsign".into()),
            ("GIT_CONFIG_VALUE_1".into(), "false".into()),
            ("GIT_AUTHOR_NAME".into(), "Fixture".into()),
            ("GIT_AUTHOR_EMAIL".into(), "fixture@example.invalid".into()),
            ("GIT_COMMITTER_NAME".into(), "Fixture".into()),
            (
                "GIT_COMMITTER_EMAIL".into(),
                "fixture@example.invalid".into(),
            ),
            ("HOME".into(), self.temporary.path().as_os_str().to_owned()),
        ])
    }

    pub fn git(&self, args: &[&str]) -> Vec<u8> {
        self.process()
            .run(GitCommand::new(&self.root, args.iter().copied()))
            .unwrap()
            .stdout
    }

    pub fn git_os(&self, args: impl IntoIterator<Item = OsString>) {
        self.process()
            .run(GitCommand::new(&self.root, args))
            .unwrap();
    }

    pub fn write(&self, path: &str, content: &str) {
        fs::write(self.root.join(path), content).unwrap();
    }

    pub fn commit(&self, message: &str) {
        self.git(&["add", "--all"]);
        self.git(&["commit", "-m", message]);
    }
}

pub fn files_under(root: &Path) -> BTreeMap<PathBuf, (Vec<u8>, std::time::SystemTime)> {
    let mut entries = BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];

    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();

            if entry.file_type().unwrap().is_dir() {
                pending.push(path);
            } else if !entry.file_type().unwrap().is_symlink() {
                let modified = fs::metadata(&path).unwrap().modified().unwrap();

                entries.insert(
                    path.strip_prefix(root).unwrap().to_path_buf(),
                    (fs::read(path).unwrap(), modified),
                );
            }
        }
    }

    entries
}
