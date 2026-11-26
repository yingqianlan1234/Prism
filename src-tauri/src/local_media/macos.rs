use crate::{err, Result};
use sha2::{Digest, Sha256};
use std::{
    ffi::CString,
    fs::{self, File, Metadata, OpenOptions},
    os::{
        fd::AsRawFd,
        unix::{
            ffi::OsStrExt,
            fs::{MetadataExt, OpenOptionsExt},
        },
    },
    path::{Component, Path, PathBuf},
};
use tauri::WebviewWindow;
use tauri_plugin_dialog::DialogExt;

pub(crate) async fn choose_folder(window: WebviewWindow) -> Result<Option<PathBuf>> {
    let unavailable = || err("unavailable", "无法打开 macOS 文件夹选择器");
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selection) = window
            .dialog()
            .file()
            .set_parent(&window)
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let path = selection.into_path().map_err(|_| unavailable())?;
        fs::canonicalize(path).map(Some).map_err(|_| unavailable())
    })
    .await
    .map_err(|_| unavailable())?
}

pub(crate) fn path_length(path: &Path) -> usize {
    path.as_os_str().as_bytes().len()
}

pub(crate) fn hash_path(hash: &mut Sha256, path: &Path) {
    hash.update(path.as_os_str().as_bytes());
}

pub(crate) fn safe_directory(path: &Path) -> bool {
    let mut components = path.components();
    if components.next() != Some(Component::RootDir)
        || !components.all(|component| matches!(component, Component::Normal(_)))
    {
        return false;
    }
    let ancestors: Vec<_> = path.ancestors().collect();
    if !ancestors.into_iter().rev().all(|dir| {
        fs::symlink_metadata(dir)
            .is_ok_and(|metadata| metadata.is_dir() && !skip_metadata(&metadata))
    }) {
        return false;
    }
    let Ok(path) = CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    local_mount(|stats| unsafe { libc::statfs(path.as_ptr(), stats) })
}

fn local_mount(read_stats: impl FnOnce(*mut libc::statfs) -> libc::c_int) -> bool {
    let mut stats = std::mem::MaybeUninit::<libc::statfs>::uninit();
    read_stats(stats.as_mut_ptr()) == 0
        && unsafe { stats.assume_init().f_flags } & libc::MNT_LOCAL as u32 != 0
}

pub(crate) fn skip_metadata(metadata: &Metadata) -> bool {
    metadata.file_type().is_symlink()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Identity {
    device: u64,
    inode: u64,
    pub len: u64,
    modified: (i64, i64),
    changed: (i64, i64),
}

pub(crate) fn open_file(path: &Path, max_bytes: u64) -> Result<(File, Identity)> {
    let denied = || err("unavailable", "本地文件不可读或已变化，请重新扫描");
    if !path.parent().is_some_and(safe_directory) {
        return Err(denied());
    }
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| denied())?;
    let metadata = file.metadata().map_err(|_| denied())?;
    let len = metadata.len();
    if !metadata.is_file() || metadata.nlink() != 1 || len == 0 || len > max_bytes {
        return Err(denied());
    }
    let fd = file.as_raw_fd();
    if !local_mount(|stats| unsafe { libc::fstatfs(fd, stats) }) {
        return Err(denied());
    }
    // Inspect the opened descriptor so an ancestor replacement cannot redirect playback.
    let mut actual = [0_u8; libc::MAXPATHLEN as usize];
    if unsafe {
        libc::fcntl(
            fd,
            libc::F_GETPATH,
            actual.as_mut_ptr().cast::<libc::c_char>(),
        )
    } != 0
        || actual.split(|&byte| byte == 0).next() != Some(path.as_os_str().as_bytes())
    {
        return Err(denied());
    }
    Ok((
        file,
        Identity {
            device: metadata.dev(),
            inode: metadata.ino(),
            len,
            modified: (metadata.mtime(), metadata.mtime_nsec()),
            changed: (metadata.ctime(), metadata.ctime_nsec()),
        },
    ))
}
