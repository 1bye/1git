//! Windows handle-relative filesystem and Job Object process ownership.

use std::borrow::Cow;
use std::ffi::OsStr;
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Write};
use std::mem::{size_of, size_of_val};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::os::windows::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command};
use std::ptr::{null, null_mut};
use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError, TrySendError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
use windows_sys::Wdk::Storage::FileSystem::{
    FILE_CREATE, FILE_DIRECTORY_FILE, FILE_OPEN, FILE_OPEN_REPARSE_POINT,
    FILE_SYNCHRONOUS_IO_NONALERT, NtCreateFile,
};
use windows_sys::Win32::Foundation::{
    ERROR_CANT_ACCESS_FILE, ERROR_DIRECTORY, ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND,
    ERROR_STOPPED_ON_SYMLINK, HANDLE, INVALID_HANDLE_VALUE, LocalFree, RtlNtStatusToDosError,
    UNICODE_STRING,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo, SE_FILE_OBJECT,
    SetSecurityInfo,
};
use windows_sys::Win32::Security::Cryptography::{
    BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom,
};
use windows_sys::Win32::Security::{
    ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, DACL_SECURITY_INFORMATION, EqualSid, GetAce,
    GetSecurityDescriptorControl, GetSecurityDescriptorDacl, PROTECTED_DACL_SECURITY_INFORMATION,
    PSECURITY_DESCRIPTOR, SE_DACL_PROTECTED, SECURITY_ATTRIBUTES,
};
use windows_sys::Win32::Storage::FileSystem::{
    CREATE_NEW, CreateFileW, FILE_ALL_ACCESS, FILE_APPEND_DATA, FILE_ATTRIBUTE_NORMAL,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_TAG_INFO, FILE_BASIC_INFO,
    FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_GENERIC_READ,
    FILE_GENERIC_WRITE, FILE_ID_INFO, FILE_INFO_BY_HANDLE_CLASS, FILE_READ_ATTRIBUTES,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_STANDARD_INFO, FileAttributeTagInfo,
    FileBasicInfo, FileIdInfo, FileStandardInfo, GetFileInformationByHandleEx,
    GetFinalPathNameByHandleW, READ_CONTROL, ReOpenFile, SYNCHRONIZE, VOLUME_NAME_NONE, WRITE_DAC,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
};
use windows_sys::Win32::System::IO::{CancelSynchronousIo, IO_STATUS_BLOCK};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject,
};
use windows_sys::Win32::System::Threading::{
    CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW, CREATE_SUSPENDED, OpenThread, ResumeThread,
    THREAD_SUSPEND_RESUME,
};

use super::{Access, FileState, PathEncodingError, Signal, windows_policy};

pub(crate) fn path_from_git_bytes(bytes: &[u8]) -> Result<PathBuf, PathEncodingError> {
    let text = std::str::from_utf8(bytes).map_err(|_| PathEncodingError)?;
    let path = PathBuf::from(windows_policy::relative_git_path(text)?.as_ref());

    if path.has_root()
        || path
            .components()
            .any(|part| matches!(part, Component::Prefix(_)))
    {
        return Err(PathEncodingError);
    }

    Ok(path)
}

pub(crate) fn absolute_path_from_git_bytes(bytes: &[u8]) -> Result<PathBuf, PathEncodingError> {
    let text = std::str::from_utf8(bytes).map_err(|_| PathEncodingError)?;
    let path = PathBuf::from(text);

    if !path.is_absolute() || text.contains('\0') {
        return Err(PathEncodingError);
    }

    Ok(path)
}

pub(crate) fn path_to_git_bytes(path: &OsStr) -> Result<Cow<'_, [u8]>, PathEncodingError> {
    let text = path.to_str().ok_or(PathEncodingError)?;
    Ok(Cow::Owned(
        windows_policy::git_path_text(text)?
            .into_owned()
            .into_bytes(),
    ))
}

fn path_error() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, PathEncodingError)
}

pub(crate) const GRACEFUL_TERMINATION: bool = false;

pub(crate) fn validate_path_argument(path: &Path) -> io::Result<()> {
    // Windows: private Git escapes are display/transport values, never native file names
    // or direct Git argv. Refuse them before a command could select an unrelated entry.
    if path
        .to_str()
        .is_some_and(|text| text.contains(windows_policy::GIT_ESCAPE))
    {
        return Err(path_error());
    }

    Ok(())
}

fn validate_filesystem_path(path: &Path) -> io::Result<()> {
    validate_path_argument(path)?;
    let encoded = path_to_git_bytes(path.as_os_str()).map_err(|_| path_error())?;
    let text = std::str::from_utf8(&encoded).map_err(|_| path_error())?;

    for (index, part) in text.split('/').enumerate() {
        if matches!(part, "" | "." | "..")
            || index == 0 && part.len() == 2 && windows_policy::drive_prefix(part)
        {
            continue;
        }
        if !windows_policy::component_representable(part) {
            return Err(path_error());
        }
    }

    Ok(())
}

pub(crate) fn validate_relative_filesystem_path(path: &Path) -> io::Result<()> {
    validate_filesystem_path(path)?;

    if path.has_root()
        || path.components().any(|part| {
            matches!(
                part,
                Component::Prefix(_) | Component::RootDir | Component::ParentDir
            )
        })
    {
        return Err(path_error());
    }

    Ok(())
}

pub(crate) fn sync_directory(_directory: &File) -> io::Result<()> {
    // Windows: deliberately no directory fsync. NTFS journals metadata consistency,
    // but this does not promise Unix-equivalent power-loss durability of new names.
    // File sync_all calls remain mandatory; no extra directory write access is requested.
    Ok(())
}

fn wide(path: &OsStr) -> io::Result<Vec<u16>> {
    let mut text: Vec<_> = path.encode_wide().collect();

    if text.contains(&0) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Path contains NUL",
        ));
    }

    text.push(0);

    Ok(text)
}

fn owned_handle(handle: HANDLE) -> io::Result<OwnedHandle> {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }

    // SAFETY: the caller transfers a newly created, valid, uniquely owned kernel handle.
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

fn query<T: Default>(file: &File, class: FILE_INFO_BY_HANDLE_CLASS) -> io::Result<T> {
    let mut info = T::default();

    // SAFETY: each caller pairs the information class with its exact C layout and size;
    // file is live and info is writable for the duration of the call.
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            class,
            (&mut info as *mut T).cast(),
            size_of::<T>() as u32,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }

    Ok(info)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct FileIdentity(u64, [u8; 16]);

impl FileIdentity {
    pub(crate) fn from_file(file: &File) -> io::Result<Self> {
        let info: FILE_ID_INFO = query(file, FileIdInfo)
            .map_err(|error| io::Error::new(io::ErrorKind::Unsupported, error))?;

        if !windows_policy::valid_file_id(&info.FileId.Identifier) {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "Filesystem returned no stable 128-bit file ID",
            ));
        }

        Ok(Self(info.VolumeSerialNumber, info.FileId.Identifier))
    }

    pub(crate) fn from_path(path: &Path) -> io::Result<Self> {
        validate_filesystem_path(path)?;
        let file = OpenOptions::new()
            .access_mode(FILE_READ_ATTRIBUTES)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
            .open(path)?;

        Self::from_file(&file)
    }
}

pub(crate) fn file_state(file: &File) -> io::Result<FileState> {
    // Windows: file attributes replace POSIX mode bits; filesystem timestamps may
    // update later and at coarser resolution than Unix nanosecond mtime/ctime.
    let basic: FILE_BASIC_INFO = query(file, FileBasicInfo)?;
    let standard: FILE_STANDARD_INFO = query(file, FileStandardInfo)?;

    Ok(FileState {
        identity: FileIdentity::from_file(file)?,
        length: standard.EndOfFile as u64,
        regular: !standard.Directory,
        links: standard.NumberOfLinks.into(),
        attributes: basic.FileAttributes,
        modified: (basic.LastWriteTime, 0),
        changed: (basic.ChangeTime, 0),
    })
}

pub(crate) fn is_missing_or_not_regular(error: &io::Error) -> bool {
    matches!(
        error.raw_os_error().map(|code| code as u32),
        Some(
            ERROR_FILE_NOT_FOUND
                | ERROR_PATH_NOT_FOUND
                | ERROR_DIRECTORY
                | ERROR_CANT_ACCESS_FILE
                | ERROR_STOPPED_ON_SYMLINK
        )
    )
}

fn reject_name_surrogate(file: &File) -> io::Result<FILE_ATTRIBUTE_TAG_INFO> {
    let info: FILE_ATTRIBUTE_TAG_INFO = query(file, FileAttributeTagInfo)?;

    if info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
        && windows_policy::name_surrogate(info.ReparseTag)
    {
        return Err(io::Error::from_raw_os_error(
            ERROR_STOPPED_ON_SYMLINK as i32,
        ));
    }

    Ok(info)
}

fn prepare_file(file: File, rights: u32, data_access: bool) -> io::Result<File> {
    let info = reject_name_surrogate(&file)?;

    if !data_access || info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT == 0 {
        return Ok(file);
    }

    let identity = FileIdentity::from_file(&file)?;
    // SAFETY: file is a live filesystem handle; reopening by handle avoids a fresh
    // pathname lookup. Omitting OPEN_REPARSE_POINT lets non-surrogate data filters run.
    let handle = owned_handle(unsafe {
        ReOpenFile(
            file.as_raw_handle(),
            rights,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            FILE_FLAG_BACKUP_SEMANTICS,
        )
    })?;
    let reopened = File::from(handle);
    reject_name_surrogate(&reopened)?;

    if FileIdentity::from_file(&reopened)? != identity {
        return Err(io::Error::other(
            "Reopening the data filter changed file identity",
        ));
    }

    Ok(reopened)
}

pub(crate) fn open_directory_no_follow(path: &Path) -> io::Result<File> {
    validate_filesystem_path(path)?;
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)?;
    let file = prepare_file(file, FILE_GENERIC_READ, true)?;

    if !file.metadata()?.is_dir() {
        return Err(io::Error::from_raw_os_error(ERROR_DIRECTORY as i32));
    }

    Ok(file)
}

// A protected OWNER RIGHTS ACL grants only the object's owner access. Each newly
// created private entry receives it atomically, before any private bytes are written.
// Windows: an elevated token can make Administrators the default owner; OW then
// authorizes that privileged group, comparable to privileged root access on Unix.
struct PrivateSecurity(PSECURITY_DESCRIPTOR);

impl PrivateSecurity {
    fn new() -> io::Result<Self> {
        let sddl = wide(OsStr::new("D:P(A;;FA;;;OW)"))?;
        let mut descriptor = null_mut();

        // SAFETY: sddl is terminated; the API initializes an allocated descriptor on success.
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut descriptor,
                null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }

        Ok(Self(descriptor))
    }

    fn dacl(&self) -> io::Result<*mut ACL> {
        let mut present = 0;
        let mut defaulted = 0;
        let mut dacl = null_mut();

        // SAFETY: self owns a valid descriptor; all out pointers reference initialized locals.
        if unsafe { GetSecurityDescriptorDacl(self.0, &mut present, &mut dacl, &mut defaulted) }
            == 0
            || present == 0
            || dacl.is_null()
        {
            return Err(io::Error::other("Private security descriptor has no DACL"));
        }

        Ok(dacl)
    }
}

impl Drop for PrivateSecurity {
    fn drop(&mut self) {
        // SAFETY: this descriptor was allocated by a Windows security API using LocalAlloc.
        unsafe {
            LocalFree(self.0);
        }
    }
}

pub(crate) fn open_component(parent: &File, name: &OsStr, access: Access) -> io::Result<File> {
    open_entry(parent, name, access, false)
}

fn open_entry(parent: &File, name: &OsStr, access: Access, directory: bool) -> io::Result<File> {
    if !name
        .to_str()
        .is_some_and(windows_policy::component_representable)
    {
        return Err(path_error());
    }
    let mut wide_name = wide(name)?;
    wide_name.pop();
    let length = u16::try_from(wide_name.len() * 2).map_err(io::Error::other)?;
    let mut unicode = UNICODE_STRING {
        Length: length,
        MaximumLength: length,
        Buffer: wide_name.as_mut_ptr(),
    };
    let private = matches!(access, Access::CreatePrivate)
        .then(PrivateSecurity::new)
        .transpose()?;
    let attributes = OBJECT_ATTRIBUTES {
        Length: size_of::<OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: parent.as_raw_handle(),
        ObjectName: &mut unicode,
        // Windows: object-manager/filesystem policy can still make this lookup case-insensitive.
        // Verify the actual leaf spelling on the returned handle before using the entry.
        Attributes: 0,
        SecurityDescriptor: private
            .as_ref()
            .map_or(null_mut(), |security| security.0.cast()),
        SecurityQualityOfService: null_mut(),
    };
    let rights = match access {
        Access::Read | Access::Directory => FILE_GENERIC_READ,
        Access::Inspect => FILE_READ_ATTRIBUTES,
        Access::ReadWrite | Access::CreatePrivate => FILE_GENERIC_READ | FILE_GENERIC_WRITE,
        Access::Append { .. } => FILE_GENERIC_READ | FILE_APPEND_DATA,
    };
    let disposition = match access {
        Access::CreatePrivate | Access::Append { create: true } => FILE_CREATE,
        _ => FILE_OPEN,
    };
    let options = FILE_OPEN_REPARSE_POINT
        | FILE_SYNCHRONOUS_IO_NONALERT
        | if directory || matches!(access, Access::Directory) {
            FILE_DIRECTORY_FILE
        } else {
            0
        };
    let mut handle = null_mut();
    let mut status = IO_STATUS_BLOCK::default();

    // SAFETY: parent is live; unicode contains exactly one validated relative component;
    // output pointers and the optional security descriptor live through this synchronous call.
    let result = unsafe {
        NtCreateFile(
            &mut handle,
            rights | SYNCHRONIZE,
            &attributes,
            &mut status,
            null(),
            FILE_ATTRIBUTE_NORMAL,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            disposition,
            options,
            null(),
            0,
        )
    };

    if result < 0 {
        // SAFETY: this function maps any NTSTATUS to its corresponding Win32 error code.
        return Err(io::Error::from_raw_os_error(
            unsafe { RtlNtStatusToDosError(result) } as i32,
        ));
    }

    // SAFETY: NtCreateFile succeeded and transferred one uniquely owned file handle.
    let file = prepare_file(
        unsafe { File::from_raw_handle(handle) },
        rights | SYNCHRONIZE,
        !matches!(access, Access::Inspect),
    )?;
    verify_entry_name(&file, name)?;

    if matches!(access, Access::CreatePrivate) {
        make_private_file(&file)?;
    }

    Ok(file)
}

pub(crate) fn create_private_file(path: &Path) -> io::Result<File> {
    validate_filesystem_path(path)?;
    let name = wide(path.as_os_str())?;
    let security = PrivateSecurity::new()?;
    let attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: security.0,
        bInheritHandle: 0,
    };

    // SAFETY: the name is terminated and the non-inheritable private descriptor is live;
    // CREATE_NEW refuses existing files, including substituted links.
    let handle = unsafe {
        CreateFileW(
            name.as_ptr(),
            FILE_GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            &attributes,
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL,
            null_mut(),
        )
    };
    let handle = owned_handle(handle)?;

    let file = File::from(handle);

    make_private_file(&file)?;

    Ok(file)
}

pub(crate) fn truncate_no_follow(path: &Path) -> io::Result<File> {
    // Inspect the held object before truncation, so a reparse point is never followed.
    validate_filesystem_path(path)?;
    let file = prepare_file(
        OpenOptions::new()
            .write(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?,
        FILE_GENERIC_WRITE,
        true,
    )?;
    if let Some(name) = path.file_name() {
        verify_entry_name(&file, name)?;
    }

    file.set_len(0)?;

    Ok(file)
}

pub(crate) fn create_private_directory(parent: &File, name: &OsStr) -> io::Result<File> {
    open_entry(parent, name, Access::CreatePrivate, true)
}

pub(crate) fn make_private_directory(directory: &File) -> io::Result<()> {
    let security = PrivateSecurity::new()?;
    let dacl = security.dacl()?;

    // SAFETY: directory is live; ReOpenFile preserves object identity while requesting DACL access.
    let handle = owned_handle(unsafe {
        ReOpenFile(
            directory.as_raw_handle(),
            READ_CONTROL | WRITE_DAC,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            FILE_FLAG_BACKUP_SEMANTICS,
        )
    })?;
    // SAFETY: the reopened handle has WRITE_DAC; dacl belongs to the live descriptor.
    let result = unsafe {
        SetSecurityInfo(
            handle.as_raw_handle(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            dacl,
            null(),
        )
    };

    if result != 0 {
        return Err(io::Error::from_raw_os_error(result as i32));
    }

    make_private_file(directory)
}

pub(crate) fn is_private_directory(directory: &File) -> io::Result<bool> {
    let expected = PrivateSecurity::new()?;
    let mut descriptor = null_mut();
    let mut dacl = null_mut();

    // SAFETY: live handle and writable output pointers; the returned descriptor owns dacl.
    let result = unsafe {
        GetSecurityInfo(
            directory.as_raw_handle(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            &mut dacl,
            null_mut(),
            &mut descriptor,
        )
    };

    if result != 0 {
        return Err(io::Error::from_raw_os_error(result as i32));
    }

    let actual = PrivateSecurity(descriptor);
    let mut control = 0;
    let mut revision = 0;
    // SAFETY: actual owns a valid descriptor and the two output pointers are live.
    if unsafe { GetSecurityDescriptorControl(actual.0, &mut control, &mut revision) } == 0 {
        return Err(io::Error::last_os_error());
    }
    if dacl.is_null() || control & SE_DACL_PROTECTED == 0 {
        return Ok(false);
    }
    let expected_dacl = expected.dacl()?;

    // SAFETY: both descriptors own valid ACLs; require the exact single allow ACE we create.
    unsafe {
        if (*dacl).AceCount != 1 {
            return Ok(false);
        }
        let mut actual_ace = null_mut();
        let mut expected_ace = null_mut();

        if GetAce(dacl, 0, &mut actual_ace) == 0 || GetAce(expected_dacl, 0, &mut expected_ace) == 0
        {
            return Err(io::Error::last_os_error());
        }

        let header = &*actual_ace.cast::<ACE_HEADER>();
        if header.AceType != 0 || usize::from(header.AceSize) < size_of::<ACCESS_ALLOWED_ACE>() {
            return Ok(false);
        }
        let actual_ace = &*actual_ace.cast::<ACCESS_ALLOWED_ACE>();
        let expected_ace = &*expected_ace.cast::<ACCESS_ALLOWED_ACE>();

        Ok(actual_ace.Header.AceType == 0
            && actual_ace.Header.AceFlags == 0
            && actual_ace.Mask == FILE_ALL_ACCESS
            && EqualSid(
                (&actual_ace.SidStart as *const u32).cast_mut().cast(),
                (&expected_ace.SidStart as *const u32).cast_mut().cast(),
            ) != 0)
    }
}

pub(crate) fn make_private_file(file: &File) -> io::Result<()> {
    // Windows: reject filesystems that ignore private creation ACLs, before writing bytes.
    if !is_private_directory(file)? {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Private owner-only ACL was not preserved",
        ));
    }

    Ok(())
}

pub(crate) fn validate_discard_path(root: &File, path: &Path) -> io::Result<bool> {
    validate_relative_filesystem_path(path)?;
    let mut parent = root.try_clone()?;
    let mut components = path.components().peekable();

    while let Some(component) = components.next() {
        let Component::Normal(name) = component else {
            return Err(path_error());
        };
        let last = components.peek().is_none();
        let access = if last {
            Access::Inspect
        } else {
            Access::Directory
        };
        match open_component(&parent, name, access) {
            Ok(file) if last => return Ok(file.metadata()?.is_file()),
            Ok(directory) => parent = directory,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(true),
            // Windows: final name-surrogate links still require external Git handling.
            Err(error) => return Err(error),
        }
    }

    Ok(true)
}

pub(crate) fn random_bytes(bytes: &mut [u8]) -> io::Result<()> {
    let length = u32::try_from(bytes.len()).map_err(io::Error::other)?;

    // SAFETY: the system RNG writes exactly length bytes to this live mutable buffer.
    let status = unsafe {
        BCryptGenRandom(
            null_mut(),
            bytes.as_mut_ptr(),
            length,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };

    if status < 0 {
        return Err(io::Error::other(format!("System RNG failed: {status:#x}")));
    }

    Ok(())
}

fn handle_path(directory: &File, volume: u32) -> io::Result<PathBuf> {
    let mut buffer = vec![0_u16; 512];

    loop {
        // SAFETY: the directory handle is live and the buffer is writable for its stated size.
        let length = unsafe {
            GetFinalPathNameByHandleW(
                directory.as_raw_handle(),
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                volume,
            )
        } as usize;

        if length == 0 {
            return Err(io::Error::last_os_error());
        }
        if length >= buffer.len() {
            buffer.resize(length + 1, 0);
            continue;
        }

        use std::os::windows::ffi::OsStringExt;
        return Ok(std::ffi::OsString::from_wide(&buffer[..length]).into());
    }
}

fn directory_path(directory: &File) -> io::Result<PathBuf> {
    let path = handle_path(directory, 0)?;

    Ok(path.to_str().map_or_else(
        || path.clone(),
        |text| PathBuf::from(windows_policy::cwd_path(text).as_ref()),
    ))
}

fn verify_entry_name(file: &File, requested: &OsStr) -> io::Result<()> {
    windows_policy::verified_entry_name(
        handle_path(file, VOLUME_NAME_NONE).map(|path| path.file_name() == Some(requested)),
    )
}

pub(crate) struct OwnedChild {
    pub(crate) child: Child,
    pub(crate) finished: bool,
    job: OwnedHandle,
}

impl OwnedChild {
    pub(crate) fn finish(&mut self, preserve_descendants: bool) -> io::Result<()> {
        if preserve_descendants {
            // No breakaway is allowed during execution. After an ordinary completion,
            // attempt to disarm kill-on-close so background helpers can survive.
            let limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            // Windows: disarming is best-effort after Git has finished. Failure may
            // terminate descendants when the job closes, but must not replace Git's result.
            // SAFETY: the live job and exact information structure/class/size agree.
            unsafe {
                SetInformationJobObject(
                    self.job.as_raw_handle(),
                    JobObjectExtendedLimitInformation,
                    (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    size_of_val(&limits) as u32,
                );
            }
        }
        self.finished = true;

        Ok(())
    }

    pub(crate) fn signal(&self, signal: Signal) {
        // Windows: CREATE_NO_WINDOW leaves the child without a console; CTRL_BREAK
        // cannot be delivered. The shared runner skips the Unix grace period and kills the job.
        if matches!(signal, Signal::Kill) {
            // SAFETY: this uniquely owned live job contains the suspended-assigned child tree.
            unsafe {
                TerminateJobObject(self.job.as_raw_handle(), 1);
            }
        }
    }
}

impl Drop for OwnedChild {
    fn drop(&mut self) {
        if !self.finished {
            self.signal(Signal::Kill);
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        // Normal completion attempts to disarm kill-on-close; cancellation keeps it armed.
    }
}

pub(crate) fn spawn(
    command: &mut Command,
    cwd: &Path,
    directory: Option<&File>,
) -> io::Result<OwnedChild> {
    // SAFETY: null security attributes create an unnamed non-inheritable job handle.
    let job = owned_handle(unsafe { CreateJobObjectW(null(), null()) })?;
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

    // SAFETY: job is live; the information class matches the initialized structure and size.
    if unsafe {
        SetInformationJobObject(
            job.as_raw_handle(),
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of_val(&limits) as u32,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    // Windows: CreateProcess takes a pathname, not a directory handle. Resolving the
    // handle immediately before spawn still leaves a rename/replacement race.
    command.current_dir(match directory {
        Some(directory) => directory_path(directory)?,
        None => cwd.to_owned(),
    });
    command.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_SUSPENDED | CREATE_NO_WINDOW);
    let mut owned = OwnedChild {
        child: command.spawn()?,
        finished: false,
        job,
    };

    // SAFETY: the child is still suspended, so it cannot create descendants before assignment.
    if unsafe { AssignProcessToJobObject(owned.job.as_raw_handle(), owned.child.as_raw_handle()) }
        == 0
    {
        return Err(io::Error::last_os_error());
    }

    resume_child(&mut owned.child)?;

    Ok(owned)
}

fn resume_child(child: &mut Child) -> io::Result<()> {
    // std::Child does not expose the initial thread handle. Keep the documented
    // ToolHelp/ResumeThread route instead of relying on undocumented NtResumeProcess.
    // SAFETY: flags request a newly allocated thread enumeration snapshot.
    let snapshot = owned_handle(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) })?;
    let mut entry = THREADENTRY32 {
        dwSize: size_of::<THREADENTRY32>() as u32,
        ..Default::default()
    };

    // SAFETY: snapshot is live and entry has the required size and writable storage.
    let mut found = unsafe { Thread32First(snapshot.as_raw_handle(), &mut entry) } != 0;

    while found {
        if entry.th32OwnerProcessID == child.id() {
            // SAFETY: the enumerated initial thread belongs to our suspended, unreaped child.
            let thread =
                owned_handle(unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) })?;
            // SAFETY: this handle has resume access to the child's suspended initial thread.
            if unsafe { ResumeThread(thread.as_raw_handle()) } == u32::MAX {
                return Err(io::Error::last_os_error());
            }

            return Ok(());
        }

        // SAFETY: snapshot remains live and entry remains correctly sized writable storage.
        found = unsafe { Thread32Next(snapshot.as_raw_handle(), &mut entry) } != 0;
    }

    Err(io::Error::other(
        "Could not find the suspended child thread",
    ))
}

// Anonymous child pipes are synchronous on Windows. Bounded worker channels keep
// cancellation responsive without unbounded buffering; Drop cancels and joins every worker.
struct PipeWorker(Option<JoinHandle<()>>);

impl Drop for PipeWorker {
    fn drop(&mut self) {
        if let Some(worker) = self.0.take() {
            while !worker.is_finished() {
                // SAFETY: worker's thread handle remains live until join. Repeat to cover
                // a worker entering synchronous I/O just after the previous cancellation.
                unsafe {
                    CancelSynchronousIo(worker.as_raw_handle());
                }
                thread::sleep(Duration::from_millis(1));
            }
            let _ = worker.join();
        }
    }
}

pub(crate) struct OutputPipe {
    receiver: Option<Receiver<io::Result<Vec<u8>>>>,
    worker: PipeWorker,
}

impl Read for OutputPipe {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        if bytes.is_empty() {
            return Ok(0);
        }
        match self
            .receiver
            .as_ref()
            .expect("live output receiver")
            .try_recv()
        {
            Ok(Ok(chunk)) => {
                // The domain pump always supplies an 8192-byte buffer.
                if chunk.len() > bytes.len() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "Pipe buffer is too small",
                    ));
                }
                bytes[..chunk.len()].copy_from_slice(&chunk);
                Ok(chunk.len())
            }
            Ok(Err(error)) if error.kind() == io::ErrorKind::BrokenPipe => Ok(0),
            Ok(Err(error)) => Err(error),
            Err(TryRecvError::Empty) => Err(io::ErrorKind::WouldBlock.into()),
            Err(TryRecvError::Disconnected) => Ok(0),
        }
    }
}

impl Drop for OutputPipe {
    fn drop(&mut self) {
        // Unblock a full channel before PipeWorker cancels any blocked OS read and joins.
        self.receiver.take();
        let _ = &self.worker;
    }
}

pub(crate) fn output_pipe<R: Read + Send + 'static>(mut pipe: R) -> io::Result<OutputPipe> {
    let (sender, receiver) = mpsc::sync_channel(1);
    let worker = thread::Builder::new()
        .name("git-output".into())
        .spawn(move || {
            loop {
                let mut buffer = vec![0; 8192];
                let result = pipe.read(&mut buffer).map(|count| {
                    buffer.truncate(count);
                    buffer
                });
                let done = result.as_ref().map_or(true, Vec::is_empty);

                if sender.send(result).is_err() || done {
                    break;
                }
            }
        })?;

    Ok(OutputPipe {
        receiver: Some(receiver),
        worker: PipeWorker(Some(worker)),
    })
}

pub(crate) struct InputPipe {
    sender: Option<SyncSender<Vec<u8>>>,
    receiver: Option<Receiver<io::Result<usize>>>,
    pending: bool,
    worker: PipeWorker,
}

impl Write for InputPipe {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if !self.pending {
            let chunk = bytes[..bytes.len().min(8192)].to_vec();
            match self
                .sender
                .as_ref()
                .expect("live input sender")
                .try_send(chunk)
            {
                Ok(()) => self.pending = true,
                Err(TrySendError::Full(_)) => return Err(io::ErrorKind::WouldBlock.into()),
                Err(TrySendError::Disconnected(_)) => return Err(io::ErrorKind::BrokenPipe.into()),
            }
        }
        match self
            .receiver
            .as_ref()
            .expect("live input receiver")
            .try_recv()
        {
            Ok(result) => {
                self.pending = false;
                result
            }
            Err(TryRecvError::Empty) => Err(io::ErrorKind::WouldBlock.into()),
            Err(TryRecvError::Disconnected) => Err(io::ErrorKind::BrokenPipe.into()),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Drop for InputPipe {
    fn drop(&mut self) {
        self.sender.take();
        self.receiver.take();
        let _ = &self.worker;
    }
}

pub(crate) fn input_pipe(mut pipe: ChildStdin) -> io::Result<InputPipe> {
    let (sender, input): (SyncSender<Vec<u8>>, Receiver<Vec<u8>>) = mpsc::sync_channel(1);
    let (output, receiver) = mpsc::sync_channel(1);
    let worker = thread::Builder::new()
        .name("git-input".into())
        .spawn(move || {
            while let Ok(chunk) = input.recv() {
                let result = pipe.write_all(&chunk).map(|()| chunk.len());
                let failed = result.is_err();

                if output.send(result).is_err() || failed {
                    break;
                }
            }
        })?;

    Ok(InputPipe {
        sender: Some(sender),
        receiver: Some(receiver),
        pending: false,
        worker: PipeWorker(Some(worker)),
    })
}

#[cfg(test)]
pub(crate) fn symlink(original: impl AsRef<Path>, link: impl AsRef<Path>) -> io::Result<()> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::ffi::OsStringExt;

    #[test]
    fn unrepresentable_paths_return_encoding_errors() {
        assert!(path_from_git_bytes(b"invalid\xff").is_err());
        let temporary = tempfile::tempdir().unwrap();
        let root = open_directory_no_follow(temporary.path()).unwrap();

        for text in [
            "NUL",
            "a:stream",
            "trailing.",
            "name ",
            "folder\\file",
            "line\nfeed",
            "embedded\0nul",
        ] {
            let error = open_component(&root, OsStr::new(text), Access::Read).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
            assert!(
                error
                    .get_ref()
                    .is_some_and(|source| source.is::<PathEncodingError>())
            );
        }
        let surrogate = std::ffi::OsString::from_wide(&[0xd800]);
        assert!(path_to_git_bytes(&surrogate).is_err());
        assert_eq!(
            path_to_git_bytes(OsStr::new("folder\\file.txt"))
                .unwrap()
                .as_ref(),
            b"folder/file.txt"
        );
    }

    #[test]
    fn private_creation_verifies_an_owner_only_acl() {
        let temporary = tempfile::tempdir().unwrap();
        let parent = open_directory_no_follow(temporary.path()).unwrap();
        let directory = create_private_directory(&parent, "private".as_ref()).unwrap();
        let file = open_component(&directory, "file".as_ref(), Access::CreatePrivate).unwrap();

        assert!(is_private_directory(&directory).unwrap());
        assert!(is_private_directory(&file).unwrap());
        assert!(make_private_file(&file).is_ok());
    }

    #[test]
    fn deadline_joins_backpressured_pipe_workers_and_terminates_the_job() {
        let temporary = tempfile::tempdir().unwrap();
        let input = vec![b'x'; 1024 * 1024];
        let mut command = crate::ToolCommand::new(
            Path::new("cmd.exe"),
            temporary.path(),
            ["/D", "/C", "ping -n 60 127.0.0.1 >NUL"],
        );
        command.stdin = &input;
        command.timeout = Duration::from_millis(100);
        let began = std::time::Instant::now();
        let result = crate::execute_tool(command);

        assert!(matches!(result, Err(crate::GitError::TimedOut)));
        assert!(began.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn ignore_patterns_use_git_separators_and_reject_native_git_components() {
        assert_eq!(
            crate::ignore_pattern(Path::new("folder\\file.txt"), &crate::IgnoreRule::File).unwrap(),
            "/folder/file.txt"
        );
        assert!(
            crate::ignore_pattern(Path::new("folder\\.git\\config"), &crate::IgnoreRule::File)
                .is_err()
        );
    }
    #[test]
    fn status_display_accepts_reserved_names_but_file_access_returns_a_typed_error() {
        let status = crate::parse_status(b"? aux.c\0? a:b\0").unwrap();
        let temporary = tempfile::tempdir().unwrap();
        let root = open_directory_no_follow(temporary.path()).unwrap();
        assert_eq!(status.files.len(), 2);

        for (change, expected) in status.files.iter().zip([b"aux.c".as_slice(), b"a:b"]) {
            assert_eq!(
                path_to_git_bytes(change.path.as_os_str()).unwrap().as_ref(),
                expected
            );
            assert!(
                temporary
                    .path()
                    .join(&change.path)
                    .starts_with(temporary.path())
            );
            let error = super::super::open_beneath(&root, &change.path, false).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
            assert!(
                error
                    .get_ref()
                    .is_some_and(|source| source.is::<PathEncodingError>())
            );
        }
        assert!(path_from_git_bytes(b"c:/outside").is_err());
        assert!(absolute_path_from_git_bytes(b"c:/outside").is_ok());
    }

    #[test]
    fn discard_inspection_needs_attributes_without_reading_file_data() {
        let temporary = tempfile::tempdir().unwrap();
        let name = temporary.path().join("held.txt");
        std::fs::write(&name, b"kept").unwrap();
        // Deny FILE_READ_DATA sharing. Attribute-only inspection must still succeed.
        let _held = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_WRITE | FILE_SHARE_DELETE)
            .open(&name)
            .unwrap();
        let root = open_directory_no_follow(temporary.path()).unwrap();
        assert!(validate_discard_path(&root, Path::new("held.txt")).unwrap());
        assert!(open_component(&root, "held.txt".as_ref(), Access::Read).is_err());
    }

    #[test]
    fn component_opens_reject_case_aliases_and_leave_content_unchanged() {
        let temporary = tempfile::tempdir().unwrap();
        std::fs::write(temporary.path().join("Exact.txt"), b"kept").unwrap();
        let root = open_directory_no_follow(temporary.path()).unwrap();
        assert!(open_component(&root, "Exact.txt".as_ref(), Access::Read).is_ok());
        assert!(open_component(&root, "exact.txt".as_ref(), Access::ReadWrite).is_err());
        assert_eq!(
            std::fs::read(temporary.path().join("Exact.txt")).unwrap(),
            b"kept"
        );
    }

    #[test]
    fn ordinary_completion_keeps_a_background_process_after_the_job_handle_closes() {
        use std::process::Stdio;
        use windows_sys::Win32::Foundation::WAIT_TIMEOUT;
        use windows_sys::Win32::System::JobObjects::{
            IsProcessInJob, JobObjectBasicProcessIdList, QueryInformationJobObject,
        };
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_TERMINATE, TerminateProcess,
            WaitForSingleObject,
        };

        struct BackgroundProcess(OwnedHandle);
        impl Drop for BackgroundProcess {
            fn drop(&mut self) {
                // SAFETY: this test owns a handle to its fixture daemon with terminate/wait access.
                unsafe {
                    TerminateProcess(self.0.as_raw_handle(), 1);
                    WaitForSingleObject(self.0.as_raw_handle(), 10_000);
                }
            }
        }

        #[repr(C)]
        #[derive(Default)]
        struct ProcessIds {
            assigned: u32,
            count: u32,
            ids: [usize; 16],
        }

        let temporary = tempfile::tempdir().unwrap();
        let mut command = Command::new("cmd.exe");
        command
            .args(["/D", "/C", "start \"\" /B ping -n 60 127.0.0.1 >NUL"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut owned = spawn(&mut command, temporary.path(), None).unwrap();
        assert!(owned.child.wait().unwrap().success());
        owned.finish(true).unwrap();
        // Retain cleanup on any assertion failure until the background handle is owned.
        owned.finished = false;
        let mut ids = ProcessIds::default();
        // SAFETY: the live job and writable, aligned process-ID buffer agree with the class;
        // the API receives the full buffer size and fails if it needs more than 16 entries.
        let queried = unsafe {
            QueryInformationJobObject(
                owned.job.as_raw_handle(),
                JobObjectBasicProcessIdList,
                (&mut ids as *mut ProcessIds).cast(),
                size_of_val(&ids) as u32,
                null_mut(),
            )
        };
        assert_ne!(queried, 0);
        let pid = ids.ids[..ids.count as usize]
            .iter()
            .copied()
            .find(|pid| *pid != owned.child.id() as usize)
            .expect("background daemon PID");
        // SAFETY: OpenProcess borrows no pointers and returns a new handle on success.
        let handle = owned_handle(unsafe {
            OpenProcess(
                SYNCHRONIZE | PROCESS_QUERY_INFORMATION | PROCESS_TERMINATE,
                0,
                pid as u32,
            )
        })
        .unwrap();
        let mut in_job = 0;
        // SAFETY: both handles are live and the output pointer is writable. Verify job
        // membership before taking termination ownership, in case the PID was reused.
        let queried = unsafe {
            IsProcessInJob(
                handle.as_raw_handle(),
                owned.job.as_raw_handle(),
                &mut in_job,
            )
        };
        assert_ne!(queried, 0);
        assert_ne!(in_job, 0);
        let daemon = BackgroundProcess(handle);
        owned.finished = true;
        drop(owned);

        // SAFETY: the daemon handle remains live; waiting observes termination without changing it.
        let status = unsafe { WaitForSingleObject(daemon.0.as_raw_handle(), 500) };
        assert_eq!(
            status, WAIT_TIMEOUT,
            "closing a normally completed job killed its daemon"
        );
    }
    #[test]
    fn backslash_git_names_are_lossless_distinct_and_never_native_file_arguments() {
        use std::collections::{BTreeSet, HashSet};
        let literal = path_from_git_bytes(b"folder\\file").unwrap();
        let separated = path_from_git_bytes(b"folder/file").unwrap();
        let escape_literal = path_from_git_bytes("folder\u{e000}bfile".as_bytes()).unwrap();
        assert_eq!(
            path_to_git_bytes(literal.as_os_str()).unwrap().as_ref(),
            b"folder\\file"
        );
        assert_eq!(crate::output::path(b"folder\\file").unwrap(), literal);
        assert_ne!(literal, separated);
        assert_ne!(literal, escape_literal);
        assert_eq!(
            HashSet::from([literal.clone(), separated.clone(), escape_literal.clone()]).len(),
            3
        );
        assert_eq!(
            BTreeSet::from([literal.clone(), separated.clone(), escape_literal]).len(),
            3
        );
        assert!(crate::validation::require_paths([literal.as_path()]).is_err());
        assert!(crate::validation::require_paths([separated.as_path()]).is_ok());
        for name in [b"\\x".as_slice(), b"C:\\x", b"\\\\?\\C:\\x"] {
            let path = path_from_git_bytes(name).unwrap();
            assert!(!path.has_root());
            assert!(
                !path
                    .components()
                    .any(|part| matches!(part, Component::Prefix(_)))
            );
            assert_eq!(path_to_git_bytes(path.as_os_str()).unwrap().as_ref(), name);
            assert!(validate_relative_filesystem_path(&path).is_err());
        }
        assert!(crate::output::absolute_path(b"C:\\repo").is_ok());

        let temporary = tempfile::tempdir().unwrap();
        std::fs::create_dir(temporary.path().join("folder")).unwrap();
        std::fs::write(temporary.path().join("folder/file"), b"kept").unwrap();
        let root = open_directory_no_follow(temporary.path()).unwrap();
        let error = super::super::open_beneath(&root, &literal, false).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(
            error
                .get_ref()
                .is_some_and(|source| source.is::<PathEncodingError>())
        );
        assert!(super::super::open_beneath(&root, &separated, false).is_ok());
        assert_eq!(
            std::fs::read(temporary.path().join("folder/file")).unwrap(),
            b"kept"
        );
    }

    #[test]
    fn status_keeps_backslash_entries_and_ordinary_entries_without_deduplication() {
        let status =
            crate::parse_status(b"? folder\\file\0? folder/file\0? ordinary.txt\0").unwrap();
        assert_eq!(status.files.len(), 3);
        for (change, expected) in
            status
                .files
                .iter()
                .zip([b"folder\\file".as_slice(), b"folder/file", b"ordinary.txt"])
        {
            assert_eq!(
                path_to_git_bytes(change.path.as_os_str()).unwrap().as_ref(),
                expected
            );
        }
        assert_ne!(status.files[0].path, status.files[1].path);
    }

    #[test]
    fn drive_like_names_use_the_same_guard_in_all_relative_decoders() {
        let native = path_from_git_bytes(b"a:b").unwrap();
        let output = crate::output::path(b"a:b").unwrap();
        let status = crate::parse_status(b"? a:b\0").unwrap();
        assert_eq!(native, output);
        assert_eq!(native, status.files[0].path);
        assert_eq!(native.as_os_str(), OsStr::new(".\\a:b"));
        assert!(!native.has_root());
        assert!(
            !native
                .components()
                .any(|part| matches!(part, Component::Prefix(_)))
        );
        assert_eq!(
            path_to_git_bytes(native.as_os_str()).unwrap().as_ref(),
            b"a:b"
        );
    }

    #[test]
    fn a_job_disarm_failure_cannot_replace_a_completed_git_result() {
        use std::process::Stdio;
        use windows_sys::Win32::System::Threading::CreateEventW;
        let temporary = tempfile::tempdir().unwrap();
        let mut command = Command::new("cmd.exe");
        command
            .args(["/D", "/C", "exit 0"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut owned = spawn(&mut command, temporary.path(), None).unwrap();
        let status = owned.child.wait().unwrap();
        assert!(status.success());
        // SAFETY: null attributes/name create a uniquely owned unnamed event handle.
        let event = owned_handle(unsafe { CreateEventW(null(), 0, 0, null()) }).unwrap();
        // A real event is safe to close but fails the Job Object API's handle-type check.
        let _job = std::mem::replace(&mut owned.job, event);
        assert!(owned.finish(true).is_ok());
        assert!(owned.finished);
        assert!(status.success());
    }
}
