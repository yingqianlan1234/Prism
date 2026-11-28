// Candidate response shape only: no successful real response has confirmed it.
use serde_json::Value;

#[derive(Debug, PartialEq, Eq)]
enum Classification {
    CandidateItems(usize),
    CandidateEmpty,
    AuthExpired,
    PermissionDenied,
    Timeout,
    HttpError,
    BusinessError(i64),
    TopCodeMissing,
    UnknownShape,
}

enum Transport<'a> {
    Timeout,
    Response { status: u16, body: &'a str },
}

fn classify(input: Transport<'_>) -> Classification {
    use Classification::*;
    let (status, body) = match input {
        Transport::Timeout => return Timeout,
        Transport::Response { status, body } => (status, body),
    };
    match status {
        401 => return AuthExpired,
        403 => return PermissionDenied,
        200..=299 => {}
        _ => return HttpError,
    }
    let Ok(body) = serde_json::from_str::<Value>(body) else {
        return UnknownShape;
    };
    let Some(top_code) = body.get("code").and_then(Value::as_i64) else {
        return TopCodeMissing;
    };
    if top_code != 0 {
        return BusinessError(top_code);
    }
    let Some(module) = body.get("music.search.SearchCgiService") else {
        return UnknownShape;
    };
    let Some(module_code) = module.get("code").and_then(Value::as_i64) else {
        return UnknownShape;
    };
    if module_code != 0 {
        return BusinessError(module_code);
    }
    let Some(items) = module
        .pointer("/data/body/song/list")
        .and_then(Value::as_array)
    else {
        return UnknownShape;
    };
    if items.is_empty() {
        return CandidateEmpty;
    }
    if !items.iter().all(|item| {
        ["mid", "name"].iter().all(|key| {
            item.get(*key)
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty())
        })
    }) {
        return UnknownShape;
    }
    CandidateItems(items.len())
}

#[test]
fn candidate_search_shape_requires_codes_and_an_explicit_array() {
    fn parse(body: &str) -> Classification {
        classify(Transport::Response { status: 200, body })
    }
    assert_eq!(
        parse(
            r#"{"code":0,"music.search.SearchCgiService":{"code":0,"data":{"body":{"song":{"list":[{"mid":"synthetic-mid","name":"synthetic song"}]}}}}}"#
        ),
        Classification::CandidateItems(1)
    );
    assert_eq!(
        parse(
            r#"{"code":0,"music.search.SearchCgiService":{"code":0,"data":{"body":{"song":{"list":[]}}}}}"#
        ),
        Classification::CandidateEmpty
    );
    assert_eq!(
        parse(
            r#"{"music.search.SearchCgiService":{"code":0,"data":{"body":{"song":{"list":[]}}}}}"#
        ),
        Classification::TopCodeMissing
    );
    assert_eq!(parse("{}"), Classification::TopCodeMissing);
    for item in [
        r#"{"name":"synthetic song"}"#,
        r#"{"mid":"synthetic-mid"}"#,
        r#"{"mid":" ","name":"synthetic song"}"#,
        r#"{"mid":"synthetic-mid","name":""}"#,
    ] {
        let body = format!(
            r#"{{"code":0,"music.search.SearchCgiService":{{"code":0,"data":{{"body":{{"song":{{"list":[{item}]}}}}}}}}}}"#
        );
        assert_eq!(parse(&body), Classification::UnknownShape);
    }
    assert_eq!(
        parse(
            r#"{"code":0,"music.search.SearchCgiService":{"code":0,"data":{"body":{"song":{"list":[{"mid":"synthetic","name":"synthetic"},{}]}}}}}"#
        ),
        Classification::UnknownShape
    );
    for body in [
        "not json",
        r#"{"code":0}"#,
        r#"{"code":0,"music.search.SearchCgiService":{"data":{"body":{"song":{"list":[]}}}}}"#,
        r#"{"code":0,"music.search.SearchCgiService":{"code":0,"data":{"body":{"song":{}}}}}"#,
        r#"{"code":0,"music.search.SearchCgiService":{"code":0,"data":{"body":{"song":{"list":null}}}}}"#,
    ] {
        assert_eq!(parse(body), Classification::UnknownShape);
    }
}

#[test]
fn candidate_errors_are_not_search_results() {
    fn parse(status: u16, body: &str) -> Classification {
        classify(Transport::Response { status, body })
    }
    assert_eq!(classify(Transport::Timeout), Classification::Timeout);
    assert_eq!(parse(401, ""), Classification::AuthExpired);
    assert_eq!(parse(403, ""), Classification::PermissionDenied);
    assert_eq!(parse(500, ""), Classification::HttpError);
    assert_eq!(
        parse(
            200,
            r#"{"code":42,"music.search.SearchCgiService":{"code":0}}"#
        ),
        Classification::BusinessError(42)
    );
    assert_eq!(
        parse(
            200,
            r#"{"code":0,"music.search.SearchCgiService":{"code":9001}}"#
        ),
        Classification::BusinessError(9001)
    );
}

// This ignored probe requires renewed permission; it does not validate the synthetic contract above.
#[test]
#[ignore = "network probe; run only after renewed user authorization"]
fn qq_anonymous_search_probe() {
    assert_eq!(
        std::env::var("QQ_ANONYMOUS_PROBE_CONFIRMED").as_deref(),
        Ok("yes"),
        "renewed authorization is required"
    );
    tauri::async_runtime::block_on(async {
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()
            .expect("probe client initialization failed");
        let payload = serde_json::json!({
            "music.search.SearchCgiService": {"module": "music.search.SearchCgiService", "method": "DoSearchForQQMusicDesktop",
                "param": {"query": "music", "page_num": 1, "num_per_page": 1, "search_type": 0}}
        });
        let response = client
            .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
            .json(&payload)
            .send()
            .await
            .unwrap_or_else(|_| panic!("probe request failed"));
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(';').next())
            .filter(|v| {
                matches!(
                    *v,
                    "application/json" | "text/json" | "text/plain" | "text/html"
                )
            })
            .unwrap_or("other-or-missing");
        println!("http_status={status} content_type={content_type}");
        assert!(
            (200..300).contains(&status),
            "probe HTTP status is not successful"
        );
        let bytes = response
            .bytes()
            .await
            .unwrap_or_else(|_| panic!("probe response read failed"));
        let parsed = serde_json::from_slice::<Value>(&bytes);
        println!("is_json={}", parsed.is_ok());
        let body = parsed.unwrap_or_else(|_| panic!("probe response is not JSON"));
        {
            // Whitelisting avoids printing unexpected field names that might contain user data.
            let names = |value: &Value, allowed: &[&str]| -> Vec<String> {
                allowed
                    .iter()
                    .filter(|key| value.get(**key).is_some())
                    .map(|key| (*key).to_owned())
                    .collect()
            };
            let module = &body["music.search.SearchCgiService"];
            println!(
                "top_level_fields={:?} module_fields={:?}",
                names(&body, &["code", "music.search.SearchCgiService"]),
                names(module, &["code", "data"])
            );
            println!(
                "top_code={:?} module_code={:?} result_array_count={:?}",
                body.get("code").and_then(Value::as_i64),
                module.get("code").and_then(Value::as_i64),
                module
                    .pointer("/data/body/song/list")
                    .and_then(Value::as_array)
                    .map(Vec::len)
            );
            let items = module
                .pointer("/data/body/song/list")
                .and_then(Value::as_array);
            let first = items.and_then(|list| list.first());
            let present = |key| {
                first
                    .and_then(|item| item.get(key))
                    .and_then(Value::as_str)
                    .is_some_and(|value| !value.trim().is_empty())
            };
            println!(
                "first_mid_present={} first_name_present={}",
                present("mid"),
                present("name")
            );
            assert_eq!(
                body.get("code").and_then(Value::as_i64),
                Some(0),
                "top-level business code missing or nonzero"
            );
            assert_eq!(
                module.get("code").and_then(Value::as_i64),
                Some(0),
                "module business code missing or nonzero"
            );
            assert!(items.is_some(), "target result list missing");
            assert!(
                present("mid") && present("name"),
                "first result lacks required fields"
            );
        }
    });
}
