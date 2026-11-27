use crate::{err, local_media, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use lofty::{
    config::{apply_global_options, GlobalOptions, ParseOptions},
    file::{AudioFile, FileType, TaggedFileExt},
    picture::PictureType,
    probe::Probe,
    tag::Accessor,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, VecDeque},
    fs::{self, File},
    io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex, MutexGuard,
    },
    time::{Duration, Instant},
};
use tauri::{
    http::{Method, Response, StatusCode},
    AppHandle, Manager, State, WebviewWindow,
};

const MAX_FOLDERS: usize = 16;
const MAX_DEPTH: usize = 12;
const MAX_TRACKS: usize = 5_000;
const MAX_ENTRIES: usize = 50_000;
const MAX_QUEUE: usize = 1_000;
const CONFIG_BYTES: usize = 512 * 1024;
const MAX_STREAMS: usize = 8;
const STREAM_TTL: Duration = Duration::from_secs(12 * 3600);
const MAX_COVER_BYTES: usize = 2 * 1024 * 1024;
const MAX_CACHED_COVERS: usize = 64;
const MAX_CACHED_COVER_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Folder {
    id: String,
    path: PathBuf,
}

#[derive(Serialize)]
pub(crate) struct FolderInfo {
    id: String,
    name: String,
}

impl Folder {
    fn info(&self) -> FolderInfo {
        FolderInfo {
            id: self.id.clone(),
            name: self
                .path
                .file_name()
                .map(|name| label(&name.to_string_lossy()))
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| "本地磁盘".into()),
        }
    }
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Queue {
    ids: Vec<String>,
    index: Option<usize>,
    position: f64,
}

impl Queue {
    fn valid(&self) -> bool {
        self.ids.len() <= MAX_QUEUE
            && self.ids.iter().all(|id| opaque_id(id, 64))
            && self.index.is_none_or(|index| index < self.ids.len())
            && self.position.is_finite()
            && (0.0..=86400.0).contains(&self.position)
            && (self.index.is_some() || self.position == 0.0)
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Versioned<T> {
    version: u8,
    value: T,
}

fn load_config<T: DeserializeOwned + Default>(path: &Path) -> Result<T> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(T::default()),
        Err(_) => return Err(err("storage", "无法读取本地曲库设置")),
    };
    let bytes = crate::playback_storage::read_limited(file, CONFIG_BYTES)
        .map_err(|_| err("storage", "无法读取本地曲库设置"))?;
    let config = (bytes.len() <= CONFIG_BYTES)
        .then(|| serde_json::from_slice::<Versioned<T>>(&bytes).ok())
        .flatten()
        .filter(|config| config.version == 1)
        .ok_or(err("storage", "本地曲库设置格式无效"))?;
    Ok(config.value)
}

fn save_config(path: &Path, value: &impl Serialize) -> Result<()> {
    let bytes = serde_json::to_vec(&Versioned { version: 1, value })
        .map_err(|_| err("storage", "无法编码本地曲库设置"))?;
    if bytes.len() > CONFIG_BYTES {
        return Err(err("storage", "本地曲库设置超出大小限制"));
    }
    crate::playback_storage::write_if_changed(path, &bytes)
        .map_err(|_| err("storage", "无法保存本地曲库设置"))?;
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackInfo {
    id: String,
    folder_id: String,
    title: String,
    artist: Option<String>,
    album: Option<String>,
    duration_ms: Option<u64>,
}

#[derive(Clone)]
struct Track {
    info: TrackInfo,
    path: PathBuf,
    identity: local_media::Identity,
    mime: &'static str,
}

#[derive(Default)]
struct Catalog {
    tracks: BTreeMap<String, Track>,
    truncated: bool,
    unavailable_folder_ids: Vec<String>,
}

struct Lease {
    token: String,
    id: String,
    expires: Instant,
}

struct CachedCover {
    id: String,
    identity: local_media::Identity,
    data_url: Option<String>,
    byte_len: usize,
}

#[derive(Default)]
struct Library {
    folders: Vec<Folder>,
    catalog: Catalog,
    scanned: bool,
    revision: u64,
    scanning: bool,
    leases: VecDeque<Lease>,
    covers: VecDeque<CachedCover>,
}

impl Library {
    fn prune_covers(&mut self) {
        self.covers.retain(|cover| {
            self.catalog
                .tracks
                .get(&cover.id)
                .is_some_and(|track| track.identity == cover.identity)
        });
    }

    fn cache_cover(&mut self, id: String, track: &Track, data_url: Option<String>) {
        self.covers.retain(|cover| cover.id != id);
        let byte_len = data_url.as_ref().map_or(0, String::len);
        let mut total = byte_len + self.covers.iter().map(|cover| cover.byte_len).sum::<usize>();
        while self.covers.len() >= MAX_CACHED_COVERS || total > MAX_CACHED_COVER_BYTES {
            total -= self.covers.pop_front().unwrap().byte_len;
        }
        self.covers.push_back(CachedCover {
            id,
            identity: track.identity,
            data_url,
            byte_len,
        });
    }
}

pub(crate) struct LocalLibrary {
    dir: PathBuf,
    inner: Mutex<Result<Library>>,
    stream_requests: AtomicUsize,
}

impl LocalLibrary {
    fn open(dir: Result<PathBuf>) -> Self {
        let inner = dir
            .as_ref()
            .map_err(|e| err(e.kind, e.message))
            .and_then(|dir| {
                let folders: Vec<Folder> = load_config(&dir.join("folders.json"))?;
                if folders.len() > MAX_FOLDERS
                    || folders.iter().any(|folder| {
                        !opaque_id(&folder.id, 32)
                            || !folder.path.is_absolute()
                            || local_media::path_length(&folder.path) > 2048
                    })
                    || folders.iter().enumerate().any(|(i, f)| {
                        folders[..i]
                            .iter()
                            .any(|other| f.id == other.id || f.path == other.path)
                    })
                {
                    return Err(err("storage", "本地曲库目录设置无效"));
                }
                Ok(Library {
                    folders,
                    ..Library::default()
                })
            });
        Self {
            dir: dir.unwrap_or_default(),
            inner: Mutex::new(inner),
            stream_requests: AtomicUsize::new(0),
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, Result<Library>>> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| err("unavailable", "本地曲库暂不可用"))?;
        if let Err(error) = &*guard {
            return Err(err(error.kind, error.message));
        }
        Ok(guard)
    }
}

pub(crate) fn install(app: &AppHandle) {
    let dir = app
        .path()
        .app_data_dir()
        .map(|dir| dir.join("local-library"))
        .map_err(|_| err("storage", "无法确定本地曲库目录"));
    app.manage(LocalLibrary::open(dir));
}

fn random_token() -> String {
    format!("{:032x}", rand::random::<u128>())
}
fn opaque_id(id: &str, length: usize) -> bool {
    id.len() == length
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn label(value: &str) -> String {
    value
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(512)
        .collect()
}

fn track_id(folder: &Folder, path: &Path) -> String {
    let mut hash = Sha256::new();
    hash.update(folder.id.as_bytes());
    let relative = path
        .strip_prefix(&folder.path)
        .expect("scan paths must be under the configured folder");
    local_media::hash_path(&mut hash, relative);
    format!("{:x}", hash.finalize())
}

fn scan_track(folder: &Folder, path: PathBuf) -> Option<Track> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    let mime = match extension.as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        _ => return None,
    };
    let (file, identity) = local_media::open_file(&path, local_media::MAX_AUDIO_BYTES).ok()?;
    let probe = Probe::new(io::BufReader::new(file))
        .options(ParseOptions::new().read_cover_art(false))
        .guess_file_type()
        .ok()?;
    let file_type = probe.file_type()?;
    let matches_extension = matches!(
        (extension.as_str(), file_type),
        ("mp3", FileType::Mpeg)
            | ("flac", FileType::Flac)
            | ("wav", FileType::Wav)
            | ("m4a", FileType::Mp4)
            | ("ogg", FileType::Vorbis | FileType::Opus | FileType::Speex)
    );
    if !matches_extension {
        return None;
    }
    #[cfg(target_os = "macos")]
    let mime = match file_type {
        FileType::Vorbis => "audio/ogg; codecs=vorbis",
        FileType::Opus => "audio/ogg; codecs=opus",
        FileType::Speex => "audio/ogg; codecs=speex",
        _ => mime,
    };
    let tagged = probe.read().ok();
    let tag = tagged
        .as_ref()
        .and_then(|file| file.primary_tag().or_else(|| file.first_tag()));
    let title = tag
        .and_then(|tag| tag.title())
        .map(|title| label(&title))
        .filter(|title| !title.is_empty())
        .or_else(|| path.file_stem().map(|name| label(&name.to_string_lossy())))
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| "未命名曲目".into());
    let info = TrackInfo {
        id: track_id(folder, &path),
        folder_id: folder.id.clone(),
        title,
        artist: tag
            .and_then(|tag| tag.artist())
            .map(|s| label(&s))
            .filter(|value| !value.is_empty()),
        album: tag
            .and_then(|tag| tag.album())
            .map(|s| label(&s))
            .filter(|value| !value.is_empty()),
        duration_ms: tagged
            .as_ref()
            .map(|file| file.properties().duration().as_millis() as u64)
            .filter(|&ms| ms > 0),
    };
    Some(Track {
        info,
        path,
        identity,
        mime,
    })
}

fn scan_folders(folders: &[Folder]) -> Catalog {
    apply_global_options(GlobalOptions::new().allocation_limit(4 * 1024 * 1024));
    let mut catalog = Catalog::default();
    let mut visited = 0;
    'folders: for folder in folders {
        if !local_media::safe_directory(&folder.path) {
            catalog.unavailable_folder_ids.push(folder.id.clone());
            continue;
        }
        let mut pending = vec![(folder.path.clone(), 0)];
        while let Some((dir, depth)) = pending.pop() {
            if !local_media::safe_directory(&dir) {
                continue;
            }
            let Ok(entries) = fs::read_dir(&dir) else {
                if depth == 0 {
                    catalog.unavailable_folder_ids.push(folder.id.clone());
                }
                continue;
            };
            for entry in entries {
                if visited >= MAX_ENTRIES || catalog.tracks.len() >= MAX_TRACKS {
                    catalog.truncated = true;
                    break 'folders;
                }
                visited += 1;
                let Ok(entry) = entry else {
                    continue;
                };
                let Ok(metadata) = fs::symlink_metadata(entry.path()) else {
                    continue;
                };
                if local_media::skip_metadata(&metadata) {
                    continue;
                }
                if metadata.is_dir() {
                    if depth < MAX_DEPTH {
                        pending.push((entry.path(), depth + 1));
                    } else {
                        catalog.truncated = true;
                    }
                } else if metadata.is_file() && metadata.len() <= local_media::MAX_AUDIO_BYTES {
                    if let Some(track) = scan_track(folder, entry.path()) {
                        catalog.tracks.insert(track.info.id.clone(), track);
                    }
                }
            }
        }
    }
    catalog
}

fn authorize(window: &WebviewWindow) -> Result<()> {
    if window.label() != "main" {
        return Err(err("permission", "仅主窗口可以管理本地曲库"));
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn local_library_folders_get(
    window: WebviewWindow,
    state: State<'_, LocalLibrary>,
) -> Result<Vec<FolderInfo>> {
    authorize(&window)?;
    Ok(state
        .lock()?
        .as_ref()
        .unwrap()
        .folders
        .iter()
        .map(Folder::info)
        .collect())
}

#[tauri::command]
pub(crate) async fn local_library_folder_pick(window: WebviewWindow) -> Result<Option<FolderInfo>> {
    authorize(&window)?;
    let app = window.app_handle().clone();
    let Some(selected) = local_media::choose_folder(window).await? else {
        return Ok(None);
    };
    tauri::async_runtime::spawn_blocking(move || {
        let invalid = || err("validation", "请选择可访问的本地目录");
        if local_media::path_length(&selected) > 2044
            || !local_media::safe_directory(&selected)
        {
            return Err(invalid());
        }
        let path = fs::canonicalize(selected).map_err(|_| invalid())?;
        if !local_media::safe_directory(&path) {
            return Err(invalid());
        }
        let state = app.state::<LocalLibrary>();
        let mut guard = state.lock()?;
        let library = guard.as_mut().unwrap();
        if let Some(folder) = library.folders.iter().find(|folder| folder.path == path) {
            return Ok(Some(folder.info()));
        }
        if library.folders.len() >= MAX_FOLDERS {
            return Err(err("validation", "本地曲库最多可添加 16 个目录"));
        }
        if library
            .folders
            .iter()
            .any(|folder| path.starts_with(&folder.path) || folder.path.starts_with(&path))
        {
            return Err(err("validation", "所选目录与已有曲库目录重叠"));
        }
        let folder = Folder {
            id: random_token(),
            path,
        };
        let mut folders = library.folders.clone();
        folders.push(folder.clone());
        save_config(&state.dir.join("folders.json"), &folders)?;
        library.folders = folders;
        library.revision += 1;
        library.scanned = false;
        Ok(Some(folder.info()))
    })
    .await
    .map_err(|_| err("unavailable", "无法添加本地曲库目录"))?
}

#[tauri::command]
pub(crate) fn local_library_folder_remove(
    window: WebviewWindow,
    state: State<'_, LocalLibrary>,
    id: String,
) -> Result<()> {
    authorize(&window)?;
    if !opaque_id(&id, 32) {
        return Err(err("validation", "曲库目录标识无效"));
    }
    let mut guard = state.lock()?;
    let library = guard.as_mut().unwrap();
    if !library.folders.iter().any(|folder| folder.id == id) {
        return Err(err("not_found", "曲库目录不存在"));
    }
    let mut folders = library.folders.clone();
    folders.retain(|folder| folder.id != id);
    save_config(&state.dir.join("folders.json"), &folders)?;
    library.folders = folders;
    library.revision += 1;
    library
        .catalog
        .tracks
        .retain(|_, track| track.info.folder_id != id);
    library
        .catalog
        .unavailable_folder_ids
        .retain(|folder_id| folder_id != &id);
    library
        .leases
        .retain(|lease| library.catalog.tracks.contains_key(&lease.id));
    library.prune_covers();
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScanInfo {
    total: usize,
    truncated: bool,
    unavailable_folder_ids: Vec<String>,
}

#[tauri::command]
pub(crate) async fn local_library_scan(window: WebviewWindow) -> Result<ScanInfo> {
    authorize(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LocalLibrary>();
        let (folders, revision) = {
            let mut guard = state.lock()?;
            let library = guard.as_mut().unwrap();
            if library.scanning {
                return Err(err("busy", "本地曲库正在扫描"));
            }
            library.scanning = true;
            (library.folders.clone(), library.revision)
        };
        let scanned = std::panic::catch_unwind(|| scan_folders(&folders));
        let mut guard = state.lock()?;
        let library = guard.as_mut().unwrap();
        library.scanning = false;
        let catalog = scanned.map_err(|_| err("unavailable", "本地曲库扫描失败"))?;
        if library.revision != revision {
            return Err(err("conflict", "目录已变化，请重新扫描"));
        }
        library.leases.retain(|lease| {
            catalog
                .tracks
                .get(&lease.id)
                .zip(library.catalog.tracks.get(&lease.id))
                .is_some_and(|(new, old)| new.identity == old.identity && new.path == old.path)
        });
        let info = ScanInfo {
            total: catalog.tracks.len(),
            truncated: catalog.truncated,
            unavailable_folder_ids: catalog.unavailable_folder_ids.clone(),
        };
        library.catalog = catalog;
        library.prune_covers();
        library.scanned = true;
        Ok(info)
    })
    .await
    .map_err(|_| err("unavailable", "本地曲库扫描失败"))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrackPage {
    tracks: Vec<TrackInfo>,
    total: usize,
    has_more: bool,
    scanned: bool,
}

#[tauri::command]
pub(crate) fn local_library_tracks_get(
    window: WebviewWindow,
    state: State<'_, LocalLibrary>,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<TrackPage> {
    authorize(&window)?;
    let (offset, limit) = (offset.unwrap_or(0), limit.unwrap_or(100));
    if offset > MAX_TRACKS || !(1..=200).contains(&limit) {
        return Err(err("validation", "本地曲目分页参数无效"));
    }
    let guard = state.lock()?;
    let library = guard.as_ref().unwrap();
    let mut tracks: Vec<_> = library
        .catalog
        .tracks
        .values()
        .map(|track| &track.info)
        .collect();
    tracks.sort_unstable_by(|a, b| (&a.title, &a.id).cmp(&(&b.title, &b.id)));
    let total = tracks.len();
    Ok(TrackPage {
        total,
        has_more: offset + limit < total,
        scanned: library.scanned,
        tracks: tracks
            .into_iter()
            .skip(offset)
            .take(limit)
            .cloned()
            .collect(),
    })
}

fn registered_track(library: &Library, id: &str) -> Result<Track> {
    if !opaque_id(id, 64) {
        return Err(err("validation", "本地曲目标识无效"));
    }
    library
        .catalog
        .tracks
        .get(id)
        .cloned()
        .ok_or(err("not_found", "曲目不在当前本地曲库中，请重新扫描"))
}

fn checked_file(track: &Track) -> Result<File> {
    let (file, identity) = local_media::open_file(&track.path, local_media::MAX_AUDIO_BYTES)?;
    if track.identity != identity {
        return Err(err("unavailable", "本地曲目已变化，请重新扫描"));
    }
    Ok(file)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlaybackUrl {
    url: String,
    content_type: &'static str,
}

#[tauri::command]
pub(crate) async fn local_track_resolve(window: WebviewWindow, id: String) -> Result<PlaybackUrl> {
    authorize(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LocalLibrary>();
        let track = registered_track(state.lock()?.as_ref().unwrap(), &id)?;
        let _file = checked_file(&track)?;
        let mut guard = state.lock()?;
        let library = guard.as_mut().unwrap();
        if library
            .catalog
            .tracks
            .get(&id)
            .is_none_or(|current| current.identity != track.identity || current.path != track.path)
        {
            return Err(err("not_found", "曲目已从当前曲库移除"));
        }
        let now = Instant::now();
        library.leases.retain(|lease| lease.expires > now);
        if library.leases.len() >= MAX_STREAMS {
            library.leases.pop_front();
        }
        let token = random_token();
        library.leases.push_back(Lease {
            token: token.clone(),
            id,
            expires: now + STREAM_TTL,
        });
        Ok(PlaybackUrl {
            url: local_media::stream_url(&token),
            content_type: track.mime,
        })
    })
    .await
    .map_err(|_| err("unavailable", "无法解析本地曲目"))?
}

fn lyric_text(bytes: &[u8]) -> Result<String> {
    let utf16 = bytes
        .strip_prefix(&[0xff, 0xfe])
        .map(|bytes| (bytes, true))
        .or_else(|| {
            bytes
                .strip_prefix(&[0xfe, 0xff])
                .map(|bytes| (bytes, false))
        });
    if let Some((bytes, little_endian)) = utf16 {
        if bytes.len() % 2 != 0 {
            return Err(err("validation", "本地歌词编码无效"));
        }
        let decode = if little_endian {
            u16::from_le_bytes
        } else {
            u16::from_be_bytes
        };
        return String::from_utf16(
            &bytes
                .chunks_exact(2)
                .map(|p| decode([p[0], p[1]]))
                .collect::<Vec<_>>(),
        )
        .map_err(|_| err("validation", "本地歌词编码无效"));
    }
    std::str::from_utf8(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes))
        .map(str::to_owned)
        .map_err(|_| err("validation", "本地歌词须使用 UTF-8 或 UTF-16"))
}

#[tauri::command]
pub(crate) async fn local_track_lyric(window: WebviewWindow, id: String) -> Result<Option<String>> {
    authorize(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LocalLibrary>();
        let track = registered_track(state.lock()?.as_ref().unwrap(), &id)?;
        let _file = checked_file(&track)?;
        let path = track.path.with_extension("lrc");
        if fs::symlink_metadata(&path).is_err_and(|e| e.kind() == io::ErrorKind::NotFound) {
            return Ok(None);
        }
        let (file, _) = local_media::open_file(&path, local_media::MAX_LYRIC_BYTES)?;
        let bytes =
            crate::playback_storage::read_limited(file, local_media::MAX_LYRIC_BYTES as usize)
                .map_err(|_| err("unavailable", "无法读取本地歌词"))?;
        let guard = state.lock()?;
        let current = registered_track(guard.as_ref().unwrap(), &id)?;
        if current.identity != track.identity {
            return Err(err("not_found", "本地曲目已变化"));
        }
        Ok(Some(lyric_text(&bytes)?))
    })
    .await
    .map_err(|_| err("unavailable", "无法读取本地歌词"))?
}

fn detect_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}

fn extract_cover_data_url(file: File) -> Option<String> {
    let tagged = Probe::new(io::BufReader::new(file))
        .options(ParseOptions::new().read_cover_art(true).read_properties(false))
        .guess_file_type()
        .ok()?
        .read()
        .ok()?;
    let mut fallback = None;
    for picture in tagged
        .primary_tag()
        .into_iter()
        .chain(tagged.tags())
        .flat_map(|tag| tag.pictures())
    {
        let bytes = picture.data();
        if bytes.is_empty() || bytes.len() > MAX_COVER_BYTES {
            continue;
        }
        let Some(mime) = detect_image_mime(bytes) else {
            continue;
        };
        if picture.pic_type() == PictureType::CoverFront {
            return Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)));
        }
        fallback.get_or_insert((mime, bytes));
    }
    fallback.map(|(mime, bytes)| format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
pub(crate) async fn local_track_cover(window: WebviewWindow, id: String) -> Result<Option<String>> {
    authorize(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LocalLibrary>();
        let track = registered_track(state.lock()?.as_ref().unwrap(), &id)?;
        let file = checked_file(&track)?;
        let current_track = |library: &Library| -> Result<()> {
            let current = registered_track(library, &id)?;
            if current.identity != track.identity || current.path != track.path {
                return Err(err("not_found", "本地曲目已变化"));
            }
            Ok(())
        };
        {
            let guard = state.lock()?;
            let library = guard.as_ref().unwrap();
            current_track(library)?;
            if let Some(cover) = library
                .covers
                .iter()
                .find(|cover| cover.id == id && cover.identity == track.identity)
            {
                return Ok(cover.data_url.clone());
            }
        }
        let data_url = extract_cover_data_url(file);
        let _checked = checked_file(&track)?;
        let mut guard = state.lock()?;
        let library = guard.as_mut().unwrap();
        current_track(library)?;
        library.cache_cover(id, &track, data_url.clone());
        Ok(data_url)
    })
    .await
    .map_err(|_| err("unavailable", "无法读取本地封面"))?
}

#[tauri::command]
pub(crate) fn local_queue_get(
    window: WebviewWindow,
    state: State<'_, LocalLibrary>,
) -> Result<Queue> {
    authorize(&window)?;
    let _state = state.lock()?;
    let queue: Queue = load_config(&state.dir.join("queue.json"))?;
    if !queue.valid() {
        return Err(err("storage", "本地播放队列格式无效"));
    }
    Ok(queue)
}

#[tauri::command]
pub(crate) fn local_queue_set(
    window: WebviewWindow,
    state: State<'_, LocalLibrary>,
    queue: Queue,
) -> Result<()> {
    authorize(&window)?;
    if !queue.valid() {
        return Err(err("validation", "本地播放队列无效"));
    }
    let guard = state.lock()?;
    if queue
        .ids
        .iter()
        .any(|id| !guard.as_ref().unwrap().catalog.tracks.contains_key(id))
    {
        return Err(err("not_found", "播放队列包含未扫描到的曲目"));
    }
    save_config(&state.dir.join("queue.json"), &queue)
}

pub(crate) fn protocol(
    ctx: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let empty = |status| {
        Response::builder()
            .status(status)
            .header(tauri::http::header::CACHE_CONTROL, "no-store")
            .body(Vec::new())
            .unwrap()
    };
    let head = request.method() == Method::HEAD;
    if ctx.webview_label() != "main" || (!head && request.method() != Method::GET) {
        responder.respond(empty(StatusCode::FORBIDDEN));
        return;
    }
    let Some(token) = request
        .uri()
        .path()
        .strip_prefix('/')
        .filter(|token| opaque_id(token, 32))
    else {
        responder.respond(empty(StatusCode::NOT_FOUND));
        return;
    };
    if request.uri().query().is_some() {
        responder.respond(empty(StatusCode::NOT_FOUND));
        return;
    }
    let app = ctx.app_handle().clone();
    let token = token.to_owned();
    let mut ranges = request.headers().get_all(tauri::http::header::RANGE).iter();
    let range = ranges.next().map(|range| {
        if ranges.next().is_some() {
            String::new()
        } else {
            range.to_str().unwrap_or("").to_owned()
        }
    });
    let state = app.state::<LocalLibrary>();
    if state.stream_requests.fetch_add(1, Ordering::Relaxed) >= 4 {
        state.stream_requests.fetch_sub(1, Ordering::Relaxed);
        responder.respond(empty(StatusCode::SERVICE_UNAVAILABLE));
        return;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LocalLibrary>();
        struct Slot<'a>(&'a AtomicUsize);
        impl Drop for Slot<'_> {
            fn drop(&mut self) {
                self.0.fetch_sub(1, Ordering::Relaxed);
            }
        }
        let _slot = Slot(&state.stream_requests);
        let find_track = || -> Result<Track> {
            let guard = state.lock()?;
            let library = guard.as_ref().unwrap();
            let lease = library
                .leases
                .iter()
                .find(|lease| lease.token == token && lease.expires > Instant::now())
                .ok_or(err("not_found", "本地播放地址已失效"))?;
            registered_track(library, &lease.id)
        };
        let response = (|| {
            let track = find_track()?;
            let file = checked_file(&track)?;
            let response = local_media::stream_file(
                file,
                track.identity.len,
                track.mime,
                range.as_deref(),
                head,
            )?;
            let current = find_track()?;
            if current.identity != track.identity || current.path != track.path {
                return Err(err("not_found", "本地曲目已变化"));
            }
            Ok(response)
        })()
        .unwrap_or_else(|_: crate::Error| empty(StatusCode::NOT_FOUND));
        responder.respond(response);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::http::header;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("prism-local-test-{}", random_token()));
            fs::create_dir(&root).unwrap();
            Self(fs::canonicalize(root).unwrap())
        }
        fn folder(&self) -> Folder {
            Folder {
                id: "a".repeat(32),
                path: self.0.clone(),
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn wav(with_tags: bool) -> Vec<u8> {
        fn chunk(dst: &mut Vec<u8>, tag: &[u8; 4], bytes: &[u8]) {
            dst.extend(tag);
            dst.extend((bytes.len() as u32).to_le_bytes());
            dst.extend(bytes);
            if bytes.len() % 2 != 0 {
                dst.push(0);
            }
        }
        let mut wave = b"WAVE".to_vec();
        chunk(
            &mut wave,
            b"fmt ",
            &[1, 0, 1, 0, 0x40, 0x1f, 0, 0, 0x40, 0x1f, 0, 0, 1, 0, 8, 0],
        );
        if with_tags {
            let mut info = b"INFO".to_vec();
            for (name, value) in [
                (b"INAM", b"Track\0".as_slice()),
                (b"IART", b"Artist\0"),
                (b"IPRD", b"Album\0"),
            ] {
                chunk(&mut info, name, value);
            }
            chunk(&mut wave, b"LIST", &info);
        }
        chunk(&mut wave, b"data", &vec![128; 8000]);
        let mut riff = Vec::new();
        chunk(&mut riff, b"RIFF", &wave);
        riff
    }

    #[test]
    fn cover_mime_checks_magic_and_length() {
        for (bytes, mime) in [
            (b"\xff\xd8\xff".as_slice(), "image/jpeg"),
            (b"\x89PNG\r\n\x1a\n", "image/png"),
            (b"RIFF\x00\x00\x00\x00WEBP", "image/webp"),
        ] {
            assert_eq!(detect_image_mime(bytes), Some(mime));
            assert_eq!(detect_image_mime(&bytes[..bytes.len() - 1]), None);
        }
        for bytes in [
            b"<svg />".as_slice(),
            b"GIF89a",
            b"<html>",
            b"text",
            b"",
            b"RIFFxxxxWAVE",
        ] {
            assert_eq!(detect_image_mime(bytes), None);
        }
    }

    #[test]
    fn extracts_only_valid_embedded_covers_and_prefers_front() {
        use lofty::{
            config::WriteOptions,
            picture::{MimeType, Picture},
            tag::{Tag, TagExt, TagType},
        };

        let fixture = Fixture::new();
        let path = fixture.0.join("cover.wav");
        fs::write(&path, wav(false)).unwrap();
        let extract = || extract_cover_data_url(File::open(&path).unwrap());
        assert_eq!(extract(), None);

        let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
        let picture = |bytes, kind| {
            Picture::unchecked(bytes)
                .pic_type(kind)
                .mime_type(MimeType::Jpeg)
                .build()
        };
        let png_bytes = STANDARD.decode(png).unwrap();
        let jpeg = [0xff, 0xd8, 0xff, 0xe0];
        let mut tag = Tag::new(TagType::Id3v2);
        tag.push_picture(picture(jpeg.to_vec(), PictureType::CoverBack));
        tag.save_to_path(&path, WriteOptions::default()).unwrap();
        assert_eq!(
            extract().unwrap(),
            format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg))
        );

        tag.push_picture(picture(png_bytes.clone(), PictureType::CoverFront));
        tag.save_to_path(&path, WriteOptions::default()).unwrap();
        let expected_png = format!("data:image/png;base64,{png}");
        assert_eq!(extract().as_deref(), Some(expected_png.as_str()));

        let mut oversized = png_bytes;
        oversized.resize(MAX_COVER_BYTES + 1, 0);
        for rejected in [oversized, b"<svg />".to_vec()] {
            let mut tag = Tag::new(TagType::Id3v2);
            tag.push_picture(picture(rejected, PictureType::CoverFront));
            tag.save_to_path(&path, WriteOptions::default()).unwrap();
            assert_eq!(extract(), None);
        }
    }

    #[test]
    fn cover_cache_evicts_by_bytes_and_count_and_prunes_removed_tracks() {
        let fixture = Fixture::new();
        let path = fixture.0.join("cover.wav");
        fs::write(&path, wav(false)).unwrap();
        let track = scan_track(&fixture.folder(), path).unwrap();
        let mut library = Library::default();
        for i in 0..9 {
            library.cache_cover(i.to_string(), &track, Some("x".repeat(MAX_COVER_BYTES)));
        }
        assert_eq!(library.covers.len(), 8);
        assert_eq!(library.covers.front().unwrap().id, "1");
        for i in 9..=MAX_CACHED_COVERS + 9 {
            library.cache_cover(i.to_string(), &track, None);
        }
        assert_eq!(library.covers.len(), MAX_CACHED_COVERS);
        assert_eq!(library.covers.front().unwrap().id, "10");
        let id = track.info.id.clone();
        library.cache_cover(id.clone(), &track, None);
        library.catalog.tracks.insert(id.clone(), track);
        library.prune_covers();
        assert_eq!(library.covers.len(), 1);
        assert_eq!(library.covers.front().unwrap().id, id);
        library.catalog.tracks.clear();
        library.prune_covers();
        assert!(library.covers.is_empty());
    }

    #[test]
    fn scan_reads_metadata_and_caps_depth_without_disclosing_paths() {
        let fixture = Fixture::new();
        let folder = fixture.folder();
        fs::write(fixture.0.join("fallback.WAV"), wav(false)).unwrap();
        fs::write(fixture.0.join("tagged.wav"), wav(true)).unwrap();
        fs::write(fixture.0.join("skip.bin"), wav(false)).unwrap();
        fs::write(fixture.0.join("bad.mp3"), b"not audio").unwrap();
        let mut deep = fixture.0.clone();
        for _ in 0..=MAX_DEPTH {
            deep.push("d");
        }
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("outside-depth.wav"), wav(false)).unwrap();
        let catalog = scan_folders(&[folder.clone()]);
        assert!(catalog.truncated);
        assert_eq!(catalog.tracks.len(), 2);
        let tagged = &catalog
            .tracks
            .values()
            .find(|track| track.info.title == "Track")
            .unwrap()
            .info;
        assert_eq!(
            (
                tagged.artist.as_deref(),
                tagged.album.as_deref(),
                tagged.duration_ms
            ),
            (Some("Artist"), Some("Album"), Some(1000))
        );
        let fallback = &catalog.tracks[&track_id(&folder, &fixture.0.join("fallback.WAV"))].info;
        assert_eq!(fallback.title, "fallback");
        let output = serde_json::to_value(fallback).unwrap();
        assert!(output.get("path").is_none());
        assert!(serde_json::to_value(folder.info())
            .unwrap()
            .get("path")
            .is_none());
    }

    #[test]
    fn rejects_unlisted_ids_hardlinks_and_replaced_file() {
        let source = Fixture::new();
        let target = Fixture::new();
        let outside = target.0.join("outside.wav");
        fs::write(&outside, wav(false)).unwrap();
        fs::hard_link(&outside, source.0.join("hard.wav")).unwrap();
        #[cfg(target_os = "macos")]
        std::os::unix::fs::symlink(&outside, source.0.join("redirected.wav")).unwrap();
        let media = source.0.join("allowed.wav");
        fs::write(&media, wav(false)).unwrap();
        let catalog = scan_folders(&[source.folder()]);
        assert_eq!(catalog.tracks.len(), 1);
        let id = catalog.tracks.keys().next().unwrap().clone();
        let library = Library {
            catalog,
            ..Library::default()
        };
        assert_eq!(
            registered_track(&library, "../../outside.wav")
                .err()
                .unwrap()
                .kind,
            "validation"
        );
        assert_eq!(
            registered_track(&library, &"f".repeat(64))
                .err()
                .unwrap()
                .kind,
            "not_found"
        );
        let track = registered_track(&library, &id).unwrap();
        assert!(checked_file(&track).is_ok());
        assert!(local_media::open_file(&media, 16).is_err());
        fs::rename(&media, source.0.join("old.wav")).unwrap();
        fs::copy(&outside, &media).unwrap();
        assert!(checked_file(&track).is_err());
    }

    #[test]
    fn serves_real_file_bytes_with_range_headers_and_head() {
        let fixture = Fixture::new();
        let path = fixture.0.join("tone.wav");
        let bytes = wav(false);
        fs::write(&path, &bytes).unwrap();
        let track = scan_track(&fixture.folder(), path).unwrap();
        let serve = |range, head| {
            local_media::stream_file(
                checked_file(&track).unwrap(),
                track.identity.len,
                track.mime,
                range,
                head,
            )
            .unwrap()
        };
        let full = serve(None, false);
        assert_eq!(full.status(), 200);
        assert_eq!(full.body(), &bytes);
        let part = serve(Some("bytes=4-19"), false);
        assert_eq!(part.status(), 206);
        assert_eq!(part.headers()[header::CONTENT_TYPE], "audio/wav");
        assert_eq!(part.headers()[header::ACCEPT_RANGES], "bytes");
        assert_eq!(
            part.headers()[header::CONTENT_RANGE],
            format!("bytes 4-19/{}", bytes.len())
        );
        assert_eq!(part.body(), &bytes[4..20]);
        assert_eq!(
            serve(Some("bytes=-4"), false).body(),
            &bytes[bytes.len() - 4..]
        );
        assert_eq!(serve(Some("bytes=999999-"), false).status(), 416);
        let head = serve(Some("bytes=2-5"), true);
        assert_eq!(head.status(), 200);
        assert!(head.body().is_empty());
        assert_eq!(
            head.headers()[header::CONTENT_LENGTH],
            bytes.len().to_string()
        );
    }

    #[test]
    fn configs_restore_only_queue_ids_and_lyrics_decode_both_bom_orders() {
        let fixture = Fixture::new();
        let folder = fixture.folder();
        let media = fixture.0.join("stable.wav");
        let id = track_id(&folder, &media);
        let folders = fixture.0.join("folders.json");
        let queue_path = fixture.0.join("queue.json");
        save_config(&folders, &vec![folder]).unwrap();
        let queue = Queue {
            ids: vec![id.clone()],
            index: Some(0),
            position: 42.0,
        };
        save_config(&queue_path, &queue).unwrap();
        let restored = LocalLibrary::open(Ok(fixture.0.clone()));
        let guard = restored.lock().unwrap();
        assert_eq!(track_id(&guard.as_ref().unwrap().folders[0], &media), id);
        let restored_queue: Queue = load_config(&queue_path).unwrap();
        assert!(restored_queue.valid());
        assert_eq!(restored_queue.position, 42.0);
        assert_eq!(restored_queue.ids, [id]);
        assert!(!Queue {
            ids: vec!["C:\\music\\a.wav".into()],
            index: None,
            position: 0.0
        }
        .valid());
        assert_eq!(lyric_text(&[0xff, 0xfe, 0x4c, 0]).unwrap(), "L");
        assert_eq!(lyric_text(&[0xfe, 0xff, 0, 0x4c]).unwrap(), "L");
    }
}
