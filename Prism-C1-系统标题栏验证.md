# Prism · C1 系统标题栏与 DWM 精确着色

更新：2026-11-08。授权：用户在本轮明确批准**第二步 A/B 与 DWM 的 C 一并实施**（此前交接文档只要求 A/B 单独确认、C 再单独批准；本轮两者均已获授权）。

## 1. 实施范围（严格限定）

| 项 | 内容 | 位置 |
|---|---|---|
| A | 主窗口 `theme: "Dark"`、`backgroundColor: "#120D0B"` | `src-tauri/tauri.conf.json` |
| B1 | `html`、`body` 使用 `#120D0B`，`index.html` 内联首帧背景 + `color-scheme: dark` | `index.html`、`src/style.css` |
| B2 | 原生窗口标题跟随实际播放歌曲「歌名 — 歌手」，无歌曲时为 `Prism` | `src/main.jsx` |
| B3 | 最小权限新增 `core:window:allow-set-title` | `src-tauri/capabilities/default.json` |
| B4 | 初始隐藏 + 首帧后显示（实测确认仍存在启动闪烁后启用） | 见第 3 节 |
| C | Rust 侧 DWM 标题栏背景 `#120D0B`、文字 `#F2E9E2`、边框 `#120D0B` | `src-tauri/src/window_dwm.rs`、`src/main.rs`、`src-tauri/Cargo.toml` |

**未做**：`decorations: false`、Mica、Acrylic、透明窗口、自绘标题栏、窗口几何语义改动。`window_state.rs` 未修改。

## 2. C 的实现边界

- 仅 Windows 目标（`#[cfg(windows)] mod window_dwm;`），只作用于 `main` 窗口。
- `windows = "0.62"` 启用 `Win32_Foundation`、`Win32_Graphics_Dwm`；与 tauri 2.12.5 共用同一个 `windows 0.62.2` crate，`hwnd()` 类型直接可用（已核实 `Cargo.lock` 仅一个 windows 版本）。
- COLORREF 按 `0x00BBGGRR` 编码，由 `colorref()` 计算：#120D0B → `0x000B0D12`，#F2E9E2 → `0x00E2E9F2`。单测 `window_dwm::tests::colorref_matches_dwm_byte_order` 覆盖字节序。
- 所有 `DwmSetWindowAttribute` 返回值按设计丢弃：Windows 10 及更早版本返回 `E_INVALIDARG` 属既定降级路径，不影响窗口创建与启动。

## 3. 启动闪烁（实测驱动）

首轮实测（`visible` 默认 true）发现两个问题，且都留下了取证：

1. 窗口先以小尺寸、**白色标题栏**出现在左上角，随后才被 `window_state` 移到恢复位置并着色。
2. 即使只做 A/B，窗口内容首帧仍可能是空壳。

据此启用交接文档第 4 条预案（「只有实际观察到仍白闪时才评估初始隐藏」）：

- `tauri.conf.json` 主窗口 `visible: false`；
- Rust 新增命令 `reveal_main_window`：先应用 DWM → `show()` → **再次**应用 DWM（隐藏窗口不被 DWM 合成，属性必须在显示后补一次）；
- 前端在 React 提交首帧后再等 80ms 调用该命令，给 WebView2 合成留时间；
- Rust 侧 4 秒兜底线程强制显示，保证渲染失败时窗口不会永不出现。

`core:window:allow-show` 曾短暂加入后移除：显示动作改由 Rust 命令完成，前端不再直接调用 `show()`，权限保持只比原来多一条 `allow-set-title`。

**注意**：`src/main.jsx` 的标题 effect 必须**静态**导入 `@tauri-apps/api/window`。最初写成动态 `import()`，Vite 的 modulepreload polyfill 会在 jsdom 测试里对插入的 `<link>` 发起 `fetch`，导致 `npm run test` 直接 `TypeError: fetch failed`。改成静态导入后回归恢复全绿。

## 4. 实测证据

环境：Windows 11、屏幕 DPI 125%（`AppliedDPI=120`）、物理 2560×1440、窗口状态文件 `%APPDATA%\local.xianyu.music\window-state.json`。

取证方式：`PrintWindow(PW_RENDERFULLCONTENT)` 直接抓窗口自身内容，避免 `SetForegroundWindow` 在无用户输入时被系统拒绝、截图被其它窗口遮挡（该问题已实际踩到并排除）。

| 项 | 结果 |
|---|---|
| 首次可见帧标题栏 | 19 个采样点全部 `#120D0B`，无任何白色帧 |
| 首次可见帧内容 | 与后续帧亮度一致（16.1 vs 16.6），内容已在显示前完成上屏 |
| 标题（无歌曲） | `Prism` |
| 标题（恢复歌曲后） | `微醺 — 北染` |
| 几何恢复 | 窗口 2578×1398（125% 缩放物理像素），与保存的 2560×1351 + 边框一致 |
| 最大化恢复 | 最大化后关闭 → `{"maximized":true,...}` → 重启 `IsZoomed=True` |
| 视觉 | `docs/lumen-phase0/titlebar-20261108/library-maximized-125dpi.png` |

对比证据（同一套接口、修复前）：`docs/lumen-phase0/titlebar-20261108/before-defer-empty-shell.png` 显示既有空壳内容帧。首帧成品：`first-visible-frame-maximized-125dpi.png`。

## 5. 自动化回归

改动后完整重跑：

- `npm run test`：Node 单元测试 **25 passed / 0 failed**；其后 19 个集成脚本全部输出「通过：…」。
- `cargo test --offline`：**53 passed / 0 failed / 5 ignored**（新增 DWM 颜色单测在内；5 个 ignored 仍是需要网络的历史探针）。
- 构建：`npm exec tauri build -- --no-bundle` 成功，产物 `Prism.exe` 13,642,240 字节（独立 `CARGO_TARGET_DIR`，未覆盖旧产物）。

## 6. 未实测 / 明确限制

以下**没有**跑过，不得当作通过：

- Windows 10 或更早版本上的降级行为（本机是 Windows 11）。
- DPI 100% 与 150% 的截图（只实测了当前 125%）。
- 窗口拖动、缩放、贴靠（Snap）、关闭按钮的逐项人工验证（只验证了几何保存/恢复与最大化）。
- 屏幕阅读器抽检标题与导航。
- DWM 失败分支：没有构造过「DWM 不可用」的环境，静默降级只是代码路径保证，不是实测结果。
- 80ms 首帧等待是固定值，未在最慢机器上做上限压测。

## 7. 回滚

改动前快照：`music-desktop-workspaces-2.3-round7/lumen-before-titlebar-20261108/`（含 `src/`、`src-tauri/`、`docs/`、`package.json`、`index.html`、`vite.config.js`）。回滚即为还原 `main.jsx`、`lumen.css` 之外的四个文件（`tauri.conf.json`、`capabilities/default.json`、`index.html`、`style.css`）与 Rust 两处，并删除 `window_dwm.rs`。

## 8. 同批视觉补充（规范 §4.3 L3、§1.5 d0）

补前先核对了现有实现，**避免重复造轮子**：

- 项目**已实现** BloomLayer：`--lw-cx/--lw-cy` 定位、双层 `radial-gradient`、封面与光晕的 `left` 过渡（`src/lumen.css:207-215`），并带 `forced-colors` 降级。
- 项目**已实现** 歌词 d0–d3 层级、翻译行、四种状态（加载/无歌词/纯音乐/失败）、「回到当前行」按钮与 5 秒跟随恢复（`src/main.jsx:41`、`src/lumen.css:86,161-165,256-257`）。

本轮只补确实缺失的两项，均为追加式 CSS（`src/lumen.css` 末尾），无 JSX 改动：

1. **封面材质**：`feTurbulence` 颗粒贴图（`::after`，`opacity:.12` + `overlay`）+ 内高光 + 红青 ±2px 边缘位移。`box-shadow` 覆盖时保留了原有的 `0 24px 90px var(--lw-stage-fade)`。
2. **歌词当前行辉光**：`[data-depth="0"]` 的静态双环 `text-shadow`，色取自 `--lw-accent`。

降级：`forced-colors: active` 下颗粒与辉光都关闭。

实测（WebView2 CDP 驱动，非模拟）：`data-skin=lumen`、导航三项、`library → stage → lyrics` 切换正常；舞台渲染出光晕、三圈刻线、玻璃镜片、Archivo 宽体歌名；歌词模式封面缩小左移、刻线隐藏、空状态整块呈现。

**未实测**：封面为真实图片时的颗粒与红青位移观感（本轮恢复的歌曲无封面，走的是占位封面）；有歌词时的 d0 辉光强度与 4.5:1 对比度复核。CSS 对比度未用工具量化，只有静态色值推导。
## 9. 玻璃镜片（按用户提供的 Glass light toggle 参考落实）与 InlineNotice

用户提供了本地参考 `Glass light toggle.html`，补上了规范里「Claude Artifact 需登录、未读取」的空白。**只取材质与动作关系，不搬代码**：该参考的点阵图标是 `canvas` + `requestAnimationFrame` 逐帧绘制，规范 §5.2 与附录 B 明令禁止，因此图标继续用现有内联 SVG 点阵 + CSS 过渡。

核对后确认现有镜片已具备：玻璃渐变面、`backdrop-filter: blur(12px) saturate(1.7)`、点阵逐点延迟与散开、conic 光环弧（暂停 110°、播放 290°）、缓冲虚线环、`hover 1.04 / active .95`、`forced-colors` 降级。

本轮新增（追加式 CSS，`src/lumen.css`）：

1. **冷暖内发光**：`inset 0 -20px 28px -8px color-mix(--lw-accent 52%)`，主色随实际播放歌曲变化。
2. **外辉光**：`0 16px 30px -14px` 主色投影。
3. **光环弧辉光**：`::before` 双层 `drop-shadow`（墨色 4px + 主色 12px）。
4. **手感**：hover 600ms `cubic-bezier(.3,1.5,.5,1)`，press 120ms `.955`，与规范 §6.1 对齐（原为 160ms/.95）。

**踩到一个特异性坑**：`border-color` 最初不生效。根因是第 28 行 `.app[data-skin="lumen"] :is(.primary,.play-toggle,…)` 给 `.play-toggle` 设了 `border-color:var(--lw-ink)`，特异性 (0,3,1) 高于新规则 (0,3,0)，边框被合成成不透明墨色。改为 `.app[data-skin="lumen"] .play-toggle.lw-lens`（(0,4,0)）后 `getComputedStyle` 返回 `rgba(255,255,255,0.16)`，截图哈希随之变化，确认修复。

**InlineNotice**（规范 §1.8）：新增纯展示组件 `InlineNotice`（左 3px 色条、`data-tone`、默认 `role` 按 tone 取 alert/status），接入两处——空态的原有 `.empty-status` 文本，以及**列表已有内容时**的 content 区。后者是实际缺陷：在此之前 `message` 只在空态渲染，有 35 首歌的队列里发生加载失败时用户根本看不到提示。

实测（CDP）：`#queue-heading` 为「网易云播放队列 · 35 首 · 接下来 23 首」，`.lw-notice` 命中 `data-tone="ok"`、`role="status"`；截图见 `docs/lumen-phase0/titlebar-20261108/lens-stage-125dpi.png`、`lens-playerbar-125dpi.png`、`queue-drawer.png`、`inline-notice.png`。

**未实测**：hover/press 的手感只有 computed style 与静态截图，没有逐帧或录屏确认；`backdrop-filter` 在真实封面（彩色背景）上的观感；d0 歌词辉光在有歌词时的实际对比度。
## 10. 规范核对后的补齐：主色过渡、三尺寸矩阵、一处回归修复

### 10.1 主色 800ms 过渡（规范 §4.2，此前完全未实现）

核对时发现 CSS 中 `transition` 命中 `--lw-accent` 的次数为 **0**，换歌时光晕、竖线、镜片内发光是瞬间跳色。补法：

- `@property --lw-accent {syntax:'<color>';inherits:true;initial-value:#B08968}`，同时注册 `--lw-cx` / `--lw-cy`；
- `.app[data-skin="lumen"] {transition:--lw-accent 800ms var(--lw-ease)}`。

实测（CDP，把主色从 `#B08968` 改成 `#D6336C` 后逐次采样 computed 值）：

| 时间 | `--lw-accent` |
|---|---|
| 0ms | `rgb(176,137,104)` |
| 41ms | `rgb(183,120,105)` |
| 121ms | `rgb(198,87,106)` |
| 300ms | `rgb(210,60,108)` |
| 601ms | `rgb(214,52,108)` |
| 1002ms | `rgb(214,51,108)` = `#D6336C` |

是插值而非跳变，800ms 到位。

### 10.2 三尺寸矩阵（规范 §11.1 的一部分）

CDP `Emulation.setDeviceMetricsOverride` 在 WebView2 内模拟视口，覆盖 850×600 / 1280×820 / 1920×1080 × 曲库/舞台/歌词/队列 共 12 张，存于 `docs/lumen-phase0/matrix-20261108/`。

实测布局值：

| 视口 | 列 | 行 | 侧栏 | NowCard | 行高 | 列表列宽 |
|---|---|---|---|---|---|---|
| 850×600 | `64px 786px` | `48px 452px 100px` | 64px（图标栏） | 隐藏 | 44px | `25/624/0/0/42`（专辑列隐藏） |
| 1280×820 | `248px 1032px` | `48px 696px 76px` | 248px | 288px | 52px | `34/346/0/173/52` |
| 1920×1080 | `248px 1672px` | `48px 956px 76px` | 248px | 427px | 52px | `34/562/0/281/52` |

与规范 §7 的 S/L 档意图一致（S 收成图标栏、隐藏专辑列、行高 44px；L 显示 NowCard）。**仍是 CDP 视口模拟，不是真实窗口拉伸**；DPI 只有 125% 实机，100%/150% 未测。

### 10.3 矩阵暴露并修复的一处回归（本会话引入）

850×600 舞台截图显示镜片落在封面**左下内侧**，而规范 §1.4 要求压在**右下角**。

根因：补封面颗粒时写下 `.lw-stage-cover .lw-lens {position:relative;z-index:2}`，目的是让 `::after` 颗粒层不盖住镜片，但 `position:relative` 覆盖了原有 `.lw-stage-cover>.lw-lens` 的 `position:absolute; right:-12px; bottom:-12px`，镜片退回普通流定位。

修复：该规则只保留 `z-index:2`（镜片本身已是 absolute，z-index 生效）。重建后 850×600 舞台截图确认镜片回到封面右下角。

**教训**：给已定位元素补 z-index 时不要顺带重写 `position`；这类回归只有在窄窗口实拍时才看得出来，静态读 CSS 很容易放过。
## 11. 状态与降级实测（规范 §8.3、§9、§11.2 可自动化部分）

用 CDP `Emulation.setEmulatedMedia` 真实模拟媒体特性（不是改 CSS 断言），并用 `Performance.getMetrics` 测空闲。

### 11.1 `prefers-reduced-motion: reduce` —— 通过

`matchMedia` 命中 `true`；`.app` 的 `transition-duration` 被全局规则压到 `1e-05s`（0.01ms），镜片与点阵 `transitionDuration` 均为 `0s`。截图：`docs/lumen-phase0/states-20261108/reduced-motion-stage.png`。

### 11.2 `forced-colors: active` —— 通过

`matchMedia` 命中 `true`，实测各装饰层：

| 目标 | 结果 |
|---|---|
| `.lw-stage::before`（光晕） | `display:none` |
| `.lw-stage-cover::after`（颗粒） | `display:none` |
| `.lw-lens`（镜片） | `box-shadow:none`，保留 1.6px 边框 |
| `.lw-lens::before`（光环弧） | `display:none` |

画面退化为系统高对比：黑底白字、封面实线边框、进度条转 `Highlight`。关闭模拟后 `matchMedia` 恢复 `false`。截图：`forced-colors-stage.png`、`forced-colors-library.png`。

### 11.3 暂停空闲 10 秒性能 —— 通过

`Performance.getMetrics` 前后差值：

| 指标 | 10 秒增量 |
|---|---|
| TaskDuration | 0.0011s |
| ScriptDuration | 0 |
| LayoutDuration | 0 |
| RecalcStyleDuration | 0 |

说明暂停空闲时没有周期性任务，符合规范 §9「暂停空闲时无任何定时器、动画、rAF」。DOM 节点 810。

### 11.4 搜索无结果 —— **未能构造，不视为通过**

规范 §11.2 要求「搜索无结果」状态截图。实测：网易云搜索对 `zzqqxxvvjj0000000000zz` 仍返回 3 条，对另一个测试词返回 39 条；切到 QQ 社区匿名搜索返回 5 条并提示「总数未知，可继续请求下一页」。两个平台都不返回空结果，因此 `EmptyState` 的 `noSearchResults` 分支在真实接口下**触发不到**。

这条如实记为「代码路径存在、真实交互未触发」，不用篡改状态的方式伪造截图。

顺带得到一条真实验证：QQ 搜索时 `.lw-notice` 以 `data-tone="ok"`、`role="status"` 出现在**有内容的列表上方**，正是本轮修掉的「有歌时错误不可见」缺陷的正面证据。截图：`qq-search-inline-notice.png`。

### 11.5 仍未覆盖

DPI 100%/150% 实机、未登录态、加载中态、长歌名/长歌手、黑白封面、缓冲、切歌在途、播放失败回滚、队列为空、纯音乐歌词、歌词加载失败、屏幕阅读器抽检、纯键盘走查。这些需要改系统缩放或构造特定账号/网络条件，未做。
## 12. 纯键盘走查（规范 §11.3 键盘项）

用 CDP `Input.dispatchKeyEvent` 注入真实键盘事件驱动，不点鼠标。

| 操作 | 实测结果 |
|---|---|
| `Ctrl+L` | `document.activeElement` 变为搜索框（aria-label「搜索歌曲、歌手」） |
| 输入框内按 Space | 播放状态**不变**（编辑区保护生效） |
| 非编辑区按 Space | `play → pause` |
| 打开队列后 Esc | `.queue-dialog` 关闭 |
| 舞台视图 Esc | `data-view: stage → library` |
| 歌词模式 Esc | `lyrics: true → false`，`view` 仍为 `stage`（回到封面模式） |
| 再按 Esc | `stage → library` |
| `Ctrl+→` | 曲目由「碧落之下」切到「Toxic」 |
| `Ctrl+↑` | 音量 `0.2 → 0.25` |
| `Tab` | 焦点进入首个可聚焦元素「Prism，返回音乐库」，`:focus-visible` 为 `true` |

Esc 顺序与规范 §8.1 及新增的「歌词 → 封面 → 曲库」末尾追加一致。

焦点环：`ComputedStyle.outlineWidth` 读数为 `1.6px`，是页面 `zoom: 0.8`（125% DPI 下 WebView2 的缩放补偿）对 CSS `2px` 的计算结果，设备像素仍是 2px；颜色为墨色 `rgb(242,233,226)`。截图：`keyboard-focus-ring.png`。

**说明**：CDP 首轮用 `rawKeyDown` 发 Tab 不触发浏览器默认焦点导航，改为 `keyDown` 后才得到真实焦点移动；第一轮的 Tab 结果不作数。屏幕阅读器抽检没有做，无法用 CDP 代替。
## 13. 响应式断点与 PlayerBar 高度对齐规范（用户已授权）

改动前：断点上限是 **1050/1051px**（播放栏单行/两行的分界），`PlayerBar` L 档 76px。规范 §7 是 L≥1280 / M 900–1279 / S 681–899，§1.3 是 72px。

改动：

- `max-width:1050px` → `max-width:1279px`（5 处）、`min-width:1051px` → `min-width:1280px`（1 处）；
- `minmax(0,1fr) 76px` → `72px`（4 处，含舞台底部控制区）；
- M 档补 `now-panel { display:none }`（规范「NowCard 只在 ≥1280 出现」）。M 档的 220px 左栏**项目原本就有**，只是被 1050 的上限截短，这次随断点一起放开。

实测四档：

| 视口 | `grid-template-columns` | `grid-template-rows` | 侧栏 | NowCard |
|---|---|---|---|---|
| 850×600 | `64px 786px` | `48px 452px 100px` | 64px | 隐藏 |
| 1100×800 | `220px 880px` | `48px 652px 100px` | **220px** | 隐藏 |
| 1280×820 | `248px 1032px` | `48px 700px 72px` | 248px | 293px |
| 1920×1080 | `248px 1672px` | `48px 960px 72px` | 248px | 427px |

截图：`docs/lumen-phase0/matrix-20261108/lib-M-1100x800.png`、`lib-L-1280x820.png`。

**保留的偏差**：宽度 <1280 时播放栏仍是两行 100px，没有按「height<640 → 60px」压到 60px。理由是单行在窄窗口会挤压上一首/镜片/进度/模式/音量/队列等控件，60px 下不可用；交接文档早已记录这个取舍。此项是**有意的可用性让步**，不是遗漏。
## 14. 应用图标替换（用户提供 1254×1254 源图）

用户提供图标源图（黑色圆角底 + 米色 P + 橙色播放三角）。处理：

1. 源图存为仓库根 `app-icon-source.png`（1254×1254），便于以后重新生成；
2. `tauri icon` 生成全套（`src-tauri/icons/`）：16/24/32/48/64/256 的 ico、`icon.icns`、`icon.png`、各尺寸 PNG、Windows Store 徽标；删除与桌面无关的 `android/`、`ios/`；
3. 原 `icon.ico` 备份为 `icon.default-backup.ico`。

**关键坑**：只生成图标不生效。首次重建后 `ExtractAssociatedIcon` 仍是系统默认图标，检查 PE 资源只有 **1 个 RT_ICON（1704 字节）**。原因是 `tauri.conf.json` 的 `bundle` 只写了 `{"active":false}`，**没有 `icon` 数组**，`tauri-build` 找不到 .ico 就不嵌入。

补上 `"icon":["icons/32x32.png","icons/128x128.png","icons/128x128@2x.png","icons/icon.ico"]` 后重建，PE 资源变为 **6 个 RT_ICON**（804/1404/1940/3456/5069/51748 字节），`ExtractAssociatedIcon` 返回新图标，运行时标题栏左上角图标同步更新（截图 `titlebar-icon.png`）。

EXE 13,707,776 字节（换图标后 +65,536，含多尺寸资源）。回归 `npm run test` 25 passed / 0 failed。

**未验证**：Windows 任务栏、开始菜单、Alt+Tab 的实际显示（只用 PE 资源与标题栏图标验证）；未做安装包（`bundle.active=false`，只用 `--no-bundle`）。
## 15. 图标小尺寸重绘（用户反馈 16px 下像方块）

反馈：标题栏 16px 图标看起来像一块带白边的黑方，圆角几乎不可见。

原因：直接缩放 1254×1254 源图到 16px 时，24% 的圆角半径只剩约 3.8px，被抗锯齿吃掉；P 与三角细节只剩十几个像素。

改法：不依赖 `tauri icon` 的等比缩放，逐尺寸独立渲染后手工打包 ICO（脚本保留在 `src-tauri/icons/build-ico.ps1`）：

- 每个尺寸单独计算圆角半径（16px 用 30%，256px 用 25%），小尺寸更圆；
- 小尺寸叠加 0.8–1.6px 的半透明墨色描边，让图标在深色标题栏上有轮廓；
- 超采样后 HighQualityBicubic 缩小；
- 9 个尺寸（16/20/24/32/40/48/64/128/256）以 PNG 负载手工写入 ICO。

**两个坑**：

1. `tauri-build` 的 winres 产物有缓存，替换 `icon.ico` 后重建不生效（PE 里仍是旧图标）。必须删掉 `CARGO_TARGET_DIR/release/build/xianyu-*` 后重建，RT_ICON 才会更新。
2. 首次用 `DrawImage(Image, RectangleF)` 缩放，实际只画出了源图中心的 32px（正好是橙色三角），整张图标变成橙色圆角块。换成 `DrawImage(Image, destRect, srcRect, GraphicsUnit.Pixel)` 显式指定源/目标矩形后正常。

结果：PE 中 9 个 RT_ICON，标题栏 16px 下能看到圆角、米色 P 与橙色三角（`titlebar-icon-round.png`、`app-icon-32-round.png`）。回归 `npm run test` 25 passed / 0 failed。

**未验证**：任务栏、开始菜单、Alt+Tab 的显示（走 Windows 图标缓存）；16px 下 P 的细节仍受物理像素限制，只是不再是"黑方块"。
## 16. 图标改镂空（用户要求去掉白边）

反馈：标题栏图标仍有白边，软件内的图标应该做成镂空背景。

处理：

1. 新增亮度软阈值抠图（`alpha = clamp((luma - 26) * 255 / 54)`），把接近黑的底色转为透明，保留米色 P 与橙色三角，P 内部镂空处也一并透明；
2. 用同一算法生成 9 个尺寸的透明 PNG，打包成 ICO 覆盖 `src-tauri/icons/icon.ico`（50,997 字节，9 entries）；
3. 不再叠加任何描边——之前 0.8–1.6px 的描边正是"白边"的来源。

**试过但没用的两条路**（如实记录）：

- `tauri.conf.json` 的窗口 `icon` 字段：Tauri 2 的 `WindowConfig` **没有**这个字段，build 直接报 `Additional properties are not allowed ('icon' was unexpected)`。
- 运行时 `window.set_icon()` + `include_bytes!` 内嵌 PNG：代码能编译（已加 `tauri` 的 `image-png` feature），但在隐藏窗口上设置不生效，放到 `show()` 之后仍然没有观察到变化。

**验证方式的坑**：`PrintWindow(PW_RENDERFULLCONTENT)` **不刷新标题栏图标**。连续三次替换 ICO（黑底圆角 + 描边 → 黑底无描边 → 镂空）截图哈希完全相同，很容易误判成"没换成功"。改用 `ExtractAssociatedIcon` 读 PE 资源、再合成到 `#120D0B` 背景上，才确认已是镂空版（`app-icon-cutout.png`）。

结果：`icon.ico` 为 9 个尺寸的镂空图标，EXE 13,939,200 字节，RT_ICON 9 个。回归 `npm run test` 25 passed / 0 failed；`cargo test` 53 passed / 0 failed / 5 ignored。

**注意**：桌面/开始菜单的图标现在也是镂空（同一份资源），浅色壁纸上会显得偏轻。若只想让软件内镂空、桌面保留黑底，需要把 EXE 资源与窗口图标拆成两份——但 Tauri 2 没有窗口图标配置项，只能在运行时改图标，而实测该路径未生效。
## 17. 最终图标：用户供图 + 去棋盘格 + 用户选 C 方案

用户提供了最终图标（1254×1254 JPEG）：空心 P 形描边 + 橙色三角，**透明底被导出成棋盘格像素**。JPEG 不带 alpha，棋盘格是画进 RGB 里的。

处理：不做网格检测，改用「色温」软阈值——棋盘格是中性灰（`max-min` 通道差约 0），P 的米色与橙色三角都偏暖（通道差 20+）。取 `alpha = clamp((warmth - 4) * 255 / 12)`，既去干净棋盘格，又保留抗锯齿边缘的半透明过渡。9 个尺寸重新生成并打包 ICO（35,166 字节）。

**16px 的取舍由用户拍板**：实测 16px 下米色描边只剩约 0.5px，物理上无法显示，alpha 膨胀加粗后橙色三角反而糊成一团。给出 A（小尺寸用实心简化版）/ B（全部实心底）/ C（接受 16px 只有橙色三角）三个选项，用户选 **C**，因此不做小尺寸特化。

结果：`icon.ico` 9 尺寸镂空图标，`window-icon.png` 同步为同一设计的 64px 版本，EXE **13,923,328 字节**。`npm run test` 25 passed / 0 failed。

证据：`app-icon-final-128.png`（128px 完整设计）、`app-icon-final-16.png`（16px 实际效果，只剩橙色三角）。

**说明**：提取 EXE 图标做视觉核对时 `ExtractAssociatedIcon` 只返回 32×32，放大后看到的像素块是采样结果，不代表 256 资产的真实质量。