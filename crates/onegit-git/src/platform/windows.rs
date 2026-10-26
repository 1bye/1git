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
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_BASIC_INFO, FILE_FLAG_BACKUP_SEMANTICS,
    FILE_FLAG_OPEN_REPARSE_POINT, FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_ID_INFO,
    FILE_INFO_BY_HANDLE_CLASS, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ,
    FILE_SHARE_WRITE, FILE_STANDARD_INFO, FileBasicInfo, FileIdInfo, FileStandardInfo,
    GetFileInformationByHandleEx, GetFinalPathNameByHandleW, READ_CONTROL, ReOpenFile, SYNCHRONIZE,
    WRITE_DAC,
};
use windows_sys::Win32::System::Console::{CTRL_BREAK_EVENT, GenerateConsoleCtrlEvent};
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
    CREATE_NEW_PROCESS_GROUP, CREATE_SUSPENDED, OpenThread, ResumeThread, THREAD_SUSPEND_RESUME,
};

use super::{Access, FileState, PathEncodingError, Signal};

pub(crate) fn path_from_git_bytes(bytes: &[u8]) -> Result<PathBuf, PathEncodingError> {
    let text = std::str::from_utf8(bytes).map_err(|_| PathEncodingError)?;

    if text.contains('\\') || !representable(text) {
        return Err(PathEncodingError);
    }

    Ok(text.into())
}

pub(crate) fn path_to_git_bytes(path: &OsStr) -> Result<Cow<'_, [u8]>, PathEncodingError> {
    let text = path.to_str().ok_or(PathEncodingError)?;
    let text = if let Some(unc) = text.strip_prefix("\\\\?\\UNC\\") {
        format!("//{unc}")
    } else {
        text.strip_prefix("\\\\?\\").unwrap_or(text).to_owned()
    }
    .replace('\\', "/");

    if !representable(&text) {
        return Err(PathEncodingError);
    }

    Ok(Cow::Owned(text.into_bytes()))
}

fn representable(text: &str) -> bool {
    text.split('/').enumerate().all(|(index, part)| {
        if index == 0
            && part.len() == 2
            && part.as_bytes()[0].is_ascii_alphabetic()
            && part.ends_with(':')
        {
            return true;
        }
        if matches!(part, "" | "." | "..") {
            return true;
        }
        if part.ends_with(['.', ' ']) || part.chars().any(|ch| ch < ' ' || "<>:\"|?*".contains(ch))
        {
            return false;
        }

        let stem = part
            .split('.')
            .next()
            .unwrap_or("")
            .trim_end_matches(' ')
            .to_uppercase();

        !matches!(
            stem.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
        ) && !["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|number| {
                matches!(
                    number,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        })
    })
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
        let info: FILE_ID_INFO = query(file, FileIdInfo)?;

        Ok(Self(info.VolumeSerialNumber, info.FileId.Identifier))
    }

    pub(crate) fn from_path(path: &Path) -> io::Result<Self> {
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

fn reject_reparse(file: File) -> io::Result<File> {
    let info: FILE_BASIC_INFO = query(&file, FileBasicInfo)?;

    if info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(io::Error::from_raw_os_error(
            ERROR_STOPPED_ON_SYMLINK as i32,
        ));
    }

    Ok(file)
}

pub(crate) fn open_directory_no_follow(path: &Path) -> io::Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)?;
    let file = reject_reparse(file)?;

    if !file.metadata()?.is_dir() {
        return Err(io::Error::from_raw_os_error(ERROR_DIRECTORY as i32));
    }

    Ok(file)
}

// A protected OWNER RIGHTS ACL grants only the object's owner access. Each newly
// created private entry receives it atomically, before any private bytes are written.
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
    if !matches!(
        Path::new(name).components().next(),
        Some(Component::Normal(_))
    ) || Path::new(name).components().count() != 1
        || name
            .to_str()
            .is_none_or(|name| name.contains(['/', '\\', ':']) || !representable(name))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Expected one ordinary path component",
        ));
    }
    let mut name = wide(name)?;
    name.pop();
    let length = u16::try_from(name.len() * 2).map_err(io::Error::other)?;
    let mut unicode = UNICODE_STRING {
        Length: length,
        MaximumLength: length,
        Buffer: name.as_mut_ptr(),
    };
    let private = matches!(access, Access::CreatePrivate)
        .then(PrivateSecurity::new)
        .transpose()?;
    let attributes = OBJECT_ATTRIBUTES {
        Length: size_of::<OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: parent.as_raw_handle(),
        ObjectName: &mut unicode,
        // Preserve the Git spelling; do not introduce case-insensitive aliasing here.
        Attributes: 0,
        SecurityDescriptor: private
            .as_ref()
            .map_or(null_mut(), |security| security.0.cast()),
        SecurityQualityOfService: null_mut(),
    };
    let rights = match access {
        Access::Read | Access::Directory => FILE_GENERIC_READ,
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
    let file = reject_reparse(unsafe { File::from_raw_handle(handle) })?;

    if matches!(access, Access::CreatePrivate) {
        make_private_file(&file)?;
    }

    Ok(file)
}

pub(crate) fn create_private_file(path: &Path) -> io::Result<File> {
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
    let file = reject_reparse(
        OpenOptions::new()
            .write(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?,
    )?;

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
    match super::open_beneath(root, path, false) {
        Ok(file) => Ok(file.metadata()?.is_file()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(true),
        // Windows: final reparse points are refused too; external Git must handle them.
        Err(error) => Err(error),
    }
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

fn directory_path(directory: &File) -> io::Result<PathBuf> {
    let mut buffer = vec![0_u16; 512];

    loop {
        // SAFETY: the directory handle is live and the buffer is writable for its stated size.
        let length = unsafe {
            GetFinalPathNameByHandleW(
                directory.as_raw_handle(),
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                0,
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

pub(crate) struct OwnedChild {
    pub(crate) child: Child,
    pub(crate) finished: bool,
    job: OwnedHandle,
}

impl OwnedChild {
    pub(crate) fn signal(&self, signal: Signal) {
        // SAFETY: this child owns a private console process group and assigned job.
        unsafe {
            match signal {
                // Windows: CTRL_BREAK requires a shared console and can be ignored/unavailable;
                // the deadline always escalates to terminating the complete Job Object.
                Signal::Terminate => {
                    GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, self.child.id());
                }
                Signal::Kill => {
                    TerminateJobObject(self.job.as_raw_handle(), 1);
                }
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
        // Closing the job also terminates descendants remaining after a successful leader exit.
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
    command.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_SUSPENDED);
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
        for bytes in [
            b"invalid\xff".as_slice(),
            b"NUL",
            b"a:stream",
            b"trailing.",
            b"name ",
            b"folder\\file",
            b"line\nfeed",
            b"embedded\0nul",
        ] {
            assert!(path_from_git_bytes(bytes).is_err(), "{bytes:?}");
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
}
