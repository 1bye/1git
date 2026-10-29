use super::*;
use crate::{RepositoryInfo, parse_status};

#[test]
fn bulk_selection_preserves_input_order_deduplicates_and_rejects_unknown_paths() {
    let count = 10_000;

    let paths: Vec<_> = (0..count)
        .map(|i| GitPath::new(format!("file [{i}] été")).unwrap())
        .collect();

    let mut porcelain = b"# branch.oid (initial)\0# branch.head main\0".to_vec();

    for path in &paths {
        porcelain.extend_from_slice(b"? ");
        porcelain.extend_from_slice(path.as_bytes());
        porcelain.push(0);
    }

    let snapshot = Snapshot {
        repository: RepositoryInfo {
            root: PathBuf::new(),
            git_directory: PathBuf::new(),
            common_directory: PathBuf::new(),
            is_shallow: false,
        },
        status: parse_status(&porcelain).unwrap(),
        operation: OperationState::Normal,
        operation_token: None,
    };

    let expected: Vec<_> = paths.iter().rev().cloned().collect();
    let mut input = CommitFiles::new(expected.clone(), "Bulk selection".into(), &snapshot);

    input.paths.extend(paths);
    let validated = validate(&input).unwrap();

    assert_eq!(validated, expected);
    assert_eq!(
        selected_paths(&snapshot, &input, &validated).unwrap(),
        expected
    );
    input.paths.push(GitPath::new("missing").unwrap());
    assert!(selected_paths(&snapshot, &input, &validate(&input).unwrap()).is_err());
}
