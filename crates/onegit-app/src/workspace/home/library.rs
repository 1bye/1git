//! Local Home library; import legacy browsing intent read-only and persist Rust intent separately.
use onegit_git::{Cancellation, GitProcess, RecordType, Repository};
use rake::gpui;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::Arc,
};

const LIMIT: u64 = 2 * 1024 * 1024;
const MAX_REPOSITORIES: usize = 5_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum Layout {
    #[default]
    Tiles,
    List,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Folder {
    Path(PathBuf),
    Other,
}

impl Folder {
    fn parse(value: &Value) -> Option<Self> {
        match value.as_str()? {
            "other" => Some(Self::Other),
            path if Path::new(path).is_absolute() && !path.contains('\0') => {
                Some(Self::Path(path.into()))
            }
            _ => None,
        }
    }

    fn value(&self) -> Value {
        match self {
            Self::Path(path) => json!(path),
            Self::Other => json!("other"),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub(super) struct Library {
    pub paths: Vec<PathBuf>,
    pub folders: Vec<PathBuf>,
    pub folder: Option<Folder>,
    pub starred: Vec<PathBuf>,
    pub machines: Vec<String>,
    pub layout: Layout,
    pub sidebar_width: Option<f32>,
}

#[derive(Clone)]
pub(super) struct Overview {
    pub branch: String,
    pub changes: usize,
    pub tracking: String,
    pub avatar: Option<Arc<gpui::Image>>,
}

pub(super) fn data_directory(name: &str) -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;

    let root = if cfg!(target_os = "macos") {
        PathBuf::from(home).join("Library/Application Support")
    } else if cfg!(windows) {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(home).join("AppData/Roaming"))
    } else {
        std::env::var_os("XDG_STATE_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(home).join(".local/state"))
    };

    Some(root.join(name))
}

fn document(path: &Path) -> Result<Value, String> {
    let file = fs::File::open(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;

    if file.metadata().map_err(|error| error.to_string())?.len() > LIMIT {
        return Err(format!("{} exceeds the library size limit", path.display()));
    }

    let mut bytes = Vec::new();

    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;

    if bytes.len() as u64 > LIMIT {
        return Err("Library is too large".into());
    }

    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Could not read saved Home data: {error}"))
}

fn paths(value: &Value) -> Vec<PathBuf> {
    let mut seen = HashSet::new();

    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|path| {
            !path.contains('\0')
                && !path.starts_with("/@1git-ssh/")
                && Path::new(path).is_absolute()
        })
        .map(PathBuf::from)
        .filter(|path| seen.insert(path.clone()))
        .take(MAX_REPOSITORIES)
        .collect()
}

impl Library {
    pub fn load(legacy: &Path, own: &Path) -> Result<Self, String> {
        if own.exists() {
            let value = document(own)?;

            if value["version"] != 1 {
                return Err("Unsupported saved Home version; existing file was kept".into());
            }

            return Ok(Self::parse(&value));
        }

        let session = legacy.join("session.json");

        if !session.exists() {
            return Ok(Self::default());
        }

        let value = document(&session)?;

        let active = value["spaces"].as_array().and_then(|spaces| {
            spaces
                .iter()
                .find(|space| space["id"] == value["activeSpaceId"])
        });

        let library = active
            .map(|space| &space["library"])
            .unwrap_or(&value["repositoryLibrary"]);

        let discovery = active
            .map(|space| &space["discovery"])
            .unwrap_or(&value["repositoryDiscovery"]);

        let mut result = Self {
            paths: paths(
                active
                    .map(|space| &space["repositories"])
                    .unwrap_or(&value["recentRepositories"]),
            ),
            folders: paths(&discovery["folders"]),
            folder: Folder::parse(&library["folder"]),
            starred: paths(&library["starred"]),
            layout: if library["view"] == "list" {
                Layout::List
            } else {
                Layout::Tiles
            },
            sidebar_width: value["sidebarWidths"]["files"]
                .as_f64()
                .filter(|size| size.is_finite() && (240.0..=800.0).contains(size))
                .map(|size| size as f32),
            ..Self::default()
        };

        let hidden = paths(&discovery["hidden"]);

        let mut cache: Vec<_> = fs::read_dir(legacy.join("repository-discovery-v1"))
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path())
            .collect();

        cache.sort();

        for file in cache {
            if file.extension().is_none_or(|extension| extension != "json") {
                continue;
            }

            if let Ok(value) = document(&file) {
                let root = value["canonicalPath"].as_str().map(PathBuf::from);

                if root
                    .as_ref()
                    .is_some_and(|root| result.folders.contains(root))
                {
                    result.paths.extend(
                        paths(&value["progress"]["paths"])
                            .into_iter()
                            .filter(|path| !hidden.contains(path)),
                    );
                }
            }
        }

        result.paths.extend(result.starred.iter().cloned());
        let mut seen = HashSet::new();

        result.paths.retain(|path| seen.insert(path.clone()));
        result.paths.truncate(MAX_REPOSITORIES);

        if let Ok(machines) = document(&legacy.join("machines.json")) {
            result.machines = machines["machines"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|machine| machine["name"].as_str())
                .filter(|name| name.len() <= 256)
                .map(str::to_owned)
                .take(100)
                .collect();
        }

        Ok(result)
    }

    fn parse(value: &Value) -> Self {
        Self {
            paths: paths(&value["paths"]),
            folders: paths(&value["folders"]),
            starred: paths(&value["starred"]),
            folder: Folder::parse(&value["folder"]),
            layout: if value["view"] == "list" {
                Layout::List
            } else {
                Layout::Tiles
            },
            sidebar_width: value["sidebarWidth"]
                .as_f64()
                .filter(|size| size.is_finite() && (240.0..=800.0).contains(size))
                .map(|size| size as f32),
            machines: value["machines"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter(|name| name.len() <= 256)
                .map(str::to_owned)
                .take(100)
                .collect(),
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        let parent = path.parent().ok_or("Invalid Home data path")?;

        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let bytes = serde_json::to_vec(&json!({"version":1,"paths":self.paths,"folders":self.folders,"folder":self.folder.as_ref().map(Folder::value),"starred":self.starred,"view":if self.layout==Layout::Tiles {"tiles"}else{"list"},"machines":self.machines,"sidebarWidth":self.sidebar_width})).map_err(|error| error.to_string())?;

        if bytes.len() as u64 > LIMIT {
            return Err("Home data exceeds the size limit".into());
        }

        let temporary = tempfile_path(path);

        let result = (|| {
            use std::io::Write;
            let mut options = fs::OpenOptions::new();

            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temporary)?;

            file.write_all(&bytes)?;
            file.sync_all()?;

            fs::rename(&temporary, path)
        })();

        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }

        result.map_err(|error| format!("Could not save Home library: {error}"))
    }

    pub fn owner(&self, path: &Path) -> Option<&Path> {
        self.folders
            .iter()
            .filter(|folder| path.starts_with(folder))
            .max_by_key(|folder| folder.components().count())
            .map(PathBuf::as_path)
    }

    pub fn scope(&self) -> Vec<PathBuf> {
        self.paths
            .iter()
            .filter(|path| {
                self.folder.as_ref().is_none_or(|folder| match folder {
                    Folder::Path(folder) => self.owner(path) == Some(folder.as_path()),
                    Folder::Other => self.owner(path).is_none(),
                })
            })
            .cloned()
            .collect()
    }

    pub fn include(&mut self, path: PathBuf) {
        if !self.paths.contains(&path) {
            self.paths.insert(0, path);
            self.paths.truncate(MAX_REPOSITORIES);
        }
    }
}

fn tempfile_path(path: &Path) -> PathBuf {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    path.with_extension(format!("{}.{}.tmp", std::process::id(), nonce))
}

pub(super) fn scan(roots: &[PathBuf], cancel: &Cancellation) -> (Vec<PathBuf>, usize) {
    let mut queue: std::collections::VecDeque<_> = roots.iter().cloned().collect();
    let mut visited = HashSet::new();
    let mut found = Vec::new();
    let mut skipped = 0;

    while let Some(path) = queue.pop_front() {
        if cancel.is_cancelled() || visited.len() >= 100_000 || found.len() >= MAX_REPOSITORIES {
            break;
        }

        if !visited.insert(path.clone()) {
            continue;
        }

        if path.join(".git").exists() {
            found.push(path);
            continue;
        }

        let entries = match fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };

        let mut children = Vec::new();

        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();

            if name.starts_with('.')
                || matches!(
                    name.as_ref(),
                    "node_modules"
                        | "target"
                        | "vendor"
                        | "dist"
                        | "build"
                        | "Library"
                        | "Applications"
                        | "AppData"
                        | "Pods"
                )
            {
                continue;
            }

            if entry
                .file_type()
                .is_ok_and(|kind| kind.is_dir() && !kind.is_symlink())
            {
                children.push(entry.path());
            }
        }

        children.sort();
        queue.extend(children);
    }

    (found, skipped)
}

pub(super) fn overview(
    path: &Path,
    process: GitProcess,
    cancel: &Cancellation,
) -> Result<Overview, String> {
    let repository =
        Repository::open(path, process, Some(cancel)).map_err(|error| error.to_string())?;

    let snapshot = repository
        .snapshot(false, Some(cancel))
        .map_err(|error| error.to_string())?;

    let head = &snapshot.status.head;

    let branch = head.branch.clone().unwrap_or_else(|| {
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

    let tracking = if head.upstream.is_some() {
        format!("↓{} ↑{}", head.behind, head.ahead)
    } else {
        "No upstream".into()
    };

    let avatar = repository
        .remotes(Some(cancel))
        .ok()
        .into_iter()
        .flatten()
        .flat_map(|remote| remote.fetch_urls)
        .find_map(|remote| cached_avatar(&remote));

    Ok(Overview {
        branch,
        changes: snapshot
            .status
            .files
            .iter()
            .filter(|file| file.record_type != RecordType::Ignored)
            .count(),
        tracking,
        avatar,
    })
}

fn cached_avatar(remote: &str) -> Option<Arc<gpui::Image>> {
    let suffix = remote
        .strip_prefix("git@github.com:")
        .or_else(|| remote.strip_prefix("https://github.com/"))?;

    let owner = suffix.split('/').next()?.to_lowercase();
    let key = format!("github:https://github.com:{owner}\n");
    let home = PathBuf::from(std::env::var_os("HOME")?);

    let directory = if cfg!(target_os = "macos") {
        home.join("Library/Caches")
    } else {
        std::env::var_os("XDG_CACHE_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".cache"))
    };

    let file = directory
        .join("1git-gpuix/avatars-v1")
        .join(format!("{:x}.png", Sha256::digest(key.as_bytes())));

    let bytes = fs::read(file).ok()?;

    if bytes.len() > 64 * 1024
        || bytes.get(..8) != Some(b"\x89PNG\r\n\x1a\n")
        || bytes.get(16..24) != Some(&[0, 0, 0, 64, 0, 0, 0, 64])
    {
        return None;
    }

    Some(Arc::new(gpui::Image::from_bytes(
        gpui::ImageFormat::Png,
        bytes,
    )))
}
