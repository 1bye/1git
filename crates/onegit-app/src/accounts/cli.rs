//! Read-only gh account selection. Never switches accounts, signs out or copies CLI tokens to the vault.
use super::model::{Secret, controls};
use onegit_git::Cancellation;
use serde_json::{Value, json};

use std::{
    io::Read,
    path::PathBuf,
    process::{Command, Stdio},
    sync::Arc,
    time::{Duration, Instant},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CliAccount {
    pub host: String,
    pub username: String,
    pub active: bool,
}

impl CliAccount {
    pub fn validate(&self) -> Result<(), String> {
        let host = url::Url::parse(&format!("https://{}/", self.host))
            .map_err(|_| "Invalid GitHub CLI account.")?;

        if !self
            .host
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
            || host.host_str().is_none()
            || host.path() != "/"
            || host.host_str().is_some_and(|s| s.starts_with('-'))
            || host.username() != ""
            || host.password().is_some()
            || self
                .host
                .bytes()
                .any(|b| !b.is_ascii_alphanumeric() && !b".:-".contains(&b))
            || self.username.is_empty()
            || self.username.len() > 100
            || !self.username.as_bytes()[0].is_ascii_alphanumeric()
            || self
                .username
                .bytes()
                .any(|b| !b.is_ascii_alphanumeric() && !b"_-".contains(&b))
        {
            return Err("Invalid GitHub CLI account.".into());
        }

        Ok(())
    }
}

const UNAVAILABLE: &str = "GitHub CLI is unavailable or could not read its credentials. Install or update gh, run gh auth login, then try again.";

pub(crate) trait Run: Send + Sync {
    fn run(&self, args: &[&str], cancel: &Cancellation) -> Result<Secret, String>;
}

struct NativeRun;

impl Run for NativeRun {
    fn run(&self, args: &[&str], cancel: &Cancellation) -> Result<Secret, String> {
        let (success, stdout, stderr) = execute(args, cancel)?;

        if args == ["auth", "status", "--json", "hosts"]
            && !success
            && stderr.expose().contains("unknown flag: --json")
        {
            let (_, stdout, stderr) = execute(&["auth", "status"], cancel)?;

            return legacy(&format!("{}\n{}", stdout.expose(), stderr.expose()))
                .map(Secret::encoded);
        }

        // Status may exit 1 when one account is expired. A recognized JSON list still contains usable entries.
        if success
            || args == ["auth", "status", "--json", "hosts"]
                && serde_json::from_str::<Value>(stdout.expose()).is_ok()
        {
            Ok(stdout)
        } else {
            Err(UNAVAILABLE.into())
        }
    }
}

fn execute(args: &[&str], cancel: &Cancellation) -> Result<(bool, Secret, Secret), String> {
    if cancel.is_cancelled() {
        return Err("Account action cancelled.".into());
    }

    let mut paths = std::env::var_os("PATH")
        .map(|p| {
            std::env::split_paths(&p)
                .filter(|p| p.is_absolute())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    paths.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    let executable = paths
        .into_iter()
        .map(|p| p.join(if cfg!(windows) { "gh.exe" } else { "gh" }))
        .find(|p| p.is_file())
        .ok_or(UNAVAILABLE)?;

    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or(UNAVAILABLE)?;

    let mut command = Command::new(executable);

    command
        .args(args)
        .current_dir(home)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("NO_COLOR", "1")
        .env("CLICOLOR", "0");

    for key in [
        "GH_TOKEN",
        "GITHUB_TOKEN",
        "GH_ENTERPRISE_TOKEN",
        "GITHUB_ENTERPRISE_TOKEN",
        "GH_FORCE_TTY",
        "CLICOLOR_FORCE",
    ] {
        command.env_remove(key);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| UNAVAILABLE)?;

    fn collect(pipe: impl Read) -> Result<Secret, String> {
        let mut bytes = zeroize::Zeroizing::new(Vec::new());

        pipe.take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| UNAVAILABLE)?;

        if bytes.len() > 1024 * 1024 {
            return Err(UNAVAILABLE.into());
        }

        std::str::from_utf8(&bytes)
            .map(|s| Secret::encoded(s.into()))
            .map_err(|_| UNAVAILABLE.into())
    }
    let stdout = child.stdout.take().ok_or(UNAVAILABLE)?;
    let stderr = child.stderr.take().ok_or(UNAVAILABLE)?;
    let a = std::thread::spawn(move || collect(stdout));
    let b = std::thread::spawn(move || collect(stderr));
    let started = Instant::now();

    let result = loop {
        if cancel.is_cancelled() || started.elapsed() > Duration::from_secs(15) {
            let _ = child.kill();
            let _ = child.wait();

            break Err(if cancel.is_cancelled() {
                "Account action cancelled."
            } else {
                UNAVAILABLE
            }
            .to_string());
        }

        match child.try_wait() {
            Ok(Some(status)) => break Ok(status.success()),
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();

                break Err(UNAVAILABLE.into());
            }
        }
    };

    let a = a.join().map_err(|_| UNAVAILABLE)?;
    let b = b.join().map_err(|_| UNAVAILABLE)?;

    Ok((result?, a?, b?))
}

#[derive(Clone)]
pub(crate) struct Cli {
    pub run: Arc<dyn Run>,
}

impl Default for Cli {
    fn default() -> Self {
        Self {
            run: Arc::new(NativeRun),
        }
    }
}

impl Cli {
    pub fn accounts(&self, cancel: &Cancellation) -> Result<Vec<CliAccount>, String> {
        let output = self
            .run
            .run(&["auth", "status", "--json", "hosts"], cancel)?;

        let mut value: Value = serde_json::from_str(output.expose()).map_err(|_| UNAVAILABLE)?;

        let result = (|| {
            let hosts = value["hosts"].as_object().ok_or(UNAVAILABLE)?;
            let mut accounts = Vec::new();
            let mut seen = std::collections::HashSet::new();

            for (host, entries) in hosts {
                for entry in entries.as_array().ok_or(UNAVAILABLE)? {
                    if entry["state"].as_str() != Some("success") {
                        continue;
                    }

                    let account = CliAccount {
                        host: host.clone(),
                        username: entry["login"].as_str().ok_or(UNAVAILABLE)?.into(),
                        active: entry["active"].as_bool().ok_or(UNAVAILABLE)?,
                    };

                    account.validate()?;

                    if seen.insert((account.host.to_lowercase(), account.username.to_lowercase())) {
                        accounts.push(account);
                    }
                }
            }

            Ok(accounts)
        })();

        super::model::wipe_json(&mut value);

        result
    }

    pub fn token(&self, account: &CliAccount, cancel: &Cancellation) -> Result<Secret, String> {
        account.validate()?;
        let value = self.run.run(
            &[
                "auth",
                "token",
                "--hostname",
                &account.host,
                "--user",
                &account.username,
            ],
            cancel,
        )?;

        if controls(value.expose().trim()) {
            return Err(UNAVAILABLE.into());
        }

        Secret::token(value.expose().trim().into(), 2048).map_err(|_| UNAVAILABLE.into())
    }
}

fn legacy(output: &str) -> Result<String, String> {
    let mut hosts = serde_json::Map::new();
    let mut pending: Option<(String, String)> = None;
    let mut recognized = output.contains("You are not logged into any GitHub hosts.");

    for line in output.lines() {
        if let Some((_, tail)) = line.split_once(" Logged in to ") {
            let mut words = tail.split_whitespace();
            let host = words.next().ok_or(UNAVAILABLE)?;

            if words.next() != Some("account") {
                return Err(UNAVAILABLE.into());
            }

            let username = words.next().ok_or(UNAVAILABLE)?;

            let account = CliAccount {
                host: host.into(),
                username: username.into(),
                active: false,
            };

            account.validate()?;
            pending = Some((account.host, account.username));
            recognized = true;
        } else if line.contains("Failed to log in to ")
            || line.contains("Timeout trying to log in to ")
        {
            pending = None;
            recognized = true;
        } else if let Some((_, active)) = line.split_once("- Active account: ")
            && let Some((host, login)) = pending.take()
        {
            let active = match active.trim() {
                "true" => true,
                "false" => false,
                _ => return Err(UNAVAILABLE.into()),
            };

            hosts
                .entry(host)
                .or_insert_with(|| json!([]))
                .as_array_mut()
                .ok_or(UNAVAILABLE)?
                .push(json!({"login":login,"active":active,"state":"success"}));
        }
    }

    if !recognized || pending.is_some() {
        return Err(UNAVAILABLE.into());
    }

    Ok(json!({"hosts":hosts}).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture;

    impl Run for Fixture {
        fn run(&self, _: &[&str], _: &Cancellation) -> Result<Secret, String> {
            Ok(Secret::encoded(r#"{"hosts":{"github.com":[{"login":"tester","active":false,"state":"success","token":"never-render"},{"login":"expired","active":true,"state":"error"}]}}"#.into()))
        }
    }

    #[test]
    fn discovers_public_cli_identities_without_exposing_credentials() {
        let cli = Cli {
            run: Arc::new(Fixture),
        };

        let accounts = cli.accounts(&Cancellation::default()).unwrap();

        assert_eq!(
            accounts,
            [CliAccount {
                host: "github.com".into(),
                username: "tester".into(),
                active: false
            }]
        );
        assert!(!format!("{accounts:?}").contains("never-render"));
        let legacy=legacy("github.com\n  ✓ Logged in to github.com account tester (keyring)\n  - Active account: true\n").unwrap();

        assert!(legacy.contains("tester"));
        assert!(!legacy.contains("keyring"));
    }
}
