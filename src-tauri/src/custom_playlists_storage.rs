use crate::{
    err,
    playback_storage::{read_limited, valid_cover, valid_qq_cover, write_if_changed},
    Result,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs::File,
    io,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, WebviewWindow};

const MAX_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Payload {
    version: u64,
    playlists: Vec<CustomPlaylist>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CustomPlaylist {
    id: String,
    name: String,
    created_at: u64,
    updated_at: u64,
    tracks: Vec<CustomTrack>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CustomTrack {
    provider: String,
    id: Value,
    name: String,
    artists: Vec<String>,
    album: String,
    duration: u64,
    added_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cover_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    media_mid: Option<String>,
}

fn valid_text(value: &str, max: usize) -> bool {
    !value.chars().any(char::is_control) && value.chars().count() <= max
}

fn required_text(value: &str, max: usize) -> Option<&str> {
    let trimmed = value.trim();
    (!trimmed.is_empty() && !value.chars().any(char::is_control) && trimmed.chars().count() <= max)
        .then_some(trimmed)
}

fn valid_mid(value: &str) -> bool {
    (1..=64).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

impl CustomTrack {
    fn validate(&mut self) -> Option<()> {
        self.name = required_text(&self.name, 300)?.to_owned();
        if self.artists.len() > 30
            || self.artists.iter().any(|artist| !valid_text(artist, 200))
            || !valid_text(&self.album, 300)
            || self.duration > 86_400_000
            || self.added_at == 0
        {
            return None;
        }

        let cover = self.cover_url.as_deref();
        let media_mid = self.media_mid.as_deref();
        match self.provider.as_str() {
            "netease" if media_mid.is_none() && cover.is_none_or(valid_cover) => {
                let id = match &self.id {
                    Value::Number(number) => number.as_u64()?,
                    Value::String(id) if id.bytes().all(|byte| byte.is_ascii_digit()) => {
                        id.parse().ok()?
                    }
                    _ => return None,
                };
                if !(1..=9_007_199_254_740_991).contains(&id) {
                    return None;
                }
                self.id = Value::from(id);
            }
            "qqmusic"
                if self.id.as_str().is_some_and(valid_mid)
                    && media_mid.is_none_or(valid_mid)
                    && cover.is_none_or(valid_qq_cover) => {}
            "local" if cover.is_none() && media_mid.is_none() => {
                let id = required_text(self.id.as_str()?, 128)?;
                if id.contains(['/', '\\']) || id.contains("..") {
                    return None;
                }
                self.id = Value::from(id);
            }
            _ => return None,
        }
        Some(())
    }
}

impl Payload {
    fn validate(&mut self) -> Option<()> {
        if self.playlists.len() > 50 {
            return None;
        }
        let mut playlist_ids = HashSet::new();
        for playlist in &mut self.playlists {
            playlist.id = required_text(&playlist.id, 80)?.to_owned();
            playlist.name = required_text(&playlist.name, 60)?.to_owned();
            if !playlist_ids.insert(playlist.id.as_str())
                || playlist.created_at == 0
                || playlist.updated_at == 0
                || playlist.tracks.len() > 1000
            {
                return None;
            }
            let mut tracks = HashSet::new();
            for track in &mut playlist.tracks {
                track.validate()?;
                if !tracks.insert((track.provider.as_str(), &track.id)) {
                    return None;
                }
            }
        }
        Some(())
    }
}

fn decode(bytes: &[u8]) -> std::result::Result<Payload, &'static str> {
    if bytes.len() > MAX_BYTES {
        return Err("too_large");
    }
    #[derive(Deserialize)]
    struct Header {
        version: u64,
    }
    let header: Header = serde_json::from_slice(bytes).map_err(|_| "invalid")?;
    if header.version != 1 {
        return Err("unsupported_version");
    }
    let mut payload: Payload = serde_json::from_slice(bytes).map_err(|_| "invalid")?;
    payload.validate().ok_or("invalid")?;
    Ok(payload)
}

fn authorize(window: &WebviewWindow) -> Result<()> {
    if window.label() != "main" {
        return Err(err("permission", "仅主窗口可以管理自建歌单"));
    }
    Ok(())
}

fn storage_path(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("custom-playlists.json"))
        .map_err(|_| err("storage", "无法确定应用数据目录"))
}

fn load_file(path: &Path) -> Result<Value> {
    let read_error = || err("storage", "无法读取自建歌单");
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(json!({"status": "empty"}));
        }
        Err(_) => return Err(read_error()),
    };
    let bytes = read_limited(file, MAX_BYTES).map_err(|_| read_error())?;
    Ok(match decode(&bytes) {
        Ok(payload) => json!({"status": "ok", "data": payload}),
        Err(status) => json!({"status": status}),
    })
}

fn encode(data: &Value) -> Result<Vec<u8>> {
    let invalid = || err("validation", "自建歌单格式无效或超出大小限制");
    let bytes = serde_json::to_vec(data).map_err(|_| invalid())?;
    let payload = decode(&bytes).map_err(|_| invalid())?;
    serde_json::to_vec(&payload).map_err(|_| invalid())
}

#[tauri::command]
pub(crate) fn custom_playlists_load(window: WebviewWindow, app: AppHandle) -> Result<Value> {
    authorize(&window)?;
    load_file(&storage_path(&app)?)
}

#[tauri::command]
pub(crate) fn custom_playlists_save(
    window: WebviewWindow,
    app: AppHandle,
    data: Value,
) -> Result<Value> {
    authorize(&window)?;
    let bytes = encode(&data)?;
    write_if_changed(&storage_path(&app)?, &bytes)
        .map_err(|_| err("storage", "无法保存自建歌单"))?;
    Ok(json!({"saved": true}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn sample() -> Value {
        json!({
            "version": 1,
            "playlists": [{
                "id": "cp-1", "name": "跨源歌单", "createdAt": 1, "updatedAt": 2,
                "tracks": [
                    {"provider": "netease", "id": 123, "name": "网易", "artists": ["歌手"],
                     "album": "专辑", "duration": 3000, "addedAt": 1,
                     "coverUrl": "https://p1.music.126.net/image/1.jpg?param=300y300"},
                    {"provider": "qqmusic", "id": "MID1", "mediaMid": "FILE2", "name": "QQ",
                     "artists": [], "album": "", "duration": 0, "addedAt": 1,
                     "coverUrl": "https://y.gtimg.cn/music/photo_new/T002R300x300M000ALBUM1.jpg"},
                    {"provider": "local", "id": "track-1", "name": "本地", "artists": [],
                     "album": "", "duration": 1000, "addedAt": 2}
                ]
            }]
        })
    }

    #[test]
    fn cross_provider_roundtrip_and_netease_id_normalization() {
        let expected = sample();
        let mut input = expected.clone();
        input["playlists"][0]["tracks"][0]["id"] = json!("00123");
        let raw = encode(&input).unwrap();
        assert_eq!(
            serde_json::to_value(decode(&raw).unwrap()).unwrap(),
            expected
        );
    }

    #[test]
    fn rejects_unknown_fields_and_reports_unsupported_version() {
        for pointer in ["", "/playlists/0", "/playlists/0/tracks/0"] {
            let mut data = sample();
            data.pointer_mut(pointer).unwrap()["unknown"] = json!(true);
            assert_eq!(decode(data.to_string().as_bytes()).unwrap_err(), "invalid");
            assert_eq!(encode(&data).unwrap_err().kind, "validation");
        }
        let data = json!({"version": 2, "futureSchema": []});
        assert_eq!(
            decode(data.to_string().as_bytes()).unwrap_err(),
            "unsupported_version"
        );
        assert_eq!(encode(&data).unwrap_err().kind, "validation");
    }

    #[test]
    fn rejects_invalid_provider_fields() {
        for (track, field, value) in [
            (2, "id", json!("a/b")),
            (2, "id", json!("a\\b")),
            (2, "id", json!("a..b")),
            (2, "coverUrl", json!("data:image/png;base64,AAAA")),
            (2, "mediaMid", json!("MID1")),
            (0, "mediaMid", json!("MID1")),
            (0, "id", json!(9_007_199_254_740_992_u64)),
            (0, "id", json!("+1")),
            (1, "id", json!("MID-1")),
            (1, "mediaMid", json!("MID.1")),
            (
                1,
                "coverUrl",
                json!("https://y.gtimg.cn:443/music/photo_new/T002R300x300M000ALBUM1.jpg"),
            ),
            (
                1,
                "coverUrl",
                json!("https://y.gtimg.cn/music/photo_new/T002R300x300M000ALBUM1.jpg?q=1"),
            ),
        ] {
            let mut data = sample();
            data["playlists"][0]["tracks"][track][field] = value;
            assert_eq!(encode(&data).unwrap_err().kind, "validation");
        }
    }

    #[test]
    fn rejects_size_limits_and_duplicate_ids() {
        let playlist = sample()["playlists"][0].clone();
        let playlists: Vec<_> = (0..51)
            .map(|index| {
                let mut playlist = playlist.clone();
                playlist["id"] = json!(index.to_string());
                playlist
            })
            .collect();
        assert_eq!(
            encode(&json!({"version": 1, "playlists": playlists}))
                .unwrap_err()
                .kind,
            "validation"
        );
        assert_eq!(
            encode(&json!({"version": 1, "playlists": [playlist, playlist]}))
                .unwrap_err()
                .kind,
            "validation"
        );

        let mut data = sample();
        let tracks = data["playlists"][0]["tracks"].as_array_mut().unwrap();
        let mut duplicate = tracks[0].clone();
        duplicate["id"] = json!("00123");
        tracks.push(duplicate);
        assert_eq!(encode(&data).unwrap_err().kind, "validation");
        let oversized = json!({"version": 1, "playlists": [], "oversized": "x".repeat(MAX_BYTES)});
        assert_eq!(encode(&oversized).unwrap_err().kind, "validation");
        assert_eq!(
            decode(oversized.to_string().as_bytes()).unwrap_err(),
            "too_large"
        );
    }

    #[test]
    fn file_statuses_and_idempotent_writes() {
        let dir = std::env::temp_dir().join(format!(
            "vesper-playlists-test-{:032x}",
            rand::random::<u128>()
        ));
        fs::create_dir(&dir).unwrap();
        let path = dir.join("custom-playlists.json");
        assert_eq!(load_file(&path).unwrap(), json!({"status": "empty"}));
        fs::write(&path, b"{").unwrap();
        assert_eq!(load_file(&path).unwrap(), json!({"status": "invalid"}));
        fs::write(&path, vec![b' '; MAX_BYTES + 1]).unwrap();
        assert_eq!(load_file(&path).unwrap(), json!({"status": "too_large"}));
        let data = sample();
        let bytes = encode(&data).unwrap();
        assert!(write_if_changed(&path, &bytes).unwrap());
        assert!(!write_if_changed(&path, &bytes).unwrap());
        assert_eq!(
            load_file(&path).unwrap(),
            json!({"status": "ok", "data": data})
        );
        fs::remove_file(path).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
