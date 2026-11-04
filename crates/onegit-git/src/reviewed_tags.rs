//! Exact local tag writes reviewed against repository identity and immutable objects.
use super::{
    BranchIdentity, Repository, RepositoryError, Snapshot, WriteError,
    metadata_writes::{before, text},
};

use crate::{Cancellation, validation::full_oid};

/// Lightweight or annotated local tag creation against a frozen branch/HEAD.
#[derive(Clone, Copy, Debug)]
pub struct ReviewedTag<'a> {
    /// New local tag name; existing tags are never replaced.
    pub name: &'a str,
    /// None creates a lightweight tag; Some requires a nonblank annotation.
    pub annotation: Option<&'a str>,
    /// Exact commit selected in Graph or History.
    pub commit: &'a str,
    /// Reviewed current branch and HEAD, including detached HEAD.
    pub expected: &'a BranchIdentity,
}

/// Deletion consent for one exact local tag object, never a remote tag.
#[derive(Clone, Copy, Debug)]
pub struct DeleteReviewedTag<'a> {
    /// Reviewed local name.
    pub name: &'a str,
    /// Exact direct ref value, including an annotated tag object.
    pub expected_oid: &'a str,
    /// Exact peeled/direct commit target shown during review.
    pub expected_target: &'a str,
    /// Reviewed current branch and HEAD.
    pub expected: &'a BranchIdentity,
}

impl Repository {
    /// Create one reviewed local tag without changing files, staging or other refs.
    ///
    /// # Errors
    /// Returns an error for stale identity, invalid/unreachable targets, existing names,
    /// cancellation, signing or Git failures, or an unconfirmed post-write snapshot.
    pub fn create_reviewed_tag(
        &self,
        request: &ReviewedTag<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.mutate(cancellation, || {
            self.review_tag(request.name, request.expected, cancellation).map_err(before)?;

            if !full_oid(request.commit) {
                return Err(before(RepositoryError::InvalidInput("Select an exact commit before tagging.")));
            }

            if let Some(annotation) = request.annotation {
                text(annotation).map_err(before)?;

                if annotation.trim().is_empty() {
                    return Err(before(RepositoryError::InvalidInput("An annotated tag requires a message.")));
                }
            }

            let object = self.run(["cat-file", "-t", request.commit], cancellation).map_err(before)?;
            let refs = self.run(["for-each-ref", "--count=1", &format!("--contains={}",request.commit), "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"],cancellation).map_err(before)?;

            if object.stdout != b"commit\n"
                || (refs.stdout.is_empty() && !self.is_ancestor(request.commit, request.expected.oid.as_deref().unwrap_or(""), cancellation).map_err(before)?)
            {
                return Err(before(RepositoryError::InvalidInput("Select an exact commit reachable from the reviewed Graph or History before tagging.")));
            }

            if self.tags_uncoordinated(cancellation).map_err(before)?.iter().any(|t| t.name==request.name) {
                return Err(before(RepositoryError::InvalidInput("A tag with this name already exists. Existing tags are never replaced.")));
            }

            self.review_tag(request.name, request.expected, cancellation).map_err(before)?;

            if let Some(annotation)=request.annotation {
                self.write_command(["tag","-a","-F","-","--",request.name,request.commit],format!("{annotation}\n").as_bytes(),cancellation)?;
            } else {
                // A lightweight choice must stay lightweight even when tag.gpgSign is configured.
                self.write_command(["-c","tag.gpgSign=false","tag","--",request.name,request.commit],&[],cancellation)?;
            }

            self.written_snapshot(cancellation)
        })
    }

    /// Delete only the reviewed local tag; a replacement is protected by compare-and-swap.
    ///
    /// # Errors
    /// Returns an error for stale identity or tag values, cancellation, a failed ref
    /// transaction, or an unconfirmed post-write snapshot.
    pub fn delete_reviewed_tag(
        &self,
        request: &DeleteReviewedTag<'_>,
        cancellation: Option<&Cancellation>,
    ) -> Result<Snapshot, WriteError> {
        self.mutate(cancellation, || {
            self.review_tag(request.name, request.expected, cancellation)
                .map_err(before)?;

            if !full_oid(request.expected_oid) || !full_oid(request.expected_target) {
                return Err(before(RepositoryError::InvalidInput(
                    "An exact reviewed tag object and target are required.",
                )));
            }

            let tags = self.tags_uncoordinated(cancellation).map_err(before)?;

            if !tags.iter().any(|t| {
                t.name == request.name
                    && t.oid == request.expected_oid
                    && t.target_oid == request.expected_target
            }) {
                return Err(before(RepositoryError::InvalidInput(
                    "The tag changed or is unavailable. Refresh and review it again.",
                )));
            }

            self.review_tag(request.name, request.expected, cancellation)
                .map_err(before)?;
            // Git locks and verifies both HEAD and the exact tag in one transaction.
            let input = format!(
                "start\nverify HEAD {}\ndelete refs/tags/{} {}\nprepare\ncommit\n",
                request
                    .expected
                    .oid
                    .as_deref()
                    .expect("reviewed HEAD exists"),
                request.name,
                request.expected_oid
            );

            self.write_command(
                [
                    "update-ref",
                    "-m",
                    "1git: delete reviewed local tag",
                    "--stdin",
                ],
                input.as_bytes(),
                cancellation,
            )?;

            self.written_snapshot(cancellation)
        })
    }
}
