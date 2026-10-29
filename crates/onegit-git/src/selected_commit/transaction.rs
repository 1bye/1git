use super::{CommitError, CommitFiles, CommitMode, CommitOutcome, CommitResult, PartialCommitFile};
use crate::GitPath;

use crate::{
    BranchIdentity, Cancellation, DiffOptions, DiffTarget, ErrorCode, FileStatus, GitCommand,
    GitOutput, OperationState, PartialPatch, RecordType, Repository, RepositoryError, Snapshot,
    WritePhase,
};

use std::collections::HashSet;
use std::ffi::OsString;
use std::fs::{self, File};
use std::io::{self, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use tempfile::TempDir;

struct Transaction {
    index_path: PathBuf,
    lock_path: PathBuf,
    lock: File,
    lock_identity: crate::platform::FileIdentity,
    owns_lock: bool,
    directory: Option<TempDir>,
    retain: bool,
}

impl Transaction {
    fn new(index_path: PathBuf) -> Result<Self, CommitError> {
        let mut lock_name = index_path.as_os_str().to_os_string();

        lock_name.push(".lock");
        let lock_path = PathBuf::from(lock_name);

        let lock = crate::platform::create_private_file(&lock_path).map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                CommitError::invalid(
                    ErrorCode::RepositoryLocked,
                    "The repository is locked by another Git process.",
                )
            } else {
                before(error.into())
            }
        })?;

        let lock_identity = match crate::platform::FileIdentity::from_file(&lock) {
            Ok(identity) => identity,
            Err(error) => {
                let _ = fs::remove_file(&lock_path);

                return Err(before(error.into()));
            }
        };

        Ok(Self {
            index_path,
            lock_path,
            lock,
            lock_identity,
            owns_lock: true,
            directory: None,
            retain: false,
        })
    }

    fn check_lock(&self) -> io::Result<()> {
        let metadata = fs::symlink_metadata(&self.lock_path)?;

        if !metadata.is_file()
            || crate::platform::FileIdentity::from_path(&self.lock_path)? != self.lock_identity
        {
            return Err(io::Error::other("The owned index lock changed."));
        }

        Ok(())
    }

    fn install(&mut self, index: &Path) -> io::Result<()> {
        self.check_lock()?;
        let mut source = File::open(index)?;

        self.lock.set_len(0)?;
        self.lock.seek(SeekFrom::Start(0))?;
        io::copy(&mut source, &mut self.lock)?;
        self.lock
            .set_permissions(source.metadata()?.permissions())?;
        self.lock.sync_all()?;
        self.check_lock()?;
        fs::rename(&self.lock_path, &self.index_path)?;
        self.owns_lock = false;

        Ok(())
    }

    fn cleanup(&mut self) -> io::Result<()> {
        if self.owns_lock {
            self.owns_lock = false;

            if let Err(error) = self
                .check_lock()
                .and_then(|_| fs::remove_file(&self.lock_path))
            {
                if let Some(directory) = self.directory.take() {
                    let _ = directory.keep();
                }

                return Err(error);
            }
        }

        if let Some(directory) = self.directory.take() {
            let path = directory.keep();

            if !self.retain {
                fs::remove_dir_all(path)?;
            }
        }

        Ok(())
    }
}

impl Drop for Transaction {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

impl Repository {
    /// Commit selected current files/lines or the existing index, preserving excluded staging.
    ///
    /// Acquires the shared write queue and an exclusive real index lock. Git prepares
    /// private indexes; hooks and signing remain enabled. Exact HEAD/branch, partial
    /// patches and directory replacements are rechecked immediately before commit.
    /// Cancellation applies through the initial snapshot. Once private-index preparation
    /// begins the transaction finishes and reaps commands before cleanup; navigation
    /// must not cancel it. Call on an owned worker and retain application close protection.
    ///
    /// Confirmed writes with failed index installation/refresh and unconfirmed process
    /// outcomes return recovery/review warnings, never an ordinary retryable failure.
    /// External writers are not excluded by the application queue; do not blindly retry.
    ///
    /// # Examples
    /// ```no_run
    /// use onegit_git::{CommitFiles, CommitOutcome, GitProcess, Repository};
    /// # fn main() -> Result<(), Box<dyn std::error::Error>> {
    /// let repository = Repository::open(std::path::Path::new("/local/repository"), GitProcess::default(), None)?;
    /// let reviewed = repository.snapshot(false, None)?;
    /// let input = CommitFiles::new(vec!["selected.txt".try_into()?], "Save selected work".into(), &reviewed);
    /// let result = repository.commit_selected_files(&input, None)?;
    /// match result.outcome {
    ///     CommitOutcome::Committed if result.warning.is_none() => assert!(result.oid.is_some()),
    ///     _ => eprintln!("Inspect History and recovery instructions: {:?}", result.warning),
    /// }
    /// # Ok(())
    /// # }
    /// ```
    ///
    /// # Errors
    /// Returns exact validation/lock failures or the original typed preparation/command
    /// cause when the tip is confirmed unchanged. No original index rollback is assumed.
    pub fn commit_selected_files(
        &self,
        input: &CommitFiles,
        cancellation: Option<&Cancellation>,
    ) -> Result<CommitResult, CommitError> {
        let _write = self.mutations.enter();

        super::super::check_cancelled(cancellation).map_err(|error| before(error.into()))?;
        self.check_write_identity().map_err(before)?;
        let paths = validate(input)?;
        let message = trim(&input.message);

        let output = self
            .run(
                ["rev-parse", "--path-format=absolute", "--git-path", "index"],
                cancellation,
            )
            .map_err(before)?;

        let mut bytes = output.stdout;

        if bytes.last() == Some(&b'\n') {
            bytes.pop();

            if bytes.last() == Some(&b'\r') {
                bytes.pop();
            }
        }

        let index_path = crate::platform::absolute_path_from_git_bytes(&bytes)
            .map_err(|_| before(RepositoryError::InvalidOutput))?;

        if !index_path.is_absolute() {
            return Err(before(RepositoryError::InvalidOutput));
        }

        let mut transaction = Transaction::new(index_path)?;
        let mut outcome = CommitOutcome::Committed;
        let mut oid = None;
        let mut warning = None;
        let mut committed = false;
        let mut recovery_path = None;

        let execution = (|| {
            let snapshot = self
                .snapshot_uncoordinated(false, cancellation)
                .map_err(before)?;

            let selected = selected_paths(&snapshot, input, &paths)?;

            if input.amend {
                self.review_last_commit_uncoordinated(&input.expected, None)?;
            }

            if input.mode != CommitMode::Staged {
                check_file_paths(&self.info.root, &selected)?;
            }

            let partial_paths: HashSet<_> =
                input.partial_files.iter().map(|file| &file.path).collect();

            let stage_paths: Vec<_> = snapshot
                .status
                .files
                .iter()
                .filter(|file| {
                    paths.iter().any(|path| exact(path, &file.path))
                        && !partial_paths.contains(&file.path)
                        && file.index_status != FileStatus::Deleted
                })
                .flat_map(|file| {
                    let mut paths = Vec::new();

                    if file.worktree_status == FileStatus::Renamed {
                        paths.extend(file.original_path.iter().cloned());
                    }

                    paths.push(file.path.clone());

                    paths
                })
                .collect();

            let directory = tempfile::Builder::new()
                .prefix("1git-commit-")
                .tempdir_in(&self.info.git_directory)
                .map_err(|error| before(error.into()))?;

            let directory_path = directory.path().to_owned();
            let index = directory_path.join("index");

            let commit_index = if input.partial_files.is_empty() {
                index.clone()
            } else {
                directory_path.join("commit-index")
            };

            let path_file = directory_path.join("paths");

            recovery_path = Some(directory_path.clone());
            transaction.directory = Some(directory);

            // Private-index preparation onward deliberately uses no caller cancellation.
            match fs::copy(&transaction.index_path, &index) {
                Ok(_) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    self.commit_run(["read-tree", "--empty"], Some(&index), &[])
                        .map_err(before)?;
                }
                Err(error) => return Err(before(error.into())),
            }

            if input.mode != CommitMode::Staged && !stage_paths.is_empty() {
                self.add_commit_paths(&index, &stage_paths)
                    .map_err(before)?;
            }

            if !input.partial_files.is_empty() {
                self.commit_run(
                    [
                        "read-tree",
                        snapshot.status.head.oid.as_deref().unwrap_or("--empty"),
                    ],
                    Some(&commit_index),
                    &[],
                )
                .map_err(before)?;
                let whole: Vec<_> = selected
                    .iter()
                    .filter(|path| !partial_paths.contains(path))
                    .cloned()
                    .collect();

                if !whole.is_empty() {
                    self.add_commit_paths(&commit_index, &whole)
                        .map_err(before)?;
                }

                for file in &input.partial_files {
                    self.check_commit_patch(file)?;
                    let patch = PartialPatch::new(&file.expected_patch)
                        .and_then(|patch| patch.select(&file.included_lines))
                        .map_err(|error| {
                            CommitError::invalid(ErrorCode::InvalidInput, &error.to_string())
                        })?;

                    self.commit_run(
                        ["apply", "--cached", "--whitespace=nowarn", "-"],
                        Some(&commit_index),
                        patch.as_bytes(),
                    )
                    .map_err(before)?;
                }
            }

            let mut file = crate::platform::create_private_file(&path_file)
                .map_err(|error| before(error.into()))?;

            let pathspecs =
                crate::git_path::pathspec_list(&selected).map_err(|error| before(error.into()))?;
            file.write_all(&pathspecs)
                .map_err(|error| before(error.into()))?;
            drop(file);
            self.check_write_identity().map_err(before)?;
            selected_paths(
                &self.snapshot_uncoordinated(false, None).map_err(before)?,
                input,
                &paths,
            )?;

            for file in &input.partial_files {
                self.check_commit_patch(file)?;
            }

            if input.mode != CommitMode::Staged {
                check_file_paths(&self.info.root, &selected)?;
            }

            if input.amend {
                self.retain_amended_commit(&input.expected)?;
            }

            let mut args: Vec<OsString> = vec!["commit".into(), "-F".into(), "-".into()];

            if input.amend {
                args.push("--amend".into());
            }

            if input.mode != CommitMode::Staged && input.partial_files.is_empty() {
                args.insert(0, "--literal-pathspecs".into());
                args.push("--only".into());

                if !selected.is_empty() {
                    let mut option = OsString::from("--pathspec-from-file=");

                    option.push(
                        crate::platform::git_native_path(&path_file)
                            .map_err(|error| before(error.into()))?,
                    );
                    args.extend([option, "--pathspec-file-nul".into()]);
                }
            }

            match self.commit_run(args, Some(&commit_index), format!("{message}\n").as_bytes()) {
                Ok(_) => committed = true,
                Err(error) => {
                    let after = self.snapshot_uncoordinated(false, None).ok();

                    if after.as_ref().is_some_and(|after| {
                        after.status.head.oid == snapshot.status.head.oid
                            && after.status.head.branch == snapshot.status.head.branch
                    }) {
                        return Err(CommitError::repository(WritePhase::Command, error));
                    }

                    outcome = CommitOutcome::Unknown;
                    transaction.retain = true;
                    oid = after.and_then(|after| after.status.head.oid);
                    warning = Some(format!(
                        "Commit outcome is uncertain. Inspect History before retrying. The original index is unchanged; recovery files are in {}.",
                        directory_path.display()
                    ));
                }
            }

            if committed {
                let install = (|| -> Result<(), RepositoryError> {
                    if !input.partial_files.is_empty() {
                        let mut option = OsString::from("--pathspec-from-file=");

                        option.push(crate::platform::git_native_path(&path_file)?);
                        self.commit_run(
                            [
                                OsString::from("--literal-pathspecs"),
                                "reset".into(),
                                "-q".into(),
                                "HEAD".into(),
                                option,
                                "--pathspec-file-nul".into(),
                            ],
                            Some(&index),
                            &[],
                        )?;
                    }

                    self.check_write_identity()?;
                    transaction.install(&index)?;

                    Ok(())
                })();

                if install.is_err() {
                    transaction.retain = true;
                    warning = Some(format!(
                        "Commit created, but the index could not be updated. Do not recommit. Recovery index: {}.",
                        index.display()
                    ));
                }
            }

            Ok(())
        })();

        let cleanup = transaction.cleanup();

        if let Err(error) = cleanup {
            if committed || outcome == CommitOutcome::Unknown {
                let location = recovery_path.as_deref().unwrap_or(&transaction.lock_path);

                warning = Some(format!(
                    "{} Transaction cleanup failed. Inspect {} before continuing.",
                    warning.as_deref().unwrap_or("Commit created."),
                    location.display()
                ));
            } else if execution.is_ok() {
                return Err(before(error.into()));
            }
        }

        execution?;
        let snapshot = match self.snapshot_uncoordinated(false, None) {
            Ok(snapshot) => {
                oid = snapshot.status.head.oid.clone();

                Some(snapshot)
            }
            Err(_) => {
                warning.get_or_insert_with(||"Commit created, but refreshing the repository failed. Refresh before committing again.".to_owned());

                None
            }
        };

        Ok(CommitResult {
            outcome,
            oid,
            snapshot,
            warning,
        })
    }

    fn commit_run(
        &self,
        args: impl IntoIterator<Item = impl Into<OsString>>,
        index: Option<&Path>,
        stdin: &[u8],
    ) -> Result<GitOutput, RepositoryError> {
        let mut command = GitCommand::new(&self.info.root, args);

        command.directory = Some(&self.root_directory);
        command.index_file = index;
        command.stdin = stdin;

        Ok(self.process.run(command)?)
    }

    fn add_commit_paths(&self, index: &Path, paths: &[GitPath]) -> Result<(), RepositoryError> {
        self.commit_run(
            [
                "--literal-pathspecs",
                "add",
                "--all",
                "--pathspec-from-file=-",
                "--pathspec-file-nul",
            ],
            Some(index),
            &crate::git_path::pathspec_list(paths)?,
        )?;

        Ok(())
    }

    fn check_commit_patch(&self, file: &PartialCommitFile) -> Result<(), CommitError> {
        let paths = [file.path.clone()];
        let mut options = DiffOptions::new(DiffTarget::Changes);

        options.paths = Some(&paths);
        let current = self.diff_uncoordinated(options, None).map_err(before)?;

        if current.patch != file.expected_patch {
            return Err(CommitError::invalid(
                ErrorCode::InvalidInput,
                &format!(
                    "“{}” changed since you selected lines. Refresh and review its inclusion before committing.",
                    file.path.display()
                ),
            ));
        }

        Ok(())
    }

    fn retain_amended_commit(&self, expected: &BranchIdentity) -> Result<(), CommitError> {
        let commit = self.review_last_commit_uncoordinated(expected, None)?;
        let id = super::super::mutations::recovery_id().map_err(|error| before(error.into()))?;
        let branch = expected.branch.as_deref().unwrap_or("");

        let transaction = format!(
            "start\nverify refs/heads/{branch} {}\ncreate refs/1git/amend/{id} {}\nprepare\ncommit\n",
            commit.oid, commit.oid
        );

        self.commit_run(
            ["update-ref", "-m", "1git: retain amended commit", "--stdin"],
            None,
            transaction.as_bytes(),
        )
        .map_err(before)?;

        Ok(())
    }
}

fn before(error: RepositoryError) -> CommitError {
    CommitError::repository(WritePhase::BeforeCommand, error)
}

fn exact(a: &GitPath, b: &GitPath) -> bool {
    a == b
}

fn trim(value: &str) -> &str {
    value.trim_matches(|ch|matches!(ch,'\u{0009}'..='\u{000d}'|'\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}'))
}

fn validate(input: &CommitFiles) -> Result<Vec<GitPath>, CommitError> {
    let staged = input.mode == CommitMode::Staged;

    if input.amend && staged {
        return Err(CommitError::invalid(
            ErrorCode::InvalidInput,
            "Amend uses selected files, not staged mode.",
        ));
    }

    let mut paths = Vec::new();
    let mut seen = HashSet::new();

    if !(staged || input.amend && input.paths.is_empty()) {
        if input.paths.is_empty() {
            return Err(CommitError::invalid(
                ErrorCode::InvalidInput,
                "At least one repository path is required.",
            ));
        }

        for path in &input.paths {
            if let Err(error) = crate::validation::require_paths([path]) {
                if !matches!(error, RepositoryError::InvalidPath) {
                    return Err(before(error));
                }
                return Err(CommitError::invalid(
                    ErrorCode::InvalidPath,
                    &format!(
                        "Repository path \"{}\" must stay within the repository.",
                        path.display()
                    ),
                ));
            }

            if seen.insert(path) {
                paths.push(path.clone());
            }
        }
    }

    let partials: HashSet<&GitPath> = input.partial_files.iter().map(|file| &file.path).collect();

    if partials.len() != input.partial_files.len()
        || input
            .partial_files
            .iter()
            .any(|file| !paths.iter().any(|path| exact(path, &file.path)))
        || (staged && !input.partial_files.is_empty())
    {
        return Err(CommitError::invalid(
            ErrorCode::InvalidInput,
            "Partial selections must belong to selected files.",
        ));
    }

    let message = trim(&input.message);

    if message.is_empty() || message.contains('\0') {
        return Err(CommitError::invalid(
            ErrorCode::InvalidInput,
            "Commit message must be non-empty and contain no NUL.",
        ));
    }

    if trim(input.message.split('\n').next().unwrap_or("")).is_empty() {
        return Err(CommitError::invalid(
            ErrorCode::InvalidInput,
            "A first-line summary is required.",
        ));
    }

    Ok(paths)
}

fn selected_paths(
    snapshot: &Snapshot,
    input: &CommitFiles,
    paths: &[GitPath],
) -> Result<Vec<GitPath>, CommitError> {
    if snapshot.status.head.oid != input.expected.oid
        || snapshot.status.head.branch != input.expected.branch
    {
        return Err(CommitError::invalid(
            ErrorCode::InvalidInput,
            "HEAD or the branch changed. Refresh and review your selection before committing.",
        ));
    }

    if snapshot.operation != OperationState::Normal
        || snapshot
            .status
            .files
            .iter()
            .any(|file| file.record_type == RecordType::Unmerged)
    {
        return Err(CommitError::invalid(
            ErrorCode::Conflict,
            "Finish the merge, rebase or conflict resolution before committing here.",
        ));
    }

    if input.mode == CommitMode::Staged {
        let staged: Vec<_> = snapshot
            .status
            .files
            .iter()
            .filter(|file| {
                !matches!(
                    file.record_type,
                    RecordType::Untracked | RecordType::Ignored
                ) && file.index_status != FileStatus::Unmodified
            })
            .map(|file| file.path.clone())
            .collect();

        if staged.is_empty() {
            return Err(CommitError::invalid(
                ErrorCode::InvalidInput,
                "Stage changes before committing.",
            ));
        }

        return Ok(staged);
    }

    let mut selected = Vec::new();
    let mut seen = HashSet::new();

    for path in paths {
        let file = snapshot
            .status
            .files
            .iter()
            .find(|file| exact(&file.path, path))
            .filter(|file| file.record_type != RecordType::Ignored)
            .ok_or_else(|| {
                CommitError::invalid(
                    ErrorCode::InvalidInput,
                    &format!(
                        "“{}” is no longer a changed file. Refresh before committing.",
                        path.display()
                    ),
                )
            })?;

        if file.submodule != "N..." {
            return Err(CommitError::invalid(
                ErrorCode::InvalidInput,
                &format!("Commit submodule changes in Git first: {}", path.display()),
            ));
        }

        if !input.include_partial_staging
            && file.record_type != RecordType::Untracked
            && file.index_status != FileStatus::Unmodified
            && file.worktree_status != FileStatus::Unmodified
        {
            return Err(CommitError::invalid(
                ErrorCode::InvalidInput,
                &format!(
                    "“{}” is partially staged. Stage or unstage the whole file in Git, then refresh, or exclude it from this commit.",
                    path.display()
                ),
            ));
        }

        if seen.insert(&file.path) {
            selected.push(file.path.clone());
        }

        if let Some(original) = file.original_path.as_ref().filter(|_| {
            file.index_status == FileStatus::Renamed || file.worktree_status == FileStatus::Renamed
        }) {
            if snapshot
                .status
                .files
                .iter()
                .any(|other| exact(&other.path, original))
            {
                return Err(CommitError::invalid(
                    ErrorCode::InvalidInput,
                    &format!(
                        "The renamed source “{}” also has changes. Resolve the rename in Git before committing here.",
                        original.display()
                    ),
                ));
            }

            if seen.insert(original) {
                selected.push(original.clone());
            }
        }
    }

    Ok(selected)
}

fn check_file_paths(root: &Path, paths: &[GitPath]) -> Result<(), CommitError> {
    for path in paths {
        let native = path.to_native().map_err(|error| before(error.into()))?;

        match fs::symlink_metadata(root.join(native)) {
            Ok(metadata) if metadata.is_dir() => {
                return Err(CommitError::invalid(
                    ErrorCode::InvalidInput,
                    &format!(
                        "“{}” is now a directory. Resolve this file/directory change in Git before committing here.",
                        path.display()
                    ),
                ));
            }
            Ok(_) => {}
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
                ) => {}
            Err(error) => return Err(before(error.into())),
        }
    }

    Ok(())
}
