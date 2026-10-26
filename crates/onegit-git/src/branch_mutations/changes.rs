//! Compatible versioned stash metadata and guarded branch/worktree recovery.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::LazyLock;

use base64::Engine;
use base64::alphabet::URL_SAFE;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use regex::Regex;

use super::{BranchError, BranchMutation, Repository, RepositoryError, conflict, failure};
use crate::{Cancellation, OperationState, RecordType, Stash, WritePhase};

const ENCODING: GeneralPurpose = GeneralPurpose::new(
    &URL_SAFE,
    GeneralPurposeConfig::new()
        .with_encode_padding(false)
        .with_decode_padding_mode(DecodePaddingMode::RequireNone)
        .with_decode_allow_trailing_bits(true),
);

static MARKER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[1git-branch-v1:([A-Za-z0-9_-]+)\]$").expect("literal metadata pattern")
});

static UUID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$").expect("literal UUID pattern")
});

/// A compatible managed stash for one branch in one canonical worktree.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SavedBranchChanges {
    /// Immutable stash commit identity; reflog selectors can move independently.
    pub oid: String,
    /// Branch the saved contents belong to.
    pub branch: String,
    /// Git's stash committer date, preserving the source representation.
    pub created_at: String,
}

impl SavedBranchChanges {
    /// Select only valid v1 metadata matching the exact worktree root, in existing stash order.
    /// Manual/malformed/oversized/other-worktree entries are not app-managed backups.
    pub fn from_stashes(root: &Path, stashes: &[Stash]) -> Vec<Self> {
        let Some(root) = root.to_str() else {
            return Vec::new();
        };

        let mut saved = Vec::new();

        for stash in stashes {
            let Some(captures) = MARKER.captures(&stash.summary) else {
                continue;
            };

            let encoded = &captures[1];

            if encoded.len() > 16_384 {
                continue;
            }

            let Ok(bytes) = ENCODING.decode(encoded) else {
                continue;
            };

            let json = String::from_utf8_lossy(&bytes);

            // Raw values skip unrelated nested fields iteratively, matching the source
            // without allocating a recursive tree or imposing a new 128-level limit.
            let Ok(metadata) =
                serde_json::from_str::<BTreeMap<String, Box<serde_json::value::RawValue>>>(&json)
            else {
                continue;
            };

            let string = |key| {
                metadata
                    .get(key)
                    .and_then(|value| serde_json::from_str::<String>(value.get()).ok())
            };

            let Some(id) = string("id") else {
                continue;
            };

            let Some(branch) = string("branch") else {
                continue;
            };

            if !UUID.is_match(&id)
                || string("root").as_deref() != Some(root)
                || branch.is_empty()
                || branch.encode_utf16().count() > 1024
            {
                continue;
            }

            saved.push(Self {
                oid: stash.oid.clone(),
                branch,
                created_at: stash.created_at.clone(),
            });
        }

        saved
    }
}

impl Repository {
    /// Discover source-compatible branch backups after reopening, without app-owned storage.
    pub fn saved_branch_changes(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<SavedBranchChanges>, RepositoryError> {
        self.mutations.wait_for_pending();
        let stashes = self.stashes_uncoordinated(cancellation)?;

        Ok(SavedBranchChanges::from_stashes(&self.info.root, &stashes))
    }

    pub(super) fn save_branch_changes(
        &self,
        branch: &str,
        cancellation: Option<&Cancellation>,
    ) -> Result<SavedBranchChanges, BranchError> {
        let root = self
            .info
            .root
            .to_str()
            .ok_or_else(|| conflict("Saving branch changes requires a UTF-8 worktree root."))?;

        let id = super::super::mutations::recovery_id()
            .map_err(|error| failure(WritePhase::BeforeCommand, error))?;

        let json = serde_json::json!({ "id": id, "root": root, "branch": branch });
        let encoded = ENCODING.encode(json.to_string());
        let message = format!("1git: changes for {branch} [1git-branch-v1:{encoded}]");

        let result = self.branch_command(
            ["stash", "push", "--include-untracked", "-m", &message],
            cancellation,
        );

        let stashes = self.stashes_uncoordinated(cancellation);

        let saved = stashes
            .as_ref()
            .ok()
            .and_then(|stashes| {
                stashes
                    .iter()
                    .find(|stash| stash.summary.ends_with(&message))
            })
            .map(|stash| SavedBranchChanges {
                oid: stash.oid.clone(),
                branch: branch.to_owned(),
                created_at: stash.created_at.clone(),
            });

        if let Err(failure) = result {
            return Err(BranchError {
                failure: Box::new(failure),
                saved_changes: saved,
                context: Some("Inspect Stashes before retrying; any saved backup has been kept."),
                backup_retention_uncertain: false,
            });
        }

        stashes.map_err(|error| BranchError {
            failure: Box::new(failure(WritePhase::Refresh, error)),
            saved_changes: saved.clone(),
            context: Some("Inspect Stashes before retrying; any saved backup has been kept."),
            backup_retention_uncertain: false,
        })?;

        saved.ok_or_else(|| BranchError {
            failure: Box::new(failure(
                WritePhase::Refresh,
                RepositoryError::Conflict(
                    "Could not identify the saved changes. Inspect Stashes before retrying.".into(),
                ),
            )),
            saved_changes: None,
            context: None,
            backup_retention_uncertain: false,
        })
    }

    pub(super) fn restore_branch_changes(
        &self,
        branch: &str,
        oid: &str,
        cancellation: Option<&Cancellation>,
    ) -> Result<BranchMutation, BranchError> {
        let stashes = self
            .stashes_uncoordinated(cancellation)
            .map_err(|error| failure(WritePhase::BeforeCommand, error))?;

        let saved = SavedBranchChanges::from_stashes(&self.info.root, &stashes)
            .into_iter()
            .find(|saved| saved.oid == oid && saved.branch == branch)
            .ok_or_else(|| {
                conflict("These saved changes are unavailable. Refresh and select them again.")
            })?;

        let before = self
            .snapshot_uncoordinated(false, cancellation)
            .map_err(|error| failure(WritePhase::BeforeCommand, error))?;

        if before.status.head.branch.as_deref() != Some(branch)
            || before.operation != OperationState::Normal
            || before
                .status
                .files
                .iter()
                .any(|file| file.record_type != RecordType::Ignored)
        {
            return Err(BranchError {
                failure: Box::new(conflict(
                    "Restore requires a clean working tree on the saved branch. The backup is still in Stashes.",
                )),
                saved_changes: Some(saved),
                context: None,
                backup_retention_uncertain: false,
            });
        }

        let keep = |failure, context| BranchError {
            failure: Box::new(failure),
            saved_changes: Some(saved.clone()),
            context: Some(context),
            backup_retention_uncertain: false,
        };

        self.branch_command(["stash", "apply", "--index", oid], cancellation)
            .map_err(|error| keep(error, "Changes may be partially restored; review the files and resolve any conflicts. The recovery backup is still in Stashes."))?;
        let after = self
            .snapshot_uncoordinated(false, cancellation)
            .map_err(|error| {
                keep(
                    failure(WritePhase::Refresh, error),
                    "The recovery backup is still in Stashes.",
                )
            })?;

        if after.status.head.oid != before.status.head.oid
            || after.status.head.branch.as_deref() != Some(branch)
            || after.operation != OperationState::Normal
            || after
                .status
                .files
                .iter()
                .any(|file| file.record_type == RecordType::Unmerged)
        {
            return Err(keep(
                failure(
                    WritePhase::Refresh,
                    RepositoryError::Conflict(
                        "The workspace changed during restoration. Review it before continuing."
                            .into(),
                    ),
                ),
                "The recovery backup is still in Stashes.",
            ));
        }

        // Finish all result reads before cleanup, so a failed refresh cannot consume the backup.
        let branches = self.branches_uncoordinated(cancellation).map_err(|error| {
            keep(
                failure(WritePhase::Refresh, error),
                "The recovery backup is still in Stashes.",
            )
        })?;

        let current = self.stashes_uncoordinated(cancellation).map_err(|error| {
            keep(
                failure(WritePhase::Refresh, error),
                "The recovery backup is still in Stashes.",
            )
        })?;

        let matching: Vec<_> = current.iter().filter(|stash| stash.oid == oid).collect();

        if matching.len() != 1 {
            return Err(keep(failure(WritePhase::Refresh, RepositoryError::Conflict("Changes restored, but backup cleanup could not be confirmed. Inspect Stashes.".into())), "The recovery backup is still in Stashes."));
        }

        self.branch_command(["stash", "drop", &matching[0].reference], cancellation)
            .map_err(|error| {
                let mut error = keep(error, "Changes restored, but recovery backup cleanup failed. Inspect Stashes before retrying.");

                error.backup_retention_uncertain = true;

                error
            })?;

        Ok(BranchMutation {
            branches,
            snapshot: after,
            saved_changes: None,
        })
    }
}
