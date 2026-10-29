//! Covers: stable error codes/messages/retries, credential redaction and diagnostic bounds.
//! Real: public error translation and regex classification against frozen TypeScript outputs.
//! Doubles: synthetic exit statuses/diagnostics; no process, credentials or network.
//! Requires: none.

use std::io;

mod common;

use onegit_git::{
    ErrorCode, Failure, GitError, GitOutput, Operation, RepositoryError, StatusParseError,
};

use serde_json::Value;

#[test]
fn matches_all_frozen_legacy_command_failures() {
    let reference: Value = serde_json::from_str(include_str!("failure-reference.json")).unwrap();

    for case in reference["cases"].as_array().unwrap() {
        let error = GitError::CommandFailed {
            status: common::exit_status(128),
            output: GitOutput {
                stdout: case["stdout"].as_str().unwrap().as_bytes().to_vec(),
                stderr: case["stderr"].as_str().unwrap().as_bytes().to_vec(),
            },
        };

        let failure = Failure::from_process(Operation::Fetch, &error);
        let expected = &case["expected"];

        assert_eq!(failure.code.as_str(), expected["code"].as_str().unwrap());
        assert_eq!(
            failure.operation.as_str(),
            expected["operation"].as_str().unwrap()
        );
        assert_eq!(failure.message, expected["message"].as_str().unwrap());
        assert_eq!(failure.details.as_deref(), expected["details"].as_str());
        assert_eq!(
            failure.exit_code,
            expected["exitCode"].as_i64().map(|code| code as i32)
        );
        assert_eq!(failure.retryable, expected["retryable"].as_bool().unwrap());
        assert!(!format!("{failure:?}").contains("fixture-password"));
    }
}

#[test]
fn preserves_process_and_validation_categories_without_marking_them_retryable() {
    for (error, expected) in [
        (GitError::Cancelled, ErrorCode::Aborted),
        (
            GitError::GitNotFound(io::Error::from(io::ErrorKind::NotFound)),
            ErrorCode::GitNotFound,
        ),
        (
            GitError::OutputTooLarge { limit: 64 },
            ErrorCode::OutputTooLarge,
        ),
        (GitError::TimedOut, ErrorCode::CommandFailed),
    ] {
        let failure = Failure::from_process(Operation::GetSnapshot, &error);

        assert_eq!(failure.code, expected);
        assert!(!failure.retryable);
        assert!(failure.exit_code.is_none());
    }

    let malformed = Failure::from_repository(
        Operation::GetSnapshot,
        &RepositoryError::Status(StatusParseError),
    );

    let bare =
        Failure::from_repository(Operation::OpenRepository, &RepositoryError::BareRepository);

    let invalid = Failure::invalid(
        Operation::Stage,
        ErrorCode::InvalidPath,
        "Path must stay within the repository.",
    );

    assert_eq!(malformed.code, ErrorCode::CommandFailed);
    assert_eq!(bare.code, ErrorCode::BareRepository);
    assert_eq!(
        Failure::from_repository(
            Operation::GetHistory,
            &RepositoryError::PathOutsideRepository
        )
        .code,
        ErrorCode::InvalidPath
    );
    assert_eq!(invalid.code, ErrorCode::InvalidPath);
    assert_eq!(invalid.operation, Operation::Stage);
    assert!(invalid.details.is_none());
}

#[test]
fn bounds_unicode_diagnostics_in_utf16_units_without_splitting_a_character() {
    let error = GitError::CommandFailed {
        status: common::exit_status(1),
        output: GitOutput {
            stdout: Vec::new(),
            stderr: format!("x{}", "😀".repeat(3000)).into_bytes(),
        },
    };

    let failure = Failure::from_process(Operation::Fetch, &error);
    let details = failure.details.unwrap();

    assert_eq!(details.encode_utf16().count(), 3999);
    assert!(details.ends_with('😀'));
}
