# Prism 后端增强交接说明（供审核后转交 Codex）

更新日期：2026-11-24 · 整理方：Antigravity（前端视觉与架构重构侧）

> **交接边界说明**：**P1（网易云库与搜索增强）**、**P2-A（全局系统快捷键含方向键扩展 & 桌面悬浮歌词）** 与 **P2-B（本地音乐独立工作区）** 均已由 Codex 完成后端并在 Antigravity 完成全部前端 UI、事件同步与测试验收。目前仅 **P3（QQ 104003 播放协议排查）** 留待后续用户单独授权推进。

---

## 一、已有工作与现状

- **前端已重构**：[src/main.jsx](src/main.jsx) 已拆分为 [src/App.jsx](src/App.jsx) + `src/components/*`（`AppHeader`、`Artwork`、`FloatingDock`、`Icons`、`LibraryBar`、`LibraryContent`、`LyricPanel`、`Overlays`、`PlaybackProgress`、`RadioStage`）+ `src/utils/format.js` + `src/lyrics.js` + `src/styles/tokens.css` & `src/styles/night-radio.css`；旧皮肤 `src/style.css` 与 `src/lumen.css` 已物理删除。
- **P1 已前后端打通**：网易云音质切换（标准 / 极高 / 无损 / Hi-Res）与实际音质/试听状态呈现、红心列表同步与喜欢/取消、私人 FM 不喜欢并跳过、自建歌单收藏与移出、网易云搜索 4 分类与分页；已修复在途 `<audio>.play()` 被 `pause()` 中断（`AbortError`）误报播放失败与 `Space` 长按连发冲突问题，并补充端到端回归测试 [src/netease-p1.test.mjs](src/netease-p1.test.mjs)。
- **纯前端已顺手补齐**：歌词译文 & 罗马音（`romalrc`）解析与切换开关、睡眠定时关闭（15/30/60 分钟/播完本首）、播放倍速（0.75×–2.0×）、本地搜索历史；已完成第二轮前台灵动动效与托盘/隐藏自动休眠（监听 `visibilitychange` 写入 `html[data-hidden="true"]` 暂停全部动画）。
- **P2-A 已前后端打通**：全局系统快捷键（`global_shortcuts_get` / `global_shortcuts_set`，支持 `Ctrl+Alt` / `Ctrl+Shift` + `Left / Right / Up / Down / Space / A–Z / F1–F11`，默认 `Ctrl+Alt+P / Left / Right / Up / Down / D`，含冲突回滚与 `Ctrl+Shift+方向键` 防误触提示，监听 `prism:global-shortcut` 调度唯一 `<audio>`）与 Windows 原生桌面悬浮歌词（`desktop_lyric_get` / `desktop_lyric_set` / `desktop_lyric_update`，底栏一键开关与锁定穿透解锁按钮，仅在当前行/歌名/播放态变化时事件驱动推送，监听 `prism:desktop-lyric-state` 同步拖拽/锁定/关闭状态）；端到端回归测试 [src/desktop-p2a.test.mjs](src/desktop-p2a.test.mjs)。
- **P2-B 已前后端打通**：本地音乐独立工作区（`local_library_folders_get` / `pick` / `remove`、`local_library_scan`、`local_library_tracks_get`、`local_track_resolve`、`local_track_lyric`、`local_queue_get` / `set`），由 `main.jsx` 注入 `providers.local`；前端接入顶栏「本地」独立页签、目录增删与扫描管理、关键词与目录筛选、本地队列与进度恢复、同名 `.lrc` 歌词及单 `<audio>` 受控流播放；端到端回归测试 [src/local-library-p2b.test.mjs](src/local-library-p2b.test.mjs)。
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

### [已完成前后端对接] P2-A · 全局系统快捷键 & 桌面悬浮歌词窗体
- 后端 `src-tauri/src/desktop_shortcuts.rs`（`RegisterHotKey`）、`src-tauri/src/desktop_lyric.rs`（Windows 原生置顶透明可穿透子窗体）与 `src/providers.js`（`capabilities.desktop` / `desktop.*`）已落地；
- 前端已在 [FloatingDock.jsx](src/components/FloatingDock.jsx)、[Overlays.jsx](src/components/Overlays.jsx)、[App.jsx](src/App.jsx) 完成入口、设置弹窗、冲突提示与事件驱动同步，并通过 `src/desktop-p2a.test.mjs` 与无头 Chromium 视觉验收；真实桌面按键及原生歌词窗拖拽体验待实机启动验收。

### [已完成前后端对接] P2-B · 本地音乐曲库（独立工作区）
- 后端 `src-tauri/src/local_library.rs`、`src-tauri/src/local_media.rs`（Lofty 元数据、IFileOpenDialog 目录授权、HTTP Range 受控本地流与排队持久化）与 `src/providers.js`（`capabilities.local` / `local.*`）已落地；
- 前端已在 [AppHeader.jsx](src/components/AppHeader.jsx)、[LibraryBar.jsx](src/components/LibraryBar.jsx)、[LibraryContent.jsx](src/components/LibraryContent.jsx)、[Overlays.jsx](src/components/Overlays.jsx)、[App.jsx](src/App.jsx) 完成独立工作区、文件夹管理、本地筛选、进度恢复与歌词同步，并通过 `src/local-library-p2b.test.mjs` 与无头 Chromium 多尺寸视觉验收；真实系统文件夹选择弹窗与各类本地音频格式逐项出声/拖动进度待实机桌面端验证。

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
6. **状态提示**：**P1、P2-A（含键位扩展）与 P2-B 已全部完成前后端对接与自动化/视觉验收**；仅 **P3（QQ 104003）** 留待后续授权排查。
