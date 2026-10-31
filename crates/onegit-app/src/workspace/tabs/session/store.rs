//! Serialized atomic replacements keep failed or unsupported documents recoverable.
use super::model::{Document, LIMIT};

use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

#[derive(Clone)]
pub(super) struct Store {
    path: PathBuf,
    generation: Arc<AtomicU64>,
    saved: Arc<Mutex<Option<Document>>>,
}

impl Store {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            generation: Arc::new(AtomicU64::new(0)),
            saved: Arc::new(Mutex::new(None)),
        }
    }

    pub fn load(path: &Path) -> Result<Option<Document>, String> {
        let file = match fs::File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };

        if file.metadata().map_err(|e| e.to_string())?.len() > LIMIT {
            return Err("Saved workspace exceeds 8 MiB".into());
        }

        let mut bytes = Vec::new();

        file.take(LIMIT + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;

        if bytes.len() as u64 > LIMIT {
            return Err("Saved workspace exceeds 8 MiB".into());
        }

        let document: Document = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;

        document.validate()?;

        Ok(Some(document))
    }

    pub fn prepare(
        &self,
        document: Document,
    ) -> impl FnOnce() -> Result<(), String> + Send + 'static + use<> {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let store = self.clone();

        move || {
            let mut saved = store.saved.lock().map_err(|_| "Session save lock failed")?;

            if generation != store.generation.load(Ordering::SeqCst)
                || saved.as_ref() == Some(&document)
            {
                return Ok(());
            }

            document.validate()?;
            let bytes = serde_json::to_vec(&document).map_err(|e| e.to_string())?;

            if bytes.len() as u64 > LIMIT {
                return Err("Workspace exceeds 8 MiB; drafts remain in this window".into());
            }

            let parent = store
                .path
                .parent()
                .ok_or("Session path has no parent directory")?;

            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            // tempfile persists with atomic replacement on Unix and Windows, and private file permissions.
            let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;

            file.write_all(&bytes)
                .and_then(|()| file.as_file().sync_all())
                .map_err(|e| e.to_string())?;
            file.persist(&store.path).map_err(|e| e.to_string())?;
            *saved = Some(document);

            Ok(())
        }
    }
}
