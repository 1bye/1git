//! Verify before replacing credentials, serialize mutations and restore the vault on metadata failure.
use super::{
    cli::{Cli, CliAccount},
    http::{Failure, Network},
    model::*,
    oauth,
    store::{Review, Store},
    vault::Vault,
};

use onegit_git::Cancellation;
use rake::gpui;
use std::rc::Rc;

static MUTATIONS: async_lock::Mutex<()> = async_lock::Mutex::new(());

pub(crate) struct Accounts {
    pub store: Store,
    pub vault: Rc<dyn Vault>,
    pub network: Network,
    pub cli: Cli,
    pub executor: gpui::BackgroundExecutor,
}

impl Accounts {
    pub fn new(store: Store, vault: Rc<dyn Vault>, cx: &gpui::App) -> Self {
        Self {
            store,
            vault,
            network: Network::default(),
            cli: Cli::default(),
            executor: cx.background_executor().clone(),
        }
    }

    pub async fn load(&self) -> Result<Review, String> {
        let store = self.store.clone();

        self.executor.spawn(async move { store.read() }).await
    }

    async fn fresh(&self, review: Review) -> Result<(), String> {
        let store = self.store.clone();

        self.executor
            .spawn(async move { store.unchanged(&review) })
            .await
    }

    async fn save(&self, review: Review, accounts: Vec<Account>) -> Result<Review, String> {
        let store = self.store.clone();

        self.executor
            .spawn(async move { store.save(&review, &accounts) })
            .await
    }

    pub async fn connect(
        &self,
        review: Review,
        host: Host,
        credential: Credential,
        replacing: Option<Account>,
        cancel: Cancellation,
    ) -> Result<Review, String> {
        let network = self.network.clone();
        let checked = cancel.clone();

        let (account, credential) = self
            .executor
            .spawn(async move {
                let result = network
                    .account(&host, &credential.token, &checked)
                    .map_err(|e| e.to_string());

                (result, credential)
            })
            .await;

        self.persist(review, account?, Some(credential), replacing, None, cancel)
            .await
    }

    pub async fn connect_cli(
        &self,
        review: Review,
        selected: CliAccount,
        replacing: Option<Account>,
        cancel: Cancellation,
    ) -> Result<Review, String> {
        selected.validate()?;
        let cli = self.cli.clone();
        let network = self.network.clone();
        let checked = cancel.clone();
        let expected = selected.username.clone();

        let account = self
            .executor
            .spawn(async move {
                let token = cli.token(&selected, &checked)?;
                let host = Host::new(Provider::GitHub, &format!("https://{}/", selected.host))?;

                network
                    .account(&host, &token, &checked)
                    .map_err(|e| e.to_string())
            })
            .await?;

        self.persist(review, account, None, replacing, Some(expected), cancel)
            .await
    }

    async fn persist(
        &self,
        review: Review,
        mut account: Account,
        credential: Option<Credential>,
        replacing: Option<Account>,
        cli_user: Option<String>,
        cancel: Cancellation,
    ) -> Result<Review, String> {
        if cli_user
            .as_ref()
            .is_some_and(|u| !u.eq_ignore_ascii_case(&account.username))
        {
            return Err(
                "GitHub CLI returned a different account. Refresh the accounts and try again."
                    .into(),
            );
        }

        if replacing
            .as_ref()
            .is_some_and(|old| old.key() != account.key())
        {
            return Err(
                "This credential belongs to a different account. Use Add account instead.".into(),
            );
        }

        if cli_user.is_some() {
            account.credential_source = Some("github-cli".into());
        }

        let encoded = credential.as_ref().map(Credential::encode).transpose()?;
        let _guard = MUTATIONS.lock().await;

        cancelled(&cancel)?;
        self.fresh(review.clone()).await?;

        if replacing
            .as_ref()
            .is_some_and(|old| !review.accounts.contains(old))
        {
            return Err("The account changed or was removed. Reload before reconnecting.".into());
        }

        let key = account.key();

        // Switching to CLI is metadata-only; an older app-vault entry stays untouched, as in the source.
        let previous = if encoded.is_some() {
            self.vault.read(key.clone()).await?
        } else {
            None
        };

        cancelled(&cancel)?;
        self.fresh(review.clone()).await?;

        if let Some(encoded) = encoded {
            self.vault.write(key.clone(), encoded).await?;
        }

        // Cancellation stops before a vault write; once accepted, finish metadata or rollback even if the window closes.
        let mut accounts = review
            .accounts
            .iter()
            .filter(|a| a.key() != key)
            .cloned()
            .collect::<Vec<_>>();

        accounts.push(account);

        match self.save(review, accounts).await {
            Ok(next) => Ok(next),
            Err(_) => {
                if credential.is_some() {
                    self.restore(key, previous).await?;
                }

                Err("Could not save the account. The previous credential and connection were restored. Reload before trying again.".into())
            }
        }
    }

    pub async fn disconnect(&self, review: Review, account: Account) -> Result<Review, String> {
        let _guard = MUTATIONS.lock().await;

        self.fresh(review.clone()).await?;

        if !review.accounts.contains(&account) {
            return Err("The saved account changed. Reload before removing it.".into());
        }

        let key = account.key();

        let previous = if account.credential_source.as_deref() == Some("github-cli") {
            None
        } else {
            self.vault.read(key.clone()).await?
        };

        self.fresh(review.clone()).await?;

        if previous.is_some() {
            self.vault.delete(key.clone()).await?;
        }

        let next = review
            .accounts
            .iter()
            .filter(|a| a.key() != key)
            .cloned()
            .collect();

        match self.save(review, next).await {
            Ok(next) => Ok(next),
            Err(_) => {
                if previous.is_some() {
                    self.restore(key, previous).await?;
                }

                Err("Could not remove account metadata. The credential and connection were restored. Reload before trying again.".into())
            }
        }
    }

    async fn restore(&self, key: String, previous: Option<Secret>) -> Result<(), String> {
        let result = if let Some(previous) = previous {
            self.vault.write(key, previous).await
        } else {
            self.vault.delete(key).await
        };

        result.map_err(|_|"Account metadata could not be saved and credential rollback failed. Reconnect this account to repair it.".into())
    }

    async fn current(&self, account: &Account) -> Result<(), String> {
        if !self.load().await?.accounts.contains(account) {
            return Err("This account changed or was removed. Reload Accounts in Settings.".into());
        }

        Ok(())
    }

    async fn credential(
        &self,
        account: &Account,
        cancel: &Cancellation,
    ) -> Result<Option<Credential>, String> {
        cancelled(cancel)?;
        self.current(account).await?;

        if account.credential_source.as_deref() == Some("github-cli") {
            let cli = self.cli.clone();

            let selected = CliAccount {
                host: account.host_label(),
                username: account.username.clone(),
                active: false,
            };

            let cancel = cancel.clone();

            return self
                .executor
                .spawn(async move {
                    cli.token(&selected, &cancel)
                        .map(|token| Some(Credential { token, oauth: None }))
                })
                .await;
        }

        let Some(saved) = self.vault.read(account.key()).await? else {
            return Ok(None);
        };

        let mut credential = Credential::decode(saved, account.provider)?;

        if credential
            .oauth
            .as_ref()
            .is_some_and(|o| o.expires_at.is_some_and(|t| t <= oauth::now() + 60_000))
        {
            let network = self.network.clone();
            let host = Host::new(account.provider, &account.web_url)?;
            let checked = cancel.clone();

            credential = self
                .executor
                .spawn(async move {
                    network.refresh(
                        &host,
                        credential.oauth.as_ref().expect("expiring OAuth"),
                        &checked,
                    )
                })
                .await?;
            cancelled(cancel)?;
            self.current(account).await?;
            // Persist rotation before a subsequent identity/network error can make its old refresh token unusable.
            self.vault
                .write(account.key(), credential.encode()?)
                .await?;
        }

        Ok(Some(credential))
    }

    pub async fn check(&self, account: Account, cancel: Cancellation) -> Result<String, String> {
        let _guard = MUTATIONS.lock().await;

        let credential = match self.credential(&account, &cancel).await {
            Ok(Some(c)) => c,
            Ok(None) => return Ok("Reconnect — no saved token".into()),
            Err(e) if e == "Reconnect — token expired or invalid" => return Ok(e),
            Err(e) => return Err(e),
        };

        let host = Host::new(account.provider, &account.web_url)?;
        let network = self.network.clone();

        let result = self
            .executor
            .spawn(async move { network.account(&host, &credential.token, &cancel) })
            .await;

        match result {
            Ok(identity) => Ok(if identity.id == account.id {
                "Connected"
            } else {
                "Reconnect — account identity changed"
            }
            .into()),
            Err(Failure::Authentication) => Ok("Reconnect — token expired or invalid".into()),
            Err(e) => Err(e.to_string()),
        }
    }

    pub async fn details(&self, account: Account) -> Result<(Option<Registration>, bool), String> {
        let _guard = MUTATIONS.lock().await;

        self.current(&account).await?;

        if account.credential_source.as_deref() == Some("github-cli") {
            return Ok((None, false));
        }

        let Some(saved) = self.vault.read(account.key()).await? else {
            return Ok((None, false));
        };

        let credential = Credential::decode(saved, account.provider)?;

        Ok(credential.oauth.map_or((None, false), |o| {
            let access = o.scopes.as_ref().is_some_and(|s| {
                if account.provider == Provider::GitHub {
                    s.iter().any(|s| s == "repo")
                } else {
                    s.iter().any(|s| s == "api")
                        || (s.iter().any(|s| s == "read_api")
                            && s.iter()
                                .any(|s| s == "read_repository" || s == "write_repository"))
                }
            });

            (Some(o.registration), access)
        }))
    }
}

fn cancelled(cancel: &Cancellation) -> Result<(), String> {
    super::http::cancelled(cancel).map_err(|e| e.to_string())
}
