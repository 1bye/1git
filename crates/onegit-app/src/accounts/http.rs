//! Credential-bearing requests have bounded bodies, TLS verification and no redirects or retries.
use super::model::{Account, Host, Provider, Secret, wipe_json};
use onegit_git::Cancellation;
use serde_json::Value;
use std::{sync::Arc, time::Duration};
use url::Url;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Failure {
    Cancelled,
    Authentication,
    Network,
    Response,
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {Self::Cancelled=>"Account action cancelled.",Self::Authentication=>"Reconnect — token expired or invalid",Self::Network=>"Could not reach the hosting provider. Check your connection and try again; the saved account was kept.",Self::Response=>"The hosting provider returned an unexpected response. No connection was changed."})
    }
}

impl std::error::Error for Failure {}

pub(crate) struct Reply {
    pub status: u16,
    pub data: Value,
}

impl Drop for Reply {
    fn drop(&mut self) {
        wipe_json(&mut self.data);
    }
}

pub(crate) trait Transport: Send + Sync {
    fn request(
        &self,
        url: &Url,
        token: Option<&str>,
        form: Option<&[(&str, &str)]>,
        cancel: &Cancellation,
    ) -> Result<Reply, Failure>;
}

pub(crate) struct NativeTransport;

impl Transport for NativeTransport {
    fn request(
        &self,
        url: &Url,
        token: Option<&str>,
        form: Option<&[(&str, &str)]>,
        cancel: &Cancellation,
    ) -> Result<Reply, Failure> {
        cancelled(cancel)?;

        if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
            return Err(Failure::Response);
        }

        let agent = ureq::Agent::new_with_config(
            ureq::Agent::config_builder()
                .timeout_global(Some(Duration::from_secs(10)))
                .max_redirects(0)
                .http_status_as_error(false)
                .build(),
        );

        let reply = if let Some(form) = form {
            agent
                .post(url.as_str())
                .header("Accept", "application/json")
                .header("User-Agent", "1git-rust")
                .send_form(form.iter().copied())
        } else {
            let mut request = agent
                .get(url.as_str())
                .header("Accept", "application/json")
                .header("User-Agent", "1git-rust");

            if let Some(token) = token {
                let text = zeroize::Zeroizing::new(format!("Bearer {token}"));

                let mut header =
                    ureq::http::HeaderValue::from_str(&text).map_err(|_| Failure::Response)?;

                header.set_sensitive(true);
                request = request.header("Authorization", header);
            }

            request.call()
        };

        cancelled(cancel)?;
        let mut response = reply.map_err(|_| Failure::Network)?;
        let status = response.status().as_u16();

        if status != 200 {
            return Ok(Reply {
                status,
                data: Value::Null,
            });
        }

        let bytes = zeroize::Zeroizing::new(
            response
                .body_mut()
                .with_config()
                .limit(1024 * 1024)
                .read_to_vec()
                .map_err(|_| Failure::Response)?,
        );

        let data = serde_json::from_slice(&bytes).map_err(|_| Failure::Response)?;

        cancelled(cancel)?;

        Ok(Reply { status, data })
    }
}

pub(crate) fn cancelled(cancel: &Cancellation) -> Result<(), Failure> {
    if cancel.is_cancelled() {
        Err(Failure::Cancelled)
    } else {
        Ok(())
    }
}

#[derive(Clone)]
pub(crate) struct Network {
    pub transport: Arc<dyn Transport>,
}

impl Default for Network {
    fn default() -> Self {
        Self {
            transport: Arc::new(NativeTransport),
        }
    }
}

impl Network {
    pub fn account(
        &self,
        host: &Host,
        token: &Secret,
        cancel: &Cancellation,
    ) -> Result<Account, Failure> {
        let reply =
            self.transport
                .request(&host.api("user"), Some(token.expose()), None, cancel)?;

        if reply.status == 401 {
            return Err(Failure::Authentication);
        }

        if reply.status != 200 {
            return Err(if reply.status >= 500 {
                Failure::Network
            } else {
                Failure::Response
            });
        }

        let data = &reply.data;

        let id = if let Some(n) = data["id"].as_u64() {
            n.to_string()
        } else {
            data["id"].as_str().ok_or(Failure::Response)?.into()
        };

        let username = data[if host.provider == Provider::GitHub {
            "login"
        } else {
            "username"
        }]
        .as_str()
        .ok_or(Failure::Response)?
        .to_owned();

        host.browser_url(
            data[if host.provider == Provider::GitHub {
                "html_url"
            } else {
                "web_url"
            }]
            .as_str()
            .ok_or(Failure::Response)?,
        )
        .map_err(|_| Failure::Response)?;
        let account = Account {
            provider: host.provider,
            web_url: host.web.to_string(),
            id,
            username,
            credential_source: None,
        };

        account.validate().map_err(|_| Failure::Response)?;

        Ok(account)
    }
}
