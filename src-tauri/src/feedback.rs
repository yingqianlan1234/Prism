use crate::{err, Error, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

const DEFAULT_FEEDBACK_ENDPOINT: &str = "https://feedback.yingqianlan.top/api/feedback";
const MAX_RESPONSE_BYTES: usize = 32 * 1024;

fn feedback_endpoint() -> Result<&'static str> {
    validate_feedback_endpoint(
        option_env!("VESPER_FEEDBACK_ENDPOINT").unwrap_or(DEFAULT_FEEDBACK_ENDPOINT),
    )
}

fn validate_feedback_endpoint(url: &str) -> Result<&str> {
    // URL parsing can normalize an extra slash into a host, so check the authority first.
    let has_authority = url
        .strip_prefix("https://")
        .and_then(|rest| rest.split(['/', '\\', '?', '#']).next())
        .is_some_and(|authority| !authority.trim().is_empty());
    if has_authority && reqwest::Url::parse(url).is_ok_and(|parsed| parsed.has_host()) {
        return Ok(url);
    }
    Err(err("validation", "反馈服务地址必须使用 HTTPS 且包含主机名"))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackContext {
    active_provider: Option<String>,
    netease_quality: Option<String>,
    qq_quality: Option<String>,
    theme: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackSubmission {
    category: String,
    title: String,
    description: String,
    contact: Option<String>,
    include_env: bool,
    context: Option<FeedbackContext>,
}

fn build_feedback_request_body(input: &FeedbackSubmission) -> Result<Value> {
    if !matches!(
        input.category.as_str(),
        "bug" | "feature" | "playback" | "other"
    ) {
        return Err(err("validation", "反馈类型无效"));
    }

    let title: String = input.title.chars().filter(|c| !c.is_control()).collect();
    let title = title.trim();
    if !(2..=80).contains(&title.chars().count()) {
        return Err(err("validation", "标题长度需在 2 到 80 个字符之间"));
    }

    let description: String = input
        .description
        .chars()
        .filter(|c| *c == '\n' || !c.is_control())
        .collect();
    let description = description.trim();
    if !(10..=2000).contains(&description.chars().count()) {
        return Err(err("validation", "问题描述需在 10 到 2000 个字符之间"));
    }

    let contact = input.contact.as_deref().unwrap_or_default();
    let contact: String = contact.chars().filter(|c| !c.is_control()).collect();
    let contact = contact.trim();
    if contact.chars().count() > 120 {
        return Err(err("validation", "联系方式不能超过 120 个字符"));
    }

    let mut body = json!({
        "category": input.category,
        "title": title,
        "description": description,
        "includeEnv": input.include_env,
    });
    if !contact.is_empty() {
        body["contact"] = json!(contact);
    }

    if input.include_env {
        let mut environment = json!({
            "appVersion": env!("CARGO_PKG_VERSION"),
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
        });
        if let Some(context) = &input.context {
            if let Some(value @ ("netease" | "qqmusic" | "local")) =
                context.active_provider.as_deref()
            {
                environment["activeProvider"] = json!(value);
            }
            if let Some(value @ ("standard" | "exhigh" | "lossless" | "hires")) =
                context.netease_quality.as_deref()
            {
                environment["neteaseQuality"] = json!(value);
            }
            if let Some(value @ ("standard" | "exhigh" | "lossless")) =
                context.qq_quality.as_deref()
            {
                environment["qqQuality"] = json!(value);
            }
            if let Some(theme) = &context.theme {
                if (1..=32).contains(&theme.len())
                    && theme
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                {
                    environment["theme"] = json!(theme);
                }
            }
        }
        body["env"] = environment;
    }
    Ok(body)
}

fn parse_feedback_response(status: u16, body: &[u8]) -> Result<Value> {
    let invalid_response = || err("upstream", "反馈服务返回格式异常");
    match status {
        200 | 201 => {
            let response: Value = serde_json::from_slice(body).map_err(|_| invalid_response())?;
            let issue_number = response["issueNumber"].as_u64().filter(|&value| value > 0);
            match issue_number {
                Some(number) if response["ok"].as_bool() == Some(true) => {
                    Ok(json!({"ok": true, "issueNumber": number}))
                }
                _ => Err(invalid_response()),
            }
        }
        202..=299 => Err(invalid_response()),
        429 => Err(err("rate_limited", "提交过于频繁，请稍后再试")),
        400 | 413 => Err(err("validation", "反馈内容格式或长度不符合要求")),
        503 => Err(err(
            "upstream",
            "反馈服务暂未完成配置，请先复制内容联系开发者",
        )),
        _ => Err(err(
            "upstream",
            "反馈服务暂时不可用，请稍后重试或复制反馈内容",
        )),
    }
}

fn request_error(error: reqwest::Error) -> Error {
    if error.is_timeout() {
        err("timeout", "反馈提交超时，请检查网络或复制反馈内容")
    } else {
        err("network", "无法连接反馈服务，请检查网络或复制反馈内容")
    }
}

#[tauri::command]
pub async fn feedback_submit(
    caller: tauri::WebviewWindow,
    payload: FeedbackSubmission,
) -> Result<Value> {
    if caller.label() != "main" {
        return Err(err("permission", "仅主窗口可提交反馈"));
    }

    let body = build_feedback_request_body(&payload)?;
    let endpoint = feedback_endpoint()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(request_error)?;
    let mut response = client
        .post(endpoint)
        .header("X-Vesper-Client", "vesper-desktop")
        .header(
            reqwest::header::USER_AGENT,
            format!(
                "Vesper/{} ({}; {})",
                env!("CARGO_PKG_VERSION"),
                std::env::consts::OS,
                std::env::consts::ARCH
            ),
        )
        .json(&body)
        .send()
        .await
        .map_err(request_error)?;
    let status = response.status().as_u16();
    let mut response_body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(request_error)? {
        if chunk.len() > MAX_RESPONSE_BYTES - response_body.len() {
            return Err(err("upstream", "反馈服务返回数据过大"));
        }
        response_body.extend_from_slice(&chunk);
    }
    parse_feedback_response(status, &response_body)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn submission() -> FeedbackSubmission {
        serde_json::from_value(json!({
            "category": "bug",
            "title": " 播\u{0000}放 ",
            "description": " 第一行内容\r\n第二\t行内容 ",
            "contact": " user\u{0007}@example.com ",
            "includeEnv": true,
            "context": {
                "activeProvider": "qqmusic",
                "neteaseQuality": "hires",
                "qqQuality": "lossless",
                "theme": "Dark-2",
                "unknown": "ignored"
            }
        }))
        .unwrap()
    }

    #[test]
    fn endpoint_requires_https_and_host() {
        assert_eq!(
            validate_feedback_endpoint(DEFAULT_FEEDBACK_ENDPOINT).unwrap(),
            DEFAULT_FEEDBACK_ENDPOINT
        );
        for url in [
            "http://example.com",
            "https://",
            "https:///api/feedback",
            "https://?x",
        ] {
            assert!(validate_feedback_endpoint(url).is_err(), "{url}");
        }
    }

    #[test]
    fn feedback_body_normalizes_fields_and_includes_allowed_environment() {
        assert_eq!(
            build_feedback_request_body(&submission()).unwrap(),
            json!({
                "category": "bug",
                "title": "播放",
                "description": "第一行内容\n第二行内容",
                "contact": "user@example.com",
                "includeEnv": true,
                "env": {
                    "appVersion": env!("CARGO_PKG_VERSION"),
                    "os": std::env::consts::OS,
                    "arch": std::env::consts::ARCH,
                    "activeProvider": "qqmusic",
                    "neteaseQuality": "hires",
                    "qqQuality": "lossless",
                    "theme": "Dark-2"
                }
            })
        );
    }

    #[test]
    fn feedback_body_filters_invalid_context() {
        let mut input = submission();
        for theme in ["".into(), "浅色".into(), "dark_mode".into(), "a".repeat(33)] {
            input.context = Some(FeedbackContext {
                active_provider: Some("unknown".into()),
                netease_quality: Some("flac".into()),
                qq_quality: Some("hires".into()),
                theme: Some(theme),
            });
            assert_eq!(
                build_feedback_request_body(&input).unwrap()["env"],
                json!({
                    "appVersion": env!("CARGO_PKG_VERSION"),
                    "os": std::env::consts::OS,
                    "arch": std::env::consts::ARCH,
                })
            );
        }
    }

    #[test]
    fn feedback_body_omits_environment_without_consent_and_blank_contact() {
        let mut input = submission();
        input.include_env = false;
        input.contact = Some(" \n\t ".into());
        let body = build_feedback_request_body(&input).unwrap();
        assert_eq!(body["includeEnv"], false);
        assert!(body.get("env").is_none());
        assert!(body.get("contact").is_none());
    }

    #[test]
    fn feedback_body_rejects_invalid_fields() {
        for (key, value, message) in [
            ("category", "unknown".into(), "反馈类型无效"),
            ("title", "短".into(), "标题长度需在 2 到 80 个字符之间"),
            ("title", "长".repeat(81), "标题长度需在 2 到 80 个字符之间"),
            (
                "description",
                "短".repeat(9),
                "问题描述需在 10 到 2000 个字符之间",
            ),
            (
                "description",
                "长".repeat(2001),
                "问题描述需在 10 到 2000 个字符之间",
            ),
            ("contact", "长".repeat(121), "联系方式不能超过 120 个字符"),
        ] {
            let mut input = json!({
                "category": "bug",
                "title": "标题",
                "description": "这是较长的问题描述内容",
                "includeEnv": false,
            });
            input[key] = json!(value);
            let error =
                build_feedback_request_body(&serde_json::from_value(input).unwrap()).unwrap_err();
            assert_eq!(
                (error.kind, error.message),
                ("validation", message),
                "{key}"
            );
        }
    }

    #[test]
    fn feedback_response_accepts_success_and_returns_only_the_issue_number_and_ok() {
        for status in [200, 201] {
            assert_eq!(
                parse_feedback_response(
                    status,
                    br#"{"ok":true,"issueNumber":42,"extra":"ignored"}"#
                )
                .unwrap(),
                json!({"ok": true, "issueNumber": 42})
            );
        }
    }

    #[test]
    fn feedback_response_rejects_invalid_success_bodies() {
        for body in [
            r#"{"ok":true}"#,
            r#"{"ok":true,"issueNumber":0}"#,
            r#"{"ok":true,"issueNumber":-1}"#,
            r#"{"ok":true,"issueNumber":1.5}"#,
            r#"{"ok":true,"issueNumber":"1"}"#,
            r#"{"ok":false,"issueNumber":1}"#,
            "{",
        ] {
            let error = parse_feedback_response(201, body.as_bytes()).unwrap_err();
            assert_eq!(
                (error.kind, error.message),
                ("upstream", "反馈服务返回格式异常"),
                "{body}"
            );
        }
    }

    #[test]
    fn feedback_response_maps_http_statuses() {
        for (status, kind, message) in [
            (204, "upstream", "反馈服务返回格式异常"),
            (
                302,
                "upstream",
                "反馈服务暂时不可用，请稍后重试或复制反馈内容",
            ),
            (429, "rate_limited", "提交过于频繁，请稍后再试"),
            (400, "validation", "反馈内容格式或长度不符合要求"),
            (413, "validation", "反馈内容格式或长度不符合要求"),
            (
                503,
                "upstream",
                "反馈服务暂未完成配置，请先复制内容联系开发者",
            ),
            (
                500,
                "upstream",
                "反馈服务暂时不可用，请稍后重试或复制反馈内容",
            ),
        ] {
            let error = parse_feedback_response(status, b"").unwrap_err();
            assert_eq!((error.kind, error.message), (kind, message), "{status}");
        }
    }
}
