//! Public-client GitHub device flow and GitLab PKCE with an exact loopback callback.
use super::{
    http::{Failure, Network, cancelled},
    model::*,
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use onegit_git::Cancellation;
use rand::RngCore;
use serde_json::Value;
use sha2::{Digest, Sha256};

use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use url::Url;

#[derive(Clone, Debug)]
pub(crate) enum Progress {
    Browser(Url),
    DeviceCode(String),
    Verifying,
}

pub(crate) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn random() -> Secret {
    let mut bytes = [0; 32];

    rand::rng().fill_bytes(&mut bytes);

    Secret::encoded(URL_SAFE_NO_PAD.encode(bytes))
}

fn wait(duration: Duration, cancel: &Cancellation) -> Result<(), String> {
    let start = Instant::now();

    while start.elapsed() < duration {
        cancelled(cancel).map_err(|e| e.to_string())?;
        std::thread::sleep(
            duration
                .saturating_sub(start.elapsed())
                .min(Duration::from_millis(50)),
        );
    }

    Ok(())
}

fn lifetime(data: &Value, key: &str) -> Result<Option<u64>, String> {
    if data[key].is_null() {
        return Ok(None);
    }

    let seconds = data[key]
        .as_u64()
        .filter(|n| *n <= 31_536_000)
        .ok_or("Provider returned an invalid token lifetime.")?;

    Ok(Some(now() + seconds * 1000))
}

fn tokens(data: &Value, registration: Registration) -> Result<Credential, String> {
    if data["error"].is_string()
        || !data["token_type"]
            .as_str()
            .is_some_and(|s| s.eq_ignore_ascii_case("bearer"))
    {
        return Err("Provider rejected the OAuth exchange; authorize again.".into());
    }

    let token = Secret::token(
        data["access_token"]
            .as_str()
            .ok_or("Provider returned no access token.")?
            .into(),
        4096,
    )?;

    let refresh_token = if data["refresh_token"].is_null() {
        None
    } else {
        Some(Secret::token(
            data["refresh_token"]
                .as_str()
                .ok_or("Invalid refresh token.")?
                .into(),
            4096,
        )?)
    };

    let scopes = if data["scope"].is_null() {
        None
    } else {
        Some(
            data["scope"]
                .as_str()
                .ok_or("Invalid OAuth scopes.")?
                .split([' ', ','])
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect(),
        )
    };

    Ok(Credential {
        token,
        oauth: Some(OAuth {
            registration,
            refresh_token,
            expires_at: lifetime(data, "expires_in")?,
            refresh_expires_at: lifetime(data, "refresh_token_expires_in")?,
            scopes,
        }),
    })
}

impl Network {
    pub fn authorize(
        &self,
        host: &Host,
        registration: Registration,
        repositories: bool,
        cancel: &Cancellation,
        progress: &dyn Fn(Progress),
    ) -> Result<Credential, String> {
        registration.validate(host.provider)?;
        cancelled(cancel).map_err(|e| e.to_string())?;

        if host.provider == Provider::GitHub {
            self.device(host, registration, repositories, cancel, progress)
        } else {
            self.code(host, registration, repositories, cancel, progress)
        }
    }

    fn device(
        &self,
        host: &Host,
        registration: Registration,
        repositories: bool,
        cancel: &Cancellation,
        progress: &dyn Fn(Progress),
    ) -> Result<Credential, String> {
        let reply = self
            .transport
            .request(
                &host.web("login/device/code"),
                None,
                Some(&[
                    ("client_id", &registration.client_id),
                    (
                        "scope",
                        if repositories {
                            "read:user repo"
                        } else {
                            "read:user"
                        },
                    ),
                ]),
                cancel,
            )
            .map_err(|e| e.to_string())?;

        if reply.status != 200 || !reply.data["error"].is_null() {
            return Err(
                "Device authorization is unavailable. Check the application registration.".into(),
            );
        }

        let data = &reply.data;

        let code = Secret::token(
            data["device_code"]
                .as_str()
                .ok_or("Invalid device authorization.")?
                .into(),
            4096,
        )?;

        let user_code = data["user_code"]
            .as_str()
            .filter(|s| {
                (4..=32).contains(&s.len())
                    && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            })
            .ok_or("Invalid user verification code.")?;

        let verification = host.browser_url(
            data["verification_uri"]
                .as_str()
                .ok_or("Invalid verification URL.")?,
        )?;

        let expires = data["expires_in"]
            .as_u64()
            .filter(|n| (1..=3600).contains(n))
            .ok_or("Invalid device authorization lifetime.")?;

        let mut interval = data["interval"].as_u64().unwrap_or(5);

        if !(1..=60).contains(&interval) {
            return Err("Invalid device authorization interval.".into());
        }

        let deadline = Instant::now() + Duration::from_secs(expires);

        progress(Progress::DeviceCode(user_code.into()));
        progress(Progress::Browser(verification));

        loop {
            wait(
                Duration::from_secs(interval)
                    .min(deadline.saturating_duration_since(Instant::now())),
                cancel,
            )?;

            if Instant::now() >= deadline {
                return Err("Authorization expired. Start sign-in again.".into());
            }

            let reply = self
                .transport
                .request(
                    &host.web("login/oauth/access_token"),
                    None,
                    Some(&[
                        ("client_id", &registration.client_id),
                        ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                        ("device_code", code.expose()),
                    ]),
                    cancel,
                )
                .map_err(|e| e.to_string())?;

            cancelled(cancel).map_err(|e| e.to_string())?;

            if Instant::now() >= deadline {
                return Err("Authorization expired. Start sign-in again.".into());
            }

            match reply.data["error"].as_str() {
                Some("authorization_pending") => continue,
                Some("slow_down") => {
                    interval = interval.saturating_add(5);
                    continue;
                }
                Some(_) => {
                    return Err("Device authorization was denied or expired. Start again.".into());
                }
                None if reply.status == 200 => {
                    progress(Progress::Verifying);

                    return tokens(&reply.data, registration);
                }
                _ => return Err("Provider rejected the device authorization request.".into()),
            }
        }
    }

    fn code(
        &self,
        host: &Host,
        registration: Registration,
        repositories: bool,
        cancel: &Cancellation,
        progress: &dyn Fn(Progress),
    ) -> Result<Credential, String> {
        let redirect = callback(registration.redirect_uri.as_deref().unwrap_or(""))?;
        let listener=TcpListener::bind(("127.0.0.1",redirect.port().expect("validated callback port"))).map_err(|_|"Could not open the local callback port. Close another sign-in attempt or register a different port.")?;

        listener
            .set_nonblocking(true)
            .map_err(|_| "Could not configure the local callback.")?;
        let state = random();
        let verifier = random();
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.expose().as_bytes()));
        let mut authorization = host.web("oauth/authorize");

        authorization.query_pairs_mut().extend_pairs([
            ("client_id", registration.client_id.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("response_type", "code"),
            (
                "scope",
                if repositories {
                    "read_user read_api read_repository"
                } else {
                    "read_user"
                },
            ),
            ("state", state.expose()),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
        ]);
        progress(Progress::Browser(authorization));
        let deadline = Instant::now() + Duration::from_secs(600);

        let code = loop {
            cancelled(cancel).map_err(|e| e.to_string())?;

            if Instant::now() >= deadline {
                return Err("Authorization timed out. Start again.".into());
            }

            match listener.accept() {
                Ok((stream, _)) => {
                    if let Some(code) = receive_callback(stream, &redirect, state.expose(), cancel)?
                    {
                        break code;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    wait(Duration::from_millis(30), cancel)?
                }
                Err(_) => return Err("Could not receive the local sign-in callback.".into()),
            }
        };

        drop(listener);
        progress(Progress::Verifying);
        let reply = self
            .transport
            .request(
                &host.web("oauth/token"),
                None,
                Some(&[
                    ("client_id", &registration.client_id),
                    ("redirect_uri", redirect.as_str()),
                    ("grant_type", "authorization_code"),
                    ("code", code.expose()),
                    ("code_verifier", verifier.expose()),
                ]),
                cancel,
            )
            .map_err(|e| e.to_string())?;

        if reply.status != 200 {
            return Err("Provider rejected the OAuth exchange; authorize again.".into());
        }

        tokens(&reply.data, registration)
    }

    pub fn refresh(
        &self,
        host: &Host,
        oauth: &OAuth,
        cancel: &Cancellation,
    ) -> Result<Credential, String> {
        oauth.registration.validate(host.provider)?;
        let refresh = oauth
            .refresh_token
            .as_ref()
            .ok_or("Reconnect — token expired or invalid")?;

        if oauth.refresh_expires_at.is_some_and(|t| t <= now()) {
            return Err("Reconnect — token expired or invalid".into());
        }

        let endpoint = if host.provider == Provider::GitHub {
            "login/oauth/access_token"
        } else {
            "oauth/token"
        };

        let mut form = vec![
            ("client_id", oauth.registration.client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh.expose()),
        ];

        if let Some(redirect) = &oauth.registration.redirect_uri {
            form.push(("redirect_uri", redirect));
        }

        let reply = self
            .transport
            .request(&host.web(endpoint), None, Some(&form), cancel)
            .map_err(|e| e.to_string())?;

        if reply.status == 400 || reply.status == 401 {
            return Err("Reconnect — token expired or invalid".into());
        }

        if reply.status != 200 {
            return Err(Failure::Network.to_string());
        }

        tokens(&reply.data, oauth.registration.clone())
    }
}

fn receive_callback(
    mut stream: TcpStream,
    redirect: &Url,
    state: &str,
    cancel: &Cancellation,
) -> Result<Option<Secret>, String> {
    stream
        .set_read_timeout(Some(Duration::from_millis(100)))
        .map_err(|_| "Could not read sign-in callback.")?;
    stream
        .set_write_timeout(Some(Duration::from_millis(100)))
        .map_err(|_| "Could not acknowledge sign-in callback.")?;
    let deadline = Instant::now() + Duration::from_secs(1);
    let mut request = zeroize::Zeroizing::new(Vec::new());
    let mut buffer = [0; 1024];

    loop {
        cancelled(cancel).map_err(|e| e.to_string())?;

        if request.len() > 12288 || Instant::now() >= deadline {
            break;
        }

        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => {
                request.extend_from_slice(&buffer[..n]);

                if request.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                continue;
            }
            Err(_) => break,
        }
    }

    let parsed = std::str::from_utf8(&request)
        .ok()
        .and_then(|request| parse_callback(request, redirect, state));

    let valid = parsed.is_some();

    let body = if valid {
        "Return to 1git to finish signing in. You can close this page."
    } else {
        "Invalid authorization callback."
    };

    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
        if valid { "200 OK" } else { "400 Bad Request" },
        body.len()
    );

    let _ = stream.write_all(response.as_bytes());

    parsed.transpose()
}

fn parse_callback(request: &str, redirect: &Url, state: &str) -> Option<Result<Secret, String>> {
    let mut lines = request.split("\r\n");
    let mut parts = lines.next()?.split(' ');

    if parts.next()? != "GET" {
        return None;
    }

    let target = parts.next()?;

    if target.len() > 8192 || !target.starts_with('/') || target.starts_with("//") {
        return None;
    }

    let hosts = lines
        .take_while(|l| !l.is_empty())
        .filter_map(|l| l.split_once(':'))
        .filter(|(n, _)| n.eq_ignore_ascii_case("host"))
        .map(|(_, v)| v.trim())
        .collect::<Vec<_>>();

    if hosts.len() != 1 || hosts[0] != format!("127.0.0.1:{}", redirect.port()?) {
        return None;
    }

    let url = redirect.join(target).ok()?;

    if url.path() != redirect.path()
        || url.origin() != redirect.origin()
        || url.fragment().is_some()
    {
        return None;
    }

    let query = url.query_pairs().collect::<Vec<_>>();

    let states = query
        .iter()
        .filter(|(k, _)| k == "state")
        .map(|(_, v)| v.as_ref())
        .collect::<Vec<_>>();

    if states != [state] {
        return None;
    }

    if query.iter().any(|(k, _)| k == "error") {
        return Some(Err("Authorization was denied. Start sign-in again.".into()));
    }

    let codes = query
        .iter()
        .filter(|(k, _)| k == "code")
        .map(|(_, v)| v.as_ref())
        .collect::<Vec<_>>();

    if codes.len() != 1 {
        return None;
    }

    Some(Secret::token(codes[0].into(), 4096))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_rejects_forgery_duplicates_wrong_origin_and_method() {
        let redirect = callback(CALLBACK).unwrap();

        let request =
            |target: &str, host: &str| format!("GET {target} HTTP/1.1\r\nHost: {host}\r\n\r\n");

        let valid = request("/oauth/callback?state=state&code=fixture", "127.0.0.1:8765");

        assert_eq!(
            parse_callback(&valid, &redirect, "state")
                .unwrap()
                .unwrap()
                .expose(),
            "fixture"
        );

        for target in [
            "/else?state=state&code=x",
            "/oauth/callback?state=wrong&code=x",
            "/oauth/callback?state=state&state=state&code=x",
            "/oauth/callback?state=state&code=x&code=y",
            "//evil.test/oauth/callback?state=state&code=x",
        ] {
            assert!(
                parse_callback(&request(target, "127.0.0.1:8765"), &redirect, "state").is_none()
            );
        }

        assert!(
            parse_callback(
                &request("/oauth/callback?state=state&code=x", "evil.test"),
                &redirect,
                "state"
            )
            .is_none()
        );
        assert!(parse_callback(&valid.replace("GET", "POST"), &redirect, "state").is_none());

        for value in [
            "https://127.0.0.1:8765/x",
            "http://localhost:8765/x",
            "http://0.0.0.0:8765/x",
            "http://127.0.0.1/x",
            "http://127.0.0.1:8765/x?q=1",
        ] {
            assert!(callback(value).is_err());
        }
    }
}

#[cfg(test)]
mod flow_tests {
    use super::*;
    use crate::accounts::http::{Reply, Transport};
    use std::sync::{Arc, Mutex};

    struct Device {
        polls: Mutex<usize>,
        cancel_on_browser: bool,
    }

    impl Transport for Device {
        fn request(
            &self,
            url: &Url,
            _: Option<&str>,
            form: Option<&[(&str, &str)]>,
            _: &Cancellation,
        ) -> Result<Reply, Failure> {
            let form = form.unwrap();

            assert!(
                form.iter()
                    .any(|(k, v)| *k == "client_id" && *v == "public-client")
            );
            let data = if url.path().ends_with("device/code") {
                assert!(form.contains(&("scope", "read:user")));

                serde_json::json!({"device_code":"never-display-device-secret","user_code":"ABCD-EFGH","verification_uri":"https://github.com/login/device","expires_in":30,"interval":1})
            } else {
                *self.polls.lock().unwrap() += 1;
                assert!(form.contains(&("device_code", "never-display-device-secret")));

                serde_json::json!({"access_token":"synthetic-access","token_type":"bearer","expires_in":3600})
            };

            Ok(Reply { status: 200, data })
        }
    }

    #[test]
    fn device_flow_exposes_only_the_user_code_and_cancels_without_saving() {
        for cancel_on_browser in [false, true] {
            let fake = Arc::new(Device {
                polls: Mutex::new(0),
                cancel_on_browser,
            });

            let network = Network {
                transport: fake.clone(),
            };

            let host = Host::new(Provider::GitHub, "https://github.com").unwrap();
            let cancel = Cancellation::default();
            let events = Mutex::new(Vec::new());

            let result = network.authorize(
                &host,
                Registration {
                    client_id: "public-client".into(),
                    redirect_uri: None,
                },
                false,
                &cancel,
                &|p| {
                    events.lock().unwrap().push(format!("{p:?}"));

                    if matches!(p, Progress::Browser(_)) && fake.cancel_on_browser {
                        cancel.cancel();
                    }
                },
            );

            assert!(!events.lock().unwrap().join(" ").contains("never-display"));

            if cancel_on_browser {
                assert!(result.unwrap_err().contains("cancelled"));
                assert_eq!(*fake.polls.lock().unwrap(), 0);
            } else {
                assert_eq!(result.unwrap().token.expose(), "synthetic-access");
                assert_eq!(*fake.polls.lock().unwrap(), 1);
            }
        }
    }

    struct GitLab;

    impl Transport for GitLab {
        fn request(
            &self,
            url: &Url,
            _: Option<&str>,
            form: Option<&[(&str, &str)]>,
            _: &Cancellation,
        ) -> Result<Reply, Failure> {
            assert_eq!(url.as_str(), "https://git.example.test/base/oauth/token");
            let form = form.unwrap();

            assert!(form.contains(&("code", "synthetic-code")));
            assert!(form.contains(&("grant_type", "authorization_code")));
            let verifier = form.iter().find(|(k, _)| *k == "code_verifier").unwrap().1;

            assert!(verifier.len() >= 43);

            Ok(Reply {
                status: 200,
                data: serde_json::json!({"access_token":"synthetic-gitlab","token_type":"bearer","refresh_token":"synthetic-refresh","expires_in":3600}),
            })
        }
    }

    #[test]
    fn gitlab_pkce_binds_loopback_and_exchanges_only_a_matching_state() {
        let port = TcpListener::bind(("127.0.0.1", 0))
            .unwrap()
            .local_addr()
            .unwrap()
            .port();

        let redirect = format!("http://127.0.0.1:{port}/oauth/callback");

        let network = Network {
            transport: Arc::new(GitLab),
        };

        let host = Host::new(Provider::GitLab, "https://git.example.test/base").unwrap();

        let result=network.authorize(&host,Registration{client_id:"public-client".into(),redirect_uri:Some(redirect)},false,&Cancellation::default(),&|p|if let Progress::Browser(url)=p {
            assert_eq!(url.path(),"/base/oauth/authorize");let q=url.query_pairs().collect::<Vec<_>>();

            assert!(q.contains(&("code_challenge_method".into(),"S256".into())));assert!(q.contains(&("scope".into(),"read_user".into())));let state=q.iter().find(|(k,_)|k=="state").unwrap().1.to_string();

            std::thread::spawn(move||{let mut stream=TcpStream::connect(("127.0.0.1",port)).unwrap();

                write!(stream,"GET /oauth/callback?state={state}&code=synthetic-code HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").unwrap();let mut response=String::new();

                stream.read_to_string(&mut response).unwrap();assert!(response.starts_with("HTTP/1.1 200"));});
        }).unwrap();

        assert_eq!(result.token.expose(), "synthetic-gitlab");
    }
}
