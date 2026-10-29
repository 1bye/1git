//! Reviewed unpublished-history edits built away from the user's files, then installed by ref CAS.
use super::metadata_writes::{before, text};
use super::{
    BranchIdentity, CommitInfo, Repository, RepositoryError, Snapshot, WriteError, WritePhase,
    check_cancelled,
};
use crate::validation::full_oid;
use crate::{Cancellation, GitCommand, GitError};
use std::collections::HashSet;
use std::ffi::OsString;
use std::fs::{self, File};
use std::path::PathBuf;

/// Exact consecutive selected commit IDs, newest first, and reviewed named branch identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoryRange {
    /// At least two distinct full commit IDs, consecutive on one linear history.
    pub commits: Vec<String>,
    /// Captured source HEAD and named branch.
    pub expected: BranchIdentity,
}
/// Reviewed squash intent; message validation is repeated at execution.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SquashCommits {
    /// Newest-first selected range.
    pub range: HistoryRange,
    /// Full replacement message with a nonblank first-line summary.
    pub message: String,
}
/// Reviewed reorder intent; every selected commit appears once, oldest-first in the new order.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReorderCommits {
    /// Newest-first original range.
    pub range: HistoryRange,
    /// Exact permutation in desired oldest-first replay order.
    pub order: Vec<String>,
}
/// Read-only review of selected and later affected commits.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoryRewritePlan {
    /// Selected commits in newest-first source order.
    pub commits: Vec<CommitInfo>,
    /// Later commits in newest-first order, replayed after the new range.
    pub replay: Vec<CommitInfo>,
}
/// Acknowledged rewrite, preserving the original tip and distinguishing refresh/cleanup warnings.
#[derive(Debug)]
pub struct HistoryRewriteResult {
    /// Installed new branch tip.
    pub oid: String,
    /// Durable original tip retained atomically with the branch move.
    pub recovery_ref: String,
    /// Fresh state if readable; absence is accompanied by a warning.
    pub snapshot: Option<Snapshot>,
    /// Post-write cleanup/refresh issue; never automatically retry this result.
    pub warning: Option<String>,
}
/// Reviewed exact ancestor for a files/index-preserving branch reset.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResetCommit {
    /// Full exact ancestor commit ID, excluding the current tip.
    pub target: String,
    /// Captured current named branch and HEAD.
    pub expected: BranchIdentity,
}
/// Read-only count of commits removed by a reviewed soft reset.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResetCommitPlan {
    /// Exact target commit metadata.
    pub target: CommitInfo,
    /// Number of removed commits across all ancestry, excluding the target.
    pub commit_count: u64,
}
/// Acknowledged guarded soft reset; files/index remain unchanged.
#[derive(Debug)]
pub struct ResetCommitResult {
    /// Original tip retained atomically with the branch move.
    pub recovery_ref: String,
    /// Fresh state if readable.
    pub snapshot: Option<Snapshot>,
    /// Post-write cleanup/refresh warning, never permission to automatically retry.
    pub warning: Option<String>,
}

// Preserve the source's bounded rewrite policy, including later replayed commits.
const MAX_REWRITE_COMMITS: usize = 1000;
const COMMIT_CONFIG: &[&str] = &[
    "user.name",
    "user.email",
    "user.signingkey",
    "commit.gpgsign",
    "gpg.format",
    "gpg.program",
    "gpg.ssh.program",
    "gpg.openpgp.program",
    "gpg.x509.program",
];

struct IndexLock {
    path: PathBuf,
    file: File,
    identity: crate::platform::FileIdentity,
    owned: bool,
}
impl IndexLock {
    fn new(repository: &Repository) -> Result<Self, RepositoryError> {
        let path = repository.info.git_directory.join("index.lock");
        let file = crate::platform::create_private_file(&path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                RepositoryError::RepositoryLocked
            } else {
                error.into()
            }
        })?;
        let identity = crate::platform::FileIdentity::from_file(&file)?;
        Ok(Self {
            path,
            file,
            identity,
            owned: true,
        })
    }
    fn verify(&self) -> Result<(), RepositoryError> {
        if crate::platform::FileIdentity::from_file(&self.file)? != self.identity
            || crate::platform::FileIdentity::from_path(&self.path)? != self.identity
            || !fs::symlink_metadata(&self.path)?.is_file()
        {
            return Err(RepositoryError::InvalidInput(
                "The owned index lock changed. Inspect the lock before continuing.",
            ));
        }
        Ok(())
    }
    fn release(&mut self) -> Result<(), RepositoryError> {
        self.verify()?;
        fs::remove_file(&self.path)?;
        self.owned = false;
        Ok(())
    }
}
impl Drop for IndexLock {
    fn drop(&mut self) {
        if self.owned {
            let _ = self.release();
        }
    }
}

impl Repository {
    /// Review a consecutive unpublished squash range without creating a worktree or changing refs.
    pub fn squash_plan(
        &self,
        request: &SquashCommits,
        cancellation: Option<&Cancellation>,
    ) -> Result<HistoryRewritePlan, RepositoryError> {
        self.mutations.wait_for_pending();
        self.review_rewrite(&request.range, None, cancellation)
    }
    /// Review an exact reorder permutation without changing repository data.
    pub fn reorder_plan(
        &self,
        request: &ReorderCommits,
        cancellation: Option<&Cancellation>,
    ) -> Result<HistoryRewritePlan, RepositoryError> {
        self.mutations.wait_for_pending();
        self.review_rewrite(&request.range, Some(&request.order), cancellation)
    }
    /// Squash in a disposable detached worktree; atomically retain the original and move only the reviewed branch.
    /// Hooks/signing run normally; a changed resulting tree or any replay conflict prevents installation.
    pub fn squash_commits(
        &self,
        request: &SquashCommits,
        cancellation: Option<&Cancellation>,
    ) -> Result<HistoryRewriteResult, WriteError> {
        self.mutate(cancellation, || {
            self.rewrite(&request.range, None, Some(&request.message), cancellation)
        })
    }
    /// Replay an exact oldest-first permutation away from the user's files and install only an identical final tree.
    pub fn reorder_commits(
        &self,
        request: &ReorderCommits,
        cancellation: Option<&Cancellation>,
    ) -> Result<HistoryRewriteResult, WriteError> {
        self.mutate(cancellation, || {
            self.rewrite(&request.range, Some(&request.order), None, cancellation)
        })
    }

    fn review_rewrite(
        &self,
        range: &HistoryRange,
        order: Option<&[String]>,
        cancellation: Option<&Cancellation>,
    ) -> Result<HistoryRewritePlan, RepositoryError> {
        if self.info.is_shallow {
            return Err(RepositoryError::InvalidInput(
                "Fetch the full history before rewriting a shallow repository.",
            ));
        }
        let distinct: HashSet<_> = range.commits.iter().collect();
        if range.commits.len() < 2
            || distinct.len() != range.commits.len()
            || !range.commits.iter().all(|id| full_oid(id))
            || !range.expected.oid.as_deref().is_some_and(full_oid)
        {
            return Err(RepositoryError::InvalidInput(
                "Select at least two consecutive commits from History.",
            ));
        }
        if let Some(order) = order
            && (order.len() != range.commits.len()
                || order.iter().collect::<HashSet<_>>() != distinct)
        {
            return Err(RepositoryError::InvalidInput(
                "The new order must contain each selected commit exactly once.",
            ));
        }
        self.review_clean_branch(&range.expected, cancellation)?;
        let oldest = range.commits.last().expect("validated nonempty range");
        let oldest_commit = self.commit_uncoordinated(oldest, cancellation)?;
        let parent = oldest_commit.parent_oids.first();
        if let Some(order) = order
            && parent.is_none()
            && order.first() != Some(oldest)
        {
            return Err(RepositoryError::InvalidInput(
                "The root commit must stay first. Reorder the commits after it instead.",
            ));
        }
        let head = range.expected.oid.as_deref().expect("reviewed HEAD");
        let revision = parent.map_or_else(|| head.to_owned(), |p| format!("{p}..{head}"));
        let output = self.run(
            [
                "-c",
                "log.showSignature=false",
                "log",
                "--no-notes",
                "--no-decorate",
                &format!("--max-count={}", MAX_REWRITE_COMMITS + 1),
                &format!("--format={}", super::history::HISTORY_FORMAT),
                &revision,
                "--",
            ],
            cancellation,
        )?;
        let affected = super::history::parse_history(&output.stdout)?;
        if affected.len() > MAX_REWRITE_COMMITS {
            return Err(RepositoryError::InvalidInput(
                "This rewrite is too large. Use an external Git tool.",
            ));
        }
        let published = self.run(
            [
                "for-each-ref",
                &format!("--contains={oldest}"),
                "--format=%(refname)",
                "refs/remotes/",
            ],
            cancellation,
        )?;
        if !published.stdout.iter().all(u8::is_ascii_whitespace) {
            return Err(RepositoryError::InvalidInput(
                "These commits are published according to known remote branches. Fetch first if another tool may have pushed; only unpublished history can be rewritten.",
            ));
        }
        let tree = self.run(["ls-tree", "-r", head], cancellation)?;
        if tree
            .stdout
            .split(|b| *b == b'\n')
            .any(|line| line.starts_with(b"160000 "))
        {
            return Err(RepositoryError::InvalidInput(
                "Repositories with submodules require an external Git tool for history rewriting.",
            ));
        }
        let offset = affected
            .iter()
            .position(|c| Some(&c.oid) == range.commits.first())
            .ok_or(RepositoryError::InvalidInput(
                "Select consecutive commits on the current branch, newest first.",
            ))?;
        let selected = affected.get(offset..offset + range.commits.len()).ok_or(
            RepositoryError::InvalidInput(
                "Select consecutive commits on the current branch, newest first.",
            ),
        )?;
        if affected.first().map(|c| c.oid.as_str()) != Some(head)
            || affected.last().map(|c| &c.oid) != Some(oldest)
            || selected.iter().map(|c| &c.oid).ne(range.commits.iter())
            || affected.iter().enumerate().any(|(i, c)| {
                c.parent_oids.len() > 1
                    || affected
                        .get(i + 1)
                        .is_some_and(|next| c.parent_oids.first() != Some(&next.oid))
            })
        {
            return Err(RepositoryError::InvalidInput(
                "Select consecutive commits in linear history without merge commits.",
            ));
        }
        Ok(HistoryRewritePlan {
            commits: selected.to_vec(),
            replay: affected[..offset].to_vec(),
        })
    }

    fn rewrite(
        &self,
        range: &HistoryRange,
        order: Option<&[String]>,
        message: Option<&str>,
        cancellation: Option<&Cancellation>,
    ) -> Result<HistoryRewriteResult, WriteError> {
        let plan = self
            .review_rewrite(range, order, cancellation)
            .map_err(before)?;
        if let Some(message) = message {
            text(message).map_err(before)?;
            if message.lines().next().is_none_or(|s| s.trim().is_empty()) {
                return Err(before(RepositoryError::InvalidInput(
                    "A first-line summary is required.",
                )));
            }
        }
        if let Some(order) = order
            && order.iter().eq(range.commits.iter().rev())
        {
            return Err(before(RepositoryError::InvalidInput(
                "Choose a different commit order first.",
            )));
        }
        let action = if order.is_some() { "reorder" } else { "squash" };
        let oldest = plan.commits.last().expect("validated selected range");
        let newest = &plan.commits[0];
        let mut lock = IndexLock::new(self).map_err(before)?;
        let id = super::mutations::recovery_id().map_err(before)?;
        let recovery_ref = format!("refs/1git/{action}/{id}");
        let mut temporary = None;
        let mut worktree = None;
        let mut installed = None;
        let mut warning = None;
        let built = (|| -> Result<(), WriteError> {
            let config = self.rewrite_configuration(cancellation).map_err(before)?;
            let directory = tempfile::Builder::new()
                .prefix(&format!("1git-{action}-"))
                .tempdir()
                .map_err(before)?;
            let scratch = directory.path().join("worktree");
            temporary = Some(directory);
            worktree = Some(scratch.clone());
            let destination = crate::platform::git_native_path(&scratch).map_err(before)?;
            let base = if order.is_some() {
                oldest.parent_oids.first().unwrap_or(&oldest.oid)
            } else {
                &oldest.oid
            };
            self.run(
                vec![
                    OsString::from("worktree"),
                    "add".into(),
                    "--detach".into(),
                    "--".into(),
                    destination,
                    base.into(),
                ],
                cancellation,
            )
            .map_err(before)?;
            let run = |args: Vec<OsString>, input: &[u8]| -> Result<Vec<u8>, WriteError> {
                let mut command = GitCommand::new(&scratch, config.iter().cloned().chain(args));
                command.stdin = input;
                command.cancellation = cancellation;
                self.process
                    .run(command)
                    .map(|o| o.stdout)
                    .map_err(|e| WriteError {
                        phase: WritePhase::BeforeCommand,
                        error: e.into(),
                    })
            };
            if let Some(message) = message {
                run(
                    vec![
                        "read-tree".into(),
                        "--reset".into(),
                        "-u".into(),
                        newest.oid.clone().into(),
                    ],
                    &[],
                )?;
                run(
                    vec![
                        "commit".into(),
                        "--amend".into(),
                        "--allow-empty".into(),
                        "-F".into(),
                        "-".into(),
                    ],
                    format!("{message}\n").as_bytes(),
                )?;
            }
            let selected = order
                .map(|o| {
                    if oldest.parent_oids.is_empty() {
                        &o[1..]
                    } else {
                        o
                    }
                })
                .unwrap_or(&[]);
            for id in selected
                .iter()
                .map(String::as_str)
                .chain(plan.replay.iter().rev().map(|c| c.oid.as_str()))
            {
                run(
                    vec![
                        "cherry-pick".into(),
                        "--allow-empty".into(),
                        "--keep-redundant-commits".into(),
                        id.into(),
                    ],
                    &[],
                )?;
            }
            let oid =
                one_line(&run(vec!["rev-parse".into(), "HEAD".into()], &[])?).map_err(before)?;
            let final_tree = run(vec!["rev-parse".into(), "HEAD^{tree}".into()], &[])?;
            let original_tree = self
                .run(
                    [
                        "rev-parse",
                        &format!(
                            "{}^{{tree}}",
                            range.expected.oid.as_deref().expect("reviewed HEAD")
                        ),
                    ],
                    cancellation,
                )
                .map_err(before)?
                .stdout;
            if !full_oid(&oid) || final_tree != original_tree {
                return Err(before(RepositoryError::InvalidInput(
                    "Hooks or replay changed the resulting files. Rewrite was not installed; your branch and working files are unchanged.",
                )));
            }
            self.review_rewrite(range, order, cancellation)
                .map_err(before)?;
            lock.verify().map_err(before)?;
            self.install_history(&range.expected, &oid, &recovery_ref, cancellation)?;
            installed = Some(oid);
            Ok(())
        })();
        if let Some(path) = worktree {
            let removed = crate::platform::git_native_path(&path)
                .map_err(RepositoryError::Io)
                .and_then(|path| {
                    self.run(
                        vec![
                            "worktree".into(),
                            "remove".into(),
                            "--force".into(),
                            "--".into(),
                            path,
                        ],
                        None,
                    )
                    .map(|_| ())
                });
            if removed.is_err() {
                if let Some(directory) = temporary.take() {
                    let _ = directory.keep();
                }
                warning = Some(format!(
                    "Temporary {action} worktree cleanup failed: {}. Inspect History before retrying.",
                    path.display()
                ));
            }
        }
        if let Some(directory) = temporary
            && let Err(error) = directory.close()
        {
            append_warning(
                &mut warning,
                format!("Temporary rewrite directory cleanup failed: {error}"),
            );
        }
        if let Err(error) = lock.release() {
            append_warning(
                &mut warning,
                format!(
                    "Could not release owned index lock: {error}. Inspect History and the lock before continuing."
                ),
            );
        }
        if let Err(error) = built {
            if let Some(warning) = warning {
                return Err(WriteError {
                    phase: error.phase,
                    error: RepositoryError::Conflict(format!("{}; {warning}", error.error)),
                });
            }
            return Err(error);
        }
        let oid = installed.ok_or_else(|| {
            before(RepositoryError::InvalidInput(
                "Rewrite outcome is uncertain. Refresh History before retrying.",
            ))
        })?;
        let snapshot = self.history_refresh(&range.expected, &oid, &recovery_ref, &mut warning);
        Ok(HistoryRewriteResult {
            oid,
            recovery_ref,
            snapshot,
            warning,
        })
    }

    fn rewrite_configuration(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<OsString>, RepositoryError> {
        let read = |key: &str, path: bool| -> Result<Option<String>, RepositoryError> {
            let mut args = vec!["config"];
            if path {
                args.push("--path");
            }
            args.extend(["--get", key]);
            match self.run(args, cancellation) {
                Ok(output) => Ok(Some(
                    String::from_utf8(output.stdout)
                        .map_err(|_| RepositoryError::InvalidOutput)?
                        .trim_end_matches('\n')
                        .trim_end_matches('\r')
                        .into(),
                )),
                Err(RepositoryError::Git(GitError::CommandFailed { status, .. }))
                    if status.code() == Some(1) =>
                {
                    Ok(None)
                }
                Err(e) => Err(e),
            }
        };
        let hooks = read("core.hooksPath", true)?;
        let mut hook_arg = OsString::from("core.hooksPath=");
        if cfg!(windows)
            && hooks
                .as_deref()
                .is_some_and(|h| h.eq_ignore_ascii_case("NUL"))
        {
            // Git's null-device sentinel disables hooks; it is not a native directory.
            hook_arg.push("NUL");
        } else {
            let hooks = hooks.map_or_else(
                || self.info.common_directory.join("hooks"),
                |path| self.info.root.join(path),
            );
            hook_arg.push(crate::platform::git_native_path(&hooks)?);
        }
        let mut args = vec!["-c".into(), hook_arg];
        for key in COMMIT_CONFIG {
            if let Some(value) = read(key, false)? {
                args.extend(["-c".into(), format!("{key}={value}").into()]);
            }
        }
        Ok(args)
    }

    fn install_history(
        &self,
        expected: &BranchIdentity,
        oid: &str,
        recovery_ref: &str,
        cancellation: Option<&Cancellation>,
    ) -> Result<(), WriteError> {
        check_cancelled(cancellation).map_err(before)?;
        self.check_write_identity().map_err(before)?;
        let branch = expected.branch.as_deref().expect("reviewed named branch");
        let head = expected.oid.as_deref().expect("reviewed HEAD");
        let input = format!(
            "start\ncreate {recovery_ref} {head}\nupdate refs/heads/{branch} {oid} {head}\nprepare\ncommit\n"
        );
        // Installation must complete atomically even if the UI cancels after preparation.
        self.write_command(
            ["update-ref", "-m", "1git: rewrite history", "--stdin"],
            input.as_bytes(),
            None,
        )?;
        Ok(())
    }
    fn history_refresh(
        &self,
        expected: &BranchIdentity,
        oid: &str,
        recovery_ref: &str,
        warning: &mut Option<String>,
    ) -> Option<Snapshot> {
        match self
            .check_write_identity()
            .and_then(|()| self.snapshot_uncoordinated(false, None))
        {
            Ok(snapshot) => {
                if snapshot.status.head.oid.as_deref() != Some(oid)
                    || snapshot.status.head.branch != expected.branch
                {
                    append_warning(
                        warning,
                        format!(
                            "History changed externally after installation. Refresh and inspect History. Originals: {recovery_ref}."
                        ),
                    );
                }
                Some(snapshot)
            }
            Err(_) => {
                append_warning(
                    warning,
                    format!(
                        "History edit completed; refresh failed. Refresh History before continuing. Originals: {recovery_ref}."
                    ),
                );
                None
            }
        }
    }

    /// Review an exact ancestor and every removed commit against locally known publication.
    pub fn reset_commit_plan(
        &self,
        request: &ResetCommit,
        cancellation: Option<&Cancellation>,
    ) -> Result<ResetCommitPlan, RepositoryError> {
        self.mutations.wait_for_pending();
        self.review_reset(request, cancellation)
    }
    fn review_reset(
        &self,
        request: &ResetCommit,
        cancellation: Option<&Cancellation>,
    ) -> Result<ResetCommitPlan, RepositoryError> {
        if !full_oid(&request.target) || !request.expected.oid.as_deref().is_some_and(full_oid) {
            return Err(RepositoryError::InvalidInput(
                "Select an exact commit from History.",
            ));
        }
        if self.info.is_shallow {
            return Err(RepositoryError::InvalidInput(
                "Fetch the full history before resetting a shallow repository.",
            ));
        }
        self.review_clean_branch(&request.expected, cancellation)?;
        let head = request.expected.oid.as_deref().expect("reviewed HEAD");
        if request.target == head || !self.is_ancestor(&request.target, head, cancellation)? {
            return Err(RepositoryError::InvalidInput(
                "Select an earlier ancestor of the current branch tip.",
            ));
        }
        let target = self.commit_uncoordinated(&request.target, cancellation)?;
        let count = |unpublished: bool| -> Result<u64, RepositoryError> {
            let exclusion = format!("^{}", request.target);
            let mut args = vec!["rev-list", "--count", head, &exclusion];
            if unpublished {
                args.extend(["--not", "--remotes"]);
            }
            one_line(&self.run(args, cancellation)?.stdout)?
                .parse::<u64>()
                .ok()
                .filter(|n| *n <= 9_007_199_254_740_991)
                .ok_or(RepositoryError::InvalidOutput)
        };
        let commit_count = count(false)?;
        if target.oid != request.target || commit_count == 0 {
            return Err(RepositoryError::InvalidInput(
                "Select an exact earlier commit from History.",
            ));
        }
        if count(true)? != commit_count {
            return Err(RepositoryError::InvalidInput(
                "Later commits are published according to known remote branches. Only unpublished commits can be reset.",
            ));
        }
        Ok(ResetCommitPlan {
            target,
            commit_count,
        })
    }
    /// Retain the original tip and soft-reset only the reviewed branch atomically, preserving all files/index bytes.
    pub fn reset_to_commit(
        &self,
        request: &ResetCommit,
        cancellation: Option<&Cancellation>,
    ) -> Result<ResetCommitResult, WriteError> {
        self.mutate(cancellation,|| {
            let mut lock=IndexLock::new(self).map_err(before)?;
            self.review_reset(request,cancellation).map_err(before)?;lock.verify().map_err(before)?;
            let id=super::mutations::recovery_id().map_err(before)?;let recovery_ref=format!("refs/1git/reset/{id}");
            self.install_history(&request.expected,&request.target,&recovery_ref,cancellation)?;
            let mut warning=None;if let Err(e)=lock.release() {append_warning(&mut warning,format!("Could not release index lock: {e}. Inspect History and the lock before continuing."));}
            let snapshot=self.history_refresh(&request.expected,&request.target,&recovery_ref,&mut warning);
            Ok(ResetCommitResult {recovery_ref,snapshot,warning})
        })
    }
}
fn one_line(bytes: &[u8]) -> Result<String, RepositoryError> {
    let s = std::str::from_utf8(bytes)
        .map_err(|_| RepositoryError::InvalidOutput)?
        .trim();
    if s.is_empty() || s.contains(['\n', '\r', '\0']) {
        return Err(RepositoryError::InvalidOutput);
    }
    Ok(s.into())
}
fn append_warning(warning: &mut Option<String>, message: String) {
    if let Some(previous) = warning {
        previous.push(' ');
        previous.push_str(&message);
    } else {
        *warning = Some(message);
    }
}
