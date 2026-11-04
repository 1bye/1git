use super::{model::*, store::Store};
use serde_json::json;

fn account(host: &str, id: &str) -> Account {
    Account {
        provider: Provider::GitHub,
        web_url: host.into(),
        id: id.into(),
        username: "tester".into(),
        credential_source: None,
    }
}

#[test]
fn metadata_is_private_versioned_and_never_contains_credentials() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().join("accounts.json"));
    let old = store.read().unwrap();
    let saved = account("https://github.com/", "7");

    store.save(&old, std::slice::from_ref(&saved)).unwrap();
    assert_eq!(store.read().unwrap().accounts, [saved]);
    let text = std::fs::read_to_string(store.path()).unwrap();

    assert!(!text.contains("token"));

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(store.path())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[test]
fn stale_or_invalid_metadata_is_never_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().join("accounts.json"));
    let old = store.read().unwrap();

    store
        .save(&old, &[account("https://github.com/", "7")])
        .unwrap();
    assert!(store.save(&old, &[]).unwrap_err().contains("changed"));
    std::fs::write(store.path(), "invalid").unwrap();
    assert!(store.read().is_err());
    assert!(store.save(&old, &[]).is_err());
    assert_eq!(std::fs::read_to_string(store.path()).unwrap(), "invalid");
}

#[test]
fn providers_hosts_and_identities_have_distinct_keys() {
    let a = account("https://github.com/", "7");
    let b = account("https://code.example.test/", "7");
    let mut c = a.clone();

    c.provider = Provider::GitLab;
    let d = account("https://github.com/", "8");
    let keys = [a, b, c, d].map(|a| a.key());

    assert_eq!(
        keys.iter().collect::<std::collections::HashSet<_>>().len(),
        4
    );

    for key in keys {
        assert!(key.starts_with("1git-rust-hosting-v1:"));
    }
}

#[test]
fn hosts_tokens_and_saved_identities_are_validated_before_requests() {
    for host in [
        "http://github.com",
        "https://user:secret@github.com",
        "https://github.com/?token=secret",
        "https://github.com/#x",
        "\nhttps://github.com",
        "https://github.com\\evil",
        "https://github.com/../x",
    ] {
        assert!(Host::new(Provider::GitHub, host).is_err(), "{host}");
    }

    for token in ["", "has space", "has\nline", "has\u{7f}delete"] {
        assert!(Secret::token(token.into(), 2048).is_err());
    }

    assert!(Secret::token("a".repeat(2049), 2048).is_err());
    let host = Host::new(Provider::GitLab, "https://git.example.test/base").unwrap();

    assert_eq!(
        host.api("user").as_str(),
        "https://git.example.test/base/api/v4/user"
    );
    assert_eq!(
        Host::new(Provider::GitHub, "https://github.com")
            .unwrap()
            .api("user")
            .as_str(),
        "https://api.github.com/user"
    );
    let parsed:Account=serde_json::from_value(json!({"provider":"github","webUrl":"https://github.com/","id":"7","username":"tester","token":"ignored"})).unwrap();

    assert!(parsed.validate().is_ok());
}

#[test]
fn oauth_credentials_round_trip_without_debugging_secrets() {
    let c = Credential {
        token: Secret::token("fixture-access".into(), 4096).unwrap(),
        oauth: Some(OAuth {
            registration: Registration {
                client_id: "public-client".into(),
                redirect_uri: None,
            },
            refresh_token: Some(Secret::token("fixture-refresh".into(), 4096).unwrap()),
            expires_at: Some(10),
            refresh_expires_at: None,
            scopes: Some(vec!["read:user".into()]),
        }),
    };

    let encoded = c.encode().unwrap();

    assert!(!format!("{c:?}").contains("fixture"));
    let decoded = Credential::decode(encoded, Provider::GitHub).unwrap();

    assert_eq!(decoded.token.expose(), "fixture-access");
    assert_eq!(
        decoded.oauth.unwrap().registration.client_id,
        "public-client"
    );
}
