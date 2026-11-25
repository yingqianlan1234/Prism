# Prism 三平台移植方案

评审基线为 `main` 提交 [`0f78f2b`](https://github.com/yingqianlan1234/Prism/commit/0f78f2b98913b451228175c861a1829b21dc4060)。目标平台为 Windows、macOS 和 Android。本方案定义后续实施和验收。

## 目标与首版范围

三端共用搜索、曲库、队列、当前播放、歌词和续播体验。本地音乐、网易云音乐和 QQ 音乐保持独立工作区。用户切换浏览来源时，正在播放的歌曲继续播放。云音乐入口按各端授权验收结果开放。

| 平台 | 首轮交付 | 平台功能 |
| --- | --- | --- |
| Windows | 现有 x64 安装形态，覆盖当前 1.0.0 候选版本的升级和卸载 | 保留 WebView2 播放、托盘、全局快捷键、悬浮歌词和原生标题栏行为。 |
| macOS | 优先 Apple Silicon，提供可直接安装的 DMG | 核心功能通过后补齐菜单栏或托盘、全局快捷键和悬浮歌词。Intel 版本以独立打包和实机验收结果决定。 |
| Android | 优先 ARM64 手机，先交付内测 APK | 采用触控布局、系统目录授权、锁屏后台播放、通知栏和蓝牙媒体控制。若采用 Google Play 分发，再准备签名 AAB。 |

## 现状与迁移边界

- [Rust 入口](../src-tauri/src/main.rs#L310)直接注册了只在 Windows 编译的 QQ、本地媒体和桌面模块。[Cargo 配置](../src-tauri/Cargo.toml#L21)只启用了 Windows 系统凭据后端。先把共享应用入口和平台注册拆开，再逐个平台编译和验收。
- [前端播放入口](../src/App.jsx#L3910)用单个 HTML 音频元素承载播放，[来源适配](../src/providers.js)将桌面和本地能力设为常量。把播放控制从界面组件中抽出，保留现有曲库、歌词和队列规则。能力从实际平台和运行状态获取，前端据此显示入口与可理解的不可用原因。
- [QQ 播放句柄校验](../src/utils/format.js#L19)和[本地媒体解析](../src-tauri/src/local_library.rs#L593)使用 Windows 形式的协议地址。由平台播放层构造媒体地址并校验来源。桌面端同时覆盖 WebView2 的 HTTP 映射和 WKWebView 的自定义协议，验证 CSP、Range 响应、跳转进度和连续切歌。Android 原生播放器从本地授权 URI 或来源适配层获取音频。
- [本地队列保存](../src/App.jsx#L543)在写入完成前就记录去重键。将去重键更新放到写入成功后，保留失败重试，并加入回归用例。私人 FM 续取也需要限制历史长度，确保仍符合[快照校验](../src-tauri/src/playback_storage.rs#L94)的 2,000 首上限，同时保留当前索引和下一首。

## 共用架构与平台实现

### 播放、队列和凭据

- 播放接口覆盖载入、播放、暂停、定位、上一首、下一首和音量。事件反馈当前曲目、播放状态、位置、时长、缓冲和可诊断的错误。切歌和登出沿用请求代次校验，旧请求回包不得覆盖新曲目或新账号。每端只有一个实际播放器和一份生效的播放队列。
- Windows 与 macOS 共用一套 HTML 音频适配器。Windows 现有平台分支逐项保留，通过编译时注册控制平台实现。将共享启动逻辑移到 Tauri 库入口，桌面与 Android 入口复用它。
- 保持 Windows 原有应用标识、网易云与 QQ 的凭据标识及现有快照兼容。新端登录状态按来源与账号隔离，macOS 使用 Keychain，Android 使用 Keystore 管理的密钥加密后保存到应用私有存储。队列快照保存恢复所需的曲目元数据、索引、进度和已授权的文件引用。凭据和短期播放直链仅由受信任的后端或原生播放层持有。

### macOS

- 用系统目录选择器接入共享的元数据扫描和歌词解析。文件访问按授权范围校验。若采用 App Sandbox，使用 security-scoped bookmark 保存跨启动目录访问，并验证撤销权限和文件被移动后的处理。
- 网易云优先验证登录、会话恢复和播放。QQ 当前使用独立授权窗口和 WebView2 专用安全设置，需验证 WKWebView 下的账户隔离、导航限制、密码自动填充控制、授权清理以及播放。登录或播放验收有缺口时，在该端明确标示 QQ 能力状态。
- 用 Apple Silicon 实机验证睡眠唤醒、耳机连接变化、窗口关闭及后台播放行为。发布 DMG 时配置 Developer ID 签名与公证，并在另一台 Mac 验证安装及首次启动。

### Android

- 加入 Tauri Android 入口和 Kotlin 桥接，按手机宽度重排导航、歌词页、曲目列表和底部播放控件。选择曲目、拖动进度和队列操作提供触控入口。
- 由 Media3 的 `MediaSessionService` 和 ExoPlayer 持有播放、当前队列及自动切歌。React 通过原生控制器发送命令、订阅状态。把下一首解析、音频焦点、拔耳机、蓝牙控制和恢复检查点做到服务一侧，确保 WebView 挂起后仍能自动续播。在线来源的解析和凭据访问按来源接入受信任的 Rust 或原生接口，避免依赖页面计时器。
- 用户通过 Storage Access Framework 选择目录，持久化授权 URI。播放器读取 `content://`，同目录歌词按授权范围访问。验证进程重启、目录移动、文件删除和授权撤销后的恢复或提示。
- 尽早用真机验证网易云与 QQ 的同机授权。QQ 验证需覆盖登录、取消、退出、重启恢复和有权限曲目播放。若某来源暂时只有另一台设备扫码的路径，先明确标注其使用条件，Android 本地播放进度独立推进。

## 实施顺序与验收门槛

| 阶段 | 实施内容 | 完成条件 |
| --- | --- | --- |
| 1. 建立基线 | 在 Windows 记录当前构建和安装行为，覆盖普通播放、私人 FM、账号恢复、本地目录、托盘、全局快捷键和歌词窗口。同步探测 Android 真机上的同机授权及连续后台切歌。 | Windows 记录到具体提交和安装包。Android 分别形成两家来源的授权结论，以及后台续播的可行结果或具体阻塞。 |
| 2. 打通桌面 | 拆分共享启动、平台能力、媒体协议和安全存储。实现 macOS 本地曲库和网易云播放，验证 QQ，再逐步补齐原生桌面功能。 | Windows 全新安装及覆盖升级通过。macOS 安装后可完成目录选择、播放、拖动、歌词、切队列和重启恢复。云音乐能力按该端真机结果开放。 |
| 3. 完善 Android | 接入 Media3、系统目录授权、凭据桥接和触控界面。按来源逐个接通及验收。 | 在 ARM64 真机上锁屏后至少连续自动切歌两次。通知栏和蓝牙能控制当前曲目，来电或音频焦点变化行为可预期，退出再启动可恢复队列和位置。 |
| 4. 候选发布 | 在 CI 加入 Windows、macOS、Android 构建目标。发布流水线生成平台包，记录同一提交、产物哈希、签名状态和实机结果。 | 分平台核对安装、更新、卸载及回归结果。签名材料只进入发布环境，PR 构建使用独立的无发布凭据流程。 |

## 测试与交付

- **自动化**。保留 `npm test` 和 Windows 的 Rust 测试。补充共享播放接口、切歌回滚、账号隔离、平台 URL、恢复旧数据和保存失败重试测试。Android 增加原生服务和控制器集成测试，覆盖页面重建时对唯一服务的重新连接。
- **实机**。三端各覆盖本地和已开放云来源的首次播放、连续切歌、拖动进度、重启恢复、登录取消、会话过期和权限撤销。覆盖项目声明的 MP3、FLAC、WAV、M4A、OGG，平台验收记录注明能播放和能定位的格式。真实账号和测试曲目数据独立于构建日志。
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
