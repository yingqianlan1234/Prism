use std::{
    fs::File,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, MutexGuard,
    },
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{App, AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_updater::{Error as UpdaterError, Update, UpdaterExt};
use time::format_description::well_known::Rfc3339;
use updater_http::redirect::Policy;

use crate::{
    err,
    playback_storage::{read_limited, write_if_changed},
    Result,
};

const GITHUB_LATEST_JSON_URL: &str =
    "https://github.com/yingqianlan1234/Prism/releases/latest/download/latest.json";
const DEFAULT_MIRROR_PREFIX: &str = "https://gh-proxy.com/";
const SETTINGS_LIMIT: usize = 4096;
const MIRROR_LIMIT: usize = 256;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum UpdateSource {
    #[default]
    Github,
    Mirror,
}

impl UpdateSource {
    fn parse(raw: &str) -> Result<Self> {
        match raw {
            "github" => Ok(Self::Github),
            "mirror" => Ok(Self::Mirror),
            _ => Err(err("validation", "更新源无效")),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct UpdateSettingsPreference {
    version: u8,
    auto_check: bool,
    source: UpdateSource,
    custom_mirror: String,
    skipped_version: Option<String>,
}

impl Default for UpdateSettingsPreference {
    fn default() -> Self {
        Self {
            version: 1,
            auto_check: true,
            source: UpdateSource::Github,
            custom_mirror: String::new(),
            skipped_version: None,
        }
    }
}

fn read_settings(path: Option<&Path>) -> UpdateSettingsPreference {
    path.and_then(|path| File::open(path).ok())
        .and_then(|file| read_limited(file, SETTINGS_LIMIT).ok())
        .and_then(|raw| decode_settings(&raw))
        .unwrap_or_default()
}

fn decode_settings(raw: &[u8]) -> Option<UpdateSettingsPreference> {
    if raw.len() > SETTINGS_LIMIT {
        return None;
    }
    let mut settings: UpdateSettingsPreference = serde_json::from_slice(raw).ok()?;
    if settings.version != 1 {
        return None;
    }
    // A 256-character prefix can acquire one slash during normalization.
    let mirror = &settings.custom_mirror;
    let input = if mirror.chars().count() == MIRROR_LIMIT + 1 && !mirror.contains("{url}") {
        mirror.strip_suffix('/')?
    } else {
        mirror
    };
    let normalized = validate_mirror_prefix(input).ok()?;
    if mirror.chars().count() <= MIRROR_LIMIT {
        settings.custom_mirror = normalized;
    } else if normalized != *mirror {
        // A prefix that already ends in multiple slashes needs no added slash.
        return None;
    }
    if let Some(version) = settings.skipped_version.as_deref() {
        if !valid_skipped_version(version) {
            return None;
        }
    }
    Some(settings)
}

fn https_url(raw: &str) -> Option<Url> {
    let rest = raw.strip_prefix("https://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    if authority.is_empty()
        || authority.contains('@')
        || raw.contains('\\')
        || raw.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return None;
    }
    let url = Url::parse(raw).ok()?;
    (url.host_str().is_some_and(|host| !host.is_empty())
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none())
    .then_some(url)
}

fn validate_mirror_prefix(raw: &str) -> Result<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(String::new());
    }
    if raw.chars().count() > MIRROR_LIMIT {
        return Err(err("validation", "自定义镜像地址过长"));
    }
    let invalid = || err("validation", "自定义镜像地址格式无效");
    let rest = raw.strip_prefix("https://").ok_or_else(invalid)?;
    if rest
        .split(['/', '?', '#'])
        .next()
        .is_some_and(|authority| authority.contains("{url}"))
    {
        return Err(invalid());
    }
    let template = raw.contains("{url}");
    let sample = raw.replace("{url}", "https://github.com/test/latest.json");
    let parsed = https_url(&sample).ok_or_else(invalid)?;
    if !template && parsed.query().is_some() {
        return Err(invalid());
    }
    if template || raw.ends_with('/') {
        Ok(raw.to_owned())
    } else {
        Ok(format!("{raw}/"))
    }
}

fn apply_mirror_url(raw_url: &str, source: UpdateSource, custom_mirror: &str) -> Result<String> {
    if source == UpdateSource::Github {
        return Ok(raw_url.to_owned());
    }
    let custom_mirror = custom_mirror.trim();
    let prefix = if custom_mirror.is_empty() {
        DEFAULT_MIRROR_PREFIX
    } else {
        custom_mirror
    };
    let url = if prefix.contains("{url}") {
        prefix.replace("{url}", raw_url)
    } else {
        format!(
            "{prefix}{}{}",
            if prefix.ends_with('/') { "" } else { "/" },
            raw_url.trim_start_matches('/')
        )
    };
    https_url(&url).ok_or_else(|| err("validation", "镜像更新地址无效"))?;
    Ok(url)
}

fn without_version_prefix(raw: &str) -> &str {
    raw.strip_prefix(['v', 'V']).unwrap_or(raw)
}

fn validate_skipped_version(raw: &str) -> Result<Option<String>> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    let version = without_version_prefix(raw);
    if !valid_skipped_version(version) {
        return Err(err("validation", "版本号格式无效"));
    }
    Ok(Some(version.to_owned()))
}

fn valid_skipped_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 64
        && version
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b".-+".contains(&c))
}

fn classify_update_kind(current: &str, next: &str, notes: Option<&str>) -> &'static str {
    let notes = notes.unwrap_or_default().to_ascii_lowercase();
    if ["[feature]", "[major]", "[important]"]
        .iter()
        .any(|tag| notes.contains(tag))
    {
        return "feature";
    }
    if ["[patch]", "[silent]", "[bugfix]"]
        .iter()
        .any(|tag| notes.contains(tag))
    {
        return "patch";
    }
    let current = semver::Version::parse(without_version_prefix(current.trim()));
    let next = semver::Version::parse(without_version_prefix(next.trim()));
    if let (Ok(current), Ok(next)) = (current, next) {
        if (next.major, next.minor) > (current.major, current.minor) {
            return "feature";
        }
    }
    "patch"
}

fn valid_pubkey(raw: &str) -> bool {
    STANDARD
        .decode(raw.trim())
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .is_some_and(|key| minisign_verify::PublicKey::decode(&key).is_ok())
}

fn configured_pubkey(app: &AppHandle) -> Option<&str> {
    app.config()
        .plugins
        .0
        .get("updater")?
        .get("pubkey")?
        .as_str()
        .map(str::trim)
        .filter(|key| valid_pubkey(key))
}

pub fn is_pubkey_configured(app: &AppHandle) -> bool {
    configured_pubkey(app).is_some()
}

struct PendingUpdate {
    update: Update,
    downloaded_bytes: Option<Vec<u8>>,
}

pub(crate) struct UpdaterState {
    path: Option<PathBuf>,
    settings: Mutex<UpdateSettingsPreference>,
    pending: Mutex<Option<PendingUpdate>>,
    busy: AtomicBool,
    plugin_ready: bool,
}

impl UpdaterState {
    fn lock_settings(&self) -> Result<MutexGuard<'_, UpdateSettingsPreference>> {
        self.settings
            .lock()
            .map_err(|_| err("storage", "更新设置不可用"))
    }

    fn lock_pending(&self) -> Result<MutexGuard<'_, Option<PendingUpdate>>> {
        self.pending
            .lock()
            .map_err(|_| err("upstream", "更新状态不可用，请重新启动应用"))
    }
}

struct UpdateOperation<'a>(&'a AtomicBool);

impl<'a> UpdateOperation<'a> {
    fn start(busy: &'a AtomicBool) -> Result<Self> {
        busy.compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .map_err(|_| err("busy", "更新正在处理中，请稍后重试"))?;
        Ok(Self(busy))
    }
}

impl Drop for UpdateOperation<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

pub(crate) fn install(app: &mut App) {
    let path = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("update-settings.json"));
    let settings = read_settings(path.as_deref());
    let plugin_ready = configured_pubkey(app.handle()).is_some_and(|key| {
        app.handle()
            .plugin(tauri_plugin_updater::Builder::new().pubkey(key).build())
            .is_ok()
    });
    app.manage(UpdaterState {
        path,
        settings: Mutex::new(settings),
        pending: Mutex::new(None),
        busy: AtomicBool::new(false),
        plugin_ready,
    });
}

fn require_main(window: &WebviewWindow) -> Result<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(err("permission", "无权访问应用更新"))
    }
}

fn config_json(app: &AppHandle, settings: &UpdateSettingsPreference) -> Value {
    json!({
        "currentVersion": app.package_info().version.to_string(),
        "autoCheck": settings.auto_check,
        "source": settings.source,
        "customMirror": settings.custom_mirror,
        "defaultMirror": DEFAULT_MIRROR_PREFIX,
        "skippedVersion": settings.skipped_version,
        "pubkeyConfigured": is_pubkey_configured(app),
    })
}

#[tauri::command]
pub(crate) fn app_update_config_get(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, UpdaterState>,
) -> Result<Value> {
    require_main(&window)?;
    let settings = state.lock_settings()?;
    Ok(config_json(&app, &settings))
}

#[tauri::command]
pub(crate) fn app_update_config_set(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, UpdaterState>,
    auto_check: Option<bool>,
    source: Option<String>,
    custom_mirror: Option<String>,
    skipped_version: Option<String>,
) -> Result<Value> {
    require_main(&window)?;
    let mut settings = state.lock_settings()?;
    let mut next = settings.clone();
    if let Some(auto_check) = auto_check {
        next.auto_check = auto_check;
    }
    if let Some(source) = source {
        next.source = UpdateSource::parse(&source)?;
    }
    if let Some(custom_mirror) = custom_mirror {
        next.custom_mirror = validate_mirror_prefix(&custom_mirror)?;
    }
    if let Some(skipped_version) = skipped_version {
        next.skipped_version = validate_skipped_version(&skipped_version)?;
    }
    let storage_error = || err("storage", "无法保存更新设置");
    let path = state.path.as_ref().ok_or_else(storage_error)?;
    let data = serde_json::to_vec(&next).map_err(|_| storage_error())?;
    write_if_changed(path, &data).map_err(|_| storage_error())?;
    *settings = next;
    Ok(config_json(&app, &settings))
}

fn updater_error(error: UpdaterError) -> crate::Error {
    match error {
        UpdaterError::Reqwest(error) if error.is_timeout() => {
            err("timeout", "更新请求超时，请重试")
        }
        UpdaterError::Reqwest(error) if error.is_decode() || error.is_status() => {
            err("upstream", "更新源返回异常，请切换更新源后重试")
        }
        UpdaterError::Reqwest(_) => err("network", "无法连接更新源，请检查网络或切换更新源"),
        UpdaterError::UrlParse(_) | UpdaterError::InsecureTransportProtocol => {
            err("validation", "更新地址无效")
        }
        UpdaterError::Minisign(_)
        | UpdaterError::Base64(_)
        | UpdaterError::SignatureUtf8(_)
        | UpdaterError::SignedVersionMismatch { .. }
        | UpdaterError::MissingSignedVersion => {
            err("signature", "更新包签名校验失败，请重新检查更新")
        }
        _ => err("upstream", "更新源返回异常，请切换更新源后重试"),
    }
}

fn redirect_allowed(url: &Url, mirror_endpoint: Option<&Url>) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && mirror_endpoint.is_none_or(|endpoint| endpoint.origin() == url.origin())
}

#[tauri::command]
pub(crate) async fn app_update_check(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, UpdaterState>,
    source_override: Option<String>,
) -> Result<Value> {
    require_main(&window)?;
    if !is_pubkey_configured(&app) {
        return Err(err(
            "unconfigured",
            "当前版本尚未配置更新签名公钥，请按发版指南配置后使用",
        ));
    }
    if !state.plugin_ready {
        return Err(err("unconfigured", "更新组件初始化失败"));
    }
    let settings = state.lock_settings()?.clone();
    let source = source_override
        .as_deref()
        .map(UpdateSource::parse)
        .transpose()?
        .unwrap_or(settings.source);
    let endpoint = apply_mirror_url(GITHUB_LATEST_JSON_URL, source, &settings.custom_mirror)?;
    let endpoint = Url::parse(&endpoint).map_err(|_| err("validation", "更新地址无效"))?;
    let mirror_endpoint = (source == UpdateSource::Mirror).then(|| endpoint.clone());

    let _operation = UpdateOperation::start(&state.busy)?;
    *state.lock_pending()? = None;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(updater_error)?
        .timeout(Duration::from_secs(20))
        .configure_client(move |builder| {
            let mirror_endpoint = mirror_endpoint.clone();
            builder
                .https_only(true)
                .redirect(Policy::custom(move |attempt| {
                    if !redirect_allowed(attempt.url(), mirror_endpoint.as_ref()) {
                        attempt.stop()
                    } else if attempt.previous().len() >= 10 {
                        attempt.error("too many update redirects")
                    } else {
                        attempt.follow()
                    }
                }))
        })
        .build()
        .map_err(updater_error)?;

    let Some(mut update) = updater.check().await.map_err(updater_error)? else {
        return Ok(json!({
            "status": "up-to-date",
            "currentVersion": app.package_info().version.to_string(),
            "source": source,
        }));
    };

    let artifact = https_url(update.download_url.as_str())
        .ok_or_else(|| err("upstream", "更新源提供的安装包地址无效"))?;
    let download_url = apply_mirror_url(artifact.as_str(), source, &settings.custom_mirror)?;
    update.download_url =
        Url::parse(&download_url).map_err(|_| err("validation", "更新包地址无效"))?;
    update.timeout = Some(Duration::from_secs(15 * 60));

    let skipped =
        state.lock_settings()?.skipped_version.as_deref() == Some(update.version.as_str());
    let data = json!({
        "status": "available",
        "currentVersion": update.current_version,
        "version": update.version,
        "pubDate": update.date.and_then(|date| date.format(&Rfc3339).ok()),
        "notes": update.body,
        "updateKind": classify_update_kind(&update.current_version, &update.version, update.body.as_deref()),
        "source": source,
        "skipped": skipped,
    });
    *state.lock_pending()? = Some(PendingUpdate {
        update,
        downloaded_bytes: None,
    });
    Ok(data)
}

fn progress_percent(downloaded: u64, total: Option<u64>) -> Option<u64> {
    total
        .filter(|&total| total > 0)
        .map(|total| (downloaded.saturating_mul(100) / total).min(100))
}

#[tauri::command]
pub(crate) async fn app_update_download(
    window: WebviewWindow,
    state: State<'_, UpdaterState>,
) -> Result<Value> {
    require_main(&window)?;
    let _operation = UpdateOperation::start(&state.busy)?;
    let update = {
        let pending = state.lock_pending()?;
        let pending = pending
            .as_ref()
            .ok_or_else(|| err("validation", "请先检查更新"))?;
        if let Some(bytes) = &pending.downloaded_bytes {
            return Ok(
                json!({ "status": "ready", "version": pending.update.version, "totalBytes": bytes.len() }),
            );
        }
        pending.update.clone()
    };
    let received = Mutex::new((0u64, None));
    let mut last_emit = None::<Instant>;
    let emit_progress = |downloaded, total| {
        let _ = window.emit(
            "prism:app-update-progress",
            json!({
                "version": update.version,
                "downloadedBytes": downloaded,
                "totalBytes": total,
                "percent": progress_percent(downloaded, total),
            }),
        );
    };
    let bytes = update
        .download(
            |chunk, total| {
                let downloaded = {
                    let mut received = received.lock().unwrap();
                    received.0 += chunk as u64;
                    received.1 = total;
                    received.0
                };
                let now = Instant::now();
                if last_emit
                    .is_none_or(|last| now.duration_since(last) >= Duration::from_millis(120))
                {
                    emit_progress(downloaded, total);
                    last_emit = Some(now);
                }
            },
            || {
                let (downloaded, total) = *received.lock().unwrap();
                emit_progress(downloaded, total.or(Some(downloaded)));
            },
        )
        .await
        .map_err(updater_error)?;
    let data = json!({ "status": "ready", "version": update.version, "totalBytes": bytes.len() });
    *state.lock_pending()? = Some(PendingUpdate {
        update,
        downloaded_bytes: Some(bytes),
    });
    Ok(data)
}

#[tauri::command]
pub(crate) fn app_update_install(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, UpdaterState>,
) -> Result<()> {
    require_main(&window)?;
    let _operation = UpdateOperation::start(&state.busy)?;
    let mut pending = state.lock_pending()?;
    let (update, bytes) = pending
        .as_ref()
        .and_then(|pending| Some((&pending.update, pending.downloaded_bytes.as_deref()?)))
        .ok_or_else(|| err("validation", "尚未完成更新下载"))?;

    #[cfg(windows)]
    crate::background::allow_exit_for_update(&app);
    if update.install(bytes).is_err() {
        #[cfg(windows)]
        crate::background::restore_close_behavior_after_update_error(&app);
        return Err(err("upstream", "无法启动更新安装，请重试"));
    }
    *pending = None;
    drop(pending);
    // Windows exits inside the plugin after handing off to the installer.
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    const ARTIFACT: &str =
        "https://github.com/yingqianlan1234/Prism/releases/download/v1.2.0/Vesper.exe";

    #[test]
    fn mirror_prefix_normalizes_https_paths_and_templates() {
        for (raw, expected) in [
            (" \t ", ""),
            (
                " https://mirror.example.com ",
                "https://mirror.example.com/",
            ),
            (
                "https://mirror.example.com/proxy/",
                "https://mirror.example.com/proxy/",
            ),
            (
                "https://mirror.example.com/proxy/{url}",
                "https://mirror.example.com/proxy/{url}",
            ),
            (
                "https://mirror.example.com/get?url={url}",
                "https://mirror.example.com/get?url={url}",
            ),
        ] {
            assert_eq!(validate_mirror_prefix(raw).unwrap(), expected);
        }
    }

    #[test]
    fn mirror_prefix_rejects_invalid_addresses() {
        for invalid in [
            "http://mirror.example.com",
            "mirror.example.com",
            "https://",
            "https:///proxy",
            "https://mirror.example.com/a b",
            "https://mirror.example.com/a\u{007f}b",
            "https://user@mirror.example.com",
            "https://user:pass@mirror.example.com",
            "https://{url}/proxy",
            "https://mirror.example.com/{url}#ignored",
            "https://mirror.example.com/get?url=",
            "https://mirror.example.com\\proxy",
        ] {
            assert_eq!(
                validate_mirror_prefix(invalid).unwrap_err().kind,
                "validation",
                "{invalid:?}"
            );
        }
        let oversized = format!("https://mirror.example.com/{}", "路".repeat(240));
        assert_eq!(
            validate_mirror_prefix(&oversized).unwrap_err().message,
            "自定义镜像地址过长"
        );
    }

    #[test]
    fn both_update_urls_use_the_selected_route() {
        for raw in [GITHUB_LATEST_JSON_URL, ARTIFACT] {
            assert_eq!(
                apply_mirror_url(raw, UpdateSource::Github, "ignored").unwrap(),
                raw
            );
            for (prefix, expected) in [
                (" ", format!("{DEFAULT_MIRROR_PREFIX}{raw}")),
                (
                    "https://mirror.example.com",
                    format!("https://mirror.example.com/{raw}"),
                ),
                (
                    "https://mirror.example.com/p/",
                    format!("https://mirror.example.com/p/{raw}"),
                ),
                (
                    "https://mirror.example.com/get?url={url}",
                    format!("https://mirror.example.com/get?url={raw}"),
                ),
            ] {
                assert_eq!(
                    apply_mirror_url(raw, UpdateSource::Mirror, prefix).unwrap(),
                    expected
                );
            }
        }
    }

    #[test]
    fn mirror_redirects_stay_on_https_and_the_selected_origin() {
        let mirror = Url::parse("https://mirror.example.com/proxy").unwrap();
        for (raw, allowed) in [
            ("https://mirror.example.com/cache/file", true),
            ("http://mirror.example.com/cache/file", false),
            ("https://mirror.example.com:8443/cache/file", false),
            ("https://mirror.example.com.evil.invalid/file", false),
            ("https://user@mirror.example.com/cache/file", false),
            (ARTIFACT, false),
        ] {
            assert_eq!(
                redirect_allowed(&Url::parse(raw).unwrap(), Some(&mirror)),
                allowed
            );
        }
        assert!(redirect_allowed(&Url::parse(ARTIFACT).unwrap(), None));
    }

    #[test]
    fn skipped_version_supports_clear_prefixes_and_length_boundary() {
        assert_eq!(validate_skipped_version(" \n ").unwrap(), None);
        assert_eq!(
            validate_skipped_version(" V1.2.3-rc.1+build ")
                .unwrap()
                .as_deref(),
            Some("1.2.3-rc.1+build")
        );
        assert_eq!(
            validate_skipped_version("v1.2.3").unwrap().as_deref(),
            Some("1.2.3")
        );
        let max = "a".repeat(64);
        assert_eq!(
            validate_skipped_version(&format!("v{max}"))
                .unwrap()
                .as_deref(),
            Some(max.as_str())
        );
        for invalid in [
            "v",
            "V",
            "1/2/3",
            "1.2 3",
            "1.2.测试",
            "1.2.3\ninjected",
            &"a".repeat(65),
        ] {
            assert_eq!(
                validate_skipped_version(invalid).unwrap_err().kind,
                "validation"
            );
        }
    }

    #[test]
    fn release_notes_override_version_based_classification() {
        for (current, next, notes, expected) in [
            ("1.1.0", "1.1.1", Some("[FeAtUrE] new"), "feature"),
            ("1.1.0", "1.1.1", Some("[major]"), "feature"),
            ("1.1.0", "1.1.1", Some("[IMPORTANT] [silent]"), "feature"),
            ("1.1.0", "2.0.0", Some("[PATCH] fix"), "patch"),
            ("1.1.0", "2.0.0", Some("[silent]"), "patch"),
            ("1.1.0", "2.0.0", Some("[bugfix]"), "patch"),
            ("V1.1.0+test", "v1.2.0-rc.1+build", None, "feature"),
            ("1.9.0", "2.0.0", None, "feature"),
            ("2.0.0", "1.99.0", None, "patch"),
            ("1.1.0", "1.1.1", None, "patch"),
            ("1.1.0-rc.1", "1.1.0", None, "patch"),
            ("invalid", "2.0.0", None, "patch"),
        ] {
            assert_eq!(classify_update_kind(current, next, notes), expected);
        }
    }

    #[test]
    fn settings_round_trip_and_bad_files_fall_back() {
        let dir = std::env::temp_dir().join(format!(
            "vesper-updater-test-{:016x}",
            rand::random::<u64>()
        ));
        let path = dir.join("update-settings.json");
        let defaults = UpdateSettingsPreference::default();
        assert_eq!(read_settings(Some(&path)), defaults);
        let prefix = "https://mirror.example.com/";
        let longest = format!("{prefix}{}", "路".repeat(MIRROR_LIMIT - prefix.len()));
        let settings = UpdateSettingsPreference {
            auto_check: false,
            source: UpdateSource::Mirror,
            custom_mirror: validate_mirror_prefix(&longest).unwrap(),
            skipped_version: validate_skipped_version("vv1.2.0").unwrap(),
            ..defaults.clone()
        };
        let raw = serde_json::to_vec(&settings).unwrap();
        assert!(write_if_changed(&path, &raw).unwrap());
        assert_eq!(read_settings(Some(&path)), settings);
        assert!(!write_if_changed(&path, &raw).unwrap());
        let invalid = [
            json!({ "version": 2, "autoCheck": true, "source": "github", "customMirror": "" }),
            json!({ "version": 1, "autoCheck": true, "source": "other", "customMirror": "" }),
            json!({ "version": 1, "autoCheck": true, "source": "github", "customMirror": "", "extra": true }),
            json!({ "version": 1, "autoCheck": true, "source": "mirror", "customMirror": "http://x" }),
            json!({ "version": 1, "autoCheck": true, "source": "github", "customMirror": "", "skippedVersion": "1/2" }),
        ];
        for value in invalid {
            write_if_changed(&path, &serde_json::to_vec(&value).unwrap()).unwrap();
            assert_eq!(read_settings(Some(&path)), defaults);
        }
        write_if_changed(&path, b"{").unwrap();
        assert_eq!(read_settings(Some(&path)), defaults);
        let mut oversized = raw;
        oversized.resize(SETTINGS_LIMIT + 1, b' ');
        write_if_changed(&path, &oversized).unwrap();
        assert_eq!(read_settings(Some(&path)), defaults);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn configured_key_must_decode_as_a_tauri_minisign_public_key() {
        // RFC 8032 Ed25519 test vector public key in a minisign public key envelope.
        let key = "untrusted comment: minisign public key\nRWQBAgMEBQYHCNdamAGCsQq31Uv+08lkBzoO4XLz2qYjJa8CGmj3B1Ea";
        assert!(valid_pubkey(&format!(" {} ", STANDARD.encode(key))));
        for invalid in [
            "",
            " \t",
            "not a public key",
            &STANDARD.encode("not a public key"),
            &STANDARD.encode(key.replace("RWQ", "RVQ")),
        ] {
            assert!(!valid_pubkey(invalid));
        }
    }

    #[test]
    fn operations_exclude_each_other_and_release_the_flag() {
        let busy = AtomicBool::new(false);
        let operation = UpdateOperation::start(&busy).unwrap();
        assert!(matches!(UpdateOperation::start(&busy), Err(error) if error.kind == "busy"));
        drop(operation);
        assert!(UpdateOperation::start(&busy).is_ok());
    }

    #[test]
    fn progress_handles_unknown_and_inaccurate_content_lengths() {
        for (downloaded, total, percent) in [
            (0, None, None),
            (10, Some(0), None),
            (0, Some(100), Some(0)),
            (1, Some(3), Some(33)),
            (5, Some(5), Some(100)),
            (6, Some(5), Some(100)),
        ] {
            assert_eq!(progress_percent(downloaded, total), percent);
        }
    }
}
