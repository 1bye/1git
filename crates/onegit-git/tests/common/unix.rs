//! Unix-only fixture operations.
#![allow(dead_code)]
#[allow(unused_imports)]
pub use std::os::unix::ffi::{OsStrExt, OsStringExt};
#[allow(unused_imports)]
pub use std::os::unix::fs::{PermissionsExt, symlink};

pub fn exit_status(code: i32) -> std::process::ExitStatus {
    use std::os::unix::process::ExitStatusExt;
    std::process::ExitStatus::from_raw(code << 8)
}

pub fn remove_directory_link(path: &std::path::Path) {
    std::fs::remove_file(path).unwrap();
}
