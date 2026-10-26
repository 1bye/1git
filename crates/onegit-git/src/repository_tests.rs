//! Covers: operation precedence and marker tokens compared with the old snapshot loader.
//! Real: filesystem marker reads and SHA-256 hashing.
//! Doubles: frozen synthetic metadata files; the reference used a static Git status response.
//! Requires: writable temporary storage; no Git, network or user data.

use std::fs;

use serde_json::Value;

use super::{operation_state, operation_token};
use crate::{Cancellation, GitError, OperationState, RepositoryError};

#[test]
fn matches_frozen_typescript_operation_states_and_tokens() {
    let reference: Value = serde_json::from_str(include_str!("operation-reference.json")).unwrap();

    for case in reference["cases"].as_array().unwrap() {
        let temporary = tempfile::tempdir().unwrap();

        for (name, content) in case["files"].as_object().unwrap() {
            let path = temporary.path().join(name);

            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, content.as_str().unwrap()).unwrap();
        }

        let operation = operation_state(temporary.path()).unwrap();
        let token = operation_token(temporary.path(), operation, None).unwrap();

        assert_eq!(
            operation.name(),
            case["operation"].as_str().unwrap(),
            "{}",
            case["name"]
        );
        assert_eq!(token.as_deref(), case["token"].as_str(), "{}", case["name"]);
    }
}

#[test]
fn metadata_changes_invalidate_the_token_and_cancellation_stops_the_read() {
    let temporary = tempfile::tempdir().unwrap();

    fs::write(temporary.path().join("MERGE_HEAD"), "first\n").unwrap();

    let before = operation_token(temporary.path(), OperationState::Merge, None).unwrap();

    fs::write(temporary.path().join("MERGE_HEAD"), "second\n").unwrap();

    let after = operation_token(temporary.path(), OperationState::Merge, None).unwrap();

    assert_ne!(before, after);

    let cancellation = Cancellation::default();

    cancellation.cancel();

    assert!(matches!(
        operation_token(temporary.path(), OperationState::Merge, Some(&cancellation)),
        Err(RepositoryError::Git(GitError::Cancelled))
    ));
}
