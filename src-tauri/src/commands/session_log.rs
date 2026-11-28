//! 会话日志文件。内容由前端按会话生成（去掉转义序列的纯文本，见 utils/sessionLog.ts），
//! 这里只管落盘、列举、读取。

use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// 默认日志目录
const DEFAULT_DIR: &str = "~/iTerminal/logs";
/// 读日志默认取末尾这么多字节
const DEFAULT_READ_BYTES: u64 = 64 * 1024;

fn resolve_dir(dir: Option<&str>) -> PathBuf {
    let raw = dir
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_DIR);
    PathBuf::from(shellexpand::tilde(raw).into_owned())
}

/// 日志目录的绝对路径（不存在就创建）。「打开目录」按钮用
#[tauri::command]
pub fn resolve_session_log_dir(dir: Option<String>) -> Result<String, String> {
    let path = resolve_dir(dir.as_deref());
    fs::create_dir_all(&path)
        .map_err(|e| format!("无法创建日志目录 {}: {}", path.display(), e))?;
    Ok(path.to_string_lossy().into_owned())
}

/// 往日志文件追加内容，目录和文件不存在时创建
#[tauri::command]
pub fn append_session_log(path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(shellexpand::tilde(&path).into_owned());
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
pub struct SessionLogFile {
    pub name: String,
    pub size: u64,
    /// 修改时间（Unix 秒）
    pub modified_at: i64,
}

/// 日志文件列表，新的在前。目录还没建当作没有日志
#[tauri::command]
pub fn list_session_logs(dir: Option<String>, limit: Option<usize>) -> Result<Vec<SessionLogFile>, String> {
    let path = resolve_dir(dir.as_deref());
    let entries = match fs::read_dir(&path) {
        Ok(entries) => entries,
        Err(_) => return Ok(Vec::new()),
    };

    let mut files = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".log") {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|since| since.as_secs() as i64)
            .unwrap_or(0);
        files.push(SessionLogFile {
            name,
            size: metadata.len(),
            modified_at,
        });
    }
    files.sort_unstable_by(|a, b| b.modified_at.cmp(&a.modified_at).then_with(|| b.name.cmp(&a.name)));
    files.truncate(limit.unwrap_or(20));
    Ok(files)
}

#[derive(Debug, Serialize)]
pub struct SessionLogContent {
    pub name: String,
    pub size: u64,
    /// 只给了末尾一部分
    pub truncated: bool,
    pub content: String,
}

/// 只接受日志目录里的文件名，挡住 ../ 和带路径的写法
fn file_in_dir(base: &std::path::Path, name: &str) -> Result<PathBuf, String> {
    let path = base.join(name);
    if name.is_empty() || path.parent() != Some(base) {
        return Err("只能读取日志目录里的文件，请传文件名".to_string());
    }
    Ok(path)
}

/// 读日志的末尾 max_bytes 字节（默认 64KB）
#[tauri::command]
pub fn read_session_log(
    dir: Option<String>,
    name: String,
    max_bytes: Option<u64>,
) -> Result<SessionLogContent, String> {
    let base = resolve_dir(dir.as_deref());
    let path = file_in_dir(&base, &name)?;
    let mut file = fs::File::open(&path).map_err(|_| format!("读不到日志 {}", name))?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();

    let start = size.saturating_sub(max_bytes.unwrap_or(DEFAULT_READ_BYTES));
    file.seek(SeekFrom::Start(start))
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::with_capacity((size - start) as usize);
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    let mut content = String::from_utf8_lossy(&bytes).into_owned();

    // 从中间截断时，丢掉开头那半行和被切开的残缺字符
    if start > 0 {
        if let Some(newline) = content.find('\n') {
            content = content[newline + 1..].to_string();
        }
        content = content.trim_start_matches('\u{FFFD}').to_string();
    }

    Ok(SessionLogContent {
        name,
        size,
        truncated: start > 0,
        content,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_file_names_inside_the_log_dir_are_allowed() {
        let base = std::path::Path::new("/tmp/logs");
        assert!(file_in_dir(base, "web_20261128_210509_ab12.log").is_ok());
        assert!(file_in_dir(base, "../secret.txt").is_err());
        assert!(file_in_dir(base, "sub/inner.log").is_err());
        assert!(file_in_dir(base, "").is_err());
    }

    #[test]
    fn reading_the_tail_drops_the_cut_line() {
        let dir = tempfile_dir();
        std::fs::write(dir.join("a.log"), "first line\nsecond line\nthird line 中文\n").unwrap();

        let whole = read_session_log(Some(dir.to_string_lossy().into_owned()), "a.log".into(), None).unwrap();
        assert_eq!(whole.content, "first line\nsecond line\nthird line 中文\n");
        assert!(!whole.truncated);

        // 只取末尾 25 字节：落在 "second line" 中间，丢掉被切的那半行
        // （全文 41 字节：first line\n 11 + second line\n 12 + third line 中文\n 18）
        let tail = read_session_log(Some(dir.to_string_lossy().into_owned()), "a.log".into(), Some(25)).unwrap();
        assert_eq!(tail.content, "third line 中文\n");
        assert!(tail.truncated);

        // 切在一个多字节字符中间、后面没有换行可依：残缺的半个字符去掉，不留下替换符号
        std::fs::write(dir.join("b.log"), "中文only").unwrap();
        let dir_arg = dir.to_string_lossy().into_owned();
        let split_char = read_session_log(Some(dir_arg.clone()), "b.log".into(), Some(8)).unwrap();
        assert_eq!(split_char.content, "文only");

        // 越界的文件名被拒绝
        assert!(read_session_log(Some(dir_arg), "../x.log".into(), None).is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn listing_is_newest_first_and_only_logs() {
        let dir = tempfile_dir();
        std::fs::write(dir.join("old.log"), "a\n").unwrap();
        std::fs::write(dir.join("new.log"), "b\n").unwrap();
        std::fs::write(dir.join("notes.txt"), "c\n").unwrap();
        std::fs::create_dir(dir.join("dir.log")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        std::fs::write(dir.join("new.log"), "b\n").unwrap();

        let dir_arg = Some(dir.to_string_lossy().into_owned());
        let files = list_session_logs(dir_arg.clone(), None).unwrap();
        assert_eq!(
            files.iter().map(|file| file.name.as_str()).collect::<Vec<_>>(),
            ["new.log", "old.log"]
        );
        assert_eq!(list_session_logs(dir_arg, Some(1)).unwrap().len(), 1);
        // 目录不存在：当作没有日志，不报错
        assert!(list_session_logs(Some("/nonexistent/iterminal-logs".into()), None).unwrap().is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn appending_creates_dirs_and_keeps_order() {
        let dir = tempfile_dir().join("nested");
        let path = dir.join("session.log");
        append_session_log(path.to_string_lossy().into_owned(), "one\n".into()).unwrap();
        append_session_log(path.to_string_lossy().into_owned(), "two\n".into()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "one\ntwo\n");

        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    /// 每个测试一个独立目录，测完删掉
    fn tempfile_dir() -> PathBuf {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "iterminal-sessionlog-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}
