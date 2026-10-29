//! Ordinary transport commands and reviewed, single-destination synchronization/tag writes.
use super::metadata_writes::{before, remote_url, text};

use super::{
    BranchIdentity, BranchKind, OperationState, Repository, RepositoryError, Snapshot, WriteError,
    WritePhase,
};

use crate::validation::{full_oid, require_revision};
use crate::{Cancellation, GitCommand, HttpAuthentication, RecordType, TransferProgress};
use std::ffi::OsString;

/// Network action completed before returning fresh local state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SyncOperation {
    /// Fetch refs without checking out files.
    Fetch,
    /// Pull and integrate on the current branch.
    Pull,
    /// Push refs to a remote.
    Push,
}

/// Actual branch and state after a network command; a later read failure is Refresh.
#[derive(Debug)]
pub struct SyncResult {
    /// Executed operation, independent of UI labels.
    pub operation: SyncOperation,
    /// Explicit remote, or None for Git/all-remotes defaults.
    pub remote: Option<String>,
    /// Current branch after the operation.
    pub branch: Option<String>,
    /// Fresh state; never substitute the pre-operation snapshot after a write.
    pub snapshot: Snapshot,
}

/// Ordinary fetch options, preserving Git's normal credential helpers without account auth.
#[derive(Default)]
pub struct FetchOptions<'a> {
    /// Remote name; None fetches all remotes.
    pub remote: Option<&'a str>,
    /// Prune stale remote-tracking refs.
    pub prune: bool,
    /// Fetch all tags.
    pub tags: bool,
    /// Optional transient credentials validated against the one resolved fetch URL.
    pub authentication: Option<&'a HttpAuthentication<'a>>,
    /// Sanitized transfer progress, never raw remote text.
    pub on_progress: Option<&'a dyn Fn(TransferProgress)>,
}

impl std::fmt::Debug for FetchOptions<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FetchOptions")
            .field("remote", &self.remote)
            .field("authentication", &self.authentication)
            .finish_non_exhaustive()
    }
}

/// Explicit integration strategy for ordinary pull.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum PullStrategy {
    /// Refuse divergence instead of creating/rebasing commits.
    #[default]
    FastForwardOnly,
    /// Use Git merge semantics.
    Merge,
    /// Use Git rebase semantics.
    Rebase,
}

/// Ordinary pull using configured credentials and hooks.
#[derive(Clone, Copy, Debug, Default)]
pub struct PullOptions<'a> {
    /// Optional remote name.
    pub remote: Option<&'a str>,
    /// Optional branch, requiring an explicit remote.
    pub branch: Option<&'a str>,
    /// Explicit integration strategy.
    pub strategy: PullStrategy,
}

/// Ordinary push; force-with-lease and extra tags require explicit request flags.
#[derive(Clone, Copy, Debug, Default)]
pub struct PushOptions<'a> {
    /// Optional remote name.
    pub remote: Option<&'a str>,
    /// Optional branch/refspec, requiring an explicit remote.
    pub branch: Option<&'a str>,
    /// Explicit force-with-lease, never unconditional force.
    pub force_with_lease: bool,
    /// Include tags in this ordinary lower-level push.
    pub tags: bool,
    /// Establish tracking, requiring an explicit remote.
    pub set_upstream: bool,
}

/// Conservative branch workflow, separate from ordinary configurable pull/push.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SyncKind {
    /// Clean-worktree fast-forward-only pull.
    Pull,
    /// Push the reviewed commit to its exact upstream ref.
    Push,
    /// Publish a branch without existing tracking and establish its upstream.
    Publish,
}

/// Frozen branch review; callers retain the owner until command cleanup completes.
pub struct SyncBranch<'a> {
    /// Conservative operation requested by the user.
    pub kind: SyncKind,
    /// Exact reviewed HEAD and named branch.
    pub expected: &'a BranchIdentity,
    /// Exact configured remote name.
    pub remote: &'a str,
    /// Full destination refs/heads name, never inferred from a display label.
    pub remote_ref: &'a str,
    /// Optional one-shot credentials for the freshly resolved single URL.
    pub authentication: Option<&'a HttpAuthentication<'a>>,
    /// Sanitized phase-local progress.
    pub on_progress: Option<&'a dyn Fn(TransferProgress)>,
}

impl std::fmt::Debug for SyncBranch<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SyncBranch")
            .field("kind", &self.kind)
            .field("expected", &self.expected)
            .field("remote", &self.remote)
            .field("remote_ref", &self.remote_ref)
            .finish_non_exhaustive()
    }
}

/// Reviewed annotated release-tag creation, never force replacement.
#[derive(Clone, Copy, Debug)]
pub struct CreateReleaseTag<'a> {
    /// Valid Git tag name.
    pub name: &'a str,
    /// Nonblank annotation, retaining configured signing.
    pub message: &'a str,
    /// Exact reachable commit object.
    pub commit: &'a str,
    /// Reviewed source branch/HEAD; detached tagging is supported.
    pub expected: &'a BranchIdentity,
}

/// Frozen single-tag publication to one freshly validated remote URL.
#[derive(Clone, Copy, Debug)]
pub struct PushTag<'a> {
    /// Selected local tag name.
    pub name: &'a str,
    /// Reviewed tag object ID.
    pub expected_oid: &'a str,
    /// Reviewed peeled/direct target object ID.
    pub expected_target: &'a str,
    /// Configured remote name.
    pub remote: &'a str,
    /// Exact effective single push URL captured during review.
    pub expected_url: &'a str,
    /// Reviewed current HEAD/branch; detached tagging is supported.
    pub expected: &'a BranchIdentity,
    /// Optional one-shot account authentication for that exact URL.
    pub authentication: Option<&'a HttpAuthentication<'a>>,
}

/// Confirmed Git push plus refreshed local state; remote writes are never automatically retried.
#[derive(Debug)]
pub struct TagPushResult {
    /// Pushed local tag name.
    pub name: String,
    /// Exact tag object sent.
    pub oid: String,
    /// Reviewed remote name.
    pub remote: String,
    /// Fresh repository state.
    pub snapshot: Snapshot,
}

impl Repository {
    /// Fetch selected/all remotes; transient credentials require one exact HTTPS fetch URL.
    pub fn fetch(
        &self,
        options: FetchOptions<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<SyncResult, WriteError> {
        self.mutate(cancellation, || {
            let mut args = vec!["fetch".to_owned()];

            if options.on_progress.is_some() {
                args.push("--progress".into());
            }

            if options.prune {
                args.push("--prune".into());
            }

            if options.tags {
                args.push("--tags".into());
            }

            if let Some(remote) = options.remote.filter(|r| !r.is_empty()) {
                require_revision(remote).map_err(before)?;
                args.push(remote.into());
            } else {
                args.push("--all".into());
            }

            if let Some(auth) = options.authentication {
                let remotes = self.remotes_uncoordinated(cancellation).map_err(before)?;

                let urls = remotes
                    .iter()
                    .find(|r| Some(r.name.as_str()) == options.remote)
                    .map(|r| r.fetch_urls.as_slice())
                    .unwrap_or(&[]);

                auth.validate_for(urls).map_err(before)?;
                args.insert(1, "--recurse-submodules=no".into());
            }

            self.transport(
                args,
                options.authentication,
                options.on_progress,
                cancellation,
            )?;

            self.sync_result(SyncOperation::Fetch, options.remote, cancellation)
        })
    }

    /// Ordinary pull with explicit strategy and Git-owned credentials/hooks.
    pub fn pull(
        &self,
        options: PullOptions<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<SyncResult, WriteError> {
        self.mutate(cancellation, || {
            let flag = match options.strategy {
                PullStrategy::FastForwardOnly => "--ff-only",
                PullStrategy::Merge => "--no-rebase",
                PullStrategy::Rebase => "--rebase",
            };

            let mut args = vec!["pull", flag];

            transport_selection(&mut args, options.remote, options.branch, false)
                .map_err(before)?;
            self.write_command(args, &[], cancellation)?;

            self.sync_result(SyncOperation::Pull, options.remote, cancellation)
        })
    }

    /// Ordinary push retaining explicit force-with-lease, tags and tracking requests.
    pub fn push(
        &self,
        options: PushOptions<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<SyncResult, WriteError> {
        self.mutate(cancellation, || {
            let mut args = vec!["push"];

            if options.force_with_lease {
                args.push("--force-with-lease");
            }

            if options.tags {
                args.push("--tags");
            }

            if options.set_upstream {
                args.push("--set-upstream");
            }

            transport_selection(
                &mut args,
                options.remote,
                options.branch,
                options.set_upstream,
            )
            .map_err(before)?;
            self.write_command(args, &[], cancellation)?;

            self.sync_result(SyncOperation::Push, options.remote, cancellation)
        })
    }

    /// Synchronize only reviewed branch identity/upstream, refusing divergence or ambiguous destinations.
    pub fn sync_branch(
        &self,
        request: SyncBranch<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<SyncResult, WriteError> {
        self.mutate(cancellation, || {
            let snapshot = self.snapshot_uncoordinated(false, cancellation).map_err(before)?;
            let head = &snapshot.status.head;

            if head.oid.is_none()
                || head.branch.is_none()
                || head.is_detached()
                || BranchIdentity::from_snapshot(&snapshot) != *request.expected
            {
                return Err(before(RepositoryError::InvalidInput(
                    "The branch changed or has no commit. Refresh before synchronizing.",
                )));
            }

            if snapshot.operation != OperationState::Normal {
                return Err(before(RepositoryError::Conflict(
                    "Finish the current Git operation before synchronizing.".into(),
                )));
            }

            if request.kind == SyncKind::Pull
                && snapshot.status.files.iter().any(|f| f.record_type != RecordType::Ignored)
            {
                return Err(before(RepositoryError::DirtyWorktree));
            }

            let branches = self.branches_uncoordinated(cancellation).map_err(before)?;
            let remotes = self.remotes_uncoordinated(cancellation).map_err(before)?;

            let branch = branches.branches.iter()
                .find(|branch| branch.kind == BranchKind::Local && Some(&branch.name) == head.branch.as_ref())
                .ok_or_else(|| before(RepositoryError::InvalidInput("The selected branch is unavailable.")))?;

            let remote = remotes.iter().find(|remote| remote.name == request.remote)
                .ok_or_else(|| before(RepositoryError::InvalidInput("The selected remote is unavailable.")))?;

            if Some(&branch.oid) != head.oid.as_ref() || !request.remote_ref.starts_with("refs/heads/") {
                return Err(before(RepositoryError::InvalidInput("The selected remote or branch is unavailable.")));
            }

            if request.kind == SyncKind::Publish {
                if branch.upstream.is_some()
                    || branch.upstream_remote.is_some()
                    || request.remote_ref != format!("refs/heads/{}", branch.name)
                {
                    return Err(before(RepositoryError::InvalidInput("Tracking changed. Reopen the menu before publishing this branch.")));
                }
            } else if branch.upstream_remote.as_deref() != Some(request.remote)
                || branch.upstream_ref.as_deref() != Some(request.remote_ref)
            {
                return Err(before(RepositoryError::InvalidInput("The upstream changed. Reopen the menu before synchronizing.")));
            }

            if request.kind == SyncKind::Pull && branch.ahead > 0 && branch.behind > 0 {
                return Err(before(RepositoryError::Conflict("Branches have diverged. Resolve divergence before pulling; no merge or rebase was started.".into())));
            }

            if request.kind != SyncKind::Pull && remote.push_urls.len() != 1 {
                return Err(before(RepositoryError::InvalidInput("Configure a single push URL before synchronizing.")));
            }

            if let Some(auth) = request.authentication {
                let urls = if request.kind == SyncKind::Pull { &remote.fetch_urls } else { &remote.push_urls };

                auth.validate_for(urls).map_err(before)?;
            }

            self.run(["check-ref-format", request.remote_ref], cancellation).map_err(before)?;
            let operation = if request.kind == SyncKind::Pull { "pull" } else { "push" };
            let mut args: Vec<String>;

            if request.kind == SyncKind::Pull {
                args = ["pull", "--ff-only", "--no-rebase", "--no-autostash", "--recurse-submodules=no", "--", request.remote, request.remote_ref]
                    .into_iter().map(Into::into).collect();
            } else {
                args = vec!["-c".into(), format!("remote.{}.mirror=false", remote.name), "push".into(), "--no-force".into(), "--no-mirror".into(), "--no-follow-tags".into(), "--recurse-submodules=no".into()];

                if request.kind == SyncKind::Publish { args.push("--set-upstream".into()); }

                let source = if request.kind == SyncKind::Publish { &branch.full_name } else { &branch.oid };

                args.extend(["--".into(), remote.name.clone(), format!("{source}:{}", request.remote_ref)]);
            }

            if request.on_progress.is_some() {
                let index = args.iter().position(|arg| arg == operation).expect("known transport command");

                args.insert(index + 1, "--progress".into());
            }

            self.transport(args, request.authentication, request.on_progress, cancellation)?;

            self.sync_result(
                if request.kind == SyncKind::Pull { SyncOperation::Pull } else { SyncOperation::Push },
                Some(request.remote), cancellation,
            )
        })
    }

    /// Create an annotated local tag only for the exact reviewed reachable commit; never replace tags.
    pub fn create_release_tag(
        &self,
        request: &CreateReleaseTag<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.mutate(cancellation, || {
            self.review_tag(request.name, request.expected, cancellation)
                .map_err(before)?;
            text(request.message).map_err(before)?;

            if request.message.trim().is_empty() || !full_oid(request.commit) {
                return Err(before(RepositoryError::InvalidInput(
                    "A tag message and exact commit ID are required.",
                )));
            }

            let object = self
                .run(["cat-file", "-t", request.commit], cancellation)
                .map_err(before)?;

            if object.stdout != b"commit\n"
                || !self
                    .is_ancestor(
                        request.commit,
                        request.expected.oid.as_deref().unwrap_or(""),
                        cancellation,
                    )
                    .map_err(before)?
            {
                return Err(before(RepositoryError::InvalidInput(
                    "Select an exact commit from the reviewed History before tagging.",
                )));
            }

            if self
                .tags_uncoordinated(cancellation)
                .map_err(before)?
                .iter()
                .any(|t| t.name == request.name)
            {
                return Err(before(RepositoryError::InvalidInput(
                    "A tag with this name already exists. Existing tags are never replaced.",
                )));
            }

            self.review_tag(request.name, request.expected, cancellation)
                .map_err(before)?;
            self.write_command(
                ["tag", "-a", "-F", "-", "--", request.name, request.commit],
                format!("{}\n", request.message).as_bytes(),
                cancellation,
            )?;

            self.written_snapshot(cancellation)
        })
    }

    /// Push exactly one reviewed tag object/ref to one exact destination, without force or extra refs.
    pub fn push_tag(
        &self,
        request: PushTag<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<TagPushResult, WriteError> {
        self.mutate(cancellation, || {
            self.review_tag(request.name, request.expected, cancellation)
                .map_err(before)?;
            let tags = self.tags_uncoordinated(cancellation).map_err(before)?;
            let remotes = self.remotes_uncoordinated(cancellation).map_err(before)?;

            let tag = tags
                .iter()
                .find(|t| t.name == request.name)
                .ok_or_else(|| before(RepositoryError::InvalidInput("The tag is unavailable.")))?;

            let remote = remotes
                .iter()
                .find(|r| r.name == request.remote)
                .ok_or_else(|| {
                    before(RepositoryError::InvalidInput("The remote is unavailable."))
                })?;

            if tag.oid != request.expected_oid
                || tag.target_oid != request.expected_target
                || remote.push_urls.as_slice() != [request.expected_url]
            {
                return Err(before(RepositoryError::InvalidInput(
                    "The tag or remote destination changed. Refresh and review before pushing.",
                )));
            }

            remote_url(request.expected_url).map_err(before)?;

            if let Some(auth) = request.authentication {
                auth.validate_for(&remote.push_urls).map_err(before)?;
            }

            let destination =
                transport_destination(&self.info.root, request.expected_url).map_err(before)?;

            let args: Vec<OsString> = vec![
                "push".into(),
                "--no-force".into(),
                "--no-mirror".into(),
                "--no-follow-tags".into(),
                "--recurse-submodules=no".into(),
                "--".into(),
                destination,
                format!("{}:refs/tags/{}", tag.oid, tag.name).into(),
            ];

            self.transport(args, request.authentication, None, cancellation)?;

            Ok(TagPushResult {
                name: tag.name.clone(),
                oid: tag.oid.clone(),
                remote: remote.name.clone(),
                snapshot: self.written_snapshot(cancellation)?,
            })
        })
    }

    fn review_tag(
        &self,
        name: &str,
        expected: &BranchIdentity,
        cancellation: Option<&Cancellation>,
    ) -> Result<(), RepositoryError> {
        let snapshot = self.snapshot_uncoordinated(false, cancellation)?;

        if expected.oid.is_none()
            || BranchIdentity::from_snapshot(&snapshot) != *expected
            || snapshot.operation != OperationState::Normal
        {
            return Err(RepositoryError::InvalidInput(
                "The repository changed or has a Git operation in progress. Refresh and review the tag again.",
            ));
        }

        require_revision(name)?;
        self.run(
            ["check-ref-format", &format!("refs/tags/{name}")],
            cancellation,
        )?;

        Ok(())
    }

    fn transport(
        &self,
        args: impl IntoIterator<Item = impl Into<OsString>>,
        authentication: Option<&HttpAuthentication<'_>>,
        progress: Option<&dyn Fn(TransferProgress)>,
        cancellation: Option<&Cancellation>,
    ) -> Result<(), WriteError> {
        super::check_cancelled(cancellation).map_err(before)?;
        self.check_write_identity().map_err(before)?;
        let mut command = GitCommand::new(&self.info.root, args);

        command.directory = Some(&self.root_directory);
        command.cancellation = cancellation;
        command.http_authentication = authentication;
        command.on_progress = progress;
        self.process.run(command).map_err(|error| WriteError {
            phase: WritePhase::Command,
            error: error.into(),
        })?;

        Ok(())
    }

    fn sync_result(
        &self,
        operation: SyncOperation,
        remote: Option<&str>,
        cancellation: Option<&Cancellation>,
    ) -> Result<SyncResult, WriteError> {
        let snapshot = self.written_snapshot(cancellation)?;

        Ok(SyncResult {
            operation,
            remote: remote.map(Into::into),
            branch: snapshot.status.head.branch.clone(),
            snapshot,
        })
    }
}

fn transport_selection<'a>(
    args: &mut Vec<&'a str>,
    remote: Option<&'a str>,
    branch: Option<&'a str>,
    set_upstream: bool,
) -> Result<(), RepositoryError> {
    if let Some(remote) = remote.filter(|r| !r.is_empty()) {
        require_revision(remote)?;
        args.push(remote);

        if let Some(branch) = branch.filter(|b| !b.is_empty()) {
            require_revision(branch)?;
            args.push(branch);
        }
    } else if branch.is_some_and(|b| !b.is_empty()) || set_upstream {
        return Err(RepositoryError::InvalidInput(
            "A branch or setUpstream requires an explicit remote.",
        ));
    }

    Ok(())
}

fn transport_destination(root: &std::path::Path, url: &str) -> Result<OsString, RepositoryError> {
    let colon = url.find(':');
    let slash = url.find('/');

    if url.contains("://") || colon.is_some_and(|i| slash.is_none_or(|s| i < s)) {
        Ok(url.into())
    } else {
        Ok(crate::platform::git_native_path(&root.join(url))?)
    }
}
