# Prism 后端增强交接说明（供审核后转交 Codex）

更新日期：2026-11-24 · 整理方：Antigravity（前端视觉与架构重构侧）

> **交接边界说明**：本轮 Antigravity 已完成 Prism 前端模块拆分与「深夜电台波段 · Night Radio」全局视觉重构，仅同步调整了窗口与 DWM 标题栏的深靛夜色常量（`#0E1624` / `#F0F4FA`，涉及 `src-tauri/src/window_dwm.rs` 与 `src-tauri/tauri.conf.json`），未改动任何网易云/QQ 业务协议、凭据标识或存储结构。以下后端增强项尚未实施，待用户审核并排期后手动转交 Codex 在 `src-tauri/` 侧实现。

---

## 一、已有工作与现状

- **前端已重构**：[src/main.jsx](src/main.jsx) 已拆分为 [src/App.jsx](src/App.jsx) + `src/components/*`（`AppHeader`、`Artwork`、`FloatingDock`、`Icons`、`LibraryBar`、`LibraryContent`、`LyricPanel`、`Overlays`、`PlaybackProgress`、`RadioStage`）+ `src/utils/format.js` + `src/lyrics.js` + `src/styles/tokens.css` & `src/styles/night-radio.css`；旧皮肤 `src/style.css` 与 `src/lumen.css` 已物理删除。
- **纯前端已顺手补齐**：歌词译文 & 罗马音（`romalrc`）解析与切换开关、睡眠定时关闭（15/30/60 分钟/播完本首）、播放倍速（0.75×–2.0×）、本地搜索历史；已完成第二轮前台灵动动效与托盘/隐藏自动休眠（监听 `visibilitychange` 写入 `html[data-hidden="true"]` 暂停全部动画）。
- **视觉与工程档案**：详见 [design-brief.md](design-brief.md)；`.oil-ui/` 仅为前端过程验收目录，不进入正式构建与提交。
- **不可破坏约束**：
  - 全应用唯一 `<audio>`，进度由媒体事件驱动。
  - Windows 凭据隔离标识不变（网易 `local.xianyu.music` / `netease-session`；QQ `xianyu.qqmusic` / `session`）。
  - Cookie、Token、密钥、真实播放直链禁止写入前端 `localStorage` 或普通日志。
  - 保持 `src-tauri/src/window_dwm.rs` 与 `src-tauri/tauri.conf.json` 的深靛夜色（`#0E1624` / `#F0F4FA`）窗口/标题栏配色；保留前端 `src/main.jsx` 注入 `providers.js` 与 `listening.js` 给 `<App />` 的架构。

---

## 二、待后端实现功能清单（按优先级建议）

### P1 · 网易云音质档位切换
- **现状**：`src-tauri/src/main.rs` 中 `netease_url` 硬编码 `"level": "standard"`。
- **目标**：允许前端传入可选 `level`（白名单校验：`standard | exhigh | lossless | hires`），缺省仍回退 `standard`，并在返回体里透传实际拿到的音质级别与码率（供前端悬浮控制岛显示真实音质徽章）。
- **相关文件**：`src-tauri/src/main.rs`、`src/providers.js`。
- **验收标准**：非法 `level` 参数返回 `validation` 错误；无 VIP 账号请求高音质时能正常降级或提示试听片段，不阻断播放。

### P1 · 红心喜欢 & 歌单基础写操作（网易云）
- **目标**：补齐日常听歌核心写能力：
  1. `netease_like(id: u64, like: bool)`：喜欢 / 取消喜欢歌曲，及获取用户红心 ID 集合 `netease_likelist()`。
  2. `netease_fm_trash(id: u64)`：私人 FM“不喜欢 / 跳过并移除”。
  3. `netease_playlist_tracks_op(op: "add" | "del", pid: u64, track_id: u64)`：将歌曲收藏到自建歌单或移出。
- **验收标准**：全部校验 `valid_id` 与有效登录态；未登录时明确返回错误；不伪造成功状态。

### P1 · 网易云搜索分页与分类
- **现状**：`netease_search` 硬编码 `type: 1, limit: 40, offset: 0`。
- **目标**：支持 `offset` 翻页（上限保护）以及可选 `search_type`（单曲 `1` / 专辑 `10` / 歌手 `100` / 歌单 `1000`），保持默认参数向后兼容现有调用与测试。
- **验收标准**：现有 `netease_search({ query })` 调用行为零变化；翻页参数越界返回 `validation` 错误。

### P2 · 全局系统快捷键 & 桌面悬浮歌词窗体
- **目标**：
  1. 通过 Tauri global shortcut 注册可配置的全局媒体/播放控制快捷键（支持冲突检测与开关关闭）。
  2. 可选轻量级独立置顶透明歌词子窗体（只在用户手动开启时创建，不常驻第二个重型 WebView）。
- **验收标准**：关闭功能时不占用额外窗口或系统热键；与现有窗口内快捷键不冲突。

### P2 · 本地音乐曲库（独立工作区）
- **目标**：允许用户选择本地音频目录，Rust 侧安全扫描 `mp3 / flac / wav / m4a / ogg`，解析基础标签（歌名、歌手、专辑、时长与内嵌封面缓存）并通过受控自定义协议安全播放，不把本地绝对路径暴露给外网接口。
- **验收标准**：与网易云/QQ 工作区完全隔离，支持离线播放与队列持久化。

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
6. **状态提示**：本交接清单仅梳理接口目标与约束，后端功能尚未实施；完成后请交回前端侧对接新能力位的 UI 入口。
