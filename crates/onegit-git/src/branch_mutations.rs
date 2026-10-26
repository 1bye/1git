//! Local branch edits and reviewed, stash-backed branch switching under one shared write guard.

use super::{
    BranchCollection, BranchKind, OperationState, Repository, RepositoryError, Snapshot,
    WriteError, WritePhase, check_cancelled,
};

use crate::validation::require_revision;
use crate::{Cancellation, Failure, Operation, RecordType};
use std::ffi::OsString;

#[path = "branch_mutations/changes.rs"]
mod changes;

pub use changes::SavedBranchChanges;

/// Options matching the lower-level Git branch-creation contract.
#[derive(Clone, Copy, Debug)]
pub struct CreateBranch<'a> {
    /// Validated local branch name, never parsed as an option.
    pub name: &'a str,
    /// Optional revision; absence starts from HEAD.
    pub start_point: Option<&'a str>,
    /// Switch to the created branch.
    pub checkout: bool,
    /// Configure direct tracking of the selected start point.
    pub track: bool,
    /// Explicit lower-level permission to replace a branch. The reviewed UI never sets this.
    pub force: bool,
}

impl<'a> CreateBranch<'a> {
    /// Create without switching, tracking or replacing an existing branch.
    pub fn new(name: &'a str) -> Self {
        Self {
            name,
            start_point: None,
            checkout: false,
            track: false,
            force: false,
        }
    }
}

/// Exact source identity reviewed by a branch action or its still-open dialog.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BranchIdentity {
    /// Reviewed commit; None for an unborn repository.
    pub oid: Option<String>,
    /// Reviewed local branch; None for detached HEAD.
    pub branch: Option<String>,
}

impl BranchIdentity {
    /// Freeze the source identity, independently of later workspace refreshes.
    pub fn from_snapshot(snapshot: &Snapshot) -> Self {
        Self {
            oid: snapshot.status.head.oid.clone(),
            branch: snapshot.status.head.branch.clone(),
        }
    }
}

/// Explicit disposition of dirty tracked/untracked work during a switch.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BranchChanges {
    /// Save a durable backup associated with the source branch; do not automatically restore it.
    Leave,
    /// Save for the destination and restore the exact backup after successful checkout.
    Bring,
}

/// Non-forcing workspace branch actions. Integration/worktree operations have separate contracts.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BranchAction {
    /// Switch to an existing local branch.
    Switch(String),
    /// Create and switch to a new local branch from current HEAD.
    Create(String),
    /// Create and switch to a direct tracking branch for this exact remote ref.
    Remote(String),
    /// Rename a local branch only while its reviewed tip still matches.
    Rename {
        /// Existing local name.
        name: String,
        /// Requested validated destination name.
        new_name: String,
        /// Exact local tip reviewed for this rename.
        expected_target: String,
    },
    /// Delete a merged, unoccupied local branch only while its reviewed tip still matches.
    Delete {
        /// Local name to delete non-forcing.
        name: String,
        /// Exact local tip reviewed for deletion.
        expected_target: String,
    },
    /// Restore only this managed branch/worktree backup on a clean saved branch.
    Restore {
        /// Branch the managed backup belongs to.
        branch: String,
        /// Immutable managed stash commit selected for restoration.
        oid: String,
    },
}

/// Reviewed source and optional dirty-switch choice, owned so a worker can retain the intent.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BranchRequest {
    /// Requested action.
    pub action: BranchAction,
    /// Current workspace identity the caller reviewed.
    pub expected: BranchIdentity,
    /// Original dialog identity; refreshing the workspace must not silently update this consent.
    pub reviewed_source: Option<BranchIdentity>,
    /// Dirty switch disposition; supported only by Switch/Remote.
    pub changes: Option<BranchChanges>,
}

impl BranchRequest {
    /// Freeze a clean-tree request from a displayed snapshot.
    pub fn new(action: BranchAction, snapshot: &Snapshot) -> Self {
        Self {
            action,
            expected: BranchIdentity::from_snapshot(snapshot),
            reviewed_source: None,
            changes: None,
        }
    }
}

/// Fresh branch metadata and repository state after a branch edit.
#[derive(Debug)]
pub struct BranchMutation {
    /// Fresh locally recorded refs, without network traffic.
    pub branches: BranchCollection,
    /// Fresh working-tree state; hooks may have changed files or branch identity.
    pub snapshot: Snapshot,
    /// A durable backup deliberately left in Stashes, when one was created.
    pub saved_changes: Option<SavedBranchChanges>,
}

/// Branch failure preserving the write boundary and any identified retained recovery backup.
#[derive(Debug)]
pub struct BranchError {
    /// Command/validation/read failure, including its original cause.
    pub failure: Box<WriteError>,
    /// Last identified recovery backup. Refresh to confirm retention after a failed cleanup command.
    pub saved_changes: Option<SavedBranchChanges>,
    context: Option<&'static str>,
    backup_retention_uncertain: bool,
}

impl std::fmt::Display for BranchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.as_failure(Operation::CheckoutBranch).message)
    }
}

impl BranchError {
    /// Produce the existing bounded/redacted UI/protocol failure, retaining recovery advice.
    /// Original command output remains only in the typed cause, never in this result.
    pub fn as_failure(&self, operation: Operation) -> Failure {
        let mut failure = Failure::from_repository(operation, &self.failure.error);

        if let Some(context) = self.context {
            failure.message.push_str(&format!(" {context}"));
        }

        if let Some(saved) = &self.saved_changes {
            let oid = saved.oid.chars().take(7).collect::<String>();

            if self.backup_retention_uncertain {
                failure.message.push_str(&format!(" A recovery backup was saved in Stashes ({oid}). Refresh Stashes to confirm its current state before retrying."));
            } else {
                failure.message.push_str(&format!(" Your changes are safe in Stashes ({oid}). Inspect the current branch before restoring or retrying."));
            }
        }

        failure
    }
}

impl std::error::Error for BranchError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(self.failure.as_ref())
    }
}

impl From<WriteError> for BranchError {
    fn from(failure: WriteError) -> Self {
        Self {
            failure: Box::new(failure),
            saved_changes: None,
            context: None,
            backup_retention_uncertain: false,
        }
    }
}

enum Edit<'a> {
    Create(CreateBranch<'a>),
    Checkout {
        name: &'a str,
        force: bool,
    },
    Rename {
        current: Option<&'a str>,
        new_name: &'a str,
        force: bool,
    },
    Delete {
        name: &'a str,
        force: bool,
    },
}

fn failure(phase: WritePhase, error: impl Into<RepositoryError>) -> WriteError {
    WriteError {
        phase,
        error: error.into(),
    }
}

fn conflict(message: impl Into<String>) -> WriteError {
    failure(
        WritePhase::BeforeCommand,
        RepositoryError::Conflict(message.into()),
    )
}

impl Repository {
    /// Create a local branch, preserving Git hooks/tracking and explicit force semantics.
    pub fn create_branch(
        &self,
        options: CreateBranch<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<BranchMutation, WriteError> {
        self.edit_branch(Edit::Create(options), cancellation)
    }

    /// Switch the current worktree. Destructive discard is possible only with explicit force.
    pub fn checkout_branch(
        &self,
        name: &str,
        force: bool,
        cancellation: Option<&Cancellation>,
    ) -> Result<BranchMutation, WriteError> {
        self.edit_branch(Edit::Checkout { name, force }, cancellation)
    }

    /// Rename the named branch, or the current branch when current is None.
    pub fn rename_branch(
        &self,
        current: Option<&str>,
        new_name: &str,
        force: bool,
        cancellation: Option<&Cancellation>,
    ) -> Result<BranchMutation, WriteError> {
        self.edit_branch(
            Edit::Rename {
                current,
                new_name,
                force,
            },
            cancellation,
        )
    }

    /// Delete a local branch; unmerged deletion requires explicit force, and Git still guards occupied branches.
    pub fn delete_branch(
        &self,
        name: &str,
        force: bool,
        cancellation: Option<&Cancellation>,
    ) -> Result<BranchMutation, WriteError> {
        self.edit_branch(Edit::Delete { name, force }, cancellation)
    }

    fn edit_branch(
        &self,
        edit: Edit<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<BranchMutation, WriteError> {
        let _write = self.mutations.enter();

        self.branch_preflight(cancellation)?;
        self.execute_branch(edit, cancellation)?;

        self.branch_result(cancellation)
    }

    fn branch_preflight(&self, cancellation: Option<&Cancellation>) -> Result<(), WriteError> {
        check_cancelled(cancellation).map_err(|error| failure(WritePhase::BeforeCommand, error))?;

        self.check_write_identity()
            .map_err(|error| failure(WritePhase::BeforeCommand, error))
    }

    pub(super) fn branch_name(
        &self,
        name: &str,
        cancellation: Option<&Cancellation>,
    ) -> Result<(), WriteError> {
        require_revision(name).map_err(|error| failure(WritePhase::BeforeCommand, error))?;
        self.run(["check-ref-format", "--branch", name], cancellation)
            .map_err(|error| failure(WritePhase::BeforeCommand, error))?;

        Ok(())
    }

    fn execute_branch(
        &self,
        edit: Edit<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<(), WriteError> {
        let mut args: Vec<OsString> = Vec::new();

        match edit {
            Edit::Create(options) => {
                self.branch_name(options.name, cancellation)?;
                args.push(if options.checkout { "switch" } else { "branch" }.into());

                if options.checkout {
                    // Replacing a branch does not authorize deleting ignored working files.
                    args.push("--no-overwrite-ignore".into());
                }

                if options.track {
                    args.push("--track=direct".into());
                }

                if options.force {
                    args.push(if options.checkout { "-C" } else { "--force" }.into());
                } else if options.checkout {
                    args.push("-c".into());
                }

                args.push(options.name.into());

                if let Some(revision) = options.start_point.filter(|revision| !revision.is_empty())
                {
                    require_revision(revision)
                        .map_err(|error| failure(WritePhase::BeforeCommand, error))?;
                    args.push(revision.into());
                }
            }
            Edit::Checkout { name, force } => {
                self.branch_name(name, cancellation)?;
                args.push("switch".into());

                if force {
                    args.push("--discard-changes".into());
                } else {
                    args.push("--no-overwrite-ignore".into());
                }

                args.extend(["--".into(), name.into()]);
            }
            Edit::Rename {
                current,
                new_name,
                force,
            } => {
                self.branch_name(new_name, cancellation)?;
                args.extend(["branch".into(), if force { "-M" } else { "-m" }.into()]);

                if let Some(current) = current.filter(|name| !name.is_empty()) {
                    self.branch_name(current, cancellation)?;
                    args.push(current.into());
                }

                args.push(new_name.into());
            }
            Edit::Delete { name, force } => {
                self.branch_name(name, cancellation)?;
                args.extend([
                    "branch".into(),
                    if force { "-D" } else { "-d" }.into(),
                    "--".into(),
                    name.into(),
                ]);
            }
        }

        self.branch_command(args, cancellation)
    }

    fn branch_command(
        &self,
        args: impl IntoIterator<Item = impl Into<OsString>>,
        cancellation: Option<&Cancellation>,
    ) -> Result<(), WriteError> {
        self.check_write_identity()
            .map_err(|error| failure(WritePhase::BeforeCommand, error))?;
        self.run(args, cancellation)
            .map_err(|error| failure(WritePhase::Command, error))?;

        Ok(())
    }

    fn branch_result(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<BranchMutation, WriteError> {
        let refresh = |error| failure(WritePhase::Refresh, error);

        self.check_write_identity().map_err(refresh)?;
        let branches = self.branches_uncoordinated(cancellation).map_err(refresh)?;

        let snapshot = self
            .snapshot_uncoordinated(false, cancellation)
            .map_err(refresh)?;

        Ok(BranchMutation {
            branches,
            snapshot,
            saved_changes: None,
        })
    }

    /// Perform a non-forcing workspace action, including compatible Leave/Bring/Restore recovery.
    /// One common-directory queue guard spans all stash/checkout/restore/cleanup/refresh steps.
    /// Refuse stale dialog/source identity, dirty unconfirmed work and in-progress operations.
    /// External Git is not excluded; errors retain backups instead of attempting automatic rollback.
    pub fn change_branch(
        &self,
        request: &BranchRequest,
        cancellation: Option<&Cancellation>,
    ) -> Result<BranchMutation, BranchError> {
        let _write = self.mutations.enter();

        self.branch_preflight(cancellation)?;
        let snapshot = self
            .snapshot_uncoordinated(false, cancellation)
            .map_err(|error| failure(WritePhase::BeforeCommand, error))?;

        self.review_branch_source(request, &snapshot)?;

        if let BranchAction::Restore { branch, oid } = &request.action {
            return self.restore_branch_changes(branch, oid, cancellation);
        }

        let dirty = snapshot
            .status
            .files
            .iter()
            .any(|file| file.record_type != RecordType::Ignored);

        let switching = matches!(
            request.action,
            BranchAction::Switch(_) | BranchAction::Remote(_)
        );

        let edit = self.reviewed_branch_edit(request, &snapshot, cancellation)?;

        if dirty
            && switching
            && let Some(changes) = request.changes
        {
            let head = &snapshot.status.head;

            let Some(source) = head.branch.as_deref().filter(|_| head.oid.is_some()) else {
                return Err(conflict("Commit the first changes or attach HEAD to a branch before saving branch changes.").into());
            };

            if snapshot
                .status
                .files
                .iter()
                .any(|file| file.submodule.starts_with('S'))
            {
                return Err(conflict(
                    "Save submodule changes inside the submodule before switching branches.",
                )
                .into());
            }

            let destination = match &edit {
                Edit::Checkout { name, .. } => *name,
                Edit::Create(options) => options.name,
                _ => unreachable!("only local/remote switches can save branch changes"),
            };

            if destination == source {
                return Err(conflict(
                    "Choose an available branch that is not checked out in another worktree.",
                )
                .into());
            }

            let saved = self.save_branch_changes(
                if changes == BranchChanges::Leave {
                    source
                } else {
                    destination
                },
                cancellation,
            )?;

            let result = (|| {
                let fresh = self
                    .snapshot_uncoordinated(false, cancellation)
                    .map_err(|error| failure(WritePhase::Refresh, error))?;

                let mut clean_request = request.clone();

                clean_request.changes = None;
                self.review_branch_source(&clean_request, &fresh)?;
                let edit = self.reviewed_branch_edit(&clean_request, &fresh, cancellation)?;

                self.execute_branch(edit, cancellation)?;

                self.branch_result(cancellation)
            })();

            let mut result = result.map_err(|mut failure| {
                if failure.phase == WritePhase::BeforeCommand {
                    failure.phase = WritePhase::Command;
                }

                BranchError {
                    failure: Box::new(failure),
                    saved_changes: Some(saved.clone()),
                    context: None,
                    backup_retention_uncertain: false,
                }
            })?;

            if changes == BranchChanges::Bring {
                result = self
                    .restore_branch_changes(&saved.branch, &saved.oid, cancellation)
                    .map_err(|mut error| {
                        if error.failure.phase == WritePhase::BeforeCommand {
                            error.failure.phase = WritePhase::Command;
                        }

                        error.saved_changes = Some(saved.clone());

                        error
                    })?;
            } else {
                result.saved_changes = Some(saved);
            }

            return Ok(result);
        }

        self.execute_branch(edit, cancellation)?;

        self.branch_result(cancellation).map_err(Into::into)
    }

    fn review_branch_source(
        &self,
        request: &BranchRequest,
        snapshot: &Snapshot,
    ) -> Result<(), WriteError> {
        let head = BranchIdentity::from_snapshot(snapshot);

        if head != request.expected
            || request
                .reviewed_source
                .as_ref()
                .is_some_and(|reviewed| *reviewed != head)
        {
            return Err(conflict(
                "The branch changed outside this app. Refresh the workspace before trying again.",
            ));
        }

        if snapshot.operation != OperationState::Normal
            || snapshot
                .status
                .files
                .iter()
                .any(|file| file.record_type == RecordType::Unmerged)
        {
            return Err(conflict(
                "Finish the current Git operation before switching branches.",
            ));
        }

        let can_save = matches!(
            request.action,
            BranchAction::Switch(_) | BranchAction::Remote(_)
        ) && request.changes.is_some();

        if !can_save
            && snapshot
                .status
                .files
                .iter()
                .any(|file| file.record_type != RecordType::Ignored)
        {
            return Err(conflict(
                "Commit or stash your changes before switching branches. Nothing has been discarded.",
            ));
        }

        Ok(())
    }

    fn reviewed_branch_edit<'a>(
        &self,
        request: &'a BranchRequest,
        snapshot: &Snapshot,
        cancellation: Option<&Cancellation>,
    ) -> Result<Edit<'a>, WriteError> {
        let saving = request.changes.is_some()
            && snapshot
                .status
                .files
                .iter()
                .any(|file| file.record_type != RecordType::Ignored);

        let branches = if saving
            || matches!(
                request.action,
                BranchAction::Remote(_) | BranchAction::Rename { .. } | BranchAction::Delete { .. }
            ) {
            self.branches_uncoordinated(cancellation)
                .map_err(|error| failure(WritePhase::BeforeCommand, error))?
        } else {
            BranchCollection {
                branches: Vec::new(),
                current: None,
            }
        };

        reviewed_edit(request, snapshot, &branches, saving)
    }
}

// Remote tracking names are derived from exact refs, never from short-name guesses.
fn reviewed_edit<'a>(
    request: &'a BranchRequest,
    snapshot: &Snapshot,
    branches: &BranchCollection,
    saving: bool,
) -> Result<Edit<'a>, WriteError> {
    let local = |name: &str| {
        branches
            .branches
            .iter()
            .find(|branch| branch.kind == BranchKind::Local && branch.name == name)
    };

    let edit = match &request.action {
        BranchAction::Switch(name) => {
            if saving {
                let Some(target) = local(name) else {
                    return Err(conflict(
                        "Choose an available branch that is not checked out in another worktree.",
                    ));
                };

                if target.worktree_path.is_some()
                    || target.name == snapshot.status.head.branch.as_deref().unwrap_or("")
                {
                    return Err(conflict(
                        "Choose an available branch that is not checked out in another worktree.",
                    ));
                }
            }

            Edit::Checkout { name, force: false }
        }
        BranchAction::Create(name) => Edit::Create(CreateBranch {
            checkout: true,
            ..CreateBranch::new(name)
        }),
        BranchAction::Remote(reference) => {
            let name = super::refs::remote_tracking_name(reference, branches)
                .map_err(|error| failure(WritePhase::BeforeCommand, error))?;

            return Ok(Edit::Create(CreateBranch {
                name,
                start_point: Some(reference),
                checkout: true,
                track: true,
                force: false,
            }));
        }
        BranchAction::Rename {
            name,
            expected_target,
            ..
        }
        | BranchAction::Delete {
            name,
            expected_target,
        } => {
            let target = local(name)
                .filter(|branch| branch.oid == *expected_target)
                .ok_or_else(|| {
                    conflict("This branch changed or disappeared. Refresh before trying again.")
                })?;

            if matches!(request.action, BranchAction::Delete { .. }) {
                if target.checked_out || target.worktree_path.is_some() {
                    return Err(conflict(
                        "This branch is checked out in a workspace and cannot be deleted.",
                    ));
                }

                Edit::Delete { name, force: false }
            } else {
                let BranchAction::Rename { new_name, .. } = &request.action else {
                    unreachable!()
                };

                if target.worktree_path.is_some()
                    && snapshot.status.head.branch.as_ref() != Some(name)
                {
                    return Err(conflict(
                        "Rename this branch from the workspace where it is checked out.",
                    ));
                }

                if new_name.trim().is_empty() {
                    return Err(conflict("Enter a new branch name."));
                }

                Edit::Rename {
                    current: Some(name),
                    new_name,
                    force: false,
                }
            }
        }
        BranchAction::Restore { .. } => unreachable!("restore is handled before branch editing"),
    };

    Ok(edit)
}
