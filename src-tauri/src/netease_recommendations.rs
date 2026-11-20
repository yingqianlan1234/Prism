use serde_json::{json, Value};
use tauri::State;
use crate::{err, App, Result};

fn items(data: Value, pointer: &str) -> Result<Value> {
    if data.get("code").and_then(Value::as_i64) != Some(200) {
        return Err(err("upstream", "推荐服务返回失败"));
    }
    let entries = data.pointer(pointer).and_then(Value::as_array)
        .ok_or(err("upstream", "推荐数据不完整"))?;
    if entries.iter().any(|entry| {
        !entry.get("id").and_then(Value::as_u64).is_some_and(|id| id > 0 && id <= 9_007_199_254_740_991)
            || !entry.get("name").and_then(Value::as_str).is_some_and(|name| !name.trim().is_empty())
    }) {
        return Err(err("upstream", "推荐数据不完整"));
    }
    Ok(json!({"items": entries}))
}

fn new_songs(data: Value) -> Result<Value> {
    if data.get("code").and_then(Value::as_i64) != Some(200) {
        return Err(err("upstream", "推荐服务返回失败"));
    }
    let entries = data.get("result").and_then(Value::as_array)
        .ok_or(err("upstream", "推荐数据不完整"))?;
    let songs: Vec<Value> = entries.iter().map(|entry| entry.get("song").filter(|v| v.is_object()).cloned()
        .ok_or(err("upstream", "推荐数据不完整"))).collect::<Result<_>>()?;
    items(json!({"code":200,"songs":songs}), "/songs")
}

async fn fetch(app: State<'_, App>, path: &str, body: Value, pointer: &str) -> Result<Value> {
    let cookie = app.cookie()?.ok_or(err("auth", "请先登录"))?;
    let data = app.request(path, body, Some(&cookie), false).await?.0;
    items(data, pointer)
}

#[tauri::command]
pub(crate) async fn netease_daily_songs(app: State<'_, App>) -> Result<Value> {
    fetch(app, "v3/discovery/recommend/songs", json!({"afresh":false}), "/data/dailySongs").await
}

#[tauri::command]
pub(crate) async fn netease_recommended_resources(app: State<'_, App>) -> Result<Value> {
    fetch(app, "v1/discovery/recommend/resource", json!({}), "/recommend").await
}

#[tauri::command]
pub(crate) async fn netease_personalized_playlists(app: State<'_, App>) -> Result<Value> {
    fetch(app, "personalized/playlist", json!({"limit":9}), "/result").await
}

#[tauri::command]
pub(crate) async fn netease_recommended_new_songs(app: State<'_, App>) -> Result<Value> {
    let cookie = app.cookie()?.ok_or(err("auth", "请先登录"))?;
    let data = app.request("personalized/newsong", json!({"type":"recommend","limit":10,"areaId":0}), Some(&cookie), false).await?.0;
    new_songs(data)
}

#[tauri::command]
pub(crate) async fn netease_private_fm(app: State<'_, App>) -> Result<Value> {
    fetch(app, "v1/radio/get", json!({}), "/data").await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_each_recommendation_shape() {
        for (pointer, data) in [
            ("/data/dailySongs", json!({"code":200,"data":{"dailySongs":[{"id":1,"name":"合成歌曲","ar":[]}]}})),
            ("/recommend", json!({"code":200,"recommend":[{"id":2,"name":"合成歌单"}]})),
            ("/result", json!({"code":200,"result":[]})),
        ] {
            assert!(items(data, pointer).unwrap()["items"].is_array());
        }
    }
    #[test]
    fn rejects_error_or_malformed_data() {
        for data in [json!({"code":500,"result":[]}), json!({"result":[]}), json!({"code":200}),
            json!({"code":200,"result":[{"id":0,"name":"歌"}]}),
            json!({"code":200,"result":[{"id":9007199254740992_u64,"name":"歌"}]}),
            json!({"code":200,"result":[{"id":1,"name":" "}]}),
            json!({"code":200,"result":[{"id":"1","name":"歌"}]})] {
            assert!(items(data, "/result").is_err());
        }
    }
    #[test]
    fn validates_nested_new_songs() {
        assert_eq!(new_songs(json!({"code":200,"result":[]})).unwrap()["items"], json!([]));
        let output = new_songs(json!({"code":200,"result":[{"song":{"id":3,"name":"合成歌曲","ar":[]}}]})).unwrap();
        assert_eq!(output["items"][0]["id"], 3);
        for data in [json!({"code":500,"result":[]}), json!({"result":[]}), json!({"code":200}),
            json!({"code":200,"result":[{}]}), json!({"code":200,"result":[{"song":null}]}),
            json!({"code":200,"result":[{"song":{"id":0,"name":"歌"}}]}),
            json!({"code":200,"result":[{"song":{"id":1,"name":" "}}]})] {
            assert!(new_songs(data).is_err());
        }
    }
}
