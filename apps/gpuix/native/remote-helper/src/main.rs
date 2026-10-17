//! Bounded JSON-line execution agent. SSH owns authentication; only Git and explicit filesystem operations run here.
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{self, BufRead, Read, Write},
    os::unix::{
        fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
        process::CommandExt,
    },
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    },
    thread,
    time::Duration,
};

const FRAME_LIMIT: usize = 96 * 1024 * 1024;
const OUTPUT_LIMIT: usize = 64 * 1024 * 1024;
type Files = Arc<Mutex<HashMap<u64, File>>>;
type Tasks = Arc<Mutex<HashMap<u64, Arc<AtomicBool>>>>;
type Result<T> = std::result::Result<T, AgentError>;

#[derive(Debug)]
struct AgentError {
    message: String,
    code: String,
}
impl From<io::Error> for AgentError {
    fn from(error: io::Error) -> Self {
        let code = match error.raw_os_error() {
            Some(libc::ENOENT) => "ENOENT",
            Some(libc::EEXIST) => "EEXIST",
            Some(libc::EACCES) => "EACCES",
            Some(libc::EPERM) => "EPERM",
            Some(libc::ENOTDIR) => "ENOTDIR",
            Some(libc::EISDIR) => "EISDIR",
            Some(libc::ELOOP) => "ELOOP",
            Some(libc::ENOTEMPTY) => "ENOTEMPTY",
            _ => "EIO",
        };
        Self {
            message: error.to_string(),
            code: code.into(),
        }
    }
}
fn invalid(message: &str) -> AgentError {
    AgentError {
        message: message.into(),
        code: "EINVAL".into(),
    }
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v[key]
        .as_str()
        .ok_or_else(|| invalid("Missing string argument"))
}
fn path(v: &Value, key: &str) -> Result<PathBuf> {
    let s = text(v, key)?;
    if !Path::new(s).is_absolute() || s.contains(['\0', '\r', '\n']) {
        return Err(invalid(
            "Choose an absolute path without control characters",
        ));
    }
    Ok(PathBuf::from(s))
}
fn bytes(v: &Value, key: &str) -> Result<Vec<u8>> {
    B64.decode(text(v, key)?)
        .map_err(|_| invalid("Invalid base64 bytes"))
}
fn send(frame: Value) {
    let mut out = io::stdout().lock();
    if let Ok(data) = serde_json::to_vec(&frame) {
        if data.len() <= FRAME_LIMIT {
            let _ = out.write_all(&data);
            let _ = out.write_all(b"\n");
            let _ = out.flush();
        }
    }
}
fn metadata(m: fs::Metadata) -> Value {
    json!({"size":m.len(),"mode":m.mode(),"nlink":m.nlink(),"dev":m.dev(),"ino":m.ino(),
        "mtimeMs": m.mtime() as f64 * 1000.0 + m.mtime_nsec() as f64 / 1e6,
        "file":m.is_file(),"directory":m.is_dir(),"symlink":m.file_type().is_symlink()})
}
fn bounded_read(mut input: impl Read) -> Result<Vec<u8>> {
    let mut data = Vec::new();
    input
        .by_ref()
        .take((OUTPUT_LIMIT + 1) as u64)
        .read_to_end(&mut data)?;
    if data.len() > OUTPUT_LIMIT {
        return Err(invalid("File exceeds the 64 MiB limit"));
    }
    Ok(data)
}

fn filesystem(v: &Value, files: &Files, next: &AtomicU64) -> Result<Value> {
    let method = text(v, "method")?;
    if method.starts_with("handle-") {
        let id = v["handle"]
            .as_u64()
            .ok_or_else(|| invalid("Invalid file handle"))?;
        let mut handles = files.lock().unwrap();
        if method == "handle-close" {
            return handles
                .remove(&id)
                .map(|_| Value::Null)
                .ok_or_else(|| invalid("Closed file handle"));
        }
        let file = handles
            .get_mut(&id)
            .ok_or_else(|| invalid("Closed file handle"))?;
        return match method {
            "handle-stat" => Ok(metadata(file.metadata()?)),
            "handle-readFile" => Ok(json!(B64.encode(bounded_read(file)?))),
            "handle-writeFile" => {
                file.write_all(&bytes(v, "data")?)?;
                Ok(Value::Null)
            }
            "handle-sync" => {
                file.sync_all()?;
                Ok(Value::Null)
            }
            _ => Err(invalid("Unsupported file handle operation")),
        };
    }
    let p = path(v, "path")?;
    match method {
        "stat" => Ok(metadata(fs::metadata(p)?)),
        "lstat" => Ok(metadata(fs::symlink_metadata(p)?)),
        "realpath" => Ok(json!(
            fs::canonicalize(p)?
                .to_str()
                .ok_or_else(|| invalid("Path is not UTF-8"))?
        )),
        "readFile" => Ok(json!(B64.encode(bounded_read(File::open(p)?)?))),
        "writeFile" => {
            let mut options = OpenOptions::new();
            options
                .write(true)
                .create(true)
                .truncate(true)
                .mode(v["mode"].as_u64().unwrap_or(0o666) as u32);
            if v["exclusive"].as_bool().unwrap_or(false) {
                options.create_new(true);
            }
            options.open(p)?.write_all(&bytes(v, "data")?)?;
            Ok(Value::Null)
        }
        "mkdir" => {
            let recursive = v["recursive"].as_bool().unwrap_or(false);
            let mut builder = fs::DirBuilder::new();
            builder
                .recursive(recursive)
                .mode(v["mode"].as_u64().unwrap_or(0o777) as u32);
            builder.create(p)?;
            Ok(Value::Null)
        }
        "mkdtemp" => {
            for _ in 0..100 {
                let id = next.fetch_add(1, Ordering::Relaxed);
                let directory =
                    PathBuf::from(format!("{}{}-{id}", p.display(), std::process::id()));
                match fs::DirBuilder::new().mode(0o700).create(&directory) {
                    Ok(()) => return Ok(json!(directory.to_str().unwrap())),
                    Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(e) => return Err(e.into()),
                }
            }
            Err(invalid("Could not create a unique temporary directory"))
        }
        "readdir" => {
            let limit = v["limit"].as_u64().unwrap_or(100_001).min(100_001) as usize;
            let mut entries = Vec::new();
            for item in fs::read_dir(p)?.take(limit) {
                let entry = item?;
                let kind = entry.file_type()?;
                let name = entry
                    .file_name()
                    .into_string()
                    .map_err(|_| invalid("Filename is not UTF-8"))?;
                entries.push(json!({"name":name,"file":kind.is_file(),"directory":kind.is_dir(),"symlink":kind.is_symlink()}));
            }
            Ok(json!(entries))
        }
        "copyFile" => {
            fs::copy(p, path(v, "destination")?)?;
            Ok(Value::Null)
        }
        "rename" => {
            fs::rename(p, path(v, "destination")?)?;
            Ok(Value::Null)
        }
        "rm" => {
            let result = match fs::symlink_metadata(&p) {
                Ok(m) if m.is_dir() && v["recursive"].as_bool().unwrap_or(false) => {
                    fs::remove_dir_all(&p)
                }
                Ok(m) if m.is_dir() => fs::remove_dir(&p),
                Ok(_) => fs::remove_file(&p),
                Err(e) => Err(e),
            };
            match result {
                Err(e)
                    if e.kind() == io::ErrorKind::NotFound
                        && v["force"].as_bool().unwrap_or(false) => {}
                other => other?,
            }
            Ok(Value::Null)
        }
        "open" => {
            let mut options = OpenOptions::new();
            options
                .read(v["read"].as_bool().unwrap_or(false))
                .write(v["write"].as_bool().unwrap_or(false))
                .append(v["append"].as_bool().unwrap_or(false))
                .create(v["create"].as_bool().unwrap_or(false))
                .create_new(v["createNew"].as_bool().unwrap_or(false))
                .truncate(v["truncate"].as_bool().unwrap_or(false));
            let mut flags = 0;
            if v["noFollow"].as_bool().unwrap_or(false) {
                flags |= libc::O_NOFOLLOW;
            }
            if v["nonBlock"].as_bool().unwrap_or(false) {
                flags |= libc::O_NONBLOCK;
            }
            options
                .custom_flags(flags)
                .mode(v["mode"].as_u64().unwrap_or(0o666) as u32);
            let mut handles = files.lock().unwrap();
            if handles.len() >= 128 {
                return Err(invalid("Too many open files"));
            }
            let file = options.open(p)?;
            let id = next.fetch_add(1, Ordering::Relaxed);
            handles.insert(id, file);
            Ok(json!(id))
        }
        _ => Err(invalid("Unsupported filesystem operation")),
    }
}

fn git(v: &Value, files: &Files, cancel: Arc<AtomicBool>, id: u64) -> Result<Value> {
    let args = v["args"]
        .as_array()
        .ok_or_else(|| invalid("Invalid Git arguments"))?;
    if args.len() > 4096 {
        return Err(invalid("Too many Git arguments"));
    }
    let args: Vec<&str> = args
        .iter()
        .map(|a| {
            a.as_str()
                .filter(|s| !s.contains('\0'))
                .ok_or_else(|| invalid("Invalid Git argument"))
        })
        .collect::<Result<_>>()?;
    let maximum = v["maxOutputBytes"].as_u64().unwrap_or(OUTPUT_LIMIT as u64) as usize;
    if !(1024..=OUTPUT_LIMIT).contains(&maximum) {
        return Err(invalid("Invalid output limit"));
    }
    let mut command = Command::new("git");
    command
        .args(["-c", "color.ui=false", "-c", "core.quotepath=false"])
        .args(args)
        .current_dir(path(v, "cwd")?)
        .env("GIT_EDITOR", "true")
        .env("GIT_PAGER", "cat")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LANG", "C")
        .env("LC_ALL", "C")
        .env("PAGER", "cat")
        .process_group(0)
        .stdin(Stdio::piped())
        .stderr(Stdio::piped());
    if !v["indexFile"].is_null() {
        command.env("GIT_INDEX_FILE", path(v, "indexFile")?);
    }
    if !v["httpAuthentication"].is_null() || !v["executable"].is_null() {
        return Err(invalid(
            "Remote credential and executable overrides are forbidden",
        ));
    }
    if let Some(fd) = v["stdoutFile"].as_u64() {
        let handles = files.lock().unwrap();
        command.stdout(Stdio::from(
            handles
                .get(&fd)
                .ok_or_else(|| invalid("Invalid output file"))?
                .try_clone()?,
        ));
    } else {
        command.stdout(Stdio::piped());
    }
    if cancel.load(Ordering::SeqCst) {
        return Err(AgentError {
            message: "Git operation was aborted".into(),
            code: "aborted".into(),
        });
    }
    let input = if v["stdin"].is_null() {
        Vec::new()
    } else {
        bytes(v, "stdin")?
    };
    let mut child = command.spawn().map_err(|e| {
        if e.kind() == io::ErrorKind::NotFound {
            AgentError {
                message: "Git is not installed".into(),
                code: "git-not-found".into(),
            }
        } else {
            e.into()
        }
    })?;
    let pid = child.id() as i32;
    let overflow = Arc::new(AtomicBool::new(false));
    let count = Arc::new(AtomicUsize::new(0));
    let collect = |pipe: Option<Box<dyn Read + Send>>, progress: bool| {
        let overflow = overflow.clone();
        let count = count.clone();
        thread::spawn(move || -> io::Result<Vec<u8>> {
            let mut result = Vec::new();
            if let Some(mut pipe) = pipe {
                let mut chunk = [0u8; 8192];
                loop {
                    let size = pipe.read(&mut chunk)?;
                    if size == 0 {
                        break;
                    }
                    if count.fetch_add(size, Ordering::SeqCst) + size > maximum {
                        overflow.store(true, Ordering::SeqCst);
                        continue;
                    }
                    result.extend_from_slice(&chunk[..size]);
                    if progress {
                        send(json!({"kind":"progress","id":id,"value":B64.encode(&chunk[..size])}));
                    }
                }
            }
            Ok(result)
        })
    };
    let stdout = collect(
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
        false,
    );
    let stderr = collect(
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
        v["progress"].as_bool().unwrap_or(false),
    );
    let stdin = child.stdin.take();
    let writer = thread::spawn(move || {
        if let Some(mut stdin) = stdin {
            let _ = stdin.write_all(&input);
        }
    });
    let mut stopped = false;
    let status = loop {
        if cancel.load(Ordering::SeqCst) || overflow.load(Ordering::SeqCst) {
            // Kill the private process group, including inherited SSH/HTTP children, before acknowledging cancellation.
            unsafe {
                libc::kill(-pid, libc::SIGKILL);
            }
            stopped = true;
        }
        if let Some(status) = child.try_wait()? {
            break status;
        }
        thread::sleep(Duration::from_millis(10));
    };
    let _ = writer.join();
    let stdout = stdout
        .join()
        .map_err(|_| invalid("Output reader failed"))??;
    let stderr = stderr
        .join()
        .map_err(|_| invalid("Error reader failed"))??;
    if stopped {
        return Err(AgentError {
            message: if overflow.load(Ordering::SeqCst) {
                "Git output exceeded the size limit"
            } else {
                "Git operation was aborted"
            }
            .into(),
            code: if overflow.load(Ordering::SeqCst) {
                "output-too-large"
            } else {
                "aborted"
            }
            .into(),
        });
    }
    Ok(
        json!({"exitCode":status.code().unwrap_or(1),"stdout":B64.encode(stdout),"stderr":B64.encode(stderr)}),
    )
}

fn main() {
    let home = std::env::var("HOME").unwrap_or_default();
    if !Path::new(&home).is_absolute() {
        eprintln!("An absolute HOME is required");
        std::process::exit(1);
    }
    send(json!({"kind":"hello","protocol":2,"home":home,"temporary":std::env::temp_dir()}));
    let files: Files = Arc::new(Mutex::new(HashMap::new()));
    let tasks: Tasks = Arc::new(Mutex::new(HashMap::new()));
    let next = Arc::new(AtomicU64::new(1));
    let mut input = io::stdin().lock();
    let mut workers = Vec::new();
    loop {
        let mut line = Vec::new();
        match input
            .by_ref()
            .take((FRAME_LIMIT + 1) as u64)
            .read_until(b'\n', &mut line)
        {
            Ok(0) => break,
            Ok(_) => (),
            Err(_) => break,
        }
        if line.len() > FRAME_LIMIT {
            break;
        }
        let v: Value = match serde_json::from_slice(&line) {
            Ok(v) => v,
            Err(_) => break,
        };
        let id = match v["id"]
            .as_u64()
            .filter(|id| *id > 0 && *id <= 9_007_199_254_740_991)
        {
            Some(id) => id,
            None => break,
        };
        if v["kind"] == "cancel" {
            if let Some(c) = tasks.lock().unwrap().get(&id) {
                c.store(true, Ordering::SeqCst);
            }
            continue;
        }
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut active = tasks.lock().unwrap();
            if v["kind"] != "request" || active.len() >= 128 || active.contains_key(&id) {
                break;
            }
            active.insert(id, cancel.clone());
        }
        let files = files.clone();
        let tasks = tasks.clone();
        let next = next.clone();
        workers.retain(|worker: &thread::JoinHandle<()>| !worker.is_finished());
        workers.push(thread::spawn(move || {
            let result = match v["operation"].as_str() {
                Some("fs") => filesystem(&v, &files, &next),
                Some("git") => git(&v, &files, cancel, id),
                _ => Err(invalid("Unsupported agent operation")),
            };
            match result {
                Ok(value) => send(json!({"kind":"result","id":id,"value":value})),
                Err(e) => send(json!({"kind":"error","id":id,"message":e.message,"code":e.code})),
            }
            tasks.lock().unwrap().remove(&id);
        }));
    }
    for cancel in tasks.lock().unwrap().values() {
        cancel.store(true, Ordering::SeqCst);
    }
    for worker in workers {
        let _ = worker.join();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_relative_paths_and_unknown_operations() {
        let files = Arc::new(Mutex::new(HashMap::new()));
        let next = AtomicU64::new(1);
        assert!(filesystem(&json!({"method":"rm","path":"relative"}), &files, &next).is_err());
        assert!(filesystem(&json!({"method":"shell","path":"/tmp"}), &files, &next).is_err());
    }
}
