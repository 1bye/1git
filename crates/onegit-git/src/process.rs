//! Owns each Git process group, its pipes, cancellation and bounded output.

use std::ffi::OsString;
use std::fs::File;
use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

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

/// Run a native helper through the same owned pipes/process-group cleanup used for Git.
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
#[derive(Clone, Default)]
pub struct Cancellation(Arc<AtomicBool>);

impl Cancellation {
    /// Request cancellation of every operation using this handle.
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    /// Whether cancellation has been requested, independent of task completion.
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

/// One internal Git invocation. Arguments are passed directly, without a shell.
pub struct GitCommand<'a> {
    /// Repository or operation working directory.
    pub cwd: &'a Path,
    /// Optional opened directory to pin the child working directory across path replacement.
    /// When supplied, `cwd` is a label; the child uses this descriptor instead of looking it up.
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

/// Blocking POSIX Git runner. Repository operations own validation above this layer.
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
    pub fn with_environment(
        mut self,
        overrides: impl IntoIterator<Item = (OsString, OsString)>,
    ) -> Self {
        self.environment.extend(overrides);

        self
    }

    /// Run without terminal/editor prompts, preserving ordinary repository configuration.
    ///
    /// Cancellation/deadline/overflow sends TERM then KILL to the private process group.
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
            .envs(input.environment);

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
            .process_group(0)
            .stdin(input.stdin_file.map_or_else(Stdio::piped, Stdio::from))
            .stdout(input.stdout_file.map_or_else(Stdio::piped, Stdio::from))
            .stderr(Stdio::piped());

        // The child remaps stdin/stdout/stderr before pre_exec. Duplicate above those
        // descriptors even if the caller opened its directory while standard I/O was closed.
        let pinned_directory = input.directory.map(duplicate_directory).transpose()?;

        if let Some(directory) = pinned_directory.as_ref() {
            let descriptor = directory.as_raw_fd();

            // SAFETY: the borrowed File stays open through spawn. fchdir is async-signal-safe,
            // and this child-only hook performs no allocation, locking or parent-state mutation.
            unsafe {
                command.pre_exec(move || {
                    if libc::fchdir(descriptor) == -1 {
                        return Err(io::Error::last_os_error());
                    }

                    Ok(())
                });
            }
        } else {
            command.current_dir(input.cwd);
        }

        if let Some(index) = input.index_file {
            command.env("GIT_INDEX_FILE", index);
        }

        let child = command.spawn().map_err(|error| match error.kind() {
            io::ErrorKind::NotFound => GitError::GitNotFound(error),
            _ => GitError::Io(error),
        })?;

        drop(pinned_directory);

        let mut owned = OwnedChild {
            child,
            finished: false,
        };

        let mut stdin = owned.child.stdin.take();
        let mut stdout = owned.child.stdout.take();
        let mut stderr = owned.child.stderr.take();

        for fd in [
            stdin.as_ref().map(AsRawFd::as_raw_fd),
            stdout.as_ref().map(AsRawFd::as_raw_fd),
            stderr.as_ref().map(AsRawFd::as_raw_fd),
        ]
        .into_iter()
        .flatten()
        {
            nonblocking(fd)?;
        }

        let mut output = GitOutput::default();
        let mut written = 0;
        let mut stopped = None;
        let mut stop_time = None;

        loop {
            let previous_bytes = written + output.stdout.len() + output.stderr.len();

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

            if stopped.is_some() {
                stdin.take();
                stdout.take();
                stderr.take();

                let began = *stop_time.get_or_insert_with(|| {
                    owned.signal(libc::SIGTERM);

                    Instant::now()
                });

                if began.elapsed() >= TERMINATE_GRACE {
                    owned.signal(libc::SIGKILL);
                }

                // Keep the leader unreaped during the grace period so its group ID cannot be reused.
                if began.elapsed() < TERMINATE_GRACE {
                    thread::sleep(POLL_INTERVAL);

                    continue;
                }
            }

            if stdin.is_none()
                && stdout.is_none()
                && stderr.is_none()
                && let Some(status) = owned.child.try_wait()?
            {
                owned.finished = true;

                return match stopped {
                    Some(error) => Err(error),
                    None if status.success() => Ok(output),
                    None => Err(GitError::CommandFailed { status, output }),
                };
            }

            if written + output.stdout.len() + output.stderr.len() == previous_bytes {
                thread::sleep(POLL_INTERVAL);
            }
        }
    }
}

fn duplicate_directory(file: &File) -> io::Result<File> {
    // SAFETY: fcntl borrows a live descriptor and atomically creates a distinct owned
    // descriptor >= 3 with close-on-exec. A negative result creates no descriptor.
    let descriptor = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 3) };

    if descriptor == -1 {
        return Err(io::Error::last_os_error());
    }

    // SAFETY: this successful fcntl result has one owner, transferred into File exactly once.
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

struct OwnedChild {
    child: Child,
    finished: bool,
}

impl OwnedChild {
    fn signal(&self, signal: i32) {
        // SAFETY: Command::process_group(0) created this private group; the ID fits pid_t.
        unsafe {
            libc::kill(-(self.child.id() as libc::pid_t), signal);
        }
    }
}

impl Drop for OwnedChild {
    fn drop(&mut self) {
        if !self.finished {
            self.signal(libc::SIGKILL);
            let _ = self.child.wait();
        }
    }
}

fn nonblocking(fd: i32) -> io::Result<()> {
    // SAFETY: fd belongs to a live owned pipe; fcntl changes only its nonblocking flag.
    let result = unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFL);

        if flags < 0 {
            -1
        } else {
            libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK)
        }
    };

    if result < 0 {
        return Err(io::Error::last_os_error());
    }

    Ok(())
}

fn pump_stdin(
    pipe: &mut Option<std::process::ChildStdin>,
    bytes: &[u8],
    written: &mut usize,
) -> io::Result<()> {
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
