# Prism · Lumen Well 视觉开发交接规范

版本 v1.0 · 2026-11-08 · 读者：Codex（实施）、项目负责人（确认）

依据：《Prism 视觉设计系统 v0.2》《Prism 前端组件结构与视觉改造边界》（Codex 只读分析，源码快照 `src/main.jsx` 104 行）。视觉参考原型：https://claude.ai/artifact/Q86wKPT9qdMDN8if5EoRgE （暖炭配色；原型只用于看材质、构图与动作，**其代码不得直接搬进工程**，差异见附录 B）。

本规范只做视觉与交互交接，不修改正式工程，不含业务代码。

---

## 0. 摘要与硬约束

已确认的视觉方向（不再讨论）：暖炭配色、封面作为光源、**每屏仅一个玻璃播放镜片**、三圈同心刻线、玻璃进度游标、液态导航（可延后）。

必须遵守的工程约束，全部来自现有架构：

1. 只有一个 `<audio>`，视觉层不得新建、不得因切视图/切平台重建。
2. 播放进度来自 audio 媒体事件（`timeupdate`、`seeked` 等），**不是 Rust 推送**，视觉层不加计时器。
3. 浏览平台（`activeProvider`）与实际播放来源（`song.provider`）可能不同，视觉必须分开表达。
4. 私人 FM 有独立队列语义，不是普通队列的视觉别名，禁止普通编辑。
5. 现有快捷键不覆盖、不改变顺序，只做增量（见第 8 节）。
6. QQ 功能冻结：本次只改 QQ 工作区的外观，不碰协议、登录、授权 WebView、诊断。
7. 不引入常驻动画循环：无常驻 WebGL / Canvas / `requestAnimationFrame` 循环，无常驻 `setInterval`。动效只在事件后的有限时间内运行。
8. 视觉替换不得同时重写业务状态机；`App` 里的状态、`play()`、回滚、请求代次、FM、存储、Media Session 先原位保留。

---

## 1. 最终页面结构

### 1.1 视图模型

只有两个**视图**，外加叠加层：

| 层 | 名称 | 说明 |
|---|---|---|
| 视图 | **曲库 Library**（默认） | 完整浏览模式：左栏导航 + 歌曲表格 + 底部播放栏，宽窗口多一张正在播放卡片 |
| 视图 | **舞台 Stage** | 沉浸式正在播放；有两种模式：封面模式、歌词模式 |
| 叠加 | **队列抽屉 QueueDrawer** | 右侧滑出，两个视图都可打开，保持模态语义 |
| 叠加 | **对话框 Dialog** | 网易二维码、QQ 授权提示、清空确认、本地记录清空确认 |

顶部导航三项：**曲库 / 正在播放 / 歌词**。它们只是 UI 外壳状态：「曲库」= Library；「正在播放」= Stage 封面模式；「歌词」= Stage 歌词模式（对应现有 `showLyrics`）。

曲库**不做成抽屉**：沉浸感只属于舞台，浏览效率属于曲库。

### 1.2 全局壳层

- 顶栏高 48px，不透明底 `--lw-bg`（液态导航的反色文字需要不透明底）。
- 顶栏内容：品牌（仍是返回发现页的可聚焦按钮，行为不变）、导航三项、**浏览平台**切换（文案明确为“浏览”）、搜索框（保持现有的条件显示逻辑）、账号区（刷新 / 登录 / 退出）。
- 窗口标题栏默认**沿用系统标题栏**，不自绘（原型里的自绘窗口控制仅为示意），待你确认，见 D1。

### 1.3 曲库视图（完整模式）

```
┌ 顶栏 ─────────────────────────────────────────────────────────────┐
│ Prism  [曲库|正在播放|歌词]   浏览：[网易云|QQ]   [搜索………]  账号 │
├───────────────┬────────────────────────────────┬──────────────────┤
│ SideNav       │ ListHeader：列表名 · 元信息 · 状态/重试            │
│  私人 FM      │ ──────────────────────────────  │ NowCard（≥1280） │
│  最近播放     │ #  标题 / 歌手      专辑    时长 │  封面 + 光晕     │
│  每日推荐     │ 01 …                            │  标题 / 歌手     │
│ 我的歌单      │ 02 …                            │  SourceTag       │
│  …            │ …                               │  当前歌词 2 行   │
│               │ 分页                            │                  │
├───────────────┴────────────────────────────────┴──────────────────┤
│ PlayerBar 72px：缩略 + 标题 + SourceTag │ ⏮ 镜片 ⏭ + 进度 │ 模式 音量 歌词 队列 │
└───────────────────────────────────────────────────────────────────┘
```

- **SideNav** 由现有 `.recommend-nav`（推荐入口）与 `.library-bar`（我的歌单）合并为左栏。数据、`openList`、`recommend`、加载与错误提示全部沿用，不合并两个平台的曲库。
- **歌曲表格**：列 = 序号 / 标题+歌手 / 专辑 / 时长。行高 L 档 52px、M/S 档 44px。保持现有“网易单击选中、双击或 Enter 播放；QQ 单击播放”的语义。
- **选中与当前必须视觉区分**：选中 = 浅底 + 左侧 2px 墨色竖线；当前播放 = 左侧 4px 主色竖线 + 缩略封面带同色光晕 + 序号位显示播放态标记。
- **如实标注范围**：列表头部写“当前页 N 首”，不称完整歌单；网易歌单最多渲染 100 条、FM 主列表取最后 200 条，需在头部写明（如“最近 200 首”）。分页控件沿用现有逻辑。
- **NowCard**：只在 ≥1280 宽度出现，替代现有 `.now-panel` 的封面/标题/当前歌词片段/诊断入口。**不放播放按钮**（本屏的镜片在 PlayerBar）。点击封面或标题进入舞台。
- **PlayerBar**：本屏唯一的玻璃镜片（52px）在这里。保留现有全部控件：上一首/播放/下一首、`PlaybackProgress`、模式、音量、歌词入口、本地上报偏好开关（文案与诚实标注不变，`reportListening` 仍 unsupported）。

### 1.4 舞台（封面模式）

- 画面中心是封面片，宽 `min(42vh, 36vw)`，最大 560px；封面中心点用 `--cx/--cy/--cw` 三个变量定位。
- 封面主色向外形成两层静态径向光晕；封面外三圈同心刻线（静态 SVG，仅封面模式显示）。
- 玻璃播放镜片压在封面右下角；这是舞台上**唯一**带 `backdrop-filter` 的元素。
- 歌名（Archivo 宽体 800，clamp 30–68px）和歌手在左下，最多 3 行后截断；专辑名、来源标签放在歌手行。
- 右下：上一首、下一首、播放模式、音量、队列。底部：进度条（玻璃游标）+ 起止时间。
- 舞台进入时 PlayerBar 不显示，其职责由舞台的控件接管（见 2.4 的接手规则）。

### 1.5 歌词模式

- 封面片缩小并滑到左侧（`--cx:24%`、`--cw:min(34vh,24vw)`），光晕跟随；刻线隐藏。
- 右侧歌词列最大宽 720px。当前行 Archivo 800、clamp 28–54px，带一圈主色文字辉光（静态 `text-shadow`）；前后行逐级缩小。
- 层级（不透明度下限已按 4.5:1 校正，实施时用对比度工具复核）：

| 距离 | 字号 | 字重 | 不透明度 |
|---|---|---|---|
| d0 当前 | 28–54px | 800 | 1 |
| d1 | 26px | 500 | .85 |
| d2 | 20px | 400 | .65 |
| d3 及更远 | 16px | 400 | .50 |

- 翻译行：字号为主行 .5 倍、字重 300、`--lw-mute`，仅 d0/d1 显示。
- 状态（对应现有 `lyricStatus`）：加载中（歌词区灰色占位条，不转圈）、无歌词、纯音乐、加载失败（带重试，仅当现有逻辑提供重试入口）。四种状态各占一个整块空状态，沿用大号宽体字 + 一行说明。
- **手动滚动暂停跟随**沿用现有 5 秒恢复；暂停期间在歌词区右下角显示“回到当前行”按钮，点击立即恢复跟随（需要 `LyricPanel` 内部增加一个立即恢复的回调，属于其自身的小改动）。
- 点击歌词行 seek、可聚焦区域、滚轮/触摸/指针/滚动键暂停跟随、卸载清理，全部保留。

### 1.6 播放队列抽屉

- 右侧抽屉，宽 `min(400px, 92vw)`，带轻遮罩，保持 `role="dialog" aria-modal`，点击遮罩关闭。
- **队列属于浏览平台**：抽屉头部写“{浏览平台}队列，N 首，接下来 M 首”。若 `song.provider ≠ activeProvider`，头部下加一行提示：“正在播放的歌曲来自 {来源平台}，这里显示的是 {浏览平台} 的队列。”
- 当前项主色竖线 + 打开时滚入视野（沿用 `main.jsx:87` 的行为）。
- 逐项移除、清空（二次确认，沿用 `confirmClear`）。**切歌在途**时编辑控件 `aria-disabled` 并显示原因；**私人 FM** 队列显示“私人 FM 队列不可编辑”，隐藏移除与清空，不是置灰了事。
- 队列全部渲染（不受 100/200 限制）。长队列用 CSS `content-visibility: auto` + `contain-intrinsic-size` 做渲染裁剪，**不引入虚拟列表库**。

### 1.7 搜索与歌单浏览

- 搜索入口只在顶栏，保持“条件显示”，提交与 ref 不变，`Ctrl+L` 聚焦不变。
- 搜索结果、歌单详情、推荐、FM、最近播放**共用同一表格区域**，只换 ListHeader 的标题与元信息：
  - 本地最近播放必须保留“本地记录”的明确标注，不写成云端历史；清空确认保留。
  - 空状态：搜索无结果写“没有找到‘xx’。换个关键词，或切换浏览平台再搜。”
- 切换浏览平台不停止音频；表格与 SideNav 立刻换成对方工作区的数据，PlayerBar / NowCard 保持当前实际播放的歌曲，并用 SourceTag 标出来源。

### 1.8 弹窗、错误与空状态

- **Dialog 外壳**统一：遮罩、标题（Archivo 宽体 34px）、正文、按钮区（幽灵按钮 + 一个主操作）。网易二维码、QQ 授权提示、清空确认、本地记录清空确认共用，**取消 / 关闭 / Esc 仍触发各自原有的账号操作与请求失效**，只换外壳，不丢回调。
- **InlineNotice**：左侧 3px 色条（`--lw-err` / `--lw-ok`），一行说明发生了什么 + 怎么办；不道歉，不模糊。用于：登录失败、列表加载失败（带重试）、FM 取曲失败、播放失败后已回滚。
- 本规范第一期**不新增全局 Toast**，沿用现有 message 位置，见 D7。
- 文案规则：保留现有后端/状态返回的文案，视觉层只负责承载；新增文案用“现状 + 下一步”，例如“歌曲无法播放，已回到上一首。”

### 1.9 窄窗口

见第 7 节。主窗口最小 850×600，因此 680/560 两个断点在默认窗口下触不到，保留其现有意图用于浏览器预览与未来调整窗口约束。

---

## 2. 设计到真实前端结构的映射

不假设尚未拆分的组件已存在：目前真实声明的 React 组件只有 `App`、`PlaybackProgress`、`LyricPanel`。下表的“建议组件”都是拆分方案。

### 2.1 现有 JSX 区域 → 视觉组件

| 现有位置 | 对应视觉 | 处理方式 |
|---|---|---|
| `.app`、`.topbar`（main.jsx:90–91） | 壳层、AppHeader | **拆分**为 `AppHeader`（展示）；`.app` 保留在 `App`，加 `data-skin="lumen"` 与 `data-view` |
| `.library-bar`/`.lists`（:92） | SideNav 的“我的歌单” | **拆分**为 `LibraryBar`，数据与 `openList` 以 props 传入 |
| `.recommend-nav`（:93） | SideNav 的“推荐入口” | **拆分**为 `RecommendationNav`；仅已登录网易时显示的条件不变 |
| `.content`/`.table`/`.empty`（:94–95） | ListHeader + 歌曲表格 + 空状态 | **拆分**为 `SongList`、`EmptyState`；保留 key、选中/双击/Enter、100/200 限制、分页 |
| `.now-panel`（:93） | NowCard（曲库 L 档） | **拆分**为 `NowPlayingPanel`，只读 `song`、`lyrics`、`lyricIndex`、`lyricStatus` |
| `footer`（:96） | PlayerBar | **拆分**为 `PlayerBar`；命令回调与 `scheduleSave` 调用点保持不变 |
| `PlaybackProgress`（:17） | 进度条（bar 与 stage 两种变体） | **保留组件**，加 `variant` 和玻璃游标样式；见 2.4 |
| `LyricPanel`（:24，`showLyrics` 条件挂载 :99） | 舞台歌词列 | **保留组件与逻辑**，只改样式，加“回到当前行”；挂载位置由浮层移入 Stage |
| `.queue-dialog`（:98） | QueueDrawer | **拆分**为 `QueueDialog`（外壳改抽屉形态），props 传当前浏览队列与回调 |
| QQ 授权提示（:100）、二维码（:101）、清空确认（:95） | Dialog 外壳 | **拆分**为 `LoginDialogs` + 共用 `Dialog` 外壳，回调原样传入 |
| `<audio>`（:97） | 无视觉 | **不动**，位置与事件集合不变 |

### 2.2 必须保留在 App 中的状态与回调（第一至第五期不迁移）

`activeProvider`/`activeRef`、`workspaces`/`workRef`/`update`、`song`/`songRef`、`playing`、`buffering`、`audio`、`pendingPlay`、`rollbackRef`、`mode`、`volume`、`muted`、`settings`、`providerSettings`、`saved`/`qqSaved`/`bootProvider`、`fm`、全部请求代次（`latestRequest()`）、`lyrics`/`lyricsRef`/`lyricIndex`/`lyricStatus`、`selectedTrack`、`showQueue`、`confirmClear`、`showLyrics`、`qr`、`qqWebOpen`、`recent`/`confirmRecent`、`listening`/`reportAllowed`。命令函数：`play`、`switchProvider`、`openList`、`search`、`recommend`、FM 系列、队列编辑、登录/扫码/退出、`scheduleSave`、`syncLyric`、`parseLrc`。Media Session 绑定、`pagehide` 冲刷、`qq-auth-cleanup-failed` 订阅、二维码轮询、快捷键 effect 全部原位。

注意：`qqPlaylist`、`qqTrackPage`、`qqHasMore` 名称偏 QQ，但当前对两个平台都使用，**不要按名称删除**。

### 2.3 需要新增的纯展示组件（无业务状态、无 IPC、无网络）

| 组件 | 职责 | 接口（只读数据 + 回调） |
|---|---|---|
| `CoverStage` | 舞台构图：封面、光晕层、刻线、镜片、歌名信息 | `song`、`playing`、`buffering`、`mode`、`onTogglePlay` 等 |
| `CoverSlab` | 封面片：圆锥渐变占位 / 真封面图 + 高光 + 颗粒 + 红青边缘位移 | `src?`、`alt` |
| `BloomLayer` | 两层静态径向光晕（`--cx/--cy/--cw` 定位） | 无 props，读 CSS 变量 |
| `Rings` | 三圈同心刻线（静态内联 SVG） | `visible` |
| `PlayLens` | 玻璃播放镜片 + 点阵图标 + 光环 | `playing`、`buffering`、`disabled`、`onClick`、`size` |
| `DotIcon` | 点阵播放/暂停图标（SVG + CSS，见 5.2） | `state: "play"\|"pause"` |
| `SourceTag` | 来源标签（网易云 / QQ 音乐），与浏览平台不同时更醒目 | `provider`、`browsing` |
| `LyricStage` | 歌词列的外框、状态空页、回到当前行按钮 | 包装现有 `LyricPanel` |
| `InlineNotice` | 左色条提示 | `tone`、`children`、`action?` |
| `Dialog` / `Drawer` | 遮罩与外壳、焦点管理 | `open`、`onClose`、`labelledBy` |
| `LiquidNav`（可延后） | 顶部导航液态指示 | 导航项、当前项、`onSelect` |

### 2.4 UI 专属新状态与接手规则

- 新增仅 UI 状态：`view`（`library` / `stage`）。歌词模式直接复用现有 `showLyrics`，只在 `view="stage"` 时有意义。可放在 `App` 内，也可放在一个只含 UI 状态的小 hook，**不得挂载任何业务状态**。
- **主色** `useAccent(song)`：纯函数式 hook，输入封面 URL + 歌曲稳定标识，输出 `{a, on}`，用 effect 写到 `document.documentElement` 的 CSS 变量，**不进 React state**，避免每次换歌重渲染整个 App。主色永远取自**实际播放的歌曲**，不取浏览平台。
- **进度条接手**：舞台打开时 PlayerBar 隐藏（卸载 `PlaybackProgress` 的 bar 变体，挂载 stage 变体）。`PlaybackProgress` 必须在**挂载时从 audio 当前状态读取** `currentTime` / `duration` 初始化，不能只等下一次事件，否则切视图会出现进度空白。事件监听的绑定与清理保持现有写法。
- 同一时刻只有一个镜片挂载：曲库的镜片在 PlayerBar，舞台的镜片在 CoverStage。

---

## 3. 规范冲突修订表

下表是《视觉设计系统 v0.1/0.2》与现有架构冲突之处的**最终裁决**，以本表为准。

| # | v0.x 文档或原型中的描述 | 冲突 | 修订 |
|---|---|---|---|
| 1 | “进度由 Rust 侧事件推送，前端不自己跑定时器” | 实际进度来自 audio 媒体事件 | 进度只来自 `PlaybackProgress` 订阅的 audio 事件；原型里的 1 秒 `setInterval` 不得带入工程 |
| 2 | 键盘：空格播放、←/→ 快进 5 秒、`/` 搜索、Q 队列、Esc 关抽屉 | 与现有 Ctrl+L、Space、Ctrl+←/→、Ctrl+↑/↓ 及 Esc 顺序不一致 | 现有快捷键原样保留；进度条用原生 range 的方向键；新增键需确认（D4） |
| 3 | 顶栏“网易云 / QQ 音乐”像播放源开关 | 浏览平台 ≠ 播放来源，且切换不停播 | 文案改为“浏览”；播放来源用 SourceTag 单独标注 |
| 4 | 曲库 = 左侧抽屉 | 不满足高效浏览 | 曲库改为完整视图，宽窗口多 NowCard；抽屉只用于队列 |
| 5 | 响应式断点 820 | 窗口最小 850，且现有断点是 900/680/560 | 改用 L≥1280 / M 900–1279 / S 681–899；≤680 仅预览（见第 7 节） |
| 6 | 队列抽屉通用“清空队列”按钮 | FM 禁止普通编辑，切歌在途禁止编辑 | 见 1.6：FM 不显示编辑控件；在途 `aria-disabled` 并说明原因 |
| 7 | 队列默认当前播放平台 | 现有队列是**当前浏览平台**的队列 | 抽屉头部标注平台；来源不同时加提示行 |
| 8 | 点阵图标用 Canvas + rAF 绘制 | 不引入渲染循环；Canvas 非默认 | 改为内联 SVG + CSS transition（5.2），无 JS 循环 |
| 9 | 封面主色由 Rust 侧提取 | 视觉层不新增 IPC 与网络客户端 | 第三期用稳定哈希的策展色，第七期再评估真实取色（D3） |
| 10 | 自绘窗口控制 | 现有窗口由 Tauri 配置，最小 850×600，几何由 `window_state.rs` 保存 | 沿用系统标题栏（D1） |
| 11 | 四套配色运行时可切换 | 增加状态与测试面 | 工程只保留暖炭；其它三套仅作为附录实验，不进工程 |
| 12 | 歌词远端行 16% 不透明度 | 对比度不足 | 下限 .50，见 1.5 |
| 13 | 同心圆刻线全视图显示 | 抢歌词可读性 | 仅舞台封面模式显示 |
| 14 | 进度游标需自定义拖拽 | 现有为原生 range | 继续用原生 `<input type="range">`，只用 `::-webkit-slider-thumb` 改外观，保留键盘与无障碍 |
| 15 | 原型无 QQ 约束 | QQ 冻结、占位封面、点击即播语义 | 只换外观；占位封面走默认主色；不碰协议、登录、授权、诊断 |

---

## 4. 设计 Token

所有新样式放在命名空间 `.app[data-skin="lumen"]` 下，类名前缀 `lw-`，避免与现有 `style.css` 的多层覆盖互相污染。

```css
@property --lw-a  { syntax:'<color>';      inherits:true; initial-value:#B08968; }
@property --lw-cx { syntax:'<percentage>'; inherits:true; initial-value:50%; }
@property --lw-cy { syntax:'<percentage>'; inherits:true; initial-value:42%; }
@property --lw-cw { syntax:'<length>';     inherits:true; initial-value:360px; }

.app[data-skin="lumen"]{
  /* 颜色（单一暗色主题：暖炭） */
  --lw-bg:#120D0B; --lw-ink:#F2E9E2; --lw-mute:#9A8F88;
  --lw-line:rgba(242,233,226,.16);
  --lw-hover:rgba(242,233,226,.06); --lw-selected:rgba(242,233,226,.10);
  --lw-surface:color-mix(in srgb,var(--lw-bg) 94%,transparent);
  --lw-err:#E5484D; --lw-ok:#3DAA6D; --lw-focus:var(--lw-ink);
  --lw-on:#101214;                       /* 主色底上的文字，由 useAccent 覆盖 */

  /* 字体 */
  --lw-f-display:'Archivo','Microsoft YaHei UI',sans-serif;
  --lw-f-body:'Microsoft YaHei UI','Segoe UI',sans-serif;
  --lw-f-mono:'IBM Plex Mono',ui-monospace,Consolas,monospace;

  /* 间距（4px 基准） */
  --lw-s1:4px; --lw-s2:8px; --lw-s3:12px; --lw-s4:16px; --lw-s5:22px; --lw-s6:36px;

  /* 圆角：表示“这是什么” */
  --lw-r0:0; --lw-r1:2px; --lw-r2:3px; --lw-r3:4px; --lw-r-round:50%;

  /* 动效 */
  --lw-ease:cubic-bezier(.2,.7,.1,1);
  --lw-spring:cubic-bezier(.3,1.5,.5,1);
  --lw-spring-soft:cubic-bezier(.3,1.2,.5,1);
  --lw-d-press:80ms; --lw-d-fast:160ms; --lw-d-panel:350ms; --lw-d-cover:500ms; --lw-d-stage:800ms;

  /* 层级 */
  --lw-z-bar:3; --lw-z-drawer:20; --lw-z-dialog:30;
}
```

### 4.1 字阶

| 层级 | 字体 / 字重 / 字宽 | 字号 | 行高 | 用途 |
|---|---|---|---|---|
| Display | Archivo 800 / 字宽 125% | clamp(30px, 4.6vw, 68px) | .98 | 舞台歌名 |
| Title | Archivo 800 / 125% | 34px | 1 | 抽屉、对话框标题 |
| List title | 系统 YaHei UI 500 | 14px | 1.4 | 表格歌名 |
| Body | 系统 YaHei UI 400 | 14px | 1.5 | 正文 |
| Meta | IBM Plex Mono 400 | 11–12px | 1.6 | 序号、时间、码率、来源 |
| Lyric d0–d3 | 见 1.5 | | | 歌词 |

字体打包：Archivo（可变，需含字宽轴 62–125，`font-stretch: 62% 125%`）与 IBM Plex Mono 作为本地 woff2 随应用打包（桌面应用不得依赖 Google Fonts）；中文使用系统微软雅黑 UI，Windows 无 800 字重，实际落在 Bold，可接受。是否打包 Noto Sans SC 子集见 D2。

### 4.2 主色规则

- 主色 `--lw-a` 来自实际播放歌曲的封面。**只用作填充、标记、光晕、描边，不用作文字色。**
- 钳制（OKLCH）：L 0.62–0.78，C 0.08–0.20；C < 0.04（黑白封面）改用 `--lw-ink` 的 70% 作为主色并关闭彩色光晕。
- `--lw-on`：按相对亮度取 `#101214` 或 `#FFFFFF`，保证主色块上文字 ≥ 4.5:1。
- 无封面或 QQ 占位封面：默认主色 `#B08968`（沙色，光晕强度减半）。
- 第三期的临时方案：由歌曲稳定标识哈希选取 8 个策展主色之一（青 #00A88F、琥珀 #E3A400、玫红 #D6336C、蓝 #3D5AFE、橄榄 #6F8A1F、橙 #E8590C、沙 #B08968、灰绿 #5E8C7E），同一歌曲永远得到同一颜色。
- `--lw-a` 过渡：根节点 `transition: --lw-a 800ms var(--lw-ease)`，换歌时光晕、光环、竖线同步平滑变色。

### 4.3 材质层级

| 层 | 内容 | 实现 |
|---|---|---|
| L0 | 底色 | 纯色 `--lw-bg` |
| L1 | 环境光 | 两层静态 radial-gradient，圆心跟封面；仅 opacity / scale 过渡 |
| L2 | 抽屉、对话框 | `--lw-surface`（94% 不透明），**不使用 blur** |
| L3 | 封面片 | 圆锥渐变（或真封面）+ 高光 + SVG 颗粒贴图 + ±1px 红青边缘位移 |
| L4 | 播放镜片 | `backdrop-filter: blur(12px) saturate(1.7)`，**全应用同一时刻最多一个** |

---

## 5. 实现边界

### 5.1 总表

| 效果 | 实现 | 事件驱动？ |
|---|---|---|
| 暖炭配色、表格、行状态、抽屉、对话框 | CSS | 是 |
| 环境光晕 | CSS 静态渐变，opacity/scale 过渡 | 是（播放/暂停/切歌） |
| 同心刻线 | 静态内联 SVG | 是（视图切换时淡入淡出） |
| 封面片的高光、颗粒 | CSS + SVG 数据 URI 贴图 | 静态 |
| 镜片玻璃、内发光、光环弧 | CSS（渐变、`inset box-shadow`、conic mask） | 是（hover / press / 播放态旋转 180°） |
| 点阵播放/暂停图标 | **内联 SVG + CSS transition**（见 5.2） | 是（420ms 内） |
| 玻璃进度游标 | 原生 range + `::-webkit-slider-thumb` 样式；进度比例用 CSS 变量 | 是（audio 事件） |
| 歌词当前行辉光、层级 | CSS（`text-shadow`、字号过渡） | 是（行变化） |
| 视图切换：封面/光晕位置 | CSS 自定义属性（`@property`）过渡 | 是 |
| 液态导航（可延后） | SVG goo 滤镜 + Web Animations（560ms） | 是（点击后） |
| 封面真实取色（延后） | 切歌时一次性离屏处理 | 是（切歌） |

### 5.2 点阵图标（取代原型的 Canvas）

13×13 网格，只渲染属于“播放集合 ∪ 暂停集合”的点与少量随机火花点（总数不超过 90 个 `<rect>`）。每个点预先算好：目标透明度（播放态/暂停态各一个）、延迟（0–250ms）、散开偏移（≤2 格）、写成内联 CSS 变量。切换只需改父节点的 `data-state`，由 CSS `transition: opacity, transform` 完成，**无 JS 逐帧绘制**。`prefers-reduced-motion` 下直接切换。

### 5.3 轻量 JS 的范围

允许：一次性事件处理（切歌取色、导航液滴 WAAPI、歌词 `scrollIntoView`）、audio 事件已有的状态更新。
禁止：`requestAnimationFrame` 常驻循环、常驻 `setInterval`、Canvas/WebGL、Web Audio 分析器（见 5.5）。

### 5.4 性能风险

| 效果 | 风险 | 约束 |
|---|---|---|
| `backdrop-filter` | 重绘成本高 | 全应用只在播放镜片上用；列表区禁用 |
| 全屏 radial-gradient + `@property` 过渡 | 切歌时大面积重绘 | 仅切歌/切视图的 800ms 内过渡；稳态零动画；需真机实测 |
| 歌词字号过渡 | 触发重排 | 只对 d0–d3 范围内的行加过渡；远行静态；整列加 `contain: layout` |
| `filter: drop-shadow`（光环） | 成本随面积 | 仅镜片尺寸，静态 |
| goo 滤镜 | 滤镜面积 | 只套在导航约 300×40px 小图层，不套全屏 |
| 队列全量渲染 | 长列表节点多 | `content-visibility: auto`；不用虚拟列表库 |
| `timeupdate` 重渲染 | 整个曲库重渲染 | 进度状态留在 `PlaybackProgress` 内部；只有 `lyricIndex` 变化才更新 App 状态（沿用现有） |

### 5.5 延后（不进 v1）

声音响应、轻量频谱、局部流体运动。若将来要做，需要从唯一 audio 接 Web Audio 分析器，涉及媒体跨域头与 `crossorigin` 属性，会影响现有播放，必须单独立项评估。

---

## 6. 组件状态与交互规范

### 6.1 PlayLens

| 状态 | 表现 |
|---|---|
| 暂停 | 玻璃面 + 白色点阵“播放”；光环弧停在 110° |
| 播放 | 点阵“暂停”；光环转到 290°（800ms） |
| 悬停 | scale 1.04（600ms，`--lw-spring`） |
| 按下 | scale .955（120ms），松开回弹 |
| 缓冲 / 切歌在途 | 外侧 1.5px 虚线环旋转，仅在 `buffering` 或 `pendingPlay` 期间运行；点击仍可暂停/恢复，沿用现有行为 |
| 无歌曲 | 禁用：`aria-disabled`，opacity .35 |
| 播放失败 | 状态回到现有回滚结果；由 InlineNotice 说明，镜片不单独闪错误色 |
| 焦点 | 2px `--lw-focus` 外环，offset 3px |

尺寸：舞台 `max(64px, 封面宽 × 0.27)`；PlayerBar 52px。

### 6.2 PlaybackProgress

- 原生 `<input type="range">`，`aria-label="播放进度"`，`aria-valuetext` 为“1:32，共 4:12”。
- 外观：1px 刻度底线（舞台用刻度尺式 ticks）、主色已播放段（3px + 同色光）、玻璃游标 20px（舞台）/ 14px（PlayerBar）。
- 玻璃游标用渐变 + 内发光模拟，**不使用 backdrop-filter**。按下游标 scale .88（120ms），松开回弹。
- 已播放比例写入 `--lw-p`；游标位置的过渡只用 `linear 250ms`，覆盖 `timeupdate` 约 4 Hz 的跳变，拖动时关闭过渡。
- 时间：Plex Mono，左“当前”，右“−剩余”。`duration` 不可用时进度禁用，显示“--:--”。
- 保留：`timeupdate`、`seeked`、`loadedmetadata`、`durationchange`、`emptied` 监听，拖动与拖动结束回调，卸载清理。

### 6.3 SongList 行

| 状态 | 表现 |
|---|---|
| 默认 | 下分隔线 `--lw-line` |
| 悬停 | `--lw-hover` 底；序号位显示 ▶ |
| 选中（网易单击） | `--lw-selected` 底 + 左 2px 墨色线 |
| 当前（播放中） | 左 4px 主色线 + 缩略封面同色光晕 + 序号位播放标记 |
| 当前（暂停 / 缓冲） | 同上，标记换成暂停 / 加载标记 |
| 键盘焦点 | 2px 外环，不依赖颜色 |

行为不变：网易单击选中、双击或 Enter 播放；QQ 单击播放。右键或额外按钮不在本期范围。

### 6.4 PlayerBar

- 左：36px 缩略封面 + 歌名 + 歌手 + SourceTag；点击进入舞台。
- 中：上一首、镜片、下一首；下方为 PlaybackProgress（bar 变体）。
- 右：模式（顺序/随机/单曲，文字按钮，状态用小点标记）、音量（原生 range，1px 线）、歌词入口、队列入口、本地上报偏好开关。
- 浏览平台 ≠ 播放来源时，SourceTag 变为描边强调并带“来源”二字。

### 6.5 CoverStage / 歌词模式过渡

`view` 或 `showLyrics` 变化时，只改 `data-v` 属性，由 `--lw-cx/--lw-cy/--lw-cw` 的 CSS 过渡（800ms，`--lw-ease`）带动封面、光晕、刻线、镜片同时移动。信息块与竖排元信息在歌词模式下淡出（500ms）。

### 6.6 QueueDrawer

滑入 350ms；打开时焦点移入抽屉首个可聚焦元素，关闭后还给触发按钮；遮罩点击与 Esc 关闭；Tab 不离开抽屉。当前项滚入视野沿用现有 effect。

### 6.7 Dialog

| 状态 | 表现 |
|---|---|
| 打开 | 焦点移到标题或首个控件；Tab 循环 |
| 二维码 | 沿用现有的加载 / 过期 / 失败 / 扫描中状态；取消触发现有账号操作 |
| 清空确认 | 主操作为危险色文字（`--lw-err` 填充会过抢，只用描边）；默认焦点在“取消” |
| Esc | 严格按第 8 节顺序 |

### 6.8 LiquidNav（可延后）

选中块为墨色 8px 圆角块，切换时拉长覆盖新旧两项再收拢（560ms，`--lw-spring-soft`），并甩出一颗小液滴；文字用 `mix-blend-mode: difference`，要求顶栏有不透明底。`prefers-reduced-motion` 时直接跳到位置。第一版导航用静态下划点标记，等第七期再换液滴。

### 6.9 InlineNotice / SourceTag

InlineNotice：3px 色条 + 一行文字 + 可选动作（重试）；`role="status"`，错误用 `role="alert"`。
SourceTag：Plex Mono 11px，如“网易云”“QQ 音乐”；与浏览平台一致时为静音色，不同时为墨色描边。

---

## 7. 响应式

窗口配置：初始 1280×820，最小 850×600。

| 档位 | 宽度 | 曲库 | 舞台 |
|---|---|---|---|
| L | ≥1280 | 左栏 248px + 表格 + NowCard 320px；内容区最大宽 1480px，居中 | 封面最大 560px；歌词列最大 720px；竖排元信息显示 |
| M | 900–1279 | 左栏 220px + 表格；隐藏 NowCard，PlayerBar 承载信息 | 竖排元信息隐藏 |
| S | 681–899 | 左栏收为 64px 图标栏（点击展开覆盖层）；表格隐藏“专辑”列（沿用 900px 规则） | 封面缩到 `min(38vh, 34vw)` |
| XS | ≤680 | 仅预览：单列，左栏变顶部横向滚动条；PlayerBar 两行 | 封面居中缩小；歌词模式封面缩到顶部小图，歌词占下方约 70% |

高度档：`height < 700` 时，行高 44px，舞台刻线外圈与竖排元信息隐藏，歌名 clamp 上限降为 52px；`height < 640` 时 PlayerBar 压到 60px。

高 DPI：封面与颗粒贴图提供 2× 资源；1px 线在 125%/150% 缩放下用 `max(1px, 1dppx)` 保证不发虚；DPI 100/125/150% 都要截图复核。

---

## 8. 键盘与可访问性

### 8.1 现有快捷键（原样保留，不改顺序）

| 键 | 行为 |
|---|---|
| Esc | 依次：队列清空确认 → 队列 → 二维码 → QQ 授权 → 歌词 |
| Ctrl+L | 聚焦当前搜索输入（判断在编辑区域保护之前） |
| Space | 非编辑区域切换播放/暂停；队列/扫码/QQ 授权/歌词面板打开时直接返回 |
| Ctrl+←/→ | 上一首 / 下一首 |
| Ctrl+↑/↓ | 音量 |

### 8.2 新增 UI 的键盘规则

- **Esc 末尾追加**：…→ 歌词模式回到封面模式 → 舞台回到曲库。
- 导航三项为普通按钮，`aria-current="page"` 标当前项。
- 舞台歌词：当前行 `aria-current="true"`；歌词区保持现有可聚焦与滚动键行为。
- 进度条使用原生 range 的方向键，不另绑全局 ←/→。
- 新增快捷键（`/`、`Q`、`L`）默认**不实现**，待确认（D4）。若实现：仅在非编辑区域、无弹层打开、无修饰键时触发，并写入同一个 keydown effect 的末尾，不改变已有分支顺序。
- Space 在歌词模式下的行为：v1 保持现有（直接返回，不切换播放）；是否放宽见 D6。

### 8.3 无障碍要求

- 正文与背景对比 ≥ 4.5:1；主色不用作文字；歌词远行不低于 .50 不透明度（约 4.9:1，实施时核对）。
- 所有按钮有可见焦点环（2px，不靠颜色区分）；`:focus-visible`。
- 镜片 `aria-label` 随状态切换（“播放”/“暂停”）；装饰 SVG（刻线、点阵、光晕）`aria-hidden="true"`；封面 `role="img"` 带歌曲名。
- 抽屉与对话框：`role="dialog"`、`aria-modal`、`aria-labelledby`，焦点陷阱，关闭后还焦点。
- 错误用 `role="alert"`，加载与成功用 `role="status"`。
- `forced-colors: active`：光晕与玻璃降级为实线边框，主色竖线改用 `Highlight`。
- `prefers-reduced-motion: reduce`：所有 transition/animation 置无；点阵图标直接切换；歌词 `scrollIntoView` 用 `behavior: "auto"`；封面位置直接跳变；缓冲环改为静态虚线。

---

## 9. 性能预算

以下是**目标**，不是已测结果；每期验收时用 WebView2 的 DevTools Performance 面板实测并记录。

| 指标 | 目标 |
|---|---|
| 暂停空闲时 | 无任何定时器、动画、rAF；Performance 面板无周期性任务 |
| 播放稳态 | 只有 audio 事件触发的 `PlaybackProgress` 更新（约 4 Hz）和歌词行变化；曲库表格不因 `timeupdate` 重渲染 |
| 切歌（含取色） | 主线程单任务 < 50ms；光晕过渡 800ms 内无掉帧到 < 30 fps |
| 同屏 `backdrop-filter` | ≤ 1 个 |
| DOM | 点阵图标 ≤ 90 节点；表格行 ≤ 200；队列全部渲染但 `content-visibility: auto` |
| 滤镜与阴影 | 无全屏 filter；`drop-shadow` 仅镜片尺寸；goo 滤镜 ≤ 300×40px |
| 字体与图片资源 | Archivo + Plex Mono 子集 woff2 合计建议 < 400KB；封面贴图按 2× 提供，不预加载整个歌单封面 |
| 静态检查 | 代码库中 `requestAnimationFrame`、`setInterval`、`<canvas>`、`getContext` 新增出现次数为 0（取色的一次性离屏处理除外，且需注释说明） |

---

## 10. 分阶段实施

每期必须能**独立回归、独立回滚**。统一做法：新样式放在 `data-skin="lumen"` 命名空间下，旧 CSS 在第七期之前不删除；回滚 = 去掉该属性。每期结束运行附录 A 的行为回归清单。

| 期 | 目标 | 允许改动 | 禁止触碰 | 退出标准 |
|---|---|---|---|---|
| 0 | 基线与护栏 | 记录：3 个窗口尺寸 × 关键状态的截图基线；按真实级联确认 `style.css` 现有有效值；附录 A 清单实测一遍 | 任何源码 | 基线截图与回归清单结果入库 |
| 1 | Token + 字体 + 配色 | 新增 `lumen.css`（token、暖炭配色）；`.app` 加 `data-skin`；字体打包 | JSX 结构、业务逻辑 | 现有界面整体换成暖炭色，所有功能回归通过；可一键回退 |
| 2 | 纯展示组件拆分（零视觉变化） | 提取 `AppHeader`、`LibraryBar`、`RecommendationNav`、`SongList`、`EmptyState`、`NowPlayingPanel`、`PlayerBar`、`QueueDialog`、`LoginDialogs`，全部 props 化；保持事件顺序与 key | 状态、`play`、audio、存储、Media Session 不动 | 像素级与基线一致；回归清单全过；`App` 行数下降但状态位置不变 |
| 3 | 曲库完整模式 + PlayerBar + 镜片 | L/M/S 布局、SideNav、行状态、ListHeader、NowCard、SourceTag、PlayerBar 样式；`PlayLens` + SVG 点阵图标；`PlaybackProgress` 玻璃游标（range 样式）；哈希策展主色（临时） | 舞台、歌词、队列抽屉 | 曲库在三档窗口可用；选中/当前可区分；镜片唯一；播放/暂停/seek/键盘回归通过 |
| 4 | 舞台封面模式 | `view` 状态、`CoverStage`、`CoverSlab`、`BloomLayer`、`Rings`、导航静态版；`PlaybackProgress` stage 变体与接手规则；Esc 末尾追加 | 歌词逻辑、队列 | 进出舞台进度不空白；唯一 audio 未重建（用现有媒体事件日志确认）；暂停时无动画 |
| 5 | 歌词模式 | `LyricStage` 外框、层级样式、四种状态页、“回到当前行” | `parseLrc`、`syncLyric`、5 秒跟随逻辑 | 点击 seek、手动滚动暂停、卸载清理全过；对比度达标 |
| 6 | 队列抽屉、对话框、错误与空状态 | `QueueDialog` 抽屉化、`Dialog`/`Drawer` 外壳、`InlineNotice`；焦点管理；窄窗口（S/XS）完整走查 | 队列编辑规则、FM 保护、账号代次 | FM 不可编辑、切歌在途禁用、Esc 顺序、二维码取消、清空确认全过 |
| 7 | 收尾与可选效果 | 液态导航（可选）、真实封面取色（评估通过后）、reduced-motion / forced-colors 全走查、性能实测、清理旧 CSS | 业务状态机 | 第 11 节全部通过；旧 CSS 删除后基线无回归 |

不在这七期内：把控制逻辑抽成 hooks / controller（账号、播放器与队列、FM、持久化）——必须等视觉稳定后另行立项，一次只迁一块。

---

## 11. 视觉验收标准

### 11.1 截图矩阵

窗口：850×600、1280×820、1920×1080；DPI：100%、125%、150%。每组至少覆盖：曲库（网易 / QQ）、舞台封面、舞台歌词、队列抽屉、二维码对话框。

### 11.2 状态矩阵（每项有截图或记录）

未登录 · 加载中 · 搜索无结果 · 歌单为空 · 列表加载失败（含重试）· 分页 · 长歌名 / 长歌手 · 无封面 / QQ 占位封面 · 黑白封面 · 黄/橙封面 · 缓冲 · 切歌在途 · 播放失败已回滚 · 私人 FM 队列 · 浏览平台 ≠ 播放来源 · 本地最近播放 · 无歌词 · 纯音乐 · 歌词加载失败 · 手动滚动暂停跟随 · 队列为空 · 队列很长。

### 11.3 规则检查

- 无硬编码颜色：新样式文件中的颜色值只出现在 token 定义里。
- 圆角只出现 token 里的五种；圆形只用于镜片与小圆点。
- 同屏 `backdrop-filter` ≤ 1。
- 主色不作为文字色。
- 静态检查：无新增 rAF / `setInterval` / Canvas。
- 暂停空闲 10 秒的 Performance 记录：无周期性任务。
- 键盘：不用鼠标走完“搜索 → 选歌 → 播放 → 打开队列 → 关闭 → 进入舞台 → 歌词模式 → 返回”；焦点环始终可见。
- 屏幕阅读器抽检：镜片、进度、导航当前项、抽屉标题读出正确。
- 现有快捷键逐项复测（8.1 表）。
- 行为回归清单（附录 A）全部通过。

### 11.4 设计一致性

三个评审问题，必须能回答“是”：封面是否是画面里最亮、最有分量的东西？一屏之内是否只有一处玻璃？删掉任何一个装饰元素，信息是否仍然完整（如果是，说明它该被删）？

---

## 12. 需要你确认的设计决策

| # | 决策 | 我的建议 |
|---|---|---|
| D1 | 窗口标题栏：沿用系统，还是自绘并改 Tauri 窗口配置 | 沿用系统。自绘会牵动 `tauri.conf.json`、窗口状态保存和拖拽区域，收益低 |
| D2 | 中文字体：系统微软雅黑 UI，还是打包 Noto Sans SC 子集 | v1 用系统字体；子集会增加数 MB 体积，待视觉稳定后再评估 |
| D3 | 封面取色：前端一次性离屏取色（可能受跨域限制）/ 新增 Rust 命令 / 长期用哈希策展色 | 先用哈希策展色上线；同时验证封面图域名是否带 CORS 头，再决定是否需要 Rust 命令（会触及后端，需你批准） |
| D4 | 是否新增快捷键 `/`（搜索）、`Q`（队列）、`L`（歌词） | 暂不实现；若实现，仅作为增量 |
| D5 | 顶部导航“歌词”是否独立成第三项 | 保留三项，意图最清楚；如果你觉得拥挤，可并入舞台内切换 |
| D6 | 歌词模式下 Space 是否可播放/暂停（现有行为是直接返回） | v1 保持现有；若要放宽，条件为“焦点不在歌词滚动区”，这会改变现有行为，需你拍板 |
| D7 | 是否新增全局 Toast | 第一期不加，用 InlineNotice；确有需要时单独立项 |
| D8 | 液态导航是否进 v1 | 放到第七期，作为可选项，效果有风险（反色混合依赖不透明底） |
| D9 | 三圈刻线是否最终保留 | 暂时保留，仅舞台封面模式显示；真机看过后你定 |
| D10 | NowCard 的显示阈值：≥1280 还是 ≥1440 | ≥1280；窗口初始 1280 宽，用户一开始就能看到 |
| D11 | 点阵图标是否保留 | 保留（SVG + CSS，无循环）；若性能或清晰度不达标，退回普通 SVG 图标 |

---

## 附录 A · 行为回归清单（每期必跑）

1. 页面里始终只有一个 `<audio>`；切换浏览平台、进出舞台、开关队列/歌词后，audio 未被重建，音频不中断。
2. `switchProvider` 不暂停播放；切到另一平台后，PlayerBar 仍是实际播放歌曲并带正确 SourceTag。
3. 网易：单击选中、双击或 Enter 播放；QQ：单击播放。
4. 私人 FM：队列不可普通删除/清空；接近队尾继续续取；`onEnded` 等待在途续取。
5. 切歌在途：队列编辑禁用；播放失败后回滚到上一状态且有说明。
6. 队列清空二次确认；Esc 顺序：清空确认 → 队列 → 二维码 → QQ 授权 → 歌词 →（新增）舞台。
7. 二维码取消、QQ 授权关闭仍触发原有账号操作与请求失效。
8. Ctrl+L、Space、Ctrl+←/→、Ctrl+↑/↓ 行为不变；输入框内不触发普通播放快捷键。
9. Media Session 的播放/暂停/上下首可用，元数据随歌曲更新。
10. 歌词：当前行跟随；点击行 seek；滚轮/触摸/指针/滚动键暂停跟随 5 秒后恢复；卸载无残留定时器。
11. 进度条：拖动 seek；`seeked` 后歌词索引同步；视图切换后进度不空白。
12. 本地最近播放有“本地”标注，清空需确认；仅网易。
13. 网易歌单渲染 ≤ 100，FM 主列表 ≤ 200；头部如实标注。
14. 状态恢复：重启后保持暂停；`pagehide` 冲刷保存；3 秒节流不变。
15. QQ 工作区：登录、授权、诊断相关界面行为不变，本次只检查外观。

## 附录 B · 原型与本规范的差异（Codex 不要照搬原型代码）

| 原型 | 本规范 |
|---|---|
| `setInterval` 每秒推进进度 | 进度来自 audio 事件 |
| Canvas + rAF 点阵图标 | 内联 SVG + CSS transition |
| 自定义 pointer 拖拽的游标 | 原生 range + thumb 样式 |
| 曲库是左侧抽屉 | 曲库是完整视图 |
| 自绘窗口控制、四套配色切换 | 沿用系统标题栏；只保留暖炭 |
| ←/→ 快进、Q 队列、`/` 搜索 | 不覆盖现有快捷键 |
| 虚构的曲目与歌词 | 以真实 `song`、`lyrics` 数据为准 |

## 附录 C · 需要同步修订的 v0.2 文档章节

§4（响应式断点改为 L/M/S/XS）、§7（游标改原生 range；点阵图标改 SVG；液态导航标为可选）、§12（快捷键改为保留现有 + 增量）、§13（进度来自 audio 事件；取色待 D3）、§14（曲库由抽屉改为完整视图）、§15（下一步改为本规范的第 0–7 期）。
