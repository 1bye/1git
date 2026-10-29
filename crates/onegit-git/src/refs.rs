//! Read-only branch, remote, tag, stash, worktree and configuration metadata.

use std::path::PathBuf;
use std::sync::LazyLock;

use regex::Regex;

use super::{Repository, RepositoryError};
use crate::output::{absolute_path, rows, text, trim_end};
use crate::{Cancellation, GitError};

const BRANCH_FORMAT: &str = "%(refname)%00%(refname:short)%00%(objectname)%00%(HEAD)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(committerdate:iso-strict)%00%(subject)%00%(worktreepath)%00%(upstream:remotename)%00%(upstream:remoteref)%00";

pub(super) fn remote_tracking_name<'a>(
    reference: &'a str,
    collection: &BranchCollection,
) -> Result<&'a str, RepositoryError> {
    let target = collection
        .branches
        .iter()
        .find(|branch| branch.kind == BranchKind::Remote && branch.full_name == reference)
        .ok_or_else(|| {
            RepositoryError::Conflict(
                "The remote branch is unavailable. Refresh and try again.".into(),
            )
        })?;

    let remote = target.remote.as_ref().ok_or_else(|| {
        RepositoryError::Conflict(
            "This remote branch is unavailable. Refresh and try again.".into(),
        )
    })?;

    let name = reference
        .strip_prefix(&format!("refs/remotes/{remote}/"))
        .filter(|name| !name.is_empty())
        .ok_or_else(|| {
            RepositoryError::Conflict(
                "This remote branch is unavailable. Refresh and try again.".into(),
            )
        })?;

    if collection
        .branches
        .iter()
        .any(|branch| branch.kind == BranchKind::Local && branch.name == name)
    {
        return Err(RepositoryError::Conflict(format!(
            "Local branch “{name}” already exists. Choose it instead."
        )));
    }

    Ok(name)
}

const TAG_FORMAT: &str = "%(refname:short)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(creatordate:iso-strict)%00%(subject)%00";
const STASH_FORMAT: &str = "%gd%x00%H%x00%cI%x00%gs%x00";

static TRACKING: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(ahead|behind) (\d+)").expect("literal tracking pattern is valid")
});

static CONFIG_KEY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)+$")
        .expect("literal config key pattern is valid")
});

/// Local branch versus a fetched remote-tracking branch.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BranchKind {
    /// A ref under refs/heads.
    Local,
    /// A ref under refs/remotes.
    Remote,
}

/// Owned branch metadata, including the exact configured upstream destination.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Branch {
    /// Full ref name.
    pub full_name: String,
    /// Git's short display name.
    pub name: String,
    /// Tip object ID.
    pub oid: String,
    /// Local/remote category.
    pub kind: BranchKind,
    /// Whether this is the current working tree's HEAD branch.
    pub checked_out: bool,
    /// Remote name for a remote-tracking branch.
    pub remote: Option<String>,
    /// Upstream display label.
    pub upstream: Option<String>,
    /// Exact configured upstream remote; may be `.`.
    pub upstream_remote: Option<String>,
    /// Exact configured upstream ref; never inferred from the display label.
    pub upstream_ref: Option<String>,
    /// Ahead count when an upstream is available.
    pub ahead: u64,
    /// Behind count when an upstream is available.
    pub behind: u64,
    /// Tip committer date, in Git's strict ISO representation.
    pub committed_at: Option<String>,
    /// Tip subject.
    pub summary: String,
    /// Worktree checking out this branch, preserving Unix path bytes.
    pub worktree_path: Option<PathBuf>,
}

/// Branches in Git's date order and the current local branch, if any.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BranchCollection {
    /// Local and remote-tracking branches, excluding symbolic remote HEAD aliases.
    pub branches: Vec<Branch>,
    /// Name of the checked-out local branch.
    pub current: Option<String>,
}

/// Lightweight versus annotated tag object.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TagKind {
    /// Direct ref to an object.
    Lightweight,
    /// Annotated tag object with a peeled target.
    Annotated,
}

/// Local tag metadata; listing never contacts its remote.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Tag {
    /// Short tag name.
    pub name: String,
    /// Referenced object ID (the tag object for annotated tags).
    pub oid: String,
    /// Peeled target, or the direct object for lightweight tags.
    pub target_oid: String,
    /// Tag kind.
    pub kind: TagKind,
    /// Creator date, when Git reports one.
    pub created_at: Option<String>,
    /// Tag or target commit subject.
    pub message: String,
}

/// One configured remote, including all effective fetch/push destinations.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Remote {
    /// Configured remote name.
    pub name: String,
    /// Locally recorded remote HEAD branch, without the remote prefix.
    pub default_branch: Option<String>,
    /// All effective fetch URLs, after Git's configured rewrites.
    pub fetch_urls: Vec<String>,
    /// All effective push URLs; Git applies fetch fallback when no push URL is set.
    pub push_urls: Vec<String>,
}

/// One entry in the local stash reflog.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Stash {
    /// Reflog selector, for example stash@{0}.
    pub reference: String,
    /// Stash commit object ID.
    pub oid: String,
    /// Strict ISO committer date.
    pub created_at: String,
    /// Reflog subject.
    pub summary: String,
}

/// Registered working-tree metadata, preserving paths and lock/prune reasons.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Worktree {
    /// Registered absolute path.
    pub path: PathBuf,
    /// HEAD object when present.
    pub head_oid: Option<String>,
    /// Local branch name, without refs/heads.
    pub branch: Option<String>,
    /// Whether this worktree is detached.
    pub detached: bool,
    /// Whether removal is locked.
    pub locked: bool,
    /// Optional lock reason.
    pub lock_reason: Option<String>,
    /// Whether Git reports the worktree prunable.
    pub prunable: bool,
    /// Optional prune reason.
    pub prune_reason: Option<String>,
}

/// Allowed configuration read scopes. Writes have a separate policy.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConfigScope {
    /// Repository-local config (the legacy default).
    Local,
    /// Worktree-specific config.
    Worktree,
    /// Effective Git configuration across all configured scopes.
    Effective,
}

/// One configuration lookup; absence differs from an explicitly empty value.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigValue {
    /// Requested key.
    pub key: String,
    /// Requested read scope.
    pub scope: ConfigScope,
    /// Last configured value, with the legacy trailing-whitespace normalization.
    pub value: Option<String>,
}

impl Repository {
    /// List local and remote branches using local refs only.
    pub fn branches(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<BranchCollection, RepositoryError> {
        self.mutations.wait_for_pending();

        self.branches_uncoordinated(cancellation)
    }

    pub(super) fn branches_uncoordinated(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<BranchCollection, RepositoryError> {
        let format = format!("--format={BRANCH_FORMAT}");

        let output = self.run(
            [
                "for-each-ref",
                "--sort=-committerdate",
                &format,
                "refs/heads",
                "refs/remotes",
            ],
            cancellation,
        )?;

        let mut collection = parse_branches(&output.stdout)?;
        for branch in &mut collection.branches {
            if let Some(path) = &mut branch.worktree_path {
                *path = crate::platform::normalize_git_location(path)?;
            }
        }
        Ok(collection)
    }

    /// List local tags in creator-date order.
    pub fn tags(&self, cancellation: Option<&Cancellation>) -> Result<Vec<Tag>, RepositoryError> {
        self.mutations.wait_for_pending();
        let format = format!("--format={TAG_FORMAT}");

        let output = self.run(
            ["for-each-ref", "--sort=-creatordate", &format, "refs/tags"],
            cancellation,
        )?;

        parse_tags(&output.stdout)
    }

    /// List local stash entries, newest first.
    pub fn stashes(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Stash>, RepositoryError> {
        self.mutations.wait_for_pending();

        self.stashes_uncoordinated(cancellation)
    }

    pub(super) fn stashes_uncoordinated(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Stash>, RepositoryError> {
        let format = format!("--format={STASH_FORMAT}");
        let output = self.run(["stash", "list", &format], cancellation)?;

        parse_stashes(&output.stdout)
    }

    /// List registered worktrees without pruning, repairing or changing them.
    pub fn worktrees(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Worktree>, RepositoryError> {
        self.mutations.wait_for_pending();

        self.worktrees_uncoordinated(cancellation)
    }

    pub(super) fn worktrees_uncoordinated(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Worktree>, RepositoryError> {
        let output = self.run(["worktree", "list", "--porcelain", "-z"], cancellation)?;

        let mut worktrees = parse_worktrees(&output.stdout)?;
        for worktree in &mut worktrees {
            worktree.path = crate::platform::normalize_git_location(&worktree.path)?;
        }
        Ok(worktrees)
    }

    /// Read configured remotes/default branches/URLs without network traffic.
    pub fn remotes(
        &self,
        cancellation: Option<&Cancellation>,
    ) -> Result<Vec<Remote>, RepositoryError> {
        self.mutations.wait_for_pending();
        let names = self.run(["remote"], cancellation)?;
        let mut remotes = Vec::new();

        for name in text(&names.stdout).lines().filter(|name| !name.is_empty()) {
            let symbolic = self.run(
                [
                    "for-each-ref",
                    "--format=%(symref:short)",
                    &format!("refs/remotes/{name}/HEAD"),
                ],
                cancellation,
            )?;

            let symbolic = text(&symbolic.stdout);
            let prefix = format!("{name}/");
            let default_branch = symbolic.trim().strip_prefix(&prefix).map(str::to_owned);

            let urls = |push| -> Result<Vec<String>, RepositoryError> {
                let mut args = vec!["remote", "get-url"];

                if push {
                    args.push("--push");
                }

                args.extend(["--all", name]);

                let output = self.run(args, cancellation)?;

                Ok(text(&output.stdout)
                    .lines()
                    .filter(|url| !url.is_empty())
                    .map(str::to_owned)
                    .collect())
            };

            remotes.push(Remote {
                name: name.into(),
                default_branch,
                fetch_urls: urls(false)?,
                push_urls: urls(true)?,
            });
        }

        Ok(remotes)
    }

    /// Read a validated key; missing values return None and never create config files.
    pub fn config(
        &self,
        key: &str,
        scope: ConfigScope,
        cancellation: Option<&Cancellation>,
    ) -> Result<ConfigValue, RepositoryError> {
        self.mutations.wait_for_pending();

        if !CONFIG_KEY.is_match(key) {
            return Err(RepositoryError::InvalidInput(
                "Invalid Git configuration key",
            ));
        }

        let mut args = vec!["config"];

        match scope {
            ConfigScope::Local => args.push("--local"),
            ConfigScope::Worktree => args.push("--worktree"),
            ConfigScope::Effective => {}
        }

        args.extend(["--get", key]);

        let value = match self.run(args, cancellation) {
            Ok(output) => Some(trim_end(&text(&output.stdout)).to_owned()),
            Err(RepositoryError::Git(GitError::CommandFailed { status, .. }))
                if status.code() == Some(1) =>
            {
                None
            }
            Err(error) => return Err(error),
        };

        Ok(ConfigValue {
            key: key.into(),
            scope,
            value,
        })
    }
}

fn parse_branches(output: &[u8]) -> Result<BranchCollection, RepositoryError> {
    let mut branches = Vec::new();

    for fields in rows(output, 11)? {
        if fields[..3].iter().any(|field| field.is_empty()) {
            return Err(RepositoryError::InvalidOutput);
        }

        let full_name = text(fields[0]);

        if full_name.ends_with("/HEAD") {
            continue;
        }

        let remote_ref = full_name.strip_prefix("refs/remotes/");

        let mut branch = Branch {
            kind: if remote_ref.is_some() {
                BranchKind::Remote
            } else {
                BranchKind::Local
            },
            remote: remote_ref
                .and_then(|tail| tail.split_once('/'))
                .map(|(remote, _)| remote.into()),
            full_name,
            name: text(fields[1]),
            oid: text(fields[2]),
            checked_out: fields[3] == b"*",
            upstream: optional(fields[4]),
            upstream_remote: optional(fields[9]),
            upstream_ref: optional(fields[10]),
            ahead: 0,
            behind: 0,
            committed_at: optional(fields[6]),
            summary: text(fields[7]),
            worktree_path: if fields[8].is_empty() {
                None
            } else {
                Some(absolute_path(fields[8])?)
            },
        };

        for capture in TRACKING.captures_iter(&text(fields[5])) {
            let count = capture[2]
                .parse()
                .map_err(|_| RepositoryError::InvalidOutput)?;

            if &capture[1] == "ahead" {
                branch.ahead = count;
            } else {
                branch.behind = count;
            }
        }

        branches.push(branch);
    }

    let current = branches
        .iter()
        .find(|branch| branch.kind == BranchKind::Local && branch.checked_out)
        .map(|branch| branch.name.clone());

    Ok(BranchCollection { branches, current })
}

fn parse_tags(output: &[u8]) -> Result<Vec<Tag>, RepositoryError> {
    rows(output, 6)?
        .into_iter()
        .map(|fields| {
            if fields[..3].iter().any(|field| field.is_empty()) {
                return Err(RepositoryError::InvalidOutput);
            }

            Ok(Tag {
                name: text(fields[0]),
                oid: text(fields[1]),
                kind: if fields[2] == b"tag" {
                    TagKind::Annotated
                } else {
                    TagKind::Lightweight
                },
                target_oid: text(if fields[3].is_empty() {
                    fields[1]
                } else {
                    fields[3]
                }),
                created_at: optional(fields[4]),
                message: text(fields[5]),
            })
        })
        .collect()
}

fn parse_stashes(output: &[u8]) -> Result<Vec<Stash>, RepositoryError> {
    rows(output, 4)?
        .into_iter()
        .map(|fields| {
            if fields[..3].iter().any(|field| field.is_empty()) {
                return Err(RepositoryError::InvalidOutput);
            }

            Ok(Stash {
                reference: text(fields[0]),
                oid: text(fields[1]),
                created_at: text(fields[2]),
                summary: text(fields[3]),
            })
        })
        .collect()
}

fn parse_worktrees(output: &[u8]) -> Result<Vec<Worktree>, RepositoryError> {
    if !output.is_empty() && !output.ends_with(b"\0\0") {
        return Err(RepositoryError::InvalidOutput);
    }

    let mut result = Vec::new();
    let mut worktree = Worktree::default();

    for record in output.split(|byte| *byte == 0) {
        if record.is_empty() {
            if !worktree.path.as_os_str().is_empty() {
                result.push(std::mem::take(&mut worktree));
            }

            continue;
        }

        let split = record
            .iter()
            .position(|byte| *byte == b' ')
            .unwrap_or(record.len());

        let key = &record[..split];
        let value = record.get(split + 1..).unwrap_or_default();

        match key {
            b"worktree" => worktree.path = absolute_path(value)?,
            b"HEAD" => worktree.head_oid = Some(text(value)),
            b"branch" => {
                worktree.branch = Some(text(value.strip_prefix(b"refs/heads/").unwrap_or(value)))
            }
            b"detached" => worktree.detached = true,
            b"locked" => {
                worktree.locked = true;
                worktree.lock_reason = optional(value);
            }
            b"prunable" => {
                worktree.prunable = true;
                worktree.prune_reason = optional(value);
            }
            _ => {}
        }
    }

    Ok(result)
}

fn optional(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        None
    } else {
        Some(text(bytes))
    }
}

#[cfg(test)]
#[path = "refs_tests.rs"]
mod tests;
