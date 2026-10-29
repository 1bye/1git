//! Clean, tip-pinned integration and persistent rebase/squash recovery.

use super::*;
use crate::GitPath;
use crate::repository::mutations::recovery_id;
use crate::repository::{Branch, BranchKind, BranchMutation};
use std::collections::BTreeSet;
use std::io::Write;

/// Integration mode selected in a reviewed branch dialog.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IntegrationKind {
    /// Merge into the current branch, allowing fast-forwarding.
    Merge,
    /// Rebase unpublished non-merge commits onto the exact target commit.
    Rebase,
    /// Commit the target's combined changes with the explicitly reviewed message.
    SquashMerge,
}

/// Owned source and target consent, independent of later UI refreshes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegrationRequest {
    /// Reviewed integration mode.
    pub kind: IntegrationKind,
    /// Exact full local or remote-tracking ref, not a guessed short name.
    pub target: String,
    /// Exact reviewed target commit.
    pub expected_target: String,
    /// Current displayed source commit and attached branch.
    pub expected: BranchIdentity,
    /// Original dialog source; refresh must not silently update this consent.
    pub reviewed_source: Option<BranchIdentity>,
    /// Required squash message, including a nonempty first-line summary.
    pub message: Option<String>,
}

fn conflict(message: &'static str) -> WriteError {
    failure(
        WritePhase::BeforeCommand,
        RepositoryError::Conflict(message.into()),
    )
}

impl Repository {
    fn review_integration(
        &self,
        request: &IntegrationRequest,
        cancellation: Option<&Cancellation>,
    ) -> Result<Branch, WriteError> {
        self.integration_preflight(cancellation)?;
        let snapshot = self
            .snapshot_uncoordinated(false, cancellation)
            .map_err(|error| failure(WritePhase::BeforeCommand, error))?;

        let current = BranchIdentity::from_snapshot(&snapshot);

        if current != request.expected
            || request
                .reviewed_source
                .as_ref()
                .is_some_and(|original| original != &current)
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
                "Finish the current Git operation before integrating branches.",
            ));
        }

        if snapshot
            .status
            .files
            .iter()
            .any(|file| file.record_type != RecordType::Ignored)
        {
            return Err(conflict(
                "Commit or stash your changes before integrating branches. Nothing has been discarded.",
            ));
        }

        let branches = self
            .branches_uncoordinated(cancellation)
            .map_err(|error| failure(WritePhase::BeforeCommand, error))?;

        branches
            .branches
            .into_iter()
            .find(|branch| {
                current.oid.is_some()
                    && current.branch.is_some()
                    && branch.full_name == request.target
                    && branch.oid == request.expected_target
                    && !(branch.kind == BranchKind::Local
                        && Some(&branch.name) == current.branch.as_ref())
            })
            .ok_or_else(|| {
                conflict("Choose another available branch and review it again before integrating.")
            })
    }

    /// Integrate exact reviewed tips on a clean attached source branch. Never check
    /// out/delete the target or force a ref. Rebase retains its original tip in
    /// `refs/1git/rebase/<uuid>` and refuses known published or merge history.
    /// Squash retains the reviewed message in Git's SQUASH_MSG on conflict/hook
    /// failure. App writes stay coordinated through the fresh result read; arbitrary
    /// external Git/filesystem writes remain outside this queue's exclusion.
    pub fn integrate_branch(
        &self,
        request: &IntegrationRequest,
        cancellation: Option<&Cancellation>,
    ) -> Result<BranchMutation, WriteError> {
        let _write = self.mutations.enter();
        let target = self.review_integration(request, cancellation)?;

        let message = if request.kind == IntegrationKind::SquashMerge {
            let message = request.message.as_deref().unwrap_or_default();

            if message.is_empty() || message.contains('\0') {
                return Err(invalid(
                    "Squash commit message must be non-empty and contain no NUL.",
                ));
            }

            if message
                .split('\n')
                .next()
                .unwrap_or_default()
                .trim_matches(js_whitespace)
                .is_empty()
            {
                return Err(invalid("A first-line summary is required."));
            }

            Some(format!("{message}\n"))
        } else {
            None
        };

        let source_oid = request
            .expected
            .oid
            .as_deref()
            .expect("reviewed committed source");

        let source_branch = request
            .expected
            .branch
            .as_deref()
            .expect("reviewed attached source");

        if request.kind == IntegrationKind::Rebase {
            let range = format!("{}..{source_oid}", target.oid);

            let count = |args: Vec<&str>| -> Result<u64, WriteError> {
                let output = self
                    .run(args, cancellation)
                    .map_err(|error| failure(WritePhase::BeforeCommand, error))?;

                std::str::from_utf8(&output.stdout)
                    .ok()
                    .and_then(|text| text.trim().parse().ok())
                    .ok_or_else(|| invalid("Git returned an invalid integration history count."))
            };

            let all = count(vec!["rev-list", "--count", &range])?;
            let unpublished = count(vec!["rev-list", "--count", &range, "--not", "--remotes"])?;
            let merges = count(vec!["rev-list", "--count", "--merges", &range])?;

            if all != unpublished {
                return Err(invalid(
                    "Rebase would rewrite published commits according to known remote branches. Merge instead, or fetch and review the branch again.",
                ));
            }

            if merges != 0 {
                return Err(invalid(
                    "This branch contains merge commits. Use Merge or an external Git tool to preserve that history.",
                ));
            }

            self.protect_ignored_integration(request, cancellation)?;
            self.review_integration(request, cancellation)?;
            let id = recovery_id().map_err(|error| failure(WritePhase::BeforeCommand, error))?;

            let transaction = format!(
                "start\nverify refs/heads/{source_branch} {source_oid}\ncreate refs/1git/rebase/{id} {source_oid}\nprepare\ncommit\n"
            );

            self.integration_command(
                ["update-ref", "-m", "1git: retain rebased branch", "--stdin"],
                Some(transaction.as_bytes()),
                cancellation,
            )?;
            // A retained backup is itself a write. Any later failure requires
            // inspection; leave the durable ref and never automatically replay.
            self.integration_command(
                [
                    "rebase",
                    "--no-autostash",
                    "--no-update-refs",
                    "--no-fork-point",
                    &target.oid,
                ],
                None,
                cancellation,
            )
            .map_err(|mut error| {
                error.phase = WritePhase::Command;

                error
            })?;
        } else if request.kind == IntegrationKind::SquashMerge {
            self.protect_ignored_integration(request, cancellation)?;
            self.review_integration(request, cancellation)?;
            let merged = self.integration_command(
                [
                    "merge",
                    "--squash",
                    "--no-autostash",
                    "--no-overwrite-ignore",
                    &target.oid,
                ],
                None,
                cancellation,
            );

            if self.reviewed_squash_pending(request)? {
                self.check_write_identity()
                    .map_err(|error| failure(WritePhase::Refresh, error))?;
                let mut marker = crate::platform::truncate_no_follow(
                    &self.info.git_directory.join("SQUASH_MSG"),
                )
                .map_err(|error| failure(WritePhase::Refresh, error))?;

                marker
                    .write_all(message.as_ref().unwrap().as_bytes())
                    .map_err(|error| failure(WritePhase::Refresh, error))?;
            }

            merged?;
            let after = self.integration_snapshot(cancellation)?;

            if BranchIdentity::from_snapshot(&after) != request.expected {
                return Err(failure(WritePhase::Command, RepositoryError::Conflict("The branch changed during squash merge. Inspect Changes before continuing.".into())));
            }

            if after.status.files.is_empty() {
                match fs::remove_file(self.info.git_directory.join("SQUASH_MSG")) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(failure(WritePhase::Refresh, error)),
                }
            } else {
                if after.operation != OperationState::SquashMerge {
                    return Err(failure(WritePhase::Command, RepositoryError::Conflict("The Git operation changed during squash merge. Inspect Changes before continuing.".into())));
                }

                self.integration_command(
                    ["commit", "-F", "-"],
                    Some(message.as_ref().unwrap().as_bytes()),
                    cancellation,
                )
                .map_err(|mut error| {
                    error.phase = WritePhase::Command;

                    error
                })?;
            }
        } else {
            self.protect_ignored_integration(request, cancellation)?;
            self.review_integration(request, cancellation)?;
            let message = format!("Merge branch '{}' into {source_branch}", target.name);

            self.integration_command(
                [
                    "merge",
                    "--no-edit",
                    "--no-autostash",
                    "--no-overwrite-ignore",
                    "-m",
                    &message,
                    &target.oid,
                ],
                None,
                cancellation,
            )?;
        }

        let branches = self
            .branches_uncoordinated(cancellation)
            .map_err(|error| failure(WritePhase::Refresh, error))?;

        let snapshot = self.integration_snapshot(cancellation)?;

        Ok(BranchMutation {
            branches,
            snapshot,
            saved_changes: None,
        })
    }

    fn reviewed_squash_pending(&self, request: &IntegrationRequest) -> Result<bool, WriteError> {
        self.check_write_identity()
            .map_err(|error| failure(WritePhase::Refresh, error))?;

        if crate::repository::operation_state(&self.info.git_directory)
            .map_err(|error| failure(WritePhase::Refresh, error))?
            != OperationState::SquashMerge
        {
            return Ok(false);
        }

        let source = request
            .expected
            .branch
            .as_deref()
            .expect("reviewed attached source");

        let reference = format!("refs/heads/{source}");

        // Even a canceled squash must retain its reviewed message once Git has
        // produced recovery state. This single metadata-only cleanup read has
        // its own deadline and does not reuse the canceled caller's token.
        let mut command = GitCommand::new(
            &self.info.root,
            [
                "for-each-ref",
                "--format=%(HEAD)%00%(objectname)%00%(refname)",
                &reference,
            ],
        );

        command.directory = Some(&self.root_directory);
        command.timeout = Some(std::time::Duration::from_secs(5));
        let output = self
            .process
            .run(command)
            .map_err(|error| failure(WritePhase::Refresh, error))?;

        let expected = format!(
            "*\0{}\0{reference}\n",
            request
                .expected
                .oid
                .as_deref()
                .expect("reviewed committed source")
        );

        Ok(output.stdout == expected.as_bytes())
    }

    fn protect_ignored_integration(
        &self,
        request: &IntegrationRequest,
        cancellation: Option<&Cancellation>,
    ) -> Result<(), WriteError> {
        let before = |error| failure(WritePhase::BeforeCommand, error);

        let source = request
            .expected
            .oid
            .as_deref()
            .expect("reviewed committed source");

        let output = self
            .run(
                [
                    "diff",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--name-only",
                    "--no-renames",
                    "--diff-filter=AMT",
                    "-z",
                    source,
                    &request.expected_target,
                    "--",
                ],
                cancellation,
            )
            .map_err(before)?;

        let mut candidates = BTreeSet::new();

        for path in paths(&output.stdout)? {
            candidates.insert(path);
        }

        if request.kind == IntegrationKind::Rebase {
            // A replay can introduce and later delete a file absent from both
            // final trees. Check every written history path without walking all
            // trees or enumerating unrelated ignored directories such as caches.
            let range = format!("{}..{source}", request.expected_target);

            let output = self
                .run(
                    [
                        "log",
                        "--no-show-signature",
                        "--no-ext-diff",
                        "--no-textconv",
                        "--format=",
                        "--name-status",
                        "--root",
                        "--no-renames",
                        "--diff-filter=AMT",
                        "-z",
                        &range,
                        "--",
                    ],
                    cancellation,
                )
                .map_err(before)?;

            let fields = nul_fields(&output.stdout)?;

            if fields.len() % 2 != 0 {
                return Err(invalid("Git returned invalid integration history paths."));
            }

            for pair in fields.chunks_exact(2) {
                if !matches!(pair[0], b"A" | b"M" | b"T") {
                    return Err(invalid("Git returned invalid integration history paths."));
                }

                candidates.insert(path(pair[1])?);
            }
        }

        let mut existing = BTreeSet::new();

        for candidate in &candidates {
            check_cancelled(cancellation).map_err(|error| before(error.into()))?;
            let mut bytes = candidate.as_bytes();

            loop {
                let ancestor = GitPath::new(bytes)
                    .map_err(|_| invalid("Git returned invalid integration history paths."))?;

                let native = ancestor.to_native().map_err(|error| before(error.into()))?;

                match fs::symlink_metadata(self.info.root.join(native)) {
                    Ok(metadata) if &ancestor == candidate || !metadata.is_dir() => {
                        existing.insert(ancestor);
                    }
                    Ok(_) => {}
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
                        ) => {}
                    Err(error) => return Err(before(error.into())),
                }

                let Some(end) = bytes.iter().rposition(|byte| *byte == b'/') else {
                    break;
                };

                bytes = &bytes[..end];
            }
        }

        let existing: Vec<_> = existing.into_iter().collect();
        let mut start = 0;

        while start < existing.len() {
            let mut end = start;
            let mut bytes = 0;

            while end < existing.len() {
                let next = existing[end].as_bytes().len() + 1;

                if end > start && (bytes + next > 16 * 1024 || end - start >= 256) {
                    break;
                }

                bytes += next;
                end += 1;
            }

            let mut args: Vec<OsString> = [
                "--literal-pathspecs",
                "ls-files",
                "--others",
                "--ignored",
                "--exclude-standard",
                "-z",
                "--",
            ]
            .into_iter()
            .map(Into::into)
            .collect();

            for path in &existing[start..end] {
                args.push(path.to_argument().map_err(|error| before(error.into()))?);
            }

            let output = self.run(args, cancellation).map_err(before)?;

            if !output.stdout.is_empty() {
                return Err(conflict(
                    "An ignored local file would be overwritten by this integration. Move it aside and review again; nothing was discarded.",
                ));
            }

            start = end;
        }

        Ok(())
    }
}

fn nul_fields(output: &[u8]) -> Result<Vec<&[u8]>, WriteError> {
    if output.is_empty() {
        return Ok(Vec::new());
    }

    if output.last() != Some(&0) {
        return Err(invalid("Git returned invalid integration paths."));
    }

    Ok(output[..output.len() - 1]
        .split(|byte| *byte == 0)
        .collect())
}

fn js_whitespace(character: char) -> bool {
    // Preserve the source String.trim contract: BOM is whitespace; NEL is not.
    matches!(character, '\u{9}'..='\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

fn path(bytes: &[u8]) -> Result<GitPath, WriteError> {
    let path = GitPath::new(bytes)
        .map_err(|_| failure(WritePhase::BeforeCommand, RepositoryError::InvalidOutput))?;

    crate::validation::require_paths([&path])
        .map_err(|error| failure(WritePhase::BeforeCommand, error))?;

    Ok(path)
}

fn paths(output: &[u8]) -> Result<Vec<GitPath>, WriteError> {
    nul_fields(output)?.into_iter().map(path).collect()
}
