use crate::{err, Result};
use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom},
    os::windows::{
        ffi::{OsStrExt, OsStringExt},
        fs::{MetadataExt, OpenOptionsExt},
        io::AsRawHandle,
    },
    path::{Component, Path, PathBuf, Prefix},
};
use tauri::http::{header, Response, StatusCode};
use windows::{
    core::{HRESULT, PCWSTR},
    Win32::{
        Foundation::{HANDLE, HWND},
        Storage::FileSystem::{
            GetDriveTypeW, GetFileInformationByHandle, GetFinalPathNameByHandleW,
            BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_OFFLINE,
            FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
            VOLUME_NAME_DOS,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED,
        },
        UI::Shell::{
            FileOpenDialog, IFileOpenDialog, FOS_FORCEFILESYSTEM, FOS_NOCHANGEDIR, FOS_PICKFOLDERS,
            SIGDN_FILESYSPATH,
        },
    },
};

pub(crate) const MAX_AUDIO_BYTES: u64 = 256 * 1024 * 1024;
pub(crate) const MAX_LYRIC_BYTES: u64 = 256 * 1024;
const CHUNK_BYTES: u64 = 4 * 1024 * 1024;
const SKIP_ATTRIBUTES: u32 = FILE_ATTRIBUTE_REPARSE_POINT.0 | FILE_ATTRIBUTE_OFFLINE.0;

pub(crate) fn choose_folder(owner: HWND) -> Result<Option<PathBuf>> {
    let unavailable = || err("unavailable", "无法打开 Windows 文件夹选择器");
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|_| unavailable())?;
        let _apartment = Apartment;
        let picker: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)
            .map_err(|_| unavailable())?;
        let options = picker.GetOptions().map_err(|_| unavailable())?;
        picker
            .SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR)
            .map_err(|_| unavailable())?;
        if let Err(error) = picker.Show(Some(owner)) {
            return if error.code() == HRESULT(0x800704c7_u32 as i32) {
                Ok(None)
            } else {
                Err(unavailable())
            };
        }
        let item = picker.GetResult().map_err(|_| unavailable())?;
        let value = item
            .GetDisplayName(SIGDN_FILESYSPATH)
            .map_err(|_| unavailable())?;
        let path = PathBuf::from(OsString::from_wide(value.as_wide()));
        CoTaskMemFree(Some(value.0.cast()));
        Ok(Some(path))
    }
}

pub(crate) fn disk_path(path: &Path) -> bool {
    let mut components = path.components();
    let drive = match components.next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) => drive,
            _ => return false,
        },
        _ => return false,
    };
    if components.next() != Some(Component::RootDir)
        || !components.all(|c| matches!(c, Component::Normal(_)))
    {
        return false;
    }
    let volume = [u16::from(drive), b':' as u16, b'\\' as u16, 0];
    // Local removable, fixed, optical, and RAM drives. Excludes mapped network drives.
    matches!(
        unsafe { GetDriveTypeW(PCWSTR(volume.as_ptr())) },
        2 | 3 | 5 | 6
    )
}

pub(crate) fn safe_directory(path: &Path) -> bool {
    // Check from the volume down so a redirected ancestor is never traversed.
    let ancestors: Vec<_> = path.ancestors().filter(|path| path.has_root()).collect();
    disk_path(path)
        && ancestors
            .into_iter()
            .rev()
            .all(|dir| fs::symlink_metadata(dir).is_ok_and(|m| m.is_dir() && !skip_metadata(&m)))
}

pub(crate) fn skip_metadata(metadata: &fs::Metadata) -> bool {
    metadata.file_attributes() & SKIP_ATTRIBUTES != 0
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Identity {
    volume: u32,
    index: u64,
    pub len: u64,
    modified: u64,
}

fn number(high: u32, low: u32) -> u64 {
    (u64::from(high) << 32) | u64::from(low)
}

pub(crate) fn open_file(path: &Path, max_bytes: u64) -> Result<(File, Identity)> {
    let denied = || err("unavailable", "本地文件不可读或已变化，请重新扫描");
    if !path.parent().is_some_and(safe_directory) {
        return Err(denied());
    }
    let file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ.0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)
        .map_err(|_| denied())?;
    let handle = HANDLE(file.as_raw_handle());
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(handle, &mut info) }.map_err(|_| denied())?;
    let len = number(info.nFileSizeHigh, info.nFileSizeLow);
    if info.dwFileAttributes & (SKIP_ATTRIBUTES | FILE_ATTRIBUTE_DIRECTORY.0) != 0
        || info.nNumberOfLinks > 1
        || len == 0
        || len > max_bytes
    {
        return Err(denied());
    }
    let expected: Vec<u16> = path.as_os_str().encode_wide().collect();
    let mut actual = vec![0; expected.len() + 1];
    let count = unsafe { GetFinalPathNameByHandleW(handle, &mut actual, VOLUME_NAME_DOS) } as usize;
    if count != expected.len() || actual[..count] != expected {
        return Err(denied());
    }
    let identity = Identity {
        volume: info.dwVolumeSerialNumber,
        index: number(info.nFileIndexHigh, info.nFileIndexLow),
        len,
        modified: number(
            info.ftLastWriteTime.dwHighDateTime,
            info.ftLastWriteTime.dwLowDateTime,
        ),
    };
    Ok((file, identity))
}

fn requested_range(range: &str, len: u64) -> Option<(u64, u64)> {
    let decimal = |value: &str| {
        (!value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()))
            .then(|| value.parse::<u64>().ok())
            .flatten()
    };
    let (start, end) = range.strip_prefix("bytes=")?.split_once('-')?;
    if start.is_empty() {
        let size = decimal(end)?.min(len).min(CHUNK_BYTES);
        return (size != 0).then_some((len - size, len - 1));
    }
    let start = decimal(start)?;
    let end = if end.is_empty() {
        len - 1
    } else {
        decimal(end)?.min(len - 1)
    };
    (start <= end).then(|| (start, end.min(start + CHUNK_BYTES - 1)))
}

pub(crate) fn stream_file(
    mut file: File,
    len: u64,
    mime: &str,
    range: Option<&str>,
    head: bool,
) -> Result<Response<Vec<u8>>> {
    let range = if head { None } else { range };
    let mut response = Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff");
    let (start, end) = match range {
        Some(value) => match requested_range(value, len) {
            Some(pair) => pair,
            None => {
                return response
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                    .body(Vec::new())
                    .map_err(|_| err("unavailable", "无法构造本地音频响应"))
            }
        },
        None if head => (0, len - 1),
        // Tauri's custom-protocol body is buffered. WebView2 can request the next range.
        None => (0, len.min(CHUNK_BYTES) - 1),
    };
    let size = end - start + 1;
    response = if range.is_some() || size < len {
        response
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
    } else {
        response.status(StatusCode::OK)
    };
    let mut body = Vec::new();
    if !head {
        body.resize(size as usize, 0);
        file.seek(SeekFrom::Start(start))
            .and_then(|_| file.read_exact(&mut body))
            .map_err(|_| err("unavailable", "无法读取本地音频"))?;
    }
    response
        .header(header::CONTENT_LENGTH, size.to_string())
        .body(body)
        .map_err(|_| err("unavailable", "无法构造本地音频响应"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range_parser_bounds_open_ended_suffix_and_invalid_ranges() {
        assert_eq!(requested_range("bytes=2-4", 8), Some((2, 4)));
        assert_eq!(requested_range("bytes=5-", 8), Some((5, 7)));
        assert_eq!(requested_range("bytes=-2", 8), Some((6, 7)));
        assert_eq!(
            requested_range("bytes=0-", 10_000_000),
            Some((0, CHUNK_BYTES - 1))
        );
        for value in [
            "bytes=-0",
            "bytes=8-",
            "bytes=4-2",
            "bytes=-",
            "bytes=+2-",
            "bytes=2-3,5-6",
        ] {
            assert_eq!(requested_range(value, 8), None);
        }
    }
}
