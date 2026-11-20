# Prism 前端组件结构与视觉改造边界

本文依据 `D:\codex\视频\music-desktop` 当前源码静态整理；`src/main.jsx` 当前为 104 行，但多数业务函数和 JSX 被压在很长的单行中。行号指该快照的位置。以下“建议组件”均为未来拆分方案，不表示源码中已经存在。未运行构建、测试或应用，也未以源码推断真实接口或系统媒体控制一定可用。

## 1. 入口与现有组件

`index.html` 提供根节点，`src/main.jsx:104` 通过 `createRoot(...).render(<App/>)` 挂载。当前前端没有独立路由或组件目录；主要画面和逻辑集中在 `App`。实际声明的 React 组件只有：

| 现有组件 | 源码 | 当前职责 |
|---|---|---|
| `App` | [src/main.jsx:32](src/main.jsx#L32) | 应用状态、平台浏览、账号和请求控制、播放、队列、FM、持久化、歌词同步、快捷键及大部分界面 JSX。 |
| `PlaybackProgress` | [src/main.jsx:17](src/main.jsx#L17) | 订阅同一个 audio 的进度与元数据事件，在自身维护秒级进度/时长，并把拖动和拖动结束交回上层。卸载时移除监听。 |
| `LyricPanel` | [src/main.jsx:24](src/main.jsx#L24) | 展示歌词、当前行、点击跳转和键盘可聚焦区域；滚轮、触摸、指针或滚动键操作后暂停自动跟随，5 秒后恢复，并在卸载时清除定时器。 |

其余如 `time`、`artist`、`album`、`qqLocalHandle` 是辅助函数，不是 React 组件。播放器下方的 `PlaybackProgress` 与浮层 `LyricPanel` 也仍由 `App` 创建并依赖其传入的状态与回调。

## 2. App 的主要状态与职责

| 状态/引用 | 位置 | 作用及改造注意点 |
|---|---|---|
| `activeProvider` / `activeRef` | [main.jsx:34](src/main.jsx#L34) | 选择当前浏览的 `netease` 或 `qqmusic`；后者让异步和事件读取最新平台。切换浏览平台本身不停止音频。 |
| `workspaces` / `workRef` / `update` | [main.jsx:33](src/main.jsx#L33) | 每个平台独立保存资料、歌单、搜索词与结果、浏览标题、消息、队列、分页、FM 视图等。`qqPlaylist`、`qqTrackPage`、`qqHasMore` 名称历史上偏 QQ，当前歌单分页 JSX 对两个平台都会使用，不要按名称误删网易状态。 |
| `song` / `songRef`、`playing`、`buffering` | [main.jsx:42](src/main.jsx#L42) | 当前播放歌曲、同步引用和音频状态。**没有名为 `playingProvider` 的独立 state**；当前播放来源由 `song.provider` / `songRef.current.provider` 表示，可能与浏览平台不同。 |
| `audio`、`pendingPlay`、`rollbackRef` | [main.jsx:47](src/main.jsx#L47) | 唯一 audio 的引用、正在进行的切歌及失败回滚快照。`play()` 会协调 URL、歌词、前后队列、账号代次和回滚；旧地址过期或异步竞争时恢复仍可能失败。 |
| `mode`、`volume`、`muted`、`settings`、`providerSettings` | [main.jsx:40](src/main.jsx#L40) | 供界面显示、单播放器控制及按平台保存设置。浏览平台改变时不等于自动改变实际播放来源。 |
| `saved` / `qqSaved` / `bootProvider` | [main.jsx:40](src/main.jsx#L40) | 网易普通/FM 队列及恢复位置、QQ 队列、最后来源、串行保存和 3 秒节流。恢复经平台与账号检查，启动保持暂停；关闭时 `pagehide` 尽力保存。 |
| `fm` | [main.jsx:46](src/main.jsx#L46) | 网易私人 FM 的账号、曲目、去重集合、未完成请求、错误和代次；它不是普通歌单队列的视觉别名。 |
| `account` / `identity` / `browse` / `playback` / `recommendation` / `qrRequest` | [main.jsx:48](src/main.jsx#L48) | 由 `latestRequest()` 创建的请求代次，保护账号切换、歌单/搜索切换、播放和推荐等异步结果；与 `clearAccountContent`、回滚一起构成隔离边界。 |
| `lyrics` / `lyricsRef` / `lyricIndex` / `lyricStatus` | [main.jsx:42](src/main.jsx#L42)、[main.jsx:50](src/main.jsx#L50) | 歌词数据、当前行及加载/空/纯音乐/错误状态；`syncLyric` 仅在当前行改变时更新 React 状态。 |
| `selectedTrack`、`showQueue`、`confirmClear`、`showLyrics`、`qr`、`qqWebOpen` | [main.jsx:34](src/main.jsx#L34)、[main.jsx:42](src/main.jsx#L42) | 列表选中及弹层显示状态。网易歌曲/队列单击选中、双击或 Enter 播放；QQ 当前 JSX 使用单击播放。 |
| `recent` / `confirmRecent` | [main.jsx:52](src/main.jsx#L52) | 本地最近播放的去重标记、串行写入和清空确认。仅网易，数据明确标注本地；不要改称平台云端历史。 |
| `listening` / `reportAllowed` / 诊断状态 | [main.jsx:39](src/main.jsx#L39)、[main.jsx:43](src/main.jsx#L43) | `ListeningTracker` 做本地真实播放观察；界面上报开关只是偏好，`providers.js` 的 `reportListening` 仍为 unsupported。QQ 诊断默认关闭，读取受限诊断快照。 |

主要命令函数分布：账号恢复、歌单读取在 [main.jsx:62](src/main.jsx#L62) 和 [main.jsx:63](src/main.jsx#L63)；搜索、最近播放、歌单和推荐在 [main.jsx:67](src/main.jsx#L67) 至 [main.jsx:72](src/main.jsx#L72)；FM 在 [main.jsx:73](src/main.jsx#L73) 至 [main.jsx:74](src/main.jsx#L74)；切歌/暂停/队列编辑在 [main.jsx:75](src/main.jsx#L75) 至 [main.jsx:78](src/main.jsx#L78)；登录、扫码和本机退出在 [main.jsx:79](src/main.jsx#L79) 至 [main.jsx:85](src/main.jsx#L85)。

## 3. 主窗口各视觉区域对应的真实 JSX

| 区域 | 实际实现 | 交互和数据来源 |
|---|---|---|
| 主窗口与顶部 | [main.jsx:90](src/main.jsx#L90) 至 [main.jsx:91](src/main.jsx#L91) 的 `.app`、`.topbar` | 品牌返回发现页、平台切换、条件显示的搜索框、账号刷新/登录/退出。窗口创建、初始 1280×820、最小 850×600 由 [tauri.conf.json:1](src-tauri/tauri.conf.json#L1) 配置；窗口几何保存见 [window_state.rs:17](src-tauri/src/window_state.rs#L17)。 |
| 我的歌单栏 | [main.jsx:92](src/main.jsx#L92) `.library-bar` / `.lists` | 当前工作区的 `lists`；网易可显示封面和创建/收藏标签，点击 `openList`。登录、加载与错误提示来自当前工作区状态。 |
| 推荐与本地最近播放 | [main.jsx:93](src/main.jsx#L93) `.recommend-nav` | 仅在已登录网易下显示私人 FM、本地最近播放、每日推荐等；本地记录来自 `netease_recent_*`，不是云端记录。 |
| 曲库、搜索结果与歌单详情 | [main.jsx:94](src/main.jsx#L94) 至 [main.jsx:95](src/main.jsx#L95) `.content` / `.table` / `.empty` | 共用同一列表区域呈现搜索、普通歌单、推荐、FM 与最近播放；有标题、歌单元数据、状态、重试和分页。网易歌单一次最多渲染 100 条，FM 主列表取最后 200 条；当前页形成当前队列，不自动跨页合并。 |
| 正在播放与预览歌词 | [main.jsx:93](src/main.jsx#L93) `.now-panel` | 当前歌曲封面、名称、状态、队列入口、诊断与当前歌词片段；`song` 来源可不同于 `activeProvider`。 |
| 底部播放栏 | [main.jsx:96](src/main.jsx#L96) `footer` | 当前歌曲、上一首/播放/下一首、`PlaybackProgress`、模式、音量、歌词入口与本地上报偏好；控件直接调用播放器命令和 `scheduleSave`。 |
| 歌词浮层 | [main.jsx:24](src/main.jsx#L24) 的 `LyricPanel`，由 [main.jsx:99](src/main.jsx#L99) 条件挂载 | 数据和当前索引仍来自 `App`；点击歌词的 seek 回调会修改唯一 audio 并同步歌词与保存状态。 |
| 播放队列弹层 | [main.jsx:98](src/main.jsx#L98) 内联 `.queue-dialog` | 展示**当前浏览平台**的队列、数量、当前项、选中项、清空确认与逐项移除；切歌在途禁止编辑，私人 FM 禁止普通删除/清空。当前 `.queue-list` 直接对 `ws.queue.tracks` 全部 `map`，不等同主歌曲列表的 100/200 条限制。 |
| 其他弹窗 | [main.jsx:100](src/main.jsx#L100) QQ 授权提示；[main.jsx:101](src/main.jsx#L101) 网易二维码；[main.jsx:95](src/main.jsx#L95) 本地记录清空确认 | 为 `App` 内联条件 JSX；取消/关闭可能触发实际账号操作，不能只替换外框而丢掉回调、请求失效和状态反馈。QQ 登录用的临时授权 WebView 由 Rust 管理，不是这些 JSX 自己创建的 React 组件。 |

## 4. 样式结构、层叠与响应式

`src/style.css` 是单文件全局 CSS，前几行包含大量压缩式规则，后续多次覆盖同一选择器；不能仅根据最早出现的定义判断最终样式。

- [style.css:1](src/style.css#L1)：根字体与颜色、按钮焦点、`.app` 网格、顶部、歌单栏、主内容/播放侧栏、歌曲行、空状态、底部播放栏、遮罩、弹窗和歌词面板的基础规则。`.app` 占满视口并用四行 Grid；`main` 内部滚动，`.workspace` 用双列 Grid；顶部/歌单/控制条主要使用 Flex。
- [style.css:6](src/style.css#L6) 至 [style.css:47](src/style.css#L47)：历史视觉精修和深中性色覆盖；后出现的 `.app`、标题、封面、歌曲行、footer、弹层等规则覆盖前面的值。判断最终结果必须按级联和媒体条件合并。
- [style.css:48](src/style.css#L48) 至 [style.css:61](src/style.css#L61)：空状态搜索、占位封面、平台切换、分页、推荐导航与推荐列表。推荐导航横向可滚动。
- [style.css:63](src/style.css#L63) 至 [style.css:74](src/style.css#L74)：桌面底栏约束、按钮、队列弹层、歌词行、歌单元信息、最近记录、封面缩略图、歌曲与队列选中样式。
- 响应式规则分布在基础行及 [style.css:45](src/style.css#L45) 等覆盖中：`max-width:900px` 收紧侧栏并隐藏部分歌曲列；`max-width:680px` 主要将工作区改为纵向并调整侧栏；`max-width:560px` 调整品牌、顶部与底栏。`min-width:681px` 对桌面 footer 使用另一套列宽。Tauri 主窗口目前配置 `minWidth:850`，因此 680/560 分支在默认桌面窗口约束下未必能由普通缩窗触及；高 DPI、浏览器预览或未来调整窗口约束时仍应重新核对。
- 有 `prefers-reduced-motion: reduce` 的全局过渡/动画时长覆盖；静态源码中这些规则不能证明实际帧率。没有从现有代码识别出独立的封面动态取色或流体渲染模块，不应假定已存在。

## 5. 视觉替换的耦合边界

| 区域 | 可独立替换的部分 | 必须保留或通过明确 props/回调接线的行为 |
|---|---|---|
| 品牌、标题、图标、分隔线、纯装饰 | 外观、文案排版与无状态容器相对容易替换。 | 品牌按钮仍有返回发现页及使旧浏览请求失效的行为；不要把可交互元素替换为不可聚焦装饰。 |
| 顶栏/平台切换/账号 | 外壳可抽成展示组件。 | 保留 `activeProvider`、`switchProvider`、搜索 ref 与提交、账号忙/身份未知、登录/刷新/退出；不把浏览平台当播放来源。 |
| 歌单栏、推荐、列表、空状态 | 列表布局、封面、行外观可分层替换。 | 保留各工作区数据和加载/错误、`openList` / `search` / `recommend`、页码和代次校验、本地历史标识、网易/QQ 不同点击语义。不要在视图中合并曲库或把当前页误称完整歌单。 |
| 正在播放卡片与底栏 | 封面/文字/控件皮肤可替换。 | `song`、`playing`、`buffering`、实际来源、音量和模式需要来自同一播放器；保持 `audio` ref、进度恢复和 `PlaybackProgress` 的事件清理。 |
| 歌词 | `LyricPanel` 已是较清晰的视觉提取候选。 | 保留当前行、5 秒手动滚动暂停跟随、点击 seek、焦点、卸载清理；保留 `parseLrc`、`syncLyric` 与 `seeked` 接线。 |
| 队列/确认/扫码/授权弹窗 | 遮罩、布局、按钮样式可抽成组件。 | 保留当前浏览队列与实际播放来源区分、FM 保护、切歌在途禁用、确认清空、Esc 顺序、二维码取消和账号代次。 |
| 播放、账号、存储和 IPC | 不应由纯视觉替换直接接管。 | `play`、回滚快照、`clearAccountContent`、保存链、`ListeningTracker`、FM 与 provider 命令高度交叉，先保持在容器/控制层，再通过数据与回调传给视图。 |

相关非 JSX 模块：`providers.js` 统一能力与网易 IPC、`qq-community.js` 动态加载 QQ 适配器；`playback-state.js` 做快照序列化、恢复、模式索引；`listening.js` 是纯内存播放计时；`lyrics.js` 做 LRC 解析；`media-session.js` 安装系统媒体动作与元数据。`App` 还直接调用 `playback_state_load/save`、`netease_recent_get/add/clear`、QQ 诊断及受限回滚 IPC。不要在纯视觉组件内另建网络客户端或直接操作凭据。

## 6. 必须保持的运行约束

1. **唯一 audio**：当前唯一 `<audio ref={audio}>` 位于 [main.jsx:97](src/main.jsx#L97)。它不随工作区切换创建/销毁；`onPlaying`、`onWaiting`、`onStalled`、`onSeeking`、`onSeeked`、`onRateChange`、`onVolumeChange`、`onPause`、`onEnded`、`onError` 同时驱动 UI、本地记录、计时、恢复和续播。禁止为视觉预览、歌词或各平台再创建常驻 audio。
2. **Media Session**：[main.jsx:88](src/main.jsx#L88) 在歌曲/播放状态变化时通过 `media-session.js` 更新元数据并绑定播放/暂停/上下首；effect 清理 handler。它使用 Web Media Session，不等同源码已建立第二个 Windows 原生播放引擎，也不能仅由源码推断所有 Windows 浮层实测成功。
3. **歌词同步**：`parseLrc` 解析多时间戳；`syncLyric` 在 audio `timeupdate` 和 `seeked` 路径更新当前行。`LyricPanel` 是显示与交互，不能让其卸载或重绘破坏主播放器事件；不要引入逐帧循环或让每个 `timeupdate` 重渲染完整曲库。
4. **双工作区**：浏览数据、账号与队列在 `workspaces` 按平台分开；`song.provider` 指实际播放来源。`switchProvider` 不主动 pause，跨工作区的异步请求依赖各自的账号/浏览代次。网易与 QQ 不合并曲库、歌单或凭据。
5. **私人 FM**：`fm` 保存账号、去重、待请求、错误和独立曲目；接近队尾时 `play` 按需续取，`onEnded` 必要时等待在途续取，`queueMode` 对 FM 使用顺序逻辑。FM 队列不允许普通编辑，视图拆分不能改变这些条件。
6. **持久化和会话**：`src-tauri/src/playback_storage.rs` 的固定 IPC 处理各平台版本化状态；`netease_recent.rs` 管理账号隔离的本地历史；凭据由后端处理。视觉层不保存 Cookie、Token 或临时媒体地址，不绕过账号代次检查。当前未实现真正听歌记录上报。

## 7. 快捷键与事件监听位置

| 位置 | 实际行为与边界 |
|---|---|
| [main.jsx:86](src/main.jsx#L86) | `window` 的 `keydown` effect（无依赖数组，每次渲染会清理并重新注册）：Escape 依次处理队列清空确认、队列、二维码、QQ 授权、歌词；Ctrl+L 聚焦当前搜索输入；非编辑区域 Space 切换播放/暂停；Ctrl+左/右切歌，Ctrl+上/下调整音量。输入、textarea、select、contenteditable 不触发普通播放快捷键；Ctrl+L 的判断在编辑区域保护之前。Space 在队列/扫码/QQ 授权/歌词面板打开时直接返回。没有在此处注册系统全局热键。 |
| [main.jsx:19](src/main.jsx#L19) | `PlaybackProgress` 绑定/清理 `timeupdate`、`seeked`、`loadedmetadata`、`durationchange`、`emptied`；滑块 `onChange` / `onPointerUp` 通过回调接入上层 seek 与保存。 |
| [main.jsx:24](src/main.jsx#L24) 至 [main.jsx:29](src/main.jsx#L29) | 歌词滚轮、触摸、指针和滚动键暂停自动跟随；行按钮点击 seek，当前行变化或恢复跟随时调用 `scrollIntoView`。 |
| [main.jsx:64](src/main.jsx#L64) | `pagehide` 尽力冲刷播放状态，effect 卸载时移除监听。 |
| [main.jsx:83](src/main.jsx#L83) | 动态订阅 Tauri `qq-auth-cleanup-failed` 并在卸载时取消订阅。 |
| [main.jsx:84](src/main.jsx#L84) | 二维码存在期间使用 2.5 秒 `setTimeout` 轮询并在清理时取消；不是页面常驻轮询。 |
| [main.jsx:87](src/main.jsx#L87) | 队列打开、平台或当前歌变化时，将已渲染的当前队列项滚入视野。 |
| [main.jsx:88](src/main.jsx#L88) | 绑定 Media Session `play`、`pause`、`previoustrack`、`nexttrack`，effect 清理时注销；具体实现位于 `src/media-session.js:1`。 |
| [main.jsx:97](src/main.jsx#L97) | 唯一 audio 的 React 媒体事件集合；`play()` 内的恢复与回滚还分别使用一次性 `loadedmetadata` 监听。 |

## 8. 面向视觉改造的拆分建议

以下是建议，不是当前已经存在的组件：

1. 先保持 `App` 中的状态、`audio`、`play`、账号/请求代次、FM、存储和 Media Session 原位；只提取接收明确数据及回调的 `AppHeader`、`LibraryBar`、`RecommendationNav`、`SongList`、`EmptyState`、`NowPlayingPanel`、`PlayerBar`、`QueueDialog`、`LoginDialogs`。保持原有事件顺序和 key，避免第一步就迁移业务控制权。
2. 保留现有 `PlaybackProgress` 和 `LyricPanel`，先整理样式依赖，再逐步明确数据、状态和回调；组件拆分时确保它们不会因浏览平台变化而重建 audio 或丢失歌词跟随状态。
3. 视觉部件以 `workspace`、`currentSong`、`queue`、`status` 等只读数据及 `onSearch/onOpenPlaylist/onPlay/onSeek/onRemove` 等命令为接口；不要把账号 cookie、音源解析、持久化 IPC 或平台网络请求塞进卡片/列表。
4. 等纯视图稳定后，再单独评估把控制逻辑抽为 hooks 或 controller：账号/工作区、播放器与队列、FM、持久化各自迁移；每次迁移保留原有令牌/账号校验、单 audio 和事件清理，避免一次同时重写视觉与状态机。
5. 整理 `style.css` 时先按真实级联确认当前有效值，提取 token 与区域样式，再改布局；保留 900/680/560 断点的当前意图，并以实际窗口尺寸、键盘焦点、空/错误/长列表状态复核。

## 9. 本次范围

只读取了相关源码与项目界面规范，生成本文件；未修改项目源码、未执行构建或测试、未读取用户凭据、未发起网易或 QQ 请求，也未检查 QQ 播放问题。文中关于运行机制的表述属于源码分析；是否在当前设备上可用须另行实测。
