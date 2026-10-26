//! Windows fixture operations. Symlink tests require developer mode or symlink privilege.
#![allow(dead_code)]
use std::io;
use std::path::Path;

pub fn symlink(original: impl AsRef<Path>, link: impl AsRef<Path>) -> io::Result<()> {
    let target = if original.as_ref().is_absolute() {
        original.as_ref().to_owned()
    } else {
        link.as_ref()
            .parent()
            .unwrap_or(Path::new("."))
            .join(original.as_ref())
    };
    if target.is_dir() {
        std::os::windows::fs::symlink_dir(original, link)
    } else {
        std::os::windows::fs::symlink_file(original, link)
    }
}

pub fn exit_status(code: i32) -> std::process::ExitStatus {
    use std::os::windows::process::ExitStatusExt;
    std::process::ExitStatus::from_raw(code as u32)
}
