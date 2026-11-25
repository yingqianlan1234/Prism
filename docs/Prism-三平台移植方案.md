# Prism 三平台移植方案

评审基线为 `main` 提交 [`0f78f2b`](https://github.com/yingqianlan1234/Prism/commit/0f78f2b98913b451228175c861a1829b21dc4060)。目标平台为 Windows、macOS 和 Android。本方案定义后续实施和验收。

## 目标与首版范围

三端共用搜索、曲库、队列、当前播放、歌词和续播体验。本地音乐、网易云音乐和 QQ 音乐保持独立工作区。用户切换浏览来源时，正在播放的歌曲继续播放。云音乐入口按各端授权验收结果开放。

| 平台 | 首轮交付 | 平台功能 |
| --- | --- | --- |
| Windows | 现有 x64 NSIS 和 MSI 安装形态，分别覆盖从 1.0.0 升级及卸载 | 保留 WebView2 播放、托盘、全局快捷键、悬浮歌词和原生标题栏行为。 |
| macOS | 优先 Apple Silicon，提供可直接安装的 DMG | 核心功能通过后补齐菜单栏或托盘、全局快捷键和悬浮歌词。Intel 版本以独立打包和实机验收结果决定。 |
| Android | 优先 ARM64 手机，先交付内测 APK | 采用触控布局、系统目录授权、锁屏后台播放、通知栏和蓝牙媒体控制。若采用 Google Play 分发，再准备签名 AAB。 |

## 现状与迁移边界

- [Rust 入口](../src-tauri/src/main.rs#L310)直接注册了只在 Windows 编译的 QQ、本地媒体和桌面模块。将共享启动移到 `src-tauri/src/lib.rs`，通过 `#[cfg_attr(mobile, tauri::mobile_entry_point)]` 提供移动入口，桌面 `main.rs` 调用共享入口。[Cargo 配置](../src-tauri/Cargo.toml)补齐 Tauri 模板的 `[lib]` 与 `crate-type = ["staticlib", "cdylib", "rlib"]`，按目标平台启用 `tray-icon` 和桌面端的 `keyring` 后端。Android 使用单独的 Keystore 桥接。
- 用 `#[cfg(desktop)]` 隔离[窗口尺寸、位置的读写](../src-tauri/src/window_state.rs)和[`window.set_icon` 窗口图标设置](../src-tauri/src/main.rs#L314)，Win32 专用模块继续使用 `#[cfg(windows)]`。将 [`visible: false`、`minWidth: 850` 及对应的首帧显示逻辑](../src-tauri/tauri.conf.json)限定在桌面配置和启动路径。Android 采用移动端窗口配置，并验收冷启动后首屏可见。
- [前端播放入口](../src/App.jsx#L3910)用单个 HTML 音频元素承载播放，[来源适配](../src/providers.js)将桌面和本地能力设为常量。把播放控制从界面组件中抽出，保留现有曲库、歌词和队列规则。能力从实际平台和运行状态获取，前端据此显示入口与可理解的不可用原因。
- [QQ 播放句柄校验](../src/utils/format.js#L19)和[本地媒体解析](../src-tauri/src/local_library.rs#L593)使用 Windows 形式的协议地址。由平台播放层构造媒体地址并校验来源。macOS WKWebView 使用 `prismlocal://localhost/…` 和 `prismmedia://localhost/…`，在 macOS 的 CSP `media-src` 中显式加入 `prismlocal:`、`prismmedia:`，保留现有规则。分别验证 WebView2 的 HTTP 映射和 WKWebView 自定义协议的实际出声、Range 响应、定位及连续切歌。
- [本地队列保存](../src/App.jsx#L543)在写入完成前就记录去重键。将去重键更新放到写入成功后，保留失败重试，并加入回归用例。私人 FM 续取也需要限制历史长度，确保仍符合[快照校验](../src-tauri/src/playback_storage.rs#L94)的 2,000 首上限，同时保留当前索引和下一首。

## 共用架构与平台实现

### 播放、队列和凭据

- 播放接口覆盖载入、播放、暂停、定位、上一首、下一首和音量。事件反馈当前曲目、播放状态、位置、时长、缓冲和可诊断的错误。切歌和登出沿用请求代次校验，旧请求回包不得覆盖新曲目或新账号。每端只有一个实际播放器和一份生效的播放队列。
- Windows 与 macOS 共用一套 HTML 音频适配器。Windows 现有平台分支逐项保留，通过编译时注册控制平台实现。播放位置事件只更新进度条和时间读数，歌词在当前行变化时更新，沿用 [`performance.test.mjs`](../src/performance.test.mjs) 对高频进度事件的渲染隔离要求。
- 保持 Windows 原有应用标识、网易云与 QQ 的凭据标识及现有快照兼容。新端登录状态按来源与账号隔离，macOS 使用 Keychain，Android 使用 Keystore 管理的密钥加密后保存到应用私有存储。队列快照保存恢复所需的曲目元数据、索引、进度和已授权的文件引用。凭据和短期播放直链仅由受信任的后端或原生播放层持有。

### 本地曲库与媒体访问

- [本地曲库](../src-tauri/src/local_library.rs)目前以 `PathBuf` 定位文件，[本地媒体层](../src-tauri/src/local_media.rs)依赖 Win32 盘符、句柄和文件身份校验。在目录枚举、曲目标识、文件打开、元数据读取和同目录歌词访问处引入平台适配。Windows 继续验证盘符范围和文件身份，macOS 使用获授权的目录及文件引用，Android 使用已授权的 `content://` URI 和文档 ID，检测文件变更时按各端可获取的身份信息处理。
- Android 通过 Storage Access Framework 选择目录并持久化读取授权。Media3 读取 `content://`，元数据层通过文件描述符或流访问。Lofty 的读取路径需要测试输入是否可定位，以能定位的句柄优先解析。遇到不可定位的流时，采用有大小上限的临时副本或回退到文件名等基础信息。验收重启、目录移动、文件删除和授权撤销后的恢复或提示。

### macOS

- 用系统目录选择器接入共享的元数据扫描和歌词解析。文件访问按授权范围校验。若采用 App Sandbox，使用 security-scoped bookmark 保存跨启动目录访问，并验证撤销权限和文件被移动后的处理。
- 网易云优先验证登录、会话恢复和播放。QQ 当前使用独立授权窗口和 WebView2 专用安全设置，需验证 WKWebView 下的账户隔离、导航限制、密码自动填充控制、授权清理以及播放。登录或播放验收有缺口时，在该端明确标示 QQ 能力状态。
- 保留桌面共用的 HTML 音频适配器。WebKit 官方记录显示，Safari 18.4 对应的 WebKit 于 macOS Sequoia 15.4 加入 Ogg 容器内的 Vorbis 和 Opus 音频支持。按首版最低支持的 macOS 和较新版本，分别在实际 WKWebView 验证两种编码的播放和定位。遇到无法解码的文件，保留曲目信息并提示当前系统不支持该格式。若产品要求较旧系统也能播放 Ogg，再评估原生解码。[WebKit 格式说明](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)
- 用 Apple Silicon 实机验证睡眠唤醒、耳机连接变化、窗口关闭及后台播放行为。发布 DMG 时配置 Developer ID 签名与公证，并在另一台 Mac 验证安装及首次启动。

### Android

- 加入 Tauri Android 入口和 Kotlin 桥接，按手机宽度重排导航、歌词页、曲目列表和底部播放控件。[曲库列表](../src/components/LibraryContent.jsx#L178)及[队列抽屉](../src/components/Overlays.jsx#L288)在手机上单击播放，桌面保留各来源现有操作，其中网易云单击选择、双击或按 Enter 播放。用 `viewport-fit=cover` 和 `env(safe-area-inset-*)` 处理屏幕缺口及手势导航区域，验收窄屏下的歌词、进度条和底部控件。
- 由 Media3 的 `MediaSessionService` 和 ExoPlayer 持有播放、当前队列及自动切歌。React 通过原生控制器发送命令、订阅状态。锁屏续播时，由服务直接通过原生或 Rust 通道读取已授权的会话、解析下一首，并通过原生数据源接入 QQ 受控流或其他来源的音频。整条路径独立于 JavaScript、Tauri 主 WebView 及其媒体协议处理器，在页面挂起或 Activity 重建时仍可工作。音频焦点、拔耳机、蓝牙控制和恢复检查点同样由原生层处理。
- 网易云现有入口只有 [`netease_qr_start/check/cancel`](../src-tauri/src/main.rs#L244)。首轮真机验证网易云官方 App 能否从相册识别 Prism 保存的二维码，并跑通返回 Prism、确认、取消及过期重试。有可用的官方同机授权回调时可独立评估。若只有跨设备扫码通过，则在首版标明需要另一台设备。
- QQ 的[桌面授权窗口](../src-tauri/src/qq_web_auth.rs#L258)依赖 WebView2 专用安全设置。Tauri 官方支持 Android 12L（API 32）及以上的移动多窗口，可用 `supportsMultipleWindows()` 判断运行环境是否支持。手机上附加窗口通常是压入返回栈的独立 Activity。首版在单 Activity 内验证独立授权 WebView 的会话隔离与清理。若服务提供可用的授权回调，再评估 Custom Tabs，授权结果通过受支持的回调交给 Prism，浏览器 Cookie 由浏览器管理。验证登录、取消、退出、重启恢复和有权限曲目播放，通过后开放对应入口。[Tauri 移动多窗口](https://v2.tauri.app/learn/mobile-multiwindow/) · [Android Custom Tabs](https://developer.chrome.com/docs/android/custom-tabs)

## 实施顺序与验收门槛

| 阶段 | 实施内容 | 完成条件 |
| --- | --- | --- |
| 1. 建立基线 | 记录 Windows 1.0.0 的 NSIS 与 MSI 安装包，并分别记录安装、卸载与同系列升级基线。覆盖普通播放、私人 FM、账号恢复、本地目录、托盘、全局快捷键和歌词窗口。同步探测 Android 真机的同机授权及连续后台切歌。 | Windows 记录具体提交、安装包类型及版本。Android 记录两家来源的同机授权和后台续播结果或阻塞。 |
| 2. 打通桌面 | 拆分共享启动、平台能力、媒体协议和安全存储，同步迁移命令注册静态守卫。实现 macOS 本地曲库和网易云播放，验证 QQ，再逐步补齐原生桌面功能。 | Windows 全新安装通过，NSIS → NSIS、MSI → MSI 分别由 1.0.0 覆盖升级到候选版，检查凭据与播放状态仍可读取、卸载项无重复且可卸载。macOS 通过实际出声、Range 定位、歌词、队列及重启恢复验收，汇报 Ogg 格式结果。 |
| 3. 完善 Android | 接入 Media3、系统目录授权、凭据桥接和触控界面。按来源逐个接通及验收。 | 在 ARM64 真机上锁屏后至少连续自动切歌两次，覆盖本地曲库及每个已开放云来源。覆盖 Activity 重建后重新连接同一播放服务。通知栏和蓝牙能控制当前曲目，来电或音频焦点变化行为可预期，退出再启动可恢复队列和位置。 |
| 4. 候选发布 | 在 CI 加入 Windows、macOS、Android 构建目标。发布流水线生成平台包，记录同一提交、产物哈希、签名状态和实机结果。 | 分平台核对安装、更新、卸载及回归结果。签名材料只进入发布环境，PR 构建使用独立的无发布凭据流程。 |

## 测试与交付

- **自动化**。保留 `npm test` 和 Windows 的 Rust 测试。[`providers.test.mjs`](../src/providers.test.mjs#L126)当前直接扫描 `main.rs` 验证 Windows 凭据标识和 `generate_handler!`。拆分时让守卫覆盖 `lib.rs` 及实际的平台注册入口，继续验证凭据标识兼容以及平台能力对应的命令注册。补充共享播放接口、切歌回滚、账号隔离、平台 URL、恢复旧数据和保存失败重试测试。Android 增加原生服务和控制器集成测试，覆盖页面重建和进度局部更新。
- **实机**。三端各覆盖本地和已开放云来源的首次播放、连续切歌、拖动进度、重启恢复、登录取消、会话过期和权限撤销。测试 MP3、FLAC、WAV、M4A 和 Ogg，其中 Ogg 分别使用 Vorbis 与 Opus 样本。按目标系统版本记录播放、定位和不支持格式提示的结果，再据此列出首版支持的格式。真实账号和测试曲目数据独立于构建日志。
- **发布判断**。上游登录、搜索和播放可单独失败，按来源呈现状态并保留本地曲库可用。若公开分发，发行前确认第三方接口、品牌和内容的使用条件，同时确认目标渠道的签名与审核要求。

## 官方参考

- [Tauri 项目结构与移动入口](https://v2.tauri.app/start/project-structure/)
- [Tauri 按平台配置](https://v2.tauri.app/reference/config/#platform-specific-configuration)
- [Tauri WebView 差异](https://v2.tauri.app/reference/webview-versions/)
- [macOS 签名和公证](https://v2.tauri.app/distribute/sign/macos/)
- [macOS App Sandbox 文件授权](https://developer.apple.com/documentation/xcode/configuring-the-macos-app-sandbox)
- [Android Media3 后台播放](https://developer.android.com/media/media3/session/background-playback)
- [Android 系统文件授权](https://developer.android.com/training/data-storage/shared/documents-files)
- [Android Keystore](https://developer.android.com/privacy-and-security/keystore)
- [Tauri Google Play 发布](https://v2.tauri.app/distribute/google-play/)
