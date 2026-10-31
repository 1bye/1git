//! Versioned navigation intent; Git snapshots and pending operations are never serialized.
use onegit_git::GitPath;
use serde::{Deserialize, Serialize};

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

pub(super) const LIMIT: u64 = 8 * 1024 * 1024;
pub(super) const MAX_TABS: usize = 128;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(super) struct Document {
    pub version: u32,
    pub tabs: Vec<SavedTab>,
    pub active: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(in crate::workspace) struct SavedTab {
    pub root: Root,
    pub summary: String,
    pub description: String,
    pub history_visible: bool,
    pub selected: Option<Change>,
    pub split_diff: bool,
    pub filter: String,
    pub filter_visible: bool,
    pub sidebar: f32,
    pub history: History,
    #[serde(default)]
    pub stashes: Option<StashView>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(in crate::workspace) struct History {
    pub commit: Option<String>,
    pub file: Option<Vec<u8>>,
    pub rows: usize,
    pub split_diff: bool,
    pub sidebar: f32,
    pub detail_fraction: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(in crate::workspace) struct StashView {
    pub visible: bool,
    pub selected: Option<String>,
    pub file: Option<(String, Vec<u8>)>,
    pub split_diff: bool,
    pub sidebar: f32,
    pub detail_fraction: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(in crate::workspace) struct Change {
    pub path: Vec<u8>,
    pub staged: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::workspace) enum Root {
    Text(String),
    Unix(Vec<u8>),
    Windows(Vec<u16>),
}

impl Root {
    pub fn capture(path: &Path) -> Self {
        if let Some(text) = path.to_str() {
            return Self::Text(text.to_owned());
        }

        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStrExt;

            Self::Unix(path.as_os_str().as_bytes().to_vec())
        }

        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;

            Self::Windows(path.as_os_str().encode_wide().collect())
        }
    }

    pub fn path(&self) -> Result<PathBuf, String> {
        let path = match self {
            Self::Text(text) if !text.contains('\0') && !text.starts_with("/@1git-ssh/") => {
                PathBuf::from(text)
            }
            #[cfg(unix)]
            Self::Unix(bytes) if !bytes.contains(&0) => {
                use std::os::unix::ffi::OsStringExt;

                PathBuf::from(OsString::from_vec(bytes.clone()))
            }
            #[cfg(windows)]
            Self::Windows(units) if !units.contains(&0) => {
                use std::os::windows::ffi::OsStringExt;

                PathBuf::from(OsString::from_wide(units))
            }
            _ => return Err("Session contains an invalid or incompatible repository path".into()),
        };

        if !path.is_absolute() {
            return Err("Session contains a relative repository path".into());
        }

        Ok(path)
    }
}

impl Document {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("Unsupported workspace session version".into());
        }

        if self.tabs.len() > MAX_TABS || self.active.is_some_and(|index| index >= self.tabs.len()) {
            return Err("Session contains an invalid tab list or active tab".into());
        }

        for tab in &self.tabs {
            tab.root.path()?;

            if let Some(saved) = &tab.stashes {
                for oid in saved
                    .selected
                    .iter()
                    .chain(saved.file.iter().map(|(oid, _)| oid))
                {
                    if !matches!(oid.len(), 40 | 64) || !oid.bytes().all(|b| b.is_ascii_hexdigit())
                    {
                        return Err("Session contains an invalid stash identity".into());
                    }
                }

                if let Some((_, path)) = &saved.file {
                    GitPath::new(path).map_err(|e| e.to_string())?;
                }

                if !saved.sidebar.is_finite()
                    || !(0.0..=100_000.).contains(&saved.sidebar)
                    || !saved.detail_fraction.is_finite()
                    || !(0.0..=1.0).contains(&saved.detail_fraction)
                {
                    return Err("Session contains invalid stash pane sizes".into());
                }
            }

            if let Some(change) = &tab.selected {
                GitPath::new(&change.path).map_err(|e| e.to_string())?;
            }

            if let Some(path) = &tab.history.file {
                GitPath::new(path).map_err(|e| e.to_string())?;
            }

            if tab.history.commit.as_ref().is_some_and(|oid| {
                !matches!(oid.len(), 40 | 64) || !oid.bytes().all(|b| b.is_ascii_hexdigit())
            }) {
                return Err("Session contains an invalid commit identity".into());
            }

            if ![tab.sidebar, tab.history.sidebar]
                .iter()
                .all(|s| s.is_finite() && (0.0..=100_000.).contains(s))
                || !tab.history.detail_fraction.is_finite()
                || !(0.0..=1.0).contains(&tab.history.detail_fraction)
                || tab.history.rows > 10_000
            {
                return Err("Session contains invalid pane sizes or history limit".into());
            }
        }

        Ok(())
    }
}
