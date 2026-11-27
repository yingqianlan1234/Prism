use crate::{err, Result};
use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    os::windows::{
        ffi::{OsStrExt, OsStringExt},
        fs::{MetadataExt, OpenOptionsExt},
        io::AsRawHandle,
    },
    path::{Component, Path, PathBuf, Prefix},
};
use tauri::WebviewWindow;
use ::windows::{
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

const SKIP_ATTRIBUTES: u32 = FILE_ATTRIBUTE_REPARSE_POINT.0 | FILE_ATTRIBUTE_OFFLINE.0;

pub(crate) async fn choose_folder(window: WebviewWindow) -> Result<Option<PathBuf>> {
    crate::desktop_shortcuts::on_ui(window, choose_folder_dialog).await
}

pub(crate) fn path_length(path: &Path) -> usize {
    path.as_os_str().encode_wide().count()
}

pub(crate) fn hash_path(hash: &mut sha2::Sha256, path: &Path) {
    use sha2::Digest;
    for code in path.as_os_str().encode_wide() {
        hash.update(code.to_le_bytes());
    }
}

fn choose_folder_dialog(owner: HWND) -> Result<Option<PathBuf>> {
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
