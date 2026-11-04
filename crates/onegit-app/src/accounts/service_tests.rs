//! Source Accounts lifecycle tests, with disposable metadata and synthetic provider/vault boundaries.
use super::{
    http::{Failure, Network, Reply, Transport},
    model::*,
    service::Accounts,
    store::Store,
    vault::Vault,
};

use onegit_git::Cancellation;
use rake::gpui;
use serde_json::{Value, json};

use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::Rc,
    sync::{Arc, Mutex},
};

use url::Url;

#[derive(Default)]
pub(super) struct MemoryVault {
    values: RefCell<HashMap<String, String>>,
    denied: Cell<bool>,
    fail_write: Cell<bool>,
    fail_delete: Cell<bool>,
    after_write: RefCell<Option<Box<dyn Fn()>>>,
}

impl Vault for MemoryVault {
    fn read(&self, key: String) -> gpui::Task<Result<Option<Secret>, String>> {
        gpui::Task::ready(if self.denied.get() {
            Err("Unlock OS credential store.".into())
        } else {
            Ok(self
                .values
                .borrow()
                .get(&key)
                .map(|s| Secret::encoded(s.clone())))
        })
    }

    fn write(&self, key: String, value: Secret) -> gpui::Task<Result<(), String>> {
        if self.fail_write.get() {
            return gpui::Task::ready(Err("Vault write denied.".into()));
        }

        self.values.borrow_mut().insert(key, value.expose().into());

        if let Some(hook) = self.after_write.borrow_mut().take() {
            hook();
        }

        gpui::Task::ready(Ok(()))
    }

    fn delete(&self, key: String) -> gpui::Task<Result<(), String>> {
        if self.fail_delete.get() {
            return gpui::Task::ready(Err("Vault delete denied.".into()));
        }

        self.values.borrow_mut().remove(&key);

        gpui::Task::ready(Ok(()))
    }
}

struct FixtureHttp {
    reply: Mutex<(u16, Value)>,
    calls: Mutex<Vec<String>>,
    refresh: Mutex<Option<Value>>,
}

impl Transport for FixtureHttp {
    fn request(
        &self,
        url: &Url,
        _token: Option<&str>,
        _form: Option<&[(&str, &str)]>,
        cancel: &Cancellation,
    ) -> Result<Reply, Failure> {
        super::http::cancelled(cancel)?;
        self.calls.lock().unwrap().push(url.to_string());

        if url.path().ends_with("access_token") || url.path().ends_with("oauth/token") {
            return Ok(Reply {
                status: 200,
                data: self.refresh.lock().unwrap().clone().unwrap(),
            });
        }

        let (status, data) = &*self.reply.lock().unwrap();

        Ok(Reply {
            status: *status,
            data: data.clone(),
        })
    }
}

pub(super) struct Fixture {
    _dir: tempfile::TempDir,
    accounts: Accounts,
    vault: Rc<MemoryVault>,
    http: Arc<FixtureHttp>,
    cx: gpui::TestAppContext,
}

impl Fixture {
    fn new() -> Self {
        let cx = gpui::TestAppContext::single();
        let dir = tempfile::tempdir().unwrap();
        let vault = Rc::new(MemoryVault::default());

        let http = Arc::new(FixtureHttp {
            reply: Mutex::new((
                200,
                json!({"id":7,"login":"tester","html_url":"https://github.com/tester"}),
            )),
            calls: Mutex::new(Vec::new()),
            refresh: Mutex::new(None),
        });

        let mut accounts = cx.update(|cx| {
            Accounts::new(
                Store::new(dir.path().join("accounts.json")),
                vault.clone(),
                cx,
            )
        });

        accounts.network = Network {
            transport: http.clone(),
        };

        Self {
            _dir: dir,
            accounts,
            vault,
            http,
            cx,
        }
    }

    fn connect(
        &self,
        token: &str,
        replacing: Option<Account>,
    ) -> Result<super::store::Review, String> {
        let review = self.accounts.store.read()?;

        self.cx
            .foreground_executor
            .block_test(self.accounts.connect(
                review,
                Host::new(Provider::GitHub, "https://github.com").unwrap(),
                Credential {
                    token: Secret::token(token.into(), 2048).unwrap(),
                    oauth: None,
                },
                replacing,
                Cancellation::default(),
            ))
    }
}

#[test]
fn validates_then_connects_reconnects_and_removes_only_application_secrets() {
    let f = Fixture::new();
    let saved = f.connect("fixture-first", None).unwrap();
    let a = saved.accounts[0].clone();

    assert_eq!(
        f.http.calls.lock().unwrap().as_slice(),
        ["https://api.github.com/user"]
    );
    assert!(
        !std::fs::read_to_string(f.accounts.store.path())
            .unwrap()
            .contains("fixture-first")
    );
    assert_eq!(
        f.cx.foreground_executor
            .block_test(f.accounts.check(a.clone(), Cancellation::default()))
            .unwrap(),
        "Connected"
    );
    f.connect("fixture-second", Some(a.clone())).unwrap();
    assert_eq!(f.vault.values.borrow()[&a.key()], "fixture-second");
    let stale = saved;

    assert!(
        f.cx.foreground_executor
            .block_test(f.accounts.disconnect(stale, a.clone()))
            .unwrap_err()
            .contains("changed")
    );
    assert_eq!(f.vault.values.borrow()[&a.key()], "fixture-second");
    let review = f.accounts.store.read().unwrap();

    assert!(
        f.cx.foreground_executor
            .block_test(f.accounts.disconnect(review, a))
            .unwrap()
            .accounts
            .is_empty()
    );
    assert!(f.vault.values.borrow().is_empty());
}

#[test]
fn reconnect_refuses_wrong_identity_and_preserves_saved_credentials_on_auth_or_network_failure() {
    let f = Fixture::new();
    let a = f.connect("fixture-good", None).unwrap().accounts.remove(0);

    *f.http.reply.lock().unwrap() = (
        200,
        json!({"id":8,"login":"other","html_url":"https://github.com/other"}),
    );
    assert!(
        f.connect("fixture-other", Some(a.clone()))
            .unwrap_err()
            .contains("different account")
    );
    assert_eq!(f.vault.values.borrow()[&a.key()], "fixture-good");
    *f.http.reply.lock().unwrap() = (401, json!({"message":"fixture-good"}));
    assert!(f.connect("fixture-bad", Some(a.clone())).is_err());
    assert!(
        f.cx.foreground_executor
            .block_test(f.accounts.check(a.clone(), Cancellation::default()))
            .unwrap()
            .starts_with("Reconnect")
    );
    *f.http.reply.lock().unwrap() = (503, json!({"message":"fixture-good"}));
    let error =
        f.cx.foreground_executor
            .block_test(f.accounts.check(a.clone(), Cancellation::default()))
            .unwrap_err();

    assert!(!error.contains("fixture-good"));
    assert_eq!(f.vault.values.borrow()[&a.key()], "fixture-good");
    assert_eq!(f.accounts.store.read().unwrap().accounts, [a]);
}

#[test]
fn denied_vault_and_metadata_failures_preserve_or_explicitly_report_rollback() {
    let f = Fixture::new();

    let a = f
        .connect("fixture-original", None)
        .unwrap()
        .accounts
        .remove(0);

    f.vault.denied.set(true);
    assert!(
        f.connect("fixture-new", Some(a.clone()))
            .unwrap_err()
            .contains("Unlock")
    );
    assert_eq!(f.vault.values.borrow()[&a.key()], "fixture-original");
    f.vault.denied.set(false);
    let path = f.accounts.store.path().to_owned();

    *f.vault.after_write.borrow_mut() = Some(Box::new(move || {
        std::fs::write(&path, "external edit").unwrap()
    }));
    assert!(
        f.connect("fixture-new", Some(a.clone()))
            .unwrap_err()
            .contains("restored")
    );
    assert_eq!(f.vault.values.borrow()[&a.key()], "fixture-original");
    assert_eq!(
        std::fs::read_to_string(f.accounts.store.path()).unwrap(),
        "external edit"
    );
    let f = Fixture::new();
    let path = f.accounts.store.path().to_owned();

    f.vault.fail_delete.set(true);
    *f.vault.after_write.borrow_mut() = Some(Box::new(move || {
        std::fs::write(&path, "external edit").unwrap()
    }));
    assert!(
        f.connect("fixture-new", None)
            .unwrap_err()
            .contains("rollback failed")
    );
}

#[test]
fn invalid_metadata_and_cancelled_requests_cannot_write_a_credential() {
    let f = Fixture::new();

    std::fs::write(f.accounts.store.path(), "invalid").unwrap();
    assert!(f.connect("fixture", None).is_err());
    assert!(f.vault.values.borrow().is_empty());
    std::fs::remove_file(f.accounts.store.path()).unwrap();
    let cancel = Cancellation::default();

    cancel.cancel();
    let result = f.cx.foreground_executor.block_test(f.accounts.connect(
        f.accounts.store.read().unwrap(),
        Host::new(Provider::GitHub, "https://github.com").unwrap(),
        Credential {
            token: Secret::token("fixture".into(), 2048).unwrap(),
            oauth: None,
        },
        None,
        cancel,
    ));

    assert!(result.is_err());
    assert!(f.http.calls.lock().unwrap().is_empty());
    assert!(f.vault.values.borrow().is_empty());
}

#[test]
fn oauth_refresh_is_persisted_before_a_later_identity_failure_and_expiry_is_recoverable() {
    let f = Fixture::new();

    let a = f
        .connect("fixture-initial", None)
        .unwrap()
        .accounts
        .remove(0);

    let credential = Credential {
        token: Secret::token("expired-fixture".into(), 4096).unwrap(),
        oauth: Some(OAuth {
            registration: Registration {
                client_id: "public-client".into(),
                redirect_uri: None,
            },
            refresh_token: Some(Secret::token("refresh-old".into(), 4096).unwrap()),
            expires_at: Some(1),
            refresh_expires_at: None,
            scopes: Some(vec!["read:user".into()]),
        }),
    };

    f.vault
        .values
        .borrow_mut()
        .insert(a.key(), credential.encode().unwrap().expose().into());
    *f.http.refresh.lock().unwrap() = Some(
        json!({"access_token":"rotated-fixture","refresh_token":"refresh-new","token_type":"bearer","expires_in":3600}),
    );
    *f.http.reply.lock().unwrap() = (503, json!({}));
    assert!(
        f.cx.foreground_executor
            .block_test(f.accounts.check(a.clone(), Cancellation::default()))
            .is_err()
    );
    let saved = Credential::decode(
        Secret::encoded(f.vault.values.borrow()[&a.key()].clone()),
        Provider::GitHub,
    )
    .unwrap();

    assert_eq!(saved.token.expose(), "rotated-fixture");
    f.vault.values.borrow_mut().insert(
        a.key(),
        Credential {
            token: Secret::token("expired".into(), 4096).unwrap(),
            oauth: Some(OAuth {
                registration: Registration {
                    client_id: "client".into(),
                    redirect_uri: None,
                },
                refresh_token: None,
                expires_at: Some(1),
                refresh_expires_at: None,
                scopes: None,
            }),
        }
        .encode()
        .unwrap()
        .expose()
        .into(),
    );
    assert!(
        f.cx.foreground_executor
            .block_test(f.accounts.check(a, Cancellation::default()))
            .unwrap()
            .starts_with("Reconnect")
    );
}

#[test]
fn cli_credentials_stay_with_gh_across_rotation_and_removal() {
    use super::cli::{Cli, CliAccount, Run};

    struct Gh(Mutex<String>);

    impl Run for Gh {
        fn run(&self, args: &[&str], _: &Cancellation) -> Result<Secret, String> {
            assert_eq!(
                args,
                [
                    "auth",
                    "token",
                    "--hostname",
                    "github.com",
                    "--user",
                    "tester"
                ]
            );

            Ok(Secret::encoded(self.0.lock().unwrap().clone()))
        }
    }
    let mut f = Fixture::new();
    let gh = Arc::new(Gh(Mutex::new("cli-fixture-one".into())));

    f.accounts.cli = Cli { run: gh.clone() };
    f.vault.denied.set(true);
    let review =
        f.cx.foreground_executor
            .block_test(f.accounts.connect_cli(
                f.accounts.store.read().unwrap(),
                CliAccount {
                    host: "github.com".into(),
                    username: "tester".into(),
                    active: false,
                },
                None,
                Cancellation::default(),
            ))
            .unwrap();

    let a = review.accounts[0].clone();

    assert_eq!(a.credential_source.as_deref(), Some("github-cli"));
    assert!(f.vault.values.borrow().is_empty());
    *gh.0.lock().unwrap() = "cli-fixture-two".into();
    assert_eq!(
        f.cx.foreground_executor
            .block_test(f.accounts.check(a.clone(), Cancellation::default()))
            .unwrap(),
        "Connected"
    );
    assert!(
        f.cx.foreground_executor
            .block_test(f.accounts.disconnect(review, a))
            .unwrap()
            .accounts
            .is_empty()
    );
    assert!(f.vault.values.borrow().is_empty());
    assert_eq!(&*gh.0.lock().unwrap(), "cli-fixture-two");
}
