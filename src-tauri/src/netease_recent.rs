use crate::{err, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager, State, WebviewWindow};
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Track {
    id: u64,
    name: String,
    artists: Vec<String>,
    album: String,
    duration: u64,
    #[serde(default, rename = "coverUrl", skip_serializing_if = "Option::is_none")]
    cover_url: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct History {
    version: u8,
    tracks: Vec<Track>,
}
fn validate(t: &Track) -> bool {
    t.id > 0
        && t.id <= 9_007_199_254_740_991
        && !t.name.trim().is_empty()
        && t.name.chars().count() <= 500
        && t.album.chars().count() <= 500
        && t.artists.len() <= 30
        && t.artists.iter().all(|v| v.chars().count() <= 500)
        && t.duration <= 86_400_000
        && t.cover_url
            .as_deref()
            .is_none_or(crate::playback_storage::valid_cover)
}
fn push(h: &mut History, track: Track) {
    h.tracks.retain(|t| t.id != track.id);
    h.tracks.insert(0, track);
    h.tracks.truncate(100);
}
fn path(app: &AppHandle, account: &str) -> Result<PathBuf> {
    if account.is_empty() || account.len() > 32 || !account.bytes().all(|v| v.is_ascii_digit()) {
        return Err(err("validation", "账号无效"));
    }
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| err("storage", "无法确定数据目录"))?
        .join(format!("recent-netease-{account}.json")))
}
fn check(caller: &WebviewWindow) -> Result<()> {
    if caller.label() == "main" {
        Ok(())
    } else {
        Err(err("permission", "仅主窗口可以访问最近播放"))
    }
}
fn lock_account<'a>(
    app: &'a State<'_, crate::App>,
    account: &str,
) -> Result<std::sync::MutexGuard<'a, crate::Session>> {
    let state = app
        .session
        .lock()
        .map_err(|_| err("storage", "会话不可用"))?;
    if state.cookie.is_none() || state.account_id.map(|v| v.to_string()).as_deref() != Some(account)
    {
        return Err(err("auth", "账号已变化或尚未验证"));
    }
    Ok(state)
}
fn read_history(path: &PathBuf) -> Result<History> {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(History {
                version: 1,
                tracks: vec![],
            })
        }
        Err(_) => return Err(err("storage", "无法读取最近播放")),
    };
    let data = crate::playback_storage::read_limited(file, 512 * 1024)
        .map_err(|_| err("storage", "无法读取最近播放"))?;
    if data.len() > 512 * 1024 {
        return Err(err("storage", "最近播放数据过大"));
    }
    let h: History =
        serde_json::from_slice(&data).map_err(|_| err("storage", "最近播放数据无效"))?;
    if h.version != 1 || h.tracks.len() > 100 || h.tracks.iter().any(|t| !validate(t)) {
        return Err(err("storage", "最近播放数据无效"));
    }
    Ok(h)
}
#[tauri::command]
pub fn netease_recent_get(
    app: AppHandle,
    caller: WebviewWindow,
    state: State<'_, crate::App>,
    account_id: String,
) -> Result<Value> {
    check(&caller)?;
    let _guard = lock_account(&state, &account_id)?;
    let h = read_history(&path(&app, &account_id)?)?;
    Ok(json!({"tracks":h.tracks}))
}
#[tauri::command]
pub fn netease_recent_add(
    app: AppHandle,
    caller: WebviewWindow,
    state: State<'_, crate::App>,
    account_id: String,
    track: Value,
) -> Result<Value> {
    check(&caller)?;
    let _guard = lock_account(&state, &account_id)?;
    let track: Track =
        serde_json::from_value(track).map_err(|_| err("validation", "歌曲信息无效"))?;
    if !validate(&track) {
        return Err(err("validation", "歌曲信息无效"));
    }
    let path = path(&app, &account_id)?;
    let mut h = read_history(&path)?;
    push(&mut h, track);
    let mut raw = serde_json::to_vec(&h).map_err(|_| err("storage", "无法保存最近播放"))?;
    while raw.len() > 512 * 1024 && h.tracks.len() > 1 {
        h.tracks.pop();
        raw = serde_json::to_vec(&h).map_err(|_| err("storage", "无法保存最近播放"))?;
    }
    if raw.len() > 512 * 1024 {
        return Err(err("storage", "最近播放数据过大"));
    }
    crate::playback_storage::write_if_changed(&path, &raw)
        .map_err(|_| err("storage", "无法保存最近播放"))?;
    Ok(json!({"saved":true}))
}
#[tauri::command]
pub fn netease_recent_clear(
    app: AppHandle,
    caller: WebviewWindow,
    state: State<'_, crate::App>,
    account_id: String,
) -> Result<Value> {
    check(&caller)?;
    let _guard = lock_account(&state, &account_id)?;
    let path = path(&app, &account_id)?;
    crate::playback_storage::write_if_changed(&path, br#"{"version":1,"tracks":[]}"#)
        .map_err(|_| err("storage", "无法清空最近播放"))?;
    Ok(json!({"cleared":true}))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recent_is_deduplicated_and_bounded() {
        let mut h = History {
            version: 1,
            tracks: vec![],
        };
        for id in 1..=120 {
            push(
                &mut h,
                Track {
                    id,
                    name: "合成".into(),
                    artists: vec![],
                    album: "".into(),
                    duration: 0,
                    cover_url: None,
                },
            );
        }
        assert_eq!(h.tracks.len(), 100);
        push(
            &mut h,
            Track {
                id: 100,
                name: "合成".into(),
                artists: vec![],
                album: "".into(),
                duration: 0,
                cover_url: None,
            },
        );
        push(
            &mut h,
            Track {
                id: 100,
                name: "合成".into(),
                artists: vec![],
                album: "".into(),
                duration: 0,
                cover_url: None,
            },
        );
        assert_eq!(h.tracks[0].id, 100);
        assert_eq!(h.tracks.iter().filter(|t| t.id == 100).count(), 1);
        assert_eq!(h.tracks.len(), 100);
    }
    #[test]
    fn rejects_sensitive_fields() {
        assert!(serde_json::from_value::<Track>(json!({"id":1,"name":"合成","artists":[],"album":"","duration":1,"url":"https://example.invalid"})).is_err());
        assert!(!validate(&Track {
            id: 0,
            name: "x".into(),
            artists: vec![],
            album: "".into(),
            duration: 0,
            cover_url: None
        }));
    }
    const LEGACY_HISTORY: &[u8] =
        br#"{"version":1,"tracks":[{"id":1,"name":"Track","artists":[],"album":"","duration":1}]}"#;

    #[test]
    fn saves_and_reads_valid_cover() {
        let cover = "https://p2.music.126.net/img/1.jpg?param=300y300";
        let mut history: History = serde_json::from_slice(LEGACY_HISTORY).unwrap();
        history.tracks[0].cover_url = Some(cover.into());
        assert!(validate(&history.tracks[0]));

        let raw = serde_json::to_vec(&history).unwrap();
        let root =
            std::env::temp_dir().join(format!("prism-recent-test-{:016x}", rand::random::<u64>()));
        let path = root.join("recent-netease-1.json");
        crate::playback_storage::write_if_changed(&path, &raw).unwrap();
        let read = read_history(&path);
        fs::remove_file(path).unwrap();
        fs::remove_dir(root).unwrap();

        let saved: Value = serde_json::from_slice(&raw).unwrap();
        assert_eq!(saved["tracks"][0]["coverUrl"], cover);
        assert_eq!(read.unwrap().tracks[0].cover_url.as_deref(), Some(cover));
    }

    #[test]
    fn legacy_history_roundtrips_without_cover() {
        let history: History = serde_json::from_slice(LEGACY_HISTORY).unwrap();
        assert!(validate(&history.tracks[0]));
        assert_eq!(history.tracks[0].cover_url, None);

        let legacy: Value = serde_json::from_slice(LEGACY_HISTORY).unwrap();
        assert_eq!(serde_json::to_value(&history).unwrap(), legacy);
    }

    #[test]
    fn rejects_invalid_covers() {
        let mut history: History = serde_json::from_slice(LEGACY_HISTORY).unwrap();
        let track = &mut history.tracks[0];
        for cover in [
            "http://p2.music.126.net/img/1.jpg",
            "https://example.invalid/a.jpg",
            "https://p2.music.126.net/img/1.jpg#fragment",
            "https://user@p2.music.126.net/img/1.jpg",
            "https://p2.music.126.net:8443/img/1.jpg",
            "https://p2.music.126.net/img/1.jpg?token=synthetic",
            "https://p2.music.126.net/img/1.jpg?param=300y300&token=synthetic",
        ] {
            track.cover_url = Some(cover.into());
            assert!(!validate(track), "accepted invalid cover {cover}");
        }
    }
}
