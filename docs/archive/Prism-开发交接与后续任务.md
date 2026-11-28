# Prism 开发交接与后续任务

更新：2026-11-08。交接用途：让后续开发者以现有源码、用户授权和可验证结果为依据继续工作；不代表所有视觉和功能已完成。

## 1. 首要交接状态

- 主工程：`D:\codex\视频\music-desktop`。这是现有项目，不要重新初始化；当前目录不是 Git 仓库，不能假定可用 `git status`、worktree 或提交历史。修改前针对实际文件建立可回退快照，保留用户数据及已生成文件。
- 技术：Windows 11、Tauri 2 + React + Rust；程序名和 EXE 名均为 Prism。用户同时要求 Windows 10 或不支持相关 DWM 属性时能够降级运行。
- **源码与产物并不同步**：本次检查时 `src/main.jsx` 修改时间为 2026-11-08 22:03:53，晚于 `target-lumen-next\release\Prism.exe` 的 21:59:36。展示组件拆分仍需以当前源码完整回归和新构建确认；不得把旧 EXE 或更早测试报告当成当前源码已验证。
- 两个历史测试版（不是自动更新的最终交付）：`D:\codex\视频\music-desktop-workspaces-2.3-round7\target-lumen\release\Prism.exe` 与 `...\target-lumen-next\release\Prism.exe`，本次检查均为 13,609,984 字节。启动或构建前重新检查文件、进程及时间；禁止覆盖正在运行的 EXE。
- 视觉完整规范：`C:\Users\wdsjl\Downloads\Prism-Lumen-Well-视觉开发交接规范.md`。项目中的 `Prism-前端组件结构与视觉改造边界.md` 和 `docs\lumen-phase0\Prism-Lumen-视觉改造进展.md` 是辅助材料；进展文档为追加式记录，后续段落可能更新前文，应对照源码和日期阅读。
- 用户要求：**继续做当前授权范围内能做的工作，不要完成一个小板块就停下或反复索取人工验证**；但明确的授权关卡、账号安全和停止条件仍然有效。真实验收尽可能合并成一次，不要把模拟测试作为真实成功。

## 2. 当前等待用户确认：Windows 系统标题栏

用户将此任务明确分两步。第一步只读检查已完成，**第二步 A、B 尚未获单独确认；DWM 的 C 必须单独批准**。当前交接文档请求不等于批准实施。

### 第一阶段检查事实

- `src-tauri/tauri.conf.json`：主窗口 `title: Prism`，1280×820，最小 850×600；未显式配置 `decorations`、`visible`、`theme`、`backgroundColor`。本机 Tauri schema 表明 `decorations` 与 `visible` 默认 true，theme 默认跟随系统。
- `index.html` 无初始背景；`src/style.css` 中后续 `:root` 规则生效为 `#18191B`，body 无单独背景；React 挂载后的 Lumen `.app` 背景为 `#120D0B`。启动白闪是可能性，尚未经实机确认。
- `src-tauri/src/main.rs` 的 `setup` 调用 `window_state::install`；`src-tauri/src/window_state.rs` 启动时读取、校验并设置已保存位置、尺寸和最大化状态，关闭时保存；不负责显示窗口或调用 `show()`。
- `src-tauri/capabilities/default.json` 当前仅有 `core:default`。本机 Tauri ACL 清单显示 `core:window:default` 不含 `allow-set-title`；如果前端使用 Tauri `setTitle`，需在用户确认 A/B 后仅为主窗口按需增加 `core:window:allow-set-title`，并检验实际生效。

### 用户确认 A、B 后的实施范围

1. 配置主窗口 `theme: Dark`、`backgroundColor: #120D0B`；保留系统标题栏，绝不设置 `decorations: false`、Mica、Acrylic 或透明窗口。保留尺寸和 `window_state.rs` 几何保存/恢复语义。
2. `html`、`body` 使用 `#120D0B`；在 `index.html` 尽早提供背景以降低白闪机会，结合 `src/style.css` 的真实级联检查。不凭配置断言零白闪。
3. 用现有 `song` 状态更新原生窗口标题为“歌名 — 歌手”，无歌曲时为 `Prism`；不新增播放业务状态，不暴露密钥。明确验证 Tauri 权限与实际原生标题，不能仅看 DOM `document.title`。
4. 先保持默认可见；只有实际观察到仍白闪时再评估初始隐藏与首次渲染后显示。若实施，处理渲染失败、窗口永不出现、几何恢复及最大化先后顺序；前端 show 所需权限也必须核对并保持最小。
5. 验收：实际启动白闪、标题动态变化、最大化/还原/贴靠/拖动/缩放/关闭、窗口几何保存恢复，以及 100%/125%/150% 缩放截图；未实测的明确标注，不要伪造 Windows 10 兼容结果。

### 仅在另获用户批准后：C（DWM 精确着色）

- 方案：在 Windows 11 支持的版本上，通过 Rust 的 Windows DWM 属性设置标题栏背景 `#120D0B`、文字 `#F2E9E2`、边框 `#120D0B`；只作用于 Prism 主窗口，失败静默降级，不影响窗口创建和启动。
- 当前 `Cargo.toml` 的 Windows 目标已有 `windows = "0.62"`，预计需启用对应 Win32 DWM 等 feature；实际依赖、API、构建版本边界及安装环境须以代码和编译结果核实，不能提前宣称已验证。
- 深色 theme 不保证标题栏精确使用指定色值。DWM 调用必须先有独立批准；不以 A/B 的确认推定 C 已获授权。

## 3. 当前产品与工程约束

- 网易云与 QQ 是独立工作区：`activeProvider` 是浏览平台，当前歌曲的 `provider` 是播放来源；平台切换不停止当前歌曲，不合并曲库、歌单或账号。
- 唯一 `<audio>` 和现有播放队列；不得引入第二套播放引擎、常驻 Node、第二个常驻 WebView、常驻轮询或持续 rAF。播放进度由 audio 事件驱动。
- 网易私人 FM 独立队列，不得作为普通歌单删除或清空；接近队尾时按需续取，避免重复和无限重试。保持已验证的推荐、搜索、歌单、播放、歌词和状态恢复。
- Windows 凭据隔离：网易 keyring service `local.xianyu.music`、user `netease-session`（既有 Windows 凭据目标 `netease-session.local.xianyu.music`）；QQ service `xianyu.qqmusic`、user `session`。标识不得改名。Cookie、Token、密钥、完整播放地址不得写入前端 localStorage 或普通日志。
- QQ 本轮视觉及标题栏工作冻结业务协议、登录与授权 WebView；不触碰 QQ 相关代码。用户日后明确重新授权 QQ 工作时，仍不能绕过会员、版权、DRM、验证码或设备验证。
- 账号切换和异步请求须保留现有代次隔离、播放候选失败回滚。禁止把真实媒体 URL 持久化，禁止伪造听歌时间、自动上报或批量补报。
- 用户指定设计：暖炭 `#120D0B` 背景、`#F2E9E2` 文字；系统标题栏；Lumen Well；封面驱动视觉、一个玻璃镜片、有限事件驱动过渡、支持 reduced motion 和 forced colors。当前用策展色哈希，不能冒充真实封面取色。新增 Rust 取色须先由用户批准。

## 4. 现有实现与证据边界

- 当前源码已形成曲库/舞台/歌词视图、工作区来源提示、FM 保护、队列抽屉、单镜片、原生 range、封面与歌词显示、键盘交互、展示组件拆分的部分实现。实际组件、状态和事件以 `src/main.jsx`、`src/lumen.css`、`src/lyrics.js` 为准；不要假设交接规范中建议的组件已全部提取。
- `AppHeader`、`LibraryBar`、`RecommendationNav`、`SongList`、`EmptyState` 在当前源码可见；拆分完成度和最新源码的运行状态仍需重新验证。播放器、账号、FM、存储、Media Session 逻辑应保留原处，除非用户另行授权业务重构。
- 视觉进展与合成预览：`docs/lumen-phase0/Prism-Lumen-视觉改造进展.md`、`docs/lumen-phase0/current-preview/`。预览是模拟数据，不是 Windows 多 DPI 实测；完整规范的截图、可访问性和性能矩阵未完成。
- 用户此前反馈：网易 A11 实机播放、歌单翻页、本地最近播放、歌词点击和媒体键正常；此前也确认 FM 歌词/进度/续播/自动续取/切 QQ 后播放/队列独立正常。这些是历史版本、历史反馈，不代表当前源码及新视觉已做同等实测。
- 网易每日推荐及私人 FM 歌曲、网易/QQ 歌单封面此前被用户报告异常。现有代码做了图片地址受限 HTTPS 兼容、缺失/失败占位及 QQ 候选字段映射；真实账号图片能否加载尚未确认。当前 FM 队列仅会保存严格白名单内、无查询串的网易图片地址；以前已丢失的封面不能从旧本地状态找回。旧版可能因严格 schema 不能读取新版含封面 FM 快照，避免随意在版本间切换。
- QQ 实测：交互式登录、资料显示、重启恢复及歌单/曲目列表曾由用户确认；同一首官方客户端可完整播放的歌曲，Prism 普通 Vkey 最后返回 0/0/104003，未获得播放 URL。原因未知，不能宣称会员/版权不足或已修复；QQ 真正播放、歌词与播放跨平台持续均未通过。当前任务不排查 104003。详见 `Prism-B10-QQ播放协议验证.md`。
- 网易真实听歌记录尚未实号上报验证，QQ 听歌上报 unsupported；本地计时与候选不等于平台统计变化。真实上报必须先说明端点、数据和影响，获得本次单独授权。
- 历史性能采样与基线见 `Prism-A9-性能复测.md`、`Prism-P1-性能定向审计.md`；它们是历史短样本，不能外推为当前长时间性能结论。

## 5. 后续视觉任务

用户已说不必按期次停下来，但完整 Lumen 规范仍是目标。建议根据当前实现逐项推进，保持每项可回滚：

1. 先完成当前源码的自动化回归并定位组件拆分后潜在问题；维持原事件顺序、key、歌词跟随和唯一 audio。继续按规范把尚未提取的展示区域拆成 props 驱动组件，避免迁移业务状态。
2. 对照完整规范补齐歌词状态、翻译、抽屉/对话框焦点与返回、NowCard/舞台控件、列表选中和当前状态、850/900/1280 响应式、reduced motion/forced colors。当前小窗口为避免控件挤压采用两行 100px 播放栏，与规范中低高度 60px 目标存在偏差，须通过真实几何与可用性取舍，不能只靠缩小文字。
3. 限制歌曲列表渲染（网易当前页至多 100、FM 最近至多 200）、队列保留完整内容并使用 `content-visibility`；不加持续动画循环。不要为视觉改变歌词 seek、5 秒手动滚动恢复、FM 编辑保护、账号代次、快捷键顺序或 audio 位置。
4. 用合成数据及当前界面进行 850×600、1280×820、1920×1080 的状态截图；实际 Windows 100%/125%/150% DPI、屏幕阅读器和 DevTools Performance 应单独实测。现有 11 张预览不等于完整截图矩阵。
5. 原规范中 `max(1px, 1dppx)` 单位不兼容，基线环境的 `CSS.supports` 为 false；不要照搬成无效 CSS，需另行验证物理像素方案。
6. 原规范引用的 Claude Artifact 曾要求登录，未读取；不能宣称已经按原型截图逐像素验证，也不得复制其代码。用户提供的完整 Markdown 是当前可用的设计依据。

## 6. 验证与构建

命令在主工程运行：

```powershell
npm run test
$env:Path="$env:USERPROFILE\.cargo\bin;$env:Path"
cargo test --offline --manifest-path src-tauri/Cargo.toml
$env:CARGO_TARGET_DIR='D:\codex\视频\music-desktop-workspaces-2.3-round7\target-prism-handoff-next'
npm exec tauri build -- --no-bundle
```

- 在构建前确认当前进程和输出目录；设置独立 `CARGO_TARGET_DIR`，不覆盖正在运行的程序。不自动安装包或部署。
- 记录实际 Node 测试数量、集成脚本结果、Rust passed 与 ignored 数量、依赖变化、EXE 字节数；`--no-bundle` 不能证明安装包大小。上次报告 Rust 52 passed、5 ignored 是历史数据，并非当前源码的新结果。
- 自动化优先覆盖唯一 audio、进度恢复、切换平台继续播放、FM 不可编辑、切歌回滚、歌词/快捷键/弹窗、账号代次、状态恢复。截图与视觉对比以真实画面为依据，不把模拟测试当作联网或实机成功。
- 如需真实网易/QQ 请求、扫码、账号写入、收听上报或不同登录方式，先列出请求范围、发送数据和影响并取得本次明确同意。避免要求账号退出或清空数据；如确需退出，说明会清除本地凭据并先获同意。

## 7. 用户沟通与操作方式

- 全程简体中文，结论先行。用户已表示多轮人工验证很麻烦；自行完成可做的实现与自动化，集中一次给出必要的用户操作步骤。
- 当前任务受 `D:\codex\视频\AGENTS.md` 和 `D:\codex\视频\ui-motion-design.md` 约束；每次涉及 UI 时先按项目规则读取对应文件并应用合适技能。具体用户指令优先，尤其“分两步并等待确认”和 DWM 单独批准。
- 当前仅交付这份交接文档，不代表用户已允许标题栏第二步或新的真实账号测试。
