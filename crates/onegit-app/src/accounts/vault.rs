//! OS-only secrets. No environment, file fallback, credential import or raw native errors.
use super::model::Secret;
use rake::gpui;
#[cfg(not(target_os = "macos"))]
use std::cell::RefCell;

pub(crate) trait Vault {
    fn read(&self, key: String) -> gpui::Task<Result<Option<Secret>, String>>;

    fn write(&self, key: String, value: Secret) -> gpui::Task<Result<(), String>>;

    fn delete(&self, key: String) -> gpui::Task<Result<(), String>>;
}

const READ: &str =
    "Could not read the OS credential store. Unlock it or allow access, then try again.";

const WRITE: &str = "Could not save to the OS credential store. The account was not connected.";
const DELETE: &str = "Could not remove the saved credential. The account was left connected.";

pub(crate) struct NativeVault {
    executor: gpui::BackgroundExecutor,
    #[cfg(not(target_os = "macos"))]
    context: RefCell<gpui::AsyncApp>,
}

impl NativeVault {
    pub fn new(cx: &gpui::App) -> Self {
        Self {
            executor: cx.background_executor().clone(),
            #[cfg(not(target_os = "macos"))]
            context: RefCell::new(cx.to_async()),
        }
    }
}

fn key_valid(key: &str) -> bool {
    key.strip_prefix("1git-rust-hosting-v1:").is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    })
}

impl Vault for NativeVault {
    fn read(&self, key: String) -> gpui::Task<Result<Option<Secret>, String>> {
        if !key_valid(&key) {
            return gpui::Task::ready(Err("Invalid application credential key.".into()));
        }

        #[cfg(target_os = "macos")]
        {
            // GPUI maps a cancelled Keychain read to absence. Keep denial distinct so reconnect cannot overwrite it.
            self.executor.spawn(async move {
                let bytes = match security_framework::passwords::get_generic_password(
                    "dev.1git.rust.hosting.v1",
                    &key,
                ) {
                    Ok(bytes) => zeroize::Zeroizing::new(bytes),
                    Err(e) if e.code() == -25300 => return Ok(None),
                    Err(_) => return Err(READ.into()),
                };

                std::str::from_utf8(&bytes)
                    .map(|s| Some(Secret::encoded(s.into())))
                    .map_err(|_| READ.into())
            })
        }

        #[cfg(not(target_os = "macos"))]
        {
            let task = self
                .context
                .borrow_mut()
                .update(|cx| cx.read_credentials(&key));

            self.executor.spawn(async move {
                let task = task.map_err(|_| READ)?;
                let value = task.await.map_err(|_| READ)?;

                value
                    .map(|(_, mut b)| {
                        let text = std::str::from_utf8(&b)
                            .map(|s| Secret::encoded(s.into()))
                            .map_err(|_| READ.to_string());

                        use zeroize::Zeroize;
                        b.zeroize();

                        text
                    })
                    .transpose()
            })
        }
    }

    fn write(&self, key: String, value: Secret) -> gpui::Task<Result<(), String>> {
        if !key_valid(&key) {
            return gpui::Task::ready(Err("Invalid application credential key.".into()));
        }

        #[cfg(target_os = "macos")]
        {
            self.executor.spawn(async move {
                security_framework::passwords::set_generic_password(
                    "dev.1git.rust.hosting.v1",
                    &key,
                    value.expose().as_bytes(),
                )
                .map_err(|_| WRITE.into())
            })
        }

        #[cfg(not(target_os = "macos"))]
        {
            let task = self
                .context
                .borrow_mut()
                .update(|cx| cx.write_credentials(&key, "1git-rust", value.expose().as_bytes()));

            self.executor
                .spawn(async move { task.map_err(|_| WRITE)?.await.map_err(|_| WRITE.into()) })
        }
    }

    fn delete(&self, key: String) -> gpui::Task<Result<(), String>> {
        if !key_valid(&key) {
            return gpui::Task::ready(Err("Invalid application credential key.".into()));
        }

        #[cfg(target_os = "macos")]
        {
            self.executor.spawn(async move {
                match security_framework::passwords::delete_generic_password(
                    "dev.1git.rust.hosting.v1",
                    &key,
                ) {
                    Ok(()) => Ok(()),
                    Err(e) if e.code() == -25300 => Ok(()),
                    Err(_) => Err(DELETE.into()),
                }
            })
        }

        #[cfg(not(target_os = "macos"))]
        {
            let task = self
                .context
                .borrow_mut()
                .update(|cx| cx.delete_credentials(&key));

            self.executor
                .spawn(async move { task.map_err(|_| DELETE)?.await.map_err(|_| DELETE.into()) })
        }
    }
}
