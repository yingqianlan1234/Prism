# Prism 后端增强交接说明（供审核后转交 Codex）

更新日期：2026-11-24 · 整理方：Antigravity（前端视觉与架构重构侧）

> **交接边界说明**：网易云 **P1 增强已由 Codex 完成后端并在 Antigravity 完成全部前端 UI 与交互对接**（`playbackQuality`、`searchPagination`、`searchCategories`、`likeTrack`、`getLikedSongIds`、`trashFmTrack`、`editPlaylistTracks`）。以下仅 **P2 / P3** 待用户后续确认排期后交由 Codex 推进。

---

## 一、已有工作与现状

- **前端已重构**：[src/main.jsx](src/main.jsx) 已拆分为 [src/App.jsx](src/App.jsx) + `src/components/*`（`AppHeader`、`Artwork`、`FloatingDock`、`Icons`、`LibraryBar`、`LibraryContent`、`LyricPanel`、`Overlays`、`PlaybackProgress`、`RadioStage`）+ `src/utils/format.js` + `src/lyrics.js` + `src/styles/tokens.css` & `src/styles/night-radio.css`；旧皮肤 `src/style.css` 与 `src/lumen.css` 已物理删除。
- **P1 已前后端打通**：网易云音质切换（标准 / 极高 / 无损 / Hi-Res）与实际音质/试听状态呈现、红心列表同步与喜欢/取消、私人 FM 不喜欢并跳过、自建歌单收藏与移出、网易云搜索 4 分类与分页；已修复在途 `<audio>.play()` 被 `pause()` 中断（`AbortError`）误报播放失败与 `Space` 长按连发冲突问题，并补充端到端回归测试 [src/netease-p1.test.mjs](src/netease-p1.test.mjs)。
- **纯前端已顺手补齐**：歌词译文 & 罗马音（`romalrc`）解析与切换开关、睡眠定时关闭（15/30/60 分钟/播完本首）、播放倍速（0.75×–2.0×）、本地搜索历史；已完成第二轮前台灵动动效与托盘/隐藏自动休眠（监听 `visibilitychange` 写入 `html[data-hidden="true"]` 暂停全部动画）。
- **视觉与工程档案**：详见 [design-brief.md](design-brief.md)；`.oil-ui/` 仅为前端过程验收目录，不进入正式构建与提交。
- **不可破坏约束**：
  - 全应用唯一 `<audio>`，进度由媒体事件驱动。
  - Windows 凭据隔离标识不变（网易 `local.xianyu.music` / `netease-session`；QQ `xianyu.qqmusic` / `session`）。
  - Cookie、Token、密钥、真实播放直链禁止写入前端 `localStorage` 或普通日志。
  - 保持 `src-tauri/src/window_dwm.rs` 与 `src-tauri/tauri.conf.json` 的深靛夜色（`#0E1624` / `#F0F4FA`）窗口/标题栏配色；保留前端 `src/main.jsx` 注入 `providers.js` 与 `listening.js` 给 `<App />` 的架构。

---

## 二、已完成与待后端实现功能清单

### [已完成前后端对接] P1 · 网易云音质 / 红心与歌单写入 / 搜索分页与分类
- 后端 `netease_url`、`netease_search`、`netease_like`、`netease_likelist`、`netease_fm_trash`、`netease_playlist_tracks_op` 及 `src/providers.js` 能力位已落地，前端已完成全部入口与端到端测试覆盖（`src/netease-p1.test.mjs`）；真实账号网络回包仍待实号验证。

### [待实现] P2-A · 全局系统快捷键 & 桌面悬浮歌词窗体
- **全局系统快捷键**：
  - 建议命令：`global_shortcuts_get`、`global_shortcuts_set({ enabled, bindings })`（绑定动作：`togglePlayback`、`prevTrack`、`nextTrack`、`volumeUp`、`volumeDown`、`toggleDesktopLyric`，默认关闭或提供安全不冲突组合键，支持持久化到本机配置）。
  - 触发时通过 Tauri event（如 `prism:global-shortcut`，payload `{ action }`）通知主窗口，前端负责驱动唯一 `<audio>` 与状态机。
  - 注册冲突时明确返回 `{ code: "conflict", message }`，关闭开关时立即注销全部系统热键。
  - `src-tauri/Cargo.toml` 当前未引入 `tauri-plugin-global-shortcut`，可优先使用 Windows 原生 `RegisterHotKey`（借助已有 `windows` crate）或按需引入官方插件，保持最小依赖与离线测试可运行。
- **桌面悬浮歌词窗体**：
  - 建议命令：`desktop_lyric_get`、`desktop_lyric_set({ enabled, locked? })`、`desktop_lyric_update({ text, translation?, romaji?, title?, playing? })`。
  - 仅在用户开启时按需创建轻量置顶透明无边框子窗体（`always_on_top`、支持鼠标穿透 `locked`、记住窗口坐标），关闭时真正销毁窗口零驻留（不在启动时预创建第二个 WebView）。
  - 窗体拖拽 / 锁定 / 关闭通过 event（如 `prism:desktop-lyric-state`）同步回主窗口状态。
- **验收标准**：关闭功能时不占用额外窗口或系统热键；与现有窗口内快捷键不冲突。

### [待实现] P2-B · 本地音乐曲库（独立工作区）
- **建议命令**：`local_library_folders_get`、`local_library_folder_add`（调用原生目录选择对话框或校验合法目录路径）、`local_library_folder_remove`、`local_library_scan`、`local_track_resolve({ id })`。
- **扫描与安全边界**：仅扫描白名单音频后缀（`mp3 / flac / wav / m4a / ogg`），跳过符号链接循环与超限文件，提取基础元数据（歌名、歌手、专辑、时长，缺失时回退文件名）与可选内嵌封面。
- **受控播放流**：沿用现有 `prismmedia` 受控自定义协议思路（或独立受控本地句柄，支持 HTTP `Range` 拖动），仅向前端返回不透明曲目 ID 与受控流地址，绝不将本机绝对路径暴露给外网请求或日志。
- **独立工作区边界**：与 `netease` / `qqmusic` 完全隔离（不污染原有两平台的 `capabilities` 结构或既有 28 单测 + 18 集成测试，可在 `src/providers.js` 新增独立 `local` provider 或专用模块）。
- **验收标准**：支持离线播放与本地列表/队列持久化，不影响网易云与 QQ 工作区状态。

### P3 · QQ 音乐 104003 播放协议专项排查（需用户单独授权实号排查）
- **现状**：QQ 登录、资料、歌单、曲目浏览与社区匿名搜索已通，但普通 Vkey 取流返回 `0/0/104003`。
- **边界**：严禁绕过会员、版权、DRM、验证码或设备风控；任何实号抓包/请求前须向用户说明请求范围与影响并获单独同意。
- **相关文件**：`src-tauri/src/qq_web_auth.rs`、`src-tauri/src/qq_catalog.rs`、`src-tauri/src/qq_research.rs`。

---

## 三、前后端接口约定与工程注意点

1. 新增 Tauri 命令请在 `src-tauri/src/main.rs` 的 `generate_handler![]` 注册，并在 `src/providers.js` 的 `capabilities` 对象中声明对应布尔能力位（前端据此自动显隐入口，绝不写死平台判断）。
2. `platforms.test.mjs`、`listening-integration.test.mjs`、`performance.test.mjs` 的测试插件只拦截 `src/main.jsx` 对 `./providers.js` 与 `./listening.js` 的导入；若修改 `providers.js` 接口，请保持由 `src/main.jsx` 通过 props 注入 `<App />`，不要在子组件直接 import。
3. 请保留 `src-tauri/src/window_dwm.rs` 与 `src-tauri/tauri.conf.json` 的深靛夜色（`#0E1624` / `#F0F4FA`）配置；`.oil-ui/` 为前端过程验收产物，勿纳入业务代码或发布提交。
4. 错误返回沿用现有 `{ code, message }` 结构，保持前端 `errorText()` 统一提示体验。
5. 改动 Rust 代码后请跑通 `cargo test --offline --manifest-path src-tauri/Cargo.toml` 与前端 `npm run test`。
6. **状态提示**：P2 与 P3 尚未开始实现；Codex 完成 P2（可先做 P2-A 或 P2-B，或一次完成）后，请跑通 `cargo test --offline --manifest-path src-tauri/Cargo.toml` 与 `npm run test`，并将新增/变更的 Tauri 命令、事件及前端能力接口整理交回给前端侧对接 UI 入口。
