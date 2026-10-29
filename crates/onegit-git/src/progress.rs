//! Bounded transfer progress parsing; untrusted remote text never crosses the observer boundary.
use regex::Regex;
use std::sync::LazyLock;

/// Borrowed output observer; chunks are bounded and valid only during the callback.
pub type OutputObserver<'a> = &'a dyn Fn(OutputStream, &[u8]);

/// Lifecycle phase of a selected-file/line commit transaction.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommitPhase {
    /// Reviewing intent and preparing private indexes.
    Preparing,
    /// Running Git and its hooks/signing helpers.
    Committing,
    /// Reading final state after transaction cleanup.
    Refreshing,
}
/// Borrowed lifecycle event; hook output stays incremental and is never persisted here.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CommitProgress<'a> {
    /// Current transaction phase.
    pub phase: CommitPhase,
    /// Optional raw output chunk; callers own incremental UTF-8 display decoding.
    pub output: Option<&'a [u8]>,
}
/// Borrowed commit observer; each output chunk has its own callback lifetime.
pub type CommitObserver<'a> = &'a dyn for<'chunk> Fn(CommitProgress<'chunk>);

pub(crate) fn commit_event(
    observer: Option<CommitObserver<'_>>,
    phase: CommitPhase,
    output: Option<&[u8]>,
) {
    if let Some(observer) = observer {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            observer(CommitProgress { phase, output })
        }));
    }
}

/// Source of a bounded incremental process-output chunk.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OutputStream {
    /// Standard output.
    Stdout,
    /// Standard error, including Git hook diagnostics.
    Stderr,
}
/// Phase-local transfer state, independent of commit counts or overall completion.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransferPhase {
    /// Establishing a transport connection.
    Connecting,
    /// Counting Git objects.
    Counting,
    /// Compressing Git objects.
    Compressing,
    /// Sending Git objects.
    Sending,
    /// Receiving Git objects.
    Receiving,
    /// Resolving delta objects.
    Resolving,
    /// Confirming remote completion.
    Confirming,
    /// Reading post-operation repository state.
    Refreshing,
}
/// Sanitized progress; percentage describes only the current Git object phase.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TransferProgress {
    /// Recognized phase without raw remote labels.
    pub phase: TransferPhase,
    /// Percentage when Git supplies a valid value; None for indeterminate presentation phases.
    pub percent: Option<u8>,
}
static PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:remote: )?(Counting objects|Compressing objects|Writing objects|Receiving objects|Resolving deltas):\s+(\d{1,3})%\s+\(\d+/\d+\)").expect("literal transfer pattern")
});
pub(crate) struct Progress<'a> {
    observer: &'a dyn Fn(TransferProgress),
    line: Vec<u8>,
    dropping: bool,
    previous: Option<TransferProgress>,
}
impl<'a> Progress<'a> {
    pub(crate) fn new(observer: &'a dyn Fn(TransferProgress)) -> Self {
        Self {
            observer,
            line: Vec::new(),
            dropping: false,
            previous: None,
        }
    }
    pub(crate) fn write(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            if matches!(byte, b'\r' | b'\n') {
                if !self.dropping {
                    self.report();
                }
                self.line.clear();
                self.dropping = false;
            } else if !self.dropping {
                if self.line.len() == 1024 {
                    self.line.clear();
                    self.dropping = true;
                } else {
                    self.line.push(byte);
                }
            }
        }
    }
    pub(crate) fn finish(&mut self) {
        self.write(b"\n");
    }
    fn report(&mut self) {
        let Ok(line) = std::str::from_utf8(&self.line) else {
            return;
        };
        let Some(m) = PATTERN.captures(line) else {
            return;
        };
        let Ok(percent) = m[2].parse::<u8>() else {
            return;
        };
        if percent > 100 {
            return;
        }
        let phase = match &m[1] {
            "Counting objects" => TransferPhase::Counting,
            "Compressing objects" => TransferPhase::Compressing,
            "Writing objects" => TransferPhase::Sending,
            "Receiving objects" => TransferPhase::Receiving,
            _ => TransferPhase::Resolving,
        };
        let progress = TransferProgress {
            phase,
            percent: Some(percent),
        };
        if self.previous == Some(progress) {
            return;
        }
        self.previous = Some(progress);
        let _ =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| (self.observer)(progress)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fragmented_progress_is_bounded_deduplicated_and_never_reports_remote_secrets() {
        let output = std::cell::RefCell::new(Vec::new());
        let observe = |p| output.borrow_mut().push(p);
        let mut parser = Progress::new(&observe);
        parser.write(b"remote: Receiving obj");
        parser
            .write(b"ects: 25% (1/4) token=secret\rReceiving objects: 25% (1/4)\nremote: secret\n");
        parser.write(&vec![b'x'; 2048]);
        parser.write(b"Receiving objects: 99% (99/100)\n");
        parser.write(b"Writing objects: 101% (1/1)\rResolving deltas: 100% (4/4)");
        parser.finish();
        assert_eq!(
            *output.borrow(),
            [
                TransferProgress {
                    phase: TransferPhase::Receiving,
                    percent: Some(25)
                },
                TransferProgress {
                    phase: TransferPhase::Resolving,
                    percent: Some(100)
                }
            ]
        );
    }
}
