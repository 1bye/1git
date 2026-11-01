//! Owned real-index lock shared by selected commits and line staging.
use super::{Repository, RepositoryError};
use crate::Cancellation;

use std::{
    fs::{self, File},
    io::{self, Seek, SeekFrom},
    path::{Path, PathBuf},
};

pub(super) struct IndexLock {
    pub path: PathBuf,
    pub(super) lock_path: PathBuf,
    file: File,
    identity: crate::platform::FileIdentity,
    owns: bool,
}

impl IndexLock {
    pub fn new(path: PathBuf) -> io::Result<Self> {
        let mut name = path.as_os_str().to_os_string();

        name.push(".lock");
        let lock_path = PathBuf::from(name);
        let file = crate::platform::create_private_file(&lock_path)?;

        let identity = match crate::platform::FileIdentity::from_file(&file) {
            Ok(v) => v,
            Err(e) => {
                let _ = fs::remove_file(&lock_path);

                return Err(e);
            }
        };

        Ok(Self {
            path,
            lock_path,
            file,
            identity,
            owns: true,
        })
    }

    fn check(&self) -> io::Result<()> {
        if !fs::symlink_metadata(&self.lock_path)?.is_file()
            || crate::platform::FileIdentity::from_path(&self.lock_path)? != self.identity
        {
            return Err(io::Error::other("The owned index lock changed."));
        }

        Ok(())
    }

    pub fn install(&mut self, index: &Path) -> io::Result<()> {
        self.check()?;
        let mut source = File::open(index)?;

        self.file.set_len(0)?;
        self.file.seek(SeekFrom::Start(0))?;
        io::copy(&mut source, &mut self.file)?;
        self.file
            .set_permissions(source.metadata()?.permissions())?;
        self.file.sync_all()?;
        self.check()?;
        fs::rename(&self.lock_path, &self.path)?;
        self.owns = false;

        Ok(())
    }

    pub fn release(&mut self) -> io::Result<()> {
        if self.owns {
            self.owns = false;
            self.check()?;
            fs::remove_file(&self.lock_path)?;
        }

        Ok(())
    }
}

impl Drop for IndexLock {
    fn drop(&mut self) {
        let _ = self.release();
    }
}

impl Repository {
    pub(super) fn index_path(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<PathBuf, RepositoryError> {
        let output = self.run(
            ["rev-parse", "--path-format=absolute", "--git-path", "index"],
            cancellation,
        )?;

        let mut bytes = output.stdout;

        if bytes.last() == Some(&b'\n') {
            bytes.pop();

            if bytes.last() == Some(&b'\r') {
                bytes.pop();
            }
        }

        let path = crate::platform::absolute_path_from_git_bytes(&bytes)
            .map_err(|_| RepositoryError::InvalidOutput)?;

        if !path.is_absolute() {
            return Err(RepositoryError::InvalidOutput);
        }

        Ok(path)
    }
}
