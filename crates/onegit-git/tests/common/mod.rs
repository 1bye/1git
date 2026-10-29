//! Isolated local Git fixtures shared by consumer suites.
#![allow(dead_code)]

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

        let root = temporary.path().join(if cfg!(unix) {
            "repository été\n "
        } else {
            "repository été"
        });

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
            (
                "GIT_CONFIG_GLOBAL".into(),
                if cfg!(windows) {
                    "NUL".into()
                } else {
                    "/dev/null".into()
                },
            ),
            ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
            ("GIT_CONFIG_COUNT".into(), "2".into()),
            ("GIT_CONFIG_KEY_0".into(), "core.hooksPath".into()),
            (
                "GIT_CONFIG_VALUE_0".into(),
                if cfg!(windows) {
                    "NUL".into()
                } else {
                    "/dev/null".into()
                },
            ),
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
            .run(GitCommand::new(
                &self.root,
                args.iter()
                    .map(|arg| git_native_argument(OsString::from(arg))),
            ))
            .unwrap()
            .stdout
    }

    pub fn git_os(&self, args: impl IntoIterator<Item = OsString>) {
        self.process()
            .run(GitCommand::new(
                &self.root,
                args.into_iter().map(git_native_argument),
            ))
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

#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

#[cfg(unix)]
#[allow(unused_imports)]
pub use unix::*;
#[cfg(windows)]
#[allow(unused_imports)]
pub use windows::*;

/// Construct a validated Git name for fixtures, without native-path interpretation.
pub fn git_path(value: impl AsRef<[u8]>) -> onegit_git::GitPath {
    onegit_git::GitPath::new(value).expect("fixture uses a valid Git path")
}

/// Keep Unix's hostile names; use literal bracket/Unicode names supported by Windows.
pub fn filename<'a>(unix: &'a str, windows: &'a str) -> &'a str {
    if cfg!(windows) { windows } else { unix }
}

pub fn file_url(path: &Path) -> String {
    url::Url::from_directory_path(path)
        .expect("absolute fixture directory URL")
        .into()
}

#[cfg(unix)]
pub fn open_directory(path: &Path) -> fs::File {
    fs::File::open(path).unwrap()
}

fn git_native_argument(argument: OsString) -> OsString {
    if cfg!(windows)
        && let Some(text) = argument.to_str()
    {
        if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
            return format!("//{unc}").replace('\\', "/").into();
        }

        if let Some(dos) = text.strip_prefix(r"\\?\") {
            return dos.replace('\\', "/").into();
        }
    }

    argument
}

/// Install an ordinary executable Git hook in the disposable fixture.
pub fn install_hook(fixture: &Fixture, name: &str, script: &str) {
    let path = fixture.root.join(".git/hooks").join(name);

    fs::write(&path, script).unwrap();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
    }
}

impl Fixture {
    /// Enable relative hooks for tests while retaining the fixture's isolated environment.
    pub fn process_with_hooks(&self) -> GitProcess {
        self.process()
            .with_environment([("GIT_CONFIG_VALUE_0".into(), ".git/hooks".into())])
    }
}
