//! Public account metadata is separate from transient, redacted credential values.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;
use zeroize::Zeroizing;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Provider {
    GitHub,
    GitLab,
}

impl Provider {
    pub fn label(self) -> &'static str {
        match self {
            Self::GitHub => "GitHub",
            Self::GitLab => "GitLab",
        }
    }

    pub fn default_host(self) -> &'static str {
        match self {
            Self::GitHub => "https://github.com/",
            Self::GitLab => "https://gitlab.com/",
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::GitHub => "github",
            Self::GitLab => "gitlab",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Account {
    pub provider: Provider,
    pub web_url: String,
    pub id: String,
    pub username: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential_source: Option<String>,
}

impl Account {
    pub fn key(&self) -> String {
        let content = serde_json::to_vec(&(self.provider, self.web_url.as_str(), self.id.as_str()))
            .expect("account tuple serializes");

        format!("1git-rust-hosting-v1:{:x}", Sha256::digest(content))
    }

    pub fn validate(&self) -> Result<(), String> {
        let h = Host::new(self.provider, &self.web_url)?;

        if h.web.as_str() != self.web_url
            || [self.id.as_str(), self.username.as_str()]
                .iter()
                .any(|v| v.is_empty() || v.len() > 2048 || controls(v))
            || self.credential_source.as_ref().is_some_and(|v| {
                v != "github-cli" || self.provider != Provider::GitHub || h.web.path() != "/"
            })
        {
            return Err("Invalid account identity metadata.".into());
        }

        Ok(())
    }

    pub fn host_label(&self) -> String {
        self.web_url
            .trim_start_matches("https://")
            .trim_end_matches('/')
            .into()
    }
}

pub(crate) fn controls(value: &str) -> bool {
    value.chars().any(|c| c < ' ' || c == '\u{7f}')
}

pub(crate) struct Secret(Zeroizing<String>);

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret([redacted])")
    }
}

impl Secret {
    pub fn token(value: String, limit: usize) -> Result<Self, String> {
        let value = Zeroizing::new(value);

        if value.is_empty()
            || value.len() > limit
            || value.chars().any(char::is_whitespace)
            || controls(&value)
        {
            return Err("Enter a valid access token with no whitespace (up to 2048 bytes).".into());
        }

        Ok(Self(value))
    }

    pub fn encoded(value: String) -> Self {
        Self(Zeroizing::new(value))
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug)]
pub(crate) struct Host {
    pub provider: Provider,
    pub web: Url,
}

impl Host {
    pub fn new(provider: Provider, value: &str) -> Result<Self, String> {
        let invalid = || {
            "Use an HTTPS host URL without credentials, query parameters or fragment.".to_string()
        };

        if value.len() > 2048
            || controls(value)
            || value.contains('\\')
            || value.split('/').any(|s| matches!(s, "." | ".."))
        {
            return Err(invalid());
        }

        let value = value.trim();
        let mut web = Url::parse(value).map_err(|_| invalid())?;

        if web.scheme() != "https"
            || web.host_str().is_none()
            || !web.username().is_empty()
            || web.password().is_some()
            || web.query().is_some()
            || web.fragment().is_some()
        {
            return Err(invalid());
        }

        if !web.path().ends_with('/') {
            web.set_path(&format!("{}/", web.path()));
        }

        Ok(Self { provider, web })
    }

    pub fn web(&self, path: &str) -> Url {
        self.web.join(path).expect("fixed relative provider path")
    }

    pub fn api(&self, path: &str) -> Url {
        if self.provider == Provider::GitHub && self.web.as_str() == "https://github.com/" {
            return Url::parse(&format!("https://api.github.com/{path}")).expect("fixed API URL");
        }

        self.web(&format!(
            "api/{}/{path}",
            if self.provider == Provider::GitHub {
                "v3"
            } else {
                "v4"
            }
        ))
    }

    pub fn browser_url(&self, value: &str) -> Result<Url, String> {
        let url = Url::parse(value).map_err(|_| "Provider returned an invalid browser URL.")?;

        if url.origin() != self.web.origin()
            || !url.path().starts_with(self.web.path())
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
        {
            return Err("Provider returned an unexpected browser destination.".into());
        }

        Ok(url)
    }

    pub fn setup_url(&self, token: bool, repositories: bool) -> Url {
        let path = match (self.provider, token) {
            (Provider::GitHub, false) => "settings/applications/new",
            (Provider::GitHub, true) => "settings/personal-access-tokens/new",
            (Provider::GitLab, false) => "user_settings/applications",
            (Provider::GitLab, true) => "-/user_settings/personal_access_tokens",
        };

        let mut url = self.web(path);

        if token {
            let mut q = url.query_pairs_mut();

            q.append_pair("name", "1git");

            if self.provider == Provider::GitHub {
                q.append_pair("expires_in", "30");
            } else {
                q.append_pair(
                    "scopes",
                    if repositories {
                        "read_user,read_api,read_repository"
                    } else {
                        "read_user"
                    },
                );
            }
        }

        url
    }
}

pub(crate) const CALLBACK: &str = "http://127.0.0.1:8765/oauth/callback";
pub(crate) const HOMEPAGE: &str = "https://github.com/1bye/1git";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Registration {
    pub client_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redirect_uri: Option<String>,
}

impl Registration {
    pub fn validate(&self, provider: Provider) -> Result<(), String> {
        if self.client_id.is_empty()
            || self.client_id.len() > 256
            || self.client_id.chars().any(char::is_whitespace)
            || controls(&self.client_id)
        {
            return Err("Enter the registered application's public client ID.".into());
        }

        if provider == Provider::GitLab {
            callback(self.redirect_uri.as_deref().unwrap_or(""))?;
        }

        Ok(())
    }
}

pub(crate) fn callback(value: &str) -> Result<Url, String> {
    let url = Url::parse(value)
        .map_err(|_| "Use a registered HTTP callback on 127.0.0.1 with an explicit port.")?;

    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "Register an HTTP callback on 127.0.0.1 with an explicit port and no query parameters."
                .into(),
        );
    }

    Ok(url)
}

#[derive(Debug)]
pub(crate) struct OAuth {
    pub registration: Registration,
    pub refresh_token: Option<Secret>,
    pub expires_at: Option<u64>,
    pub refresh_expires_at: Option<u64>,
    pub scopes: Option<Vec<String>>,
}

#[derive(Debug)]
pub(crate) struct Credential {
    pub token: Secret,
    pub oauth: Option<OAuth>,
}

impl Credential {
    pub fn encode(&self) -> Result<Secret, String> {
        if let Some(o) = &self.oauth {
            let mut data = serde_json::json!({"version":1,"registration":o.registration,"tokens":{"accessToken":self.token.expose(),"refreshToken":o.refresh_token.as_ref().map(Secret::expose),"tokenType":"bearer","expiresAt":o.expires_at,"refreshExpiresAt":o.refresh_expires_at,"scopes":o.scopes}});
            let result = Secret::encoded(data.to_string());

            wipe_json(&mut data);

            if result.expose().len() > 16384 {
                return Err("Provider credential is too large to save securely.".into());
            }

            Ok(result)
        } else {
            Ok(Secret::encoded(self.token.expose().into()))
        }
    }

    pub fn decode(value: Secret, provider: Provider) -> Result<Self, String> {
        let invalid = || "Invalid saved credential. Reconnect this account.".to_string();

        if value.expose().len() > 16384 {
            return Err(invalid());
        }

        if !value.expose().starts_with('{') {
            return Ok(Self {
                token: Secret::token(value.expose().into(), 4096).map_err(|_| invalid())?,
                oauth: None,
            });
        }

        let mut data: serde_json::Value =
            serde_json::from_str(value.expose()).map_err(|_| invalid())?;

        let result = (|| {
            if data["version"] != 1 || data["tokens"]["tokenType"] != "bearer" {
                return Err(invalid());
            }

            let registration: Registration =
                serde_json::from_value(data["registration"].clone()).map_err(|_| invalid())?;

            registration.validate(provider).map_err(|_| invalid())?;
            let tokens = &data["tokens"];

            let token = Secret::token(
                tokens["accessToken"].as_str().ok_or_else(invalid)?.into(),
                4096,
            )
            .map_err(|_| invalid())?;

            let refresh_token = if tokens["refreshToken"].is_null() {
                None
            } else {
                Some(
                    Secret::token(
                        tokens["refreshToken"].as_str().ok_or_else(invalid)?.into(),
                        4096,
                    )
                    .map_err(|_| invalid())?,
                )
            };

            let expiry = |key| {
                if tokens[key].is_null() {
                    Ok(None)
                } else {
                    tokens[key].as_u64().map(Some).ok_or_else(invalid)
                }
            };

            let scopes = if tokens["scopes"].is_null() {
                None
            } else {
                Some(serde_json::from_value(tokens["scopes"].clone()).map_err(|_| invalid())?)
            };

            Ok(Self {
                token,
                oauth: Some(OAuth {
                    registration,
                    refresh_token,
                    expires_at: expiry("expiresAt")?,
                    refresh_expires_at: expiry("refreshExpiresAt")?,
                    scopes,
                }),
            })
        })();

        wipe_json(&mut data);

        result
    }
}

pub(crate) fn wipe_json(value: &mut serde_json::Value) {
    use zeroize::Zeroize;

    match value {
        serde_json::Value::String(s) => s.zeroize(),
        serde_json::Value::Array(a) => a.iter_mut().for_each(wipe_json),
        serde_json::Value::Object(o) => o.values_mut().for_each(wipe_json),
        _ => {}
    }
}
