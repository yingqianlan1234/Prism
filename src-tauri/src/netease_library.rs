use crate::{ensure_generation, err, valid_id, App, Result};
use serde_json::{json, Value};
use tauri::State;

struct LibrarySession<'a> {
    app: &'a App,
    cookie: String,
    generation: u64,
}

impl<'a> LibrarySession<'a> {
    fn new(app: &'a App) -> Result<Self> {
        let (cookie, generation) = app.account_snapshot()?;
        let cookie = cookie
            .filter(|cookie| {
                cookie.split(';').map(str::trim).any(|pair| {
                    pair.strip_prefix("MUSIC_U=")
                        .is_some_and(|token| !token.is_empty())
                })
            })
            .ok_or(err("auth", "请先登录网易云音乐"))?;
        Ok(Self {
            app,
            cookie,
            generation,
        })
    }

    async fn request(&self, path: &str, payload: Value) -> Result<Value> {
        {
            let state = self
                .app
                .session
                .lock()
                .map_err(|_| err("storage", "会话不可用"))?;
            ensure_generation(&state, self.generation)?;
        }
        Ok(self
            .app
            .request(path, payload, Some(&self.cookie), false)
            .await?
            .0)
    }

    async fn user_id(&self) -> Result<u64> {
        let account = self.request("nuser/account/get", json!({})).await?;
        account
            .pointer("/profile/userId")
            .and_then(Value::as_u64)
            .filter(|id| valid_id(*id).is_ok())
            .ok_or(err("auth", "登录状态已失效"))
    }
}

#[tauri::command]
pub(crate) async fn netease_like(app: State<'_, App>, id: u64, like: bool) -> Result<Value> {
    valid_id(id)?;
    let session = LibrarySession::new(&app)?;
    session.user_id().await?;
    session
        .request(
            "radio/like",
            json!({
                "trackId": id, "like": like, "alg": "itembased", "time": "3"
            }),
        )
        .await?;
    Ok(json!({"code": 200}))
}

#[tauri::command]
pub(crate) async fn netease_likelist(app: State<'_, App>) -> Result<Value> {
    let session = LibrarySession::new(&app)?;
    let uid = session.user_id().await?;
    let data = session
        .request("song/like/get", json!({"uid": uid}))
        .await?;
    let ids = data
        .get("ids")
        .and_then(Value::as_array)
        .filter(|ids| {
            ids.iter()
                .all(|id| id.as_u64().is_some_and(|id| valid_id(id).is_ok()))
        })
        .ok_or(err("upstream", "喜欢歌曲列表返回格式异常"))?;
    Ok(json!({"code": 200, "ids": ids}))
}

#[tauri::command]
pub(crate) async fn netease_fm_trash(app: State<'_, App>, id: u64) -> Result<Value> {
    valid_id(id)?;
    let session = LibrarySession::new(&app)?;
    session.user_id().await?;
    // This command has no listening duration input.
    session
        .request(
            "radio/trash/add",
            json!({
                "songId": id, "alg": "RT", "time": 0
            }),
        )
        .await?;
    Ok(json!({"code": 200}))
}

#[tauri::command]
pub(crate) async fn netease_playlist_tracks_op(
    app: State<'_, App>,
    op: String,
    pid: u64,
    track_id: u64,
) -> Result<Value> {
    let payload = playlist_payload(&op, pid, track_id)?;
    let session = LibrarySession::new(&app)?;
    let uid = session.user_id().await?;
    let detail = session
        .request("v6/playlist/detail", json!({"id": pid, "n": 1, "s": 0}))
        .await?;
    ensure_playlist_owner(&detail, pid, uid)?;
    let result = session
        .request("playlist/manipulate/tracks", payload)
        .await?;
    if let Some(code) = result.pointer("/data/code").and_then(Value::as_i64) {
        if code != 200 {
            return Err(crate::business_error("playlist/manipulate/tracks", code));
        }
    }
    Ok(json!({"code": 200}))
}

fn playlist_payload(op: &str, pid: u64, track_id: u64) -> Result<Value> {
    valid_id(pid)?;
    valid_id(track_id)?;
    if !matches!(op, "add" | "del") {
        return Err(err("validation", "歌单操作无效"));
    }
    Ok(json!({"op": op, "pid": pid, "trackIds": format!(r#"["{track_id}"]"#), "imme": "true"}))
}

fn ensure_playlist_owner(detail: &Value, pid: u64, uid: u64) -> Result<()> {
    let owner = detail
        .pointer("/playlist/userId")
        .or_else(|| detail.pointer("/playlist/creator/userId"))
        .and_then(Value::as_u64);
    if detail.pointer("/playlist/id").and_then(Value::as_u64) != Some(pid) || owner.is_none() {
        return Err(err("upstream", "歌单归属数据不完整"));
    }
    if owner != Some(uid) {
        return Err(err("permission", "只能修改当前账号创建的歌单"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guest_and_anonymous_sessions_cannot_write() {
        let app = App {
            client: reqwest::Client::new(),
            session: Default::default(),
        };
        for cookie in [None, Some("MUSIC_A=fixture"), Some("MUSIC_U=")] {
            app.session.lock().unwrap().cookie = cookie.map(str::to_owned);
            assert!(matches!(LibrarySession::new(&app), Err(e) if e.kind == "auth"));
        }
        app.session.lock().unwrap().cookie = Some("MUSIC_U=fixture".into());
        let session = LibrarySession::new(&app).unwrap();
        app.session.lock().unwrap().generation += 1;
        let result = tauri::async_runtime::block_on(session.request("not-sent", json!({})));
        assert_eq!(result.unwrap_err().kind, "auth");
    }

    #[test]
    fn playlist_writes_require_valid_ids_operation_and_owner() {
        assert_eq!(
            playlist_payload("del", 1, 2).unwrap()["trackIds"],
            r#"["2"]"#
        );
        assert!(playlist_payload("add", 1, 2).is_ok());
        assert!(playlist_payload("replace", 1, 2).is_err());
        assert!(playlist_payload("add", 0, 2).is_err());
        assert!(playlist_payload("add", 1, 9_007_199_254_740_992).is_err());
        let owned = json!({"playlist": {"id": 1, "userId": 3}});
        assert!(ensure_playlist_owner(&owned, 1, 3).is_ok());
        assert_eq!(
            ensure_playlist_owner(&owned, 1, 4).unwrap_err().kind,
            "permission"
        );
        assert_eq!(
            ensure_playlist_owner(&owned, 2, 3).unwrap_err().kind,
            "upstream"
        );
    }
}
