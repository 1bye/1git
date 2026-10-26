//! Checked patch application and the source's explicit staged-step compensation.
//! Held file input pins the captured payload; it is never reopened by patch pathname.

use std::path::PathBuf;

use super::recovery::{Patch, Recovery};
use crate::repository::{Repository, RepositoryError, WriteError, WritePhase};
use crate::{Cancellation, GitCommand};

enum PatchMode {
    CheckReverse,
    CheckReverseIndex,
    Reverse,
    ReverseIndex,
    Forward,
    ForwardIndex,
}

type StepFailure = (WriteError, Option<RepositoryError>);

impl Repository {
    pub(super) fn perform_discard(
        &self,
        backup: &mut Recovery,
        cancellation: Option<&Cancellation>,
    ) -> Result<(), StepFailure> {
        let mut mutated = false;

        backup
            .check_identity()
            .and_then(|_| backup.staged.verify(cancellation))
            .and_then(|_| backup.working.verify(cancellation))
            .map_err(|error| {
                (
                    WriteError {
                        phase: WritePhase::BeforeCommand,
                        error,
                    },
                    None,
                )
            })?;

        self.apply_saved_patch(
            &mut backup.working,
            &backup.paths,
            PatchMode::CheckReverse,
            cancellation,
            &mut mutated,
        )
        .map_err(|error| (error, None))?;
        self.apply_saved_patch(
            &mut backup.staged,
            &backup.paths,
            PatchMode::CheckReverseIndex,
            cancellation,
            &mut mutated,
        )
        .map_err(|error| (error, None))?;
        self.apply_saved_patch(
            &mut backup.working,
            &backup.paths,
            PatchMode::Reverse,
            cancellation,
            &mut mutated,
        )
        .map_err(|error| (error, None))?;

        if let Err(original) = self.apply_saved_patch(
            &mut backup.staged,
            &backup.paths,
            PatchMode::Reverse,
            cancellation,
            &mut mutated,
        ) {
            let rollback = self
                .apply_saved_patch(
                    &mut backup.working,
                    &backup.paths,
                    PatchMode::Forward,
                    cancellation,
                    &mut mutated,
                )
                .err()
                .map(|error| error.error);

            return Err((original, rollback));
        }

        if let Err(original) = self.apply_saved_patch(
            &mut backup.staged,
            &backup.paths,
            PatchMode::ReverseIndex,
            cancellation,
            &mut mutated,
        ) {
            let first = self
                .apply_saved_patch(
                    &mut backup.staged,
                    &backup.paths,
                    PatchMode::Forward,
                    cancellation,
                    &mut mutated,
                )
                .err();

            let second = self
                .apply_saved_patch(
                    &mut backup.working,
                    &backup.paths,
                    PatchMode::Forward,
                    cancellation,
                    &mut mutated,
                )
                .err();

            return Err((original, first.or(second).map(|error| error.error)));
        }

        Ok(())
    }

    pub(super) fn perform_undo(
        &self,
        backup: &mut Recovery,
        cancellation: Option<&Cancellation>,
    ) -> Result<(), StepFailure> {
        let mut mutated = false;

        backup
            .check_identity()
            .and_then(|_| backup.staged.verify(cancellation))
            .and_then(|_| backup.working.verify(cancellation))
            .map_err(|error| {
                (
                    WriteError {
                        phase: WritePhase::BeforeCommand,
                        error,
                    },
                    None,
                )
            })?;

        self.apply_saved_patch(
            &mut backup.staged,
            &backup.paths,
            PatchMode::ForwardIndex,
            cancellation,
            &mut mutated,
        )
        .map_err(|error| (error, None))?;

        if let Err(original) = self.apply_saved_patch(
            &mut backup.staged,
            &backup.paths,
            PatchMode::Forward,
            cancellation,
            &mut mutated,
        ) {
            let rollback = self
                .apply_saved_patch(
                    &mut backup.staged,
                    &backup.paths,
                    PatchMode::ReverseIndex,
                    cancellation,
                    &mut mutated,
                )
                .err()
                .map(|error| error.error);

            return Err((original, rollback));
        }

        if let Err(original) = self.apply_saved_patch(
            &mut backup.working,
            &backup.paths,
            PatchMode::Forward,
            cancellation,
            &mut mutated,
        ) {
            let first = self
                .apply_saved_patch(
                    &mut backup.staged,
                    &backup.paths,
                    PatchMode::Reverse,
                    cancellation,
                    &mut mutated,
                )
                .err();

            let second = self
                .apply_saved_patch(
                    &mut backup.staged,
                    &backup.paths,
                    PatchMode::ReverseIndex,
                    cancellation,
                    &mut mutated,
                )
                .err();

            return Err((original, first.or(second).map(|error| error.error)));
        }

        Ok(())
    }

    fn apply_saved_patch(
        &self,
        patch: &mut Patch,
        paths: &[PathBuf],
        mode: PatchMode,
        cancellation: Option<&Cancellation>,
        mutated: &mut bool,
    ) -> Result<(), WriteError> {
        let phase = if *mutated {
            WritePhase::Command
        } else {
            WritePhase::BeforeCommand
        };

        let before = |error| WriteError { phase, error };

        patch.verify(cancellation).map_err(before)?;

        if patch.size == 0 {
            return Ok(());
        }

        self.validate_discard_files(paths).map_err(before)?;
        self.check_write_identity().map_err(before)?;
        let check = matches!(mode, PatchMode::CheckReverse | PatchMode::CheckReverseIndex);

        let cached = matches!(
            mode,
            PatchMode::CheckReverseIndex | PatchMode::ReverseIndex | PatchMode::ForwardIndex
        );

        let reverse = matches!(
            mode,
            PatchMode::CheckReverse
                | PatchMode::CheckReverseIndex
                | PatchMode::Reverse
                | PatchMode::ReverseIndex
        );

        let mut command = GitCommand::new(
            &self.info.root,
            ["apply", "--recount", "--whitespace=nowarn"],
        );

        if check {
            command.args.push("--check".into());
        }

        if cached {
            command.args.push("--cached".into());
        }

        if reverse {
            command.args.push("--reverse".into());
        }

        command.directory = Some(&self.root_directory);
        command.stdin_file = Some(
            patch
                .file
                .try_clone()
                .map_err(|error| before(error.into()))?,
        );
        command.cancellation = cancellation;

        if !check {
            *mutated = true;
        }

        let phase = if *mutated {
            WritePhase::Command
        } else {
            WritePhase::BeforeCommand
        };

        self.process.run(command).map_err(|error| WriteError {
            phase,
            error: error.into(),
        })?;

        Ok(())
    }
}
