use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum SearchError {
    InvalidInput,
    Timeout,
    Network,
    Http(u16),
    Business(i64),
    InvalidResponse,
    TooLarge,
}

pub(crate) fn error_message(e: SearchError) -> (&'static str, &'static str) {
    use SearchError::*;
    match e {
        InvalidInput => ("validation", "搜索参数无效"),
        Timeout => ("timeout", "QQ 社区搜索请求超时"),
        Network => ("network", "无法连接 QQ 社区搜索"),
        Http(_) => ("http", "QQ 社区搜索 HTTP 请求失败"),
        Business(_) => ("business", "QQ 社区搜索返回业务错误"),
        InvalidResponse | TooLarge => ("invalid-response", "QQ 社区搜索返回数据异常"),
    }
}

fn validate(query: &str, page: u32, page_size: u32) -> Result<(), SearchError> {
    if query.trim().is_empty()
        || query.chars().count() > 200
        || !(1..=1000).contains(&page)
        || !(1..=40).contains(&page_size)
    {
        return Err(SearchError::InvalidInput);
    }
    Ok(())
}

// Fixed origin and isolated client: no account state, redirects, proxy, or retries.
pub(crate) async fn search(
    query: &str,
    page: u32,
    page_size: u32,
) -> Result<(u16, Value), SearchError> {
    validate(query, page, page_size)?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .build()
        .map_err(|_| SearchError::Network)?;
    let payload = json!({"music.search.SearchCgiService": {"module": "music.search.SearchCgiService",
        "method": "DoSearchForQQMusicDesktop", "param": {"query": query, "page_num": page,
        "num_per_page": page_size, "search_type": 0}}});
    let mut response = client
        .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                SearchError::Timeout
            } else {
                SearchError::Network
            }
        })?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(SearchError::Http(status));
    }
    const MAX_BYTES: usize = 1024 * 1024;
    if response
        .content_length()
        .is_some_and(|n| n > MAX_BYTES as u64)
    {
        return Err(SearchError::TooLarge);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| {
        if e.is_timeout() {
            SearchError::Timeout
        } else {
            SearchError::Network
        }
    })? {
        if chunk.len() > MAX_BYTES - body.len() {
            return Err(SearchError::TooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    map_search(&body, page, page_size).map(|value| (status, value))
}

fn map_search(body: &[u8], page: u32, page_size: u32) -> Result<Value, SearchError> {
    let root: Value = serde_json::from_slice(body).map_err(|_| SearchError::InvalidResponse)?;
    let code = root
        .get("code")
        .and_then(Value::as_i64)
        .ok_or(SearchError::InvalidResponse)?;
    if code != 0 {
        return Err(SearchError::Business(code));
    }
    let module = root
        .get("music.search.SearchCgiService")
        .ok_or(SearchError::InvalidResponse)?;
    let code = module
        .get("code")
        .and_then(Value::as_i64)
        .ok_or(SearchError::InvalidResponse)?;
    if code != 0 {
        return Err(SearchError::Business(code));
    }
    let song = module
        .pointer("/data/body/song")
        .ok_or(SearchError::InvalidResponse)?;
    let items = song
        .get("list")
        .and_then(Value::as_array)
        .ok_or(SearchError::InvalidResponse)?;
    if items.len() > page_size as usize {
        return Err(SearchError::InvalidResponse);
    }
    fn required(v: Option<&Value>) -> Result<&str, SearchError> {
        v.and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .ok_or(SearchError::InvalidResponse)
    }
    let songs: Result<Vec<_>, _> = items.iter().map(|item| {
        let id = required(item.get("mid"))?;
        let name = required(item.get("name"))?;
        let singers = item.get("singer").and_then(Value::as_array).filter(|a| !a.is_empty()).ok_or(SearchError::InvalidResponse)?;
        let artists: Result<Vec<_>, _> = singers.iter().map(|s| required(s.get("name")).map(|name| json!({"name": name}))).collect();
        let album = required(item.pointer("/album/name"))?;
        let valid_mid=|v:Option<&Value>|v.and_then(Value::as_str).filter(|s|!s.is_empty()&&s.len()<=64&&s.bytes().all(|b|b.is_ascii_alphanumeric())).map(str::to_owned);
        let cover=valid_mid(item.pointer("/album/mid")).map(|m|format!("https://y.gtimg.cn/music/photo_new/T002R300x300M000{m}.jpg"));
        let media_mid=valid_mid(item.pointer("/file/media_mid"));
        let duration=item.get("interval").and_then(Value::as_u64).unwrap_or(0).min(86400)*1000;
        let vip=item.pointer("/pay/pay_play").and_then(Value::as_i64)==Some(1);
        Ok(json!({"id":id,"name":name,"artists":artists?,"album":{"name":album,"picUrl":cover},"duration":duration,"mediaMid":media_mid,"vip":vip}))
    }).collect();
    // No verified total field: retain unknown instead of assuming a page is final.
    Ok(json!({"result":{"songs":songs?,"songCount":null},"page":page,"hasMore":null}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn wrap(song: Value) -> Vec<u8> {
        serde_json::to_vec(&json!({"code":0,"music.search.SearchCgiService":{"code":0,"data":{"body":{"song":song}}}})).unwrap()
    }
    fn fixture() -> Value {
        json!({"mid":"m","name":"n","singer":[{"name":"a"},{"name":"b"}],"album":{"name":"c"}})
    }
    #[test]
    fn errors_are_classified_without_sensitive_details() {
        use SearchError::*;
        for (e, kind) in [
            (InvalidInput, "validation"),
            (Timeout, "timeout"),
            (Network, "network"),
            (Http(503), "http"),
            (Business(5), "business"),
            (InvalidResponse, "invalid-response"),
            (TooLarge, "invalid-response"),
        ] {
            let (actual, message) = error_message(e);
            assert_eq!(actual, kind);
            assert!(!message.contains("503"));
        }
    }
    #[test]
    fn maps_and_keeps_total_unknown_even_when_claimed() {
        let mut paid = fixture();
        paid["album"]["mid"] = json!("ALB1");
        paid["pay"] = json!({"pay_play":1});
        let mut free = fixture();
        free["pay"] = json!({"pay_play":0});
        let v = map_search(
            &wrap(json!({"list":[fixture(),paid,free],"totalnum":12})),
            2,
            5,
        )
        .unwrap();
        assert_eq!(
            v["result"]["songs"][0],
            json!({"id":"m","name":"n","artists":[{"name":"a"},{"name":"b"}],"album":{"name":"c","picUrl":null},"duration":0,"mediaMid":null,"vip":false})
        );
        assert_eq!(
            v["result"]["songs"][1]["album"]["picUrl"],
            "https://y.gtimg.cn/music/photo_new/T002R300x300M000ALB1.jpg"
        );
        assert_eq!(v["result"]["songs"][1]["vip"], true);
        assert_eq!(v["result"]["songs"][2]["vip"], false);
        assert!(v["result"]["songCount"].is_null());
        assert!(v["hasMore"].is_null());
        let empty = map_search(&wrap(json!({"list":[]})), 1, 5).unwrap();
        assert_eq!(empty["result"]["songs"], json!([]));
        assert!(empty["hasMore"].is_null());
    }
    #[test]
    fn rejects_bad_input_business_and_shapes() {
        for (q, p, n) in [
            (" ", 1, 5),
            ("x", 0, 5),
            ("x", 1001, 5),
            ("x", 1, 0),
            ("x", 1, 41),
        ] {
            assert_eq!(validate(q, p, n), Err(SearchError::InvalidInput));
        }
        assert_eq!(map_search(b"{}", 1, 5), Err(SearchError::InvalidResponse));
        assert_eq!(
            map_search(br#"{"code":4}"#, 1, 5),
            Err(SearchError::Business(4))
        );
        assert_eq!(
            map_search(
                &serde_json::to_vec(&json!({"code":0,"music.search.SearchCgiService":{"code":7}}))
                    .unwrap(),
                1,
                5
            ),
            Err(SearchError::Business(7))
        );
        let mut bad = fixture();
        bad["singer"] = json!([]);
        assert_eq!(
            map_search(&wrap(json!({"list":[bad]})), 1, 5),
            Err(SearchError::InvalidResponse)
        );
        assert_eq!(
            map_search(&wrap(json!({"list":[fixture(),fixture()]})), 1, 1),
            Err(SearchError::InvalidResponse)
        );
        assert_eq!(
            map_search(&wrap(json!({"list":[{"mid":"m","name":"n"}]})), 1, 5),
            Err(SearchError::InvalidResponse)
        );
    }
}
