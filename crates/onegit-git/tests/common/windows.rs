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

pub fn open_directory(path: &Path) -> std::fs::File {
    use std::os::windows::fs::OpenOptionsExt;

    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .unwrap()
}

pub fn remove_directory_link(path: &Path) {
    std::fs::remove_dir(path).unwrap();
}

pub fn random_bytes(bytes: &mut [u8]) {
    use windows_sys::Win32::Security::Cryptography::{
        BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom,
    };
    // SAFETY: the system RNG writes the stated length into this live mutable slice.
    let status = unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            bytes.as_mut_ptr(),
            bytes.len().try_into().unwrap(),
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };

    assert_eq!(status, 0);
}
