//! Owns each Git process tree, its pipes, cancellation and bounded output.

use std::ffi::OsString;
use std::fs::File;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use crate::platform;
use crate::{HttpAuthentication, OutputStream, TransferProgress};

const DEFAULT_MAX_OUTPUT_BYTES: usize = 64 * 1024 * 1024;
const TERMINATE_GRACE: Duration = Duration::from_secs(2);
const POLL_INTERVAL: Duration = Duration::from_millis(5);

/// One bounded native helper invocation, without Git arguments or Git-specific environment.
pub struct ToolCommand<'a> {
    /// Executable passed directly to the OS, without a shell.
    pub executable: &'a Path,
    /// Child working directory.
    pub cwd: &'a Path,
    /// Exact arguments, preserving literal OS path bytes.
    pub args: Vec<OsString>,
    /// Literal borrowed bytes pumped to child stdin without shell interpolation or normalization.
    /// The pipe closes after these bytes are consumed; the buffer lives through the call.
    pub stdin: &'a [u8],
    /// Optional cooperative stop, acknowledged after the owned process group is reaped.
    pub cancellation: Option<&'a Cancellation>,
    /// Wall-clock bound, including helpers retaining inherited pipes.
    pub timeout: Duration,
    /// Combined stdout/stderr byte ceiling.
    pub max_output_bytes: usize,
}

impl<'a> ToolCommand<'a> {
    /// Native helper defaults: ten seconds, one MiB of output and closed empty stdin.
    pub fn new(
        executable: &'a Path,
        cwd: &'a Path,
        args: impl IntoIterator<Item = impl Into<OsString>>,
    ) -> Self {
        Self {
            executable,
            cwd,
            args: args.into_iter().map(Into::into).collect(),
            stdin: &[],
            cancellation: None,
            timeout: Duration::from_secs(10),
            max_output_bytes: 1024 * 1024,
        }
    }
}

/// Run a native helper through the same owned pipes/process-tree cleanup used for Git.
/// The existing typed process output and errors are shared; no Git formatting/options,
/// editor, pager, prompt, locale or index overrides are added to this invocation.
pub fn execute_tool(input: ToolCommand<'_>) -> Result<GitOutput, GitError> {
    let process = GitProcess::new(input.executable, input.max_output_bytes);
    let mut command = GitCommand::new(input.cwd, input.args);

    command.cancellation = input.cancellation;
    command.stdin = input.stdin;
    command.timeout = Some(input.timeout);

    process.run_configured(command, false)
}

/// A cooperative stop request. Completion is acknowledged only after process cleanup.
#[derive(Clone, Debug, Default)]
pub struct Cancellation(Arc<AtomicBool>);

impl Cancellation {
    /// Request cancellation of every operation using this handle.
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    /// Whether cancellation has been requested, independent of task completion.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

/// One internal Git invocation. Arguments are passed directly, without a shell.
pub struct GitCommand<'a> {
    /// Repository or operation working directory.
    pub cwd: &'a Path,
    /// Optional opened directory to pin the child working directory across path replacement.
    /// When supplied, `cwd` is a label. Unix uses the descriptor directly; Windows resolves
    /// the handle to a pathname before spawn, leaving a residual rename/replacement race.
    pub directory: Option<&'a File>,
    /// Exact arguments, including option terminators required by the operation.
    pub args: Vec<OsString>,
    /// Binary input; the pipe is closed after all bytes are written.
    pub stdin: &'a [u8],
    /// Optional owned file streamed directly to child stdin from its current offset.
    /// Requires empty `stdin`; cloned descriptors share offsets with their original.
    /// The child consumes this descriptor, avoiding a patch-sized application buffer.
    pub stdin_file: Option<File>,
    /// Per-command temporary index; never mutates the host environment.
    pub index_file: Option<&'a Path>,
    /// Caller-owned output destination. Returned stdout is empty when supplied.
    pub stdout_file: Option<File>,
    /// Optional stop handle; its lifetime spans this blocking invocation.
    pub cancellation: Option<&'a Cancellation>,
    /// Optional wall-clock bound, including helpers that keep inherited pipes open.
    pub timeout: Option<Duration>,
    /// Explicit child-only overrides, also used to isolate fixture configuration.
    pub environment: Vec<(OsString, OsString)>,
    /// One-shot HTTPS credentials, cleared from errors and never stored in this runner.
    pub http_authentication: Option<&'a HttpAuthentication<'a>>,
    /// Ignore inherited Git configuration/templates when cloning with account credentials.
    pub isolate_clone_configuration: bool,
    /// Incremental bounded output; suppressed for authenticated invocations.
    /// Observer panics cannot interrupt owned process cleanup.
    pub on_output: Option<crate::OutputObserver<'a>>,
    /// Sanitized, bounded Git transfer progress from stderr.
    pub on_progress: Option<&'a dyn Fn(TransferProgress)>,
    /// Optional stricter operation cap; cannot increase the runner's captured-output limit.
    pub max_output_bytes: Option<usize>,
}

impl<'a> GitCommand<'a> {
    /// Construct an invocation with closed stdin and normal configured Git helpers.
    pub fn new(cwd: &'a Path, args: impl IntoIterator<Item = impl Into<OsString>>) -> Self {
        Self {
            cwd,
            directory: None,
            args: args.into_iter().map(Into::into).collect(),
            stdin: &[],
            stdin_file: None,
            index_file: None,
            stdout_file: None,
            cancellation: None,
            timeout: None,
            environment: Vec::new(),
            http_authentication: None,
            isolate_clone_configuration: false,
            on_output: None,
            on_progress: None,
            max_output_bytes: None,
        }
    }
}

/// Owned binary-safe output, limited jointly across stdout and stderr.
#[derive(Debug, Default)]
pub struct GitOutput {
    /// Raw stdout, empty when redirected to a caller-owned file.
    pub stdout: Vec<u8>,
    /// Raw stderr; successful commands may still produce diagnostics here.
    pub stderr: Vec<u8>,
}

/// Execution failures preserve their cause or exact Git exit and output.
#[derive(Debug)]
pub enum GitError {
    /// The executable could not be located.
    GitNotFound(io::Error),
    /// Process setup, pipe I/O or child reaping failed.
    Io(io::Error),
    /// Git exited unsuccessfully; callers classify the operation-specific diagnostic.
    CommandFailed {
        /// Exit status, including signal termination on Unix.
        status: ExitStatus,
        /// Collected command output.
        output: GitOutput,
    },
    /// Cancelled and the owned process group has been terminated and reaped.
    Cancelled,
    /// Exceeded the requested duration and completed process cleanup.
    TimedOut,
    /// Collected output exceeded its byte limit and completed process cleanup.
    OutputTooLarge {
        /// Maximum combined stdout/stderr bytes.
        limit: usize,
    },
}

impl std::fmt::Display for GitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::GitNotFound(_) => f.write_str("Git is not installed or could not be located"),
            Self::Io(error) => write!(f, "Git process I/O failed: {error}"),
            Self::CommandFailed { status, .. } => write!(f, "Git failed with {status}"),
            Self::Cancelled => f.write_str("Git operation was cancelled"),
            Self::TimedOut => f.write_str("Git operation exceeded its deadline"),
            Self::OutputTooLarge { limit } => write!(f, "Git output exceeded {limit} bytes"),
        }
    }
}

impl std::error::Error for GitError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::GitNotFound(error) | Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<io::Error> for GitError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// Blocking native Git runner. Repository operations own validation above this layer.
/// Cloning copies execution configuration; it does not share or start a child process.
#[derive(Clone)]
pub struct GitProcess {
    executable: PathBuf,
    max_output_bytes: usize,
    environment: Vec<(OsString, OsString)>,
}

impl Default for GitProcess {
    fn default() -> Self {
        Self::new("git", DEFAULT_MAX_OUTPUT_BYTES)
    }
}

impl GitProcess {
    pub(crate) fn output_limit(&self) -> usize {
        self.max_output_bytes
    }

    /// Select the executable and combined captured-output bound. File stdout is not captured.
    pub fn new(executable: impl Into<PathBuf>, max_output_bytes: usize) -> Self {
        Self {
            executable: executable.into(),
            max_output_bytes,
            environment: Vec::new(),
        }
    }

    /// Add child-only configuration shared by this runner's invocations.
    /// Per-command overrides take precedence; prompt/editor safeguards remain enforced.
    #[must_use]
    pub fn with_environment(
        mut self,
        overrides: impl IntoIterator<Item = (OsString, OsString)>,
    ) -> Self {
        self.environment.extend(overrides);

        self
    }

    /// Run without terminal/editor prompts, preserving ordinary repository configuration.
    ///
    /// Cancellation/deadline/overflow sends TERM then KILL to the Unix process group,
    /// or immediate Job Object termination on Windows, where console signalling is unavailable.
    /// This method returns only after the leader is reaped and owned pipes are closed.
    /// Call this from a background worker, never from a GPUI render/event callback.
    pub fn run(&self, input: GitCommand<'_>) -> Result<GitOutput, GitError> {
        self.run_configured(input, true)
    }

    fn run_configured(
        &self,
        input: GitCommand<'_>,
        git_settings: bool,
    ) -> Result<GitOutput, GitError> {
        let max_output_bytes = input
            .max_output_bytes
            .map_or(self.max_output_bytes, |limit| {
                limit.min(self.max_output_bytes)
            });

        if input.cancellation.is_some_and(Cancellation::is_cancelled) {
            return Err(GitError::Cancelled);
        }

        if input.stdin_file.is_some() && !input.stdin.is_empty() {
            return Err(GitError::Io(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Choose either byte input or a streamed input file, not both",
            )));
        }

        let start = Instant::now();
        let mut command = Command::new(&self.executable);

        if git_settings {
            command.args(["-c", "color.ui=false", "-c", "core.quotepath=false"]);
        }

        command
            .args(&input.args)
            .envs(self.environment.iter().map(|(key, value)| (key, value)))
            .envs(input.environment.iter().map(|(key, value)| (key, value)));

        if let Some(auth) = input.http_authentication {
            auth.apply(
                &mut command,
                self.environment
                    .iter()
                    .chain(input.environment.iter())
                    .map(|(k, _)| k.clone()),
                input.isolate_clone_configuration,
            )?;
        }

        if git_settings {
            command
                .env("GIT_EDITOR", "true")
                .env("GIT_PAGER", "cat")
                .env("GIT_SEQUENCE_EDITOR", "true")
                .env("GIT_TERMINAL_PROMPT", "0")
                .env("LANG", "C")
                .env("LC_ALL", "C")
                .env("PAGER", "cat");
        }

        command
            .stdin(input.stdin_file.map_or_else(Stdio::piped, Stdio::from))
            .stdout(input.stdout_file.map_or_else(Stdio::piped, Stdio::from))
            .stderr(Stdio::piped());

        if let Some(index) = input.index_file {
            command.env("GIT_INDEX_FILE", platform::git_native_path(index)?);
        }

        let mut owned = platform::spawn(&mut command, input.cwd, input.directory).map_err(
            |error| match error.kind() {
                io::ErrorKind::NotFound => GitError::GitNotFound(error),
                _ => GitError::Io(error),
            },
        )?;

        let mut stdin = owned
            .child
            .stdin
            .take()
            .map(platform::input_pipe)
            .transpose()?;

        let mut stdout = owned
            .child
            .stdout
            .take()
            .map(platform::output_pipe)
            .transpose()?;

        let mut stderr = owned
            .child
            .stderr
            .take()
            .map(platform::output_pipe)
            .transpose()?;

        let mut progress = input.on_progress.map(crate::progress::Progress::new);
        let mut output = GitOutput::default();
        let mut written = 0;
        let mut stopped = None;
        let mut stop_time = None;

        loop {
            let previous_stdout = output.stdout.len();
            let previous_stderr = output.stderr.len();
            let previous_bytes = written + previous_stdout + previous_stderr;

            let reason = if input.cancellation.is_some_and(Cancellation::is_cancelled) {
                Some(GitError::Cancelled)
            } else if input.timeout.is_some_and(|limit| start.elapsed() >= limit) {
                Some(GitError::TimedOut)
            } else {
                None
            };

            if stopped.is_none() {
                stopped = reason;
            }

            if stopped.is_none() {
                pump_stdin(&mut stdin, input.stdin, &mut written)?;

                let available = max_output_bytes - output.stdout.len() - output.stderr.len();

                if !pump_output(&mut stdout, &mut output.stdout, available)? {
                    stopped = Some(GitError::OutputTooLarge {
                        limit: max_output_bytes,
                    });
                }

                let available = max_output_bytes - output.stdout.len() - output.stderr.len();

                if !pump_output(&mut stderr, &mut output.stderr, available)? {
                    stopped = Some(GitError::OutputTooLarge {
                        limit: max_output_bytes,
                    });
                }
            }

            if let Some(parser) = progress.as_mut() {
                parser.write(&output.stderr[previous_stderr..]);
            }

            if input.http_authentication.is_none()
                && let Some(observer) = input.on_output
            {
                for (stream, bytes) in [
                    (OutputStream::Stdout, &output.stdout[previous_stdout..]),
                    (OutputStream::Stderr, &output.stderr[previous_stderr..]),
                ] {
                    if !bytes.is_empty() {
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            observer(stream, bytes)
                        }));
                    }
                }
            }

            if stopped.is_some() {
                if !platform::GRACEFUL_TERMINATION {
                    owned.signal(platform::Signal::Kill);
                }

                stdin.take();
                stdout.take();
                stderr.take();

                let began = *stop_time.get_or_insert_with(|| {
                    owned.signal(platform::Signal::Terminate);

                    Instant::now()
                });

                if !platform::GRACEFUL_TERMINATION || began.elapsed() >= TERMINATE_GRACE {
                    owned.signal(platform::Signal::Kill);
                }

                // Keep the leader unreaped during the grace period so its group ID cannot be reused.
                if platform::GRACEFUL_TERMINATION && began.elapsed() < TERMINATE_GRACE {
                    thread::sleep(POLL_INTERVAL);

                    continue;
                }
            }

            if stdin.is_none()
                && stdout.is_none()
                && stderr.is_none()
                && let Some(status) = owned.child.try_wait()?
            {
                owned.finish(stopped.is_none())?;

                if let Some(parser) = progress.as_mut() {
                    parser.finish();
                }

                let result = match stopped {
                    Some(error) => Err(error),
                    None if status.success() => Ok(output),
                    None => Err(GitError::CommandFailed { status, output }),
                };

                return result.map_err(|error| {
                    if input.http_authentication.is_some() {
                        crate::authentication::sanitized(error)
                    } else {
                        error
                    }
                });
            }

            if written + output.stdout.len() + output.stderr.len() == previous_bytes {
                thread::sleep(POLL_INTERVAL);
            }
        }
    }
}

fn pump_stdin<W: Write>(pipe: &mut Option<W>, bytes: &[u8], written: &mut usize) -> io::Result<()> {
    if *written == bytes.len() {
        pipe.take();

        return Ok(());
    }

    if let Some(writer) = pipe {
        match writer.write(&bytes[*written..]) {
            Ok(count) => *written += count,
            Err(error) if error.kind() == io::ErrorKind::BrokenPipe => {
                pipe.take();
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }

    Ok(())
}

/// Read at most one chunk per turn so a noisy stream cannot starve cancellation or the other pipe.
fn pump_output<R: Read>(
    pipe: &mut Option<R>,
    output: &mut Vec<u8>,
    available: usize,
) -> io::Result<bool> {
    let Some(reader) = pipe else {
        return Ok(true);
    };

    let mut chunk = [0; 8192];

    match reader.read(&mut chunk) {
        Ok(0) => {
            pipe.take();
        }
        Ok(count) if count > available => return Ok(false),
        Ok(count) => output.extend_from_slice(&chunk[..count]),
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
        Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
        Err(error) => return Err(error),
    }

    Ok(true)
}
