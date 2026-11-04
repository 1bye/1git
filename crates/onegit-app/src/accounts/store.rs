//! Bounded public metadata, private atomic replacement and stale review detection.
use super::model::Account;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, io::Write, path::PathBuf};

#[derive(Clone, Debug)]
pub(crate) struct Store {
    path: PathBuf,
}

#[derive(Clone, Debug)]
pub(crate) struct Review {
    pub accounts: Vec<Account>,
    bytes: Option<Vec<u8>>,
}

#[derive(Serialize, Deserialize)]
struct Document {
    version: u8,
    #[serde(default)]
    revision: String,
    accounts: Vec<Account>,
}

impl Store {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    #[cfg(test)]
    pub fn path(&self) -> &std::path::Path {
        &self.path
    }

    pub fn default_path() -> Option<PathBuf> {
        if let Some(path) = std::env::var_os("ONEGIT_ACCOUNTS_PATH") {
            let path = PathBuf::from(path);

            return path.is_absolute().then_some(path);
        }

        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)?;

        let base = if cfg!(target_os = "macos") {
            home.join("Library/Application Support")
        } else if cfg!(windows) {
            std::env::var_os("APPDATA").map(PathBuf::from)?
        } else {
            std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".config"))
        };

        Some(base.join("1git-rust/accounts.json"))
    }

    pub fn read(&self) -> Result<Review, String> {
        use std::io::Read;
        let bytes = match std::fs::File::open(&self.path) {
            Ok(file) => {
                let mut data = Vec::new();

                file.take(65537)
                    .read_to_end(&mut data)
                    .map_err(|_| "Could not read saved accounts. Metadata was left unchanged.")?;

                if data.len() > 65536 {
                    return Err(
                        "Account metadata is too large. The file was left unchanged.".into(),
                    );
                }

                Some(data)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => {
                return Err("Could not read saved accounts. Metadata was left unchanged.".into());
            }
        };

        let accounts = if let Some(bytes) = &bytes {
            let document:Document=serde_json::from_slice(bytes).map_err(|_|"Could not read saved accounts. Repair the metadata file; it was left unchanged.")?;

            if document.version != 1 {
                return Err(
                    "Unsupported account metadata version. The file was left unchanged.".into(),
                );
            }

            validate(&document.accounts)?;

            document.accounts
        } else {
            Vec::new()
        };

        Ok(Review { accounts, bytes })
    }

    pub fn unchanged(&self, review: &Review) -> Result<(), String> {
        if self.read()?.bytes != review.bytes {
            return Err("Saved accounts changed. Reload and review before trying again.".into());
        }

        Ok(())
    }

    pub fn save(&self, review: &Review, accounts: &[Account]) -> Result<Review, String> {
        validate(accounts)?;
        self.unchanged(review)?;
        let bytes = serde_json::to_vec(&Document {
            version: 1,
            revision: format!("{:032x}", rand::random::<u128>()),
            accounts: accounts.to_vec(),
        })
        .map_err(|_| "Could not encode public account metadata.")?;

        if bytes.len() > 65536 {
            return Err("Too many saved accounts.".into());
        }

        let parent = self
            .path
            .parent()
            .ok_or("Account directory is unavailable.")?;

        let mut builder = std::fs::DirBuilder::new();

        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(parent)
            .map_err(|_| "Could not create the private account directory.")?;
        let mut file = tempfile::NamedTempFile::new_in(parent)
            .map_err(|_| "Could not create account metadata.")?;

        file.write_all(&bytes)
            .and_then(|_| file.as_file().sync_all())
            .map_err(|_| "Could not save account metadata.")?;
        self.unchanged(review)?;
        file.persist(&self.path)
            .map_err(|_| "Could not replace account metadata.")?;

        Ok(Review {
            accounts: accounts.to_vec(),
            bytes: Some(bytes),
        })
    }
}

fn validate(accounts: &[Account]) -> Result<(), String> {
    if accounts.len() > 100 {
        return Err("Too many saved accounts.".into());
    }

    let mut keys = HashSet::new();

    for account in accounts {
        account.validate()?;

        if !keys.insert(account.key()) {
            return Err("Duplicate account metadata.".into());
        }
    }

    Ok(())
}
