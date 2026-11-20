# Prism · Lumen Well 第 0 期：基线与行为护栏

## 范围与结论

第 0 期只做现状取证，没有修改 Prism 源码，也没有制作新皮肤。主工程不是 Git 仓库，因此截图和本报告保存在工程 `docs/lumen-phase0`，尚未作 Git 提交或“入库”。

已经完成三种浏览器视口的合成数据截图、现有 CSS 的计算值采样和既有自动化回归；这些**不是 Windows 真实账号或真实媒体端到端验收**。舞台和歌词舞台当前不存在，无法把未来功能计作通过。附录 A 的真实账号、Windows 媒体键及完整桌面流程仍须用户确认；因此第 0 期不标记为全部验收通过。

## 1. 基线可复核身份

- 工程：`D:\codex\视频\music-desktop`；本次隔离预览副本：`D:\codex\视频\music-desktop-workspaces-2.3-round7\lumen-phase0-20261108-173008`。副本使用现有 `node_modules` 目录联接，预览数据和 30 秒静音 WAV 均为合成，不携带用户账户或凭据。
- 主工程 `src/main.jsx` SHA-256：`46F8B716C169D78CEC9B7F76EF26724EF443A92F8F92984C27E532EDF9FB776E`；`src/style.css` SHA-256：`DC7CAC26795651BDC3E67A3A78EA72631A93403534446B6F00BC828DBCCE2A0E`。结束时与开始一致；全部 28 个 `src` 文件与隔离副本逐个 SHA-256 比较一致。
- 没有发起真实网易或 QQ 接口请求。静态截图采用隔离 Vite 服务和虚构 IPC；服务结束后关闭。`npm run test` 自带 `vite build`，会生成开发构建产物，但不改源码；这与“第 0 期不碰源码”分开记录。

## 2. 截图矩阵

以下每行均包含 850×600、1280×820、1920×1080 三张 JPEG；已对 33 张图片独立解码，尺寸均与文件名前缀匹配。截图为浏览器 viewport、DPR 约 1，不是 Windows 真实窗口物理尺寸或 125%/150% DPI 验收。

| 状态 | 850×600 | 1280×820 | 1920×1080 |
|---|---|---|---|
| 游客/空状态 | [850](screenshots/850-guest.jpg) | [1280](screenshots/1280-guest.jpg) | [1920](screenshots/1920-guest.jpg) |
| 网易歌单、暂停 | [850](screenshots/850-netease-list.jpg) | [1280](screenshots/1280-netease-list.jpg) | [1920](screenshots/1920-netease-list.jpg) |
| 网易歌单、合成静音播放 | [850](screenshots/850-netease-playing.jpg) | [1280](screenshots/1280-netease-playing.jpg) | [1920](screenshots/1920-netease-playing.jpg) |
| QQ 浏览、网易来源暂停 | [850](screenshots/850-qq-browse-netease-source.jpg) | [1280](screenshots/1280-qq-browse-netease-source.jpg) | [1920](screenshots/1920-qq-browse-netease-source.jpg) |
| QQ 浏览、网易来源合成播放 | [850](screenshots/850-qq-browse-netease-playing.jpg) | [1280](screenshots/1280-qq-browse-netease-playing.jpg) | [1920](screenshots/1920-qq-browse-netease-playing.jpg) |
| 歌词浮层 | [850](screenshots/850-lyrics.jpg) | [1280](screenshots/1280-lyrics.jpg) | [1920](screenshots/1920-lyrics.jpg) |
| 队列弹层 | [850](screenshots/850-queue.jpg) | [1280](screenshots/1280-queue.jpg) | [1920](screenshots/1920-queue.jpg) |
| 清空队列确认 | [850](screenshots/850-clear-confirm.jpg) | [1280](screenshots/1280-clear-confirm.jpg) | [1920](screenshots/1920-clear-confirm.jpg) |
| 私人 FM 队列 | [850](screenshots/850-fm-queue.jpg) | [1280](screenshots/1280-fm-queue.jpg) | [1920](screenshots/1920-fm-queue.jpg) |
| 网易合成二维码弹窗 | [850](screenshots/850-qr-mock.jpg) | [1280](screenshots/1280-qr-mock.jpg) | [1920](screenshots/1920-qr-mock.jpg) |
| QQ 合成授权提示 | [850](screenshots/850-qq-auth-mock.jpg) | [1280](screenshots/1280-qq-auth-mock.jpg) | [1920](screenshots/1920-qq-auth-mock.jpg) |

二维码为不可登录的合成图，授权提示由模拟 IPC 显示，未打开真实授权 WebView。当前还没有舞台封面或舞台歌词视图，不能拍摄或伪造对应基线。

## 3. 现有 CSS 实际级联

在上述网易歌单合成页面读取 `getComputedStyle` 和几何；原始值见 [computed-styles.json](computed-styles.json)。结果随浏览器、系统字体和滚动条而变化，不代表 Windows 高 DPI 实测。

| 属性 | 850×600 | 1280×820 | 1920×1080 |
|---|---:|---:|---:|
| `.app` 背景 / 文字 | `rgb(33,34,37)` / `rgb(237,237,237)` | 同左 | 同左 |
| `.app` 四行 | 64 / 48 / 412 / 76 px | 64 / 48 / 632 / 76 px | 64 / 48 / 892 / 76 px |
| 顶栏/底栏背景 | `rgb(25,26,28)` | 同左 | 同左 |
| 标题 | 微软雅黑 UI，28 px，600 | 同左 | 同左 |
| 歌曲行 | 59 px；隐藏专辑列 | 59 px；五列 | 59 px；五列 |
| 右侧 `.now-panel` 宽 | 240 px | 约 362.64 px | 约 554.64 px |
| 中央进度 range 宽 | 约 24.63 px | 约 255.40 px | 约 607.40 px |
| 播放按钮 | 36×36 px，圆形，浅色 | 同左 | 同左 |

`style.css` 先给基础规则，后续中性色、空状态、平台切换、分页、队列和歌词等规则覆盖同一选择器；不可直接把首条定义当成最终值。850 的进度条在合成预览中较窄，是现状记录，不在第 0 期修改。

可复核的规范问题：`max(1px, 1dppx)` 混合长度与分辨率单位，浏览器 `CSS.supports('width', ...)` 为 false。以规范 `#F2E9E2` 在 `#120D0B` 上按 50% sRGB 混合估算对比约 4.64:1，不应直接写成 4.9:1 的实测值；实际层叠、不同背景及 DPI 要在实施阶段复核。`color-mix()` 在本预览支持，不能代表所有 WebView2 版本。

## 4. 附录 A 回归清单

“模拟通过”指本次运行的既有自动化/JSDOM 或隔离浏览器合成操作，并非真人账号、真实 Tauri/WebView2 或网络播放成功。

| # | 项目 | 本次证据与结果 |
|---:|---|---|
| 1 | 单 audio、不因平台或弹层变化重建 | 代码静态只有一个 `<audio>`；`platforms.test.mjs`、`fm.test.mjs`、`qq-stream-race.test.mjs` 合成覆盖；浏览器合成页面核对 audio 数为 1。舞台尚不存在，进出舞台未测。 |
| 2 | 浏览平台切换不中断、播放来源保留 | `platforms.test.mjs` 合成通过；浏览器用本地静音文件在 QQ 浏览时保留网易来源并继续播放，见截图。非真实 QQ/网易网络音频。 |
| 3 | 网易单击选中、双击/Enter 播放；QQ 单击 | `a11-integration.test.mjs`、`desktop-interactions.test.mjs` 等合成通过；浏览器另核对网易单击只选中、双击切歌。QQ 单击有合成脚本覆盖，未做真实 QQ 播放。 |
| 4 | FM 不可编辑、续取、结束等待 | `fm.test.mjs` 和队列模拟测试通过；浏览器合成 FM 队列显示禁用的删除按钮且无清空按钮。真实 FM 接口本轮未请求；在途续取与结束的每个时序未独立以真人操作复核。 |
| 5 | 切歌在途禁用编辑、失败回滚 | `audio-transition.test.mjs`、`qq-rollback.test.mjs` 等合成通过；真实媒体解码、过期 URL 和所有延迟错误未验收。 |
| 6 | 清空确认与 Esc 顺序 | 合成页面实按 Esc，先取消清空确认、再关队列；自动化覆盖其他现有弹层分支。舞台尚不存在，不能测新增部分。 |
| 7 | 扫码取消、QQ 授权关闭 | 合成二维码 Escape 与 QQ 授权提示取消可关闭；`integration.test.mjs`、`qq-login.test.mjs` 对模拟 IPC 有覆盖。未进行真实扫码或授权。 |
| 8 | Ctrl+L、Space、Ctrl+方向键、输入焦点 | `desktop-interactions.test.mjs` 合成通过；浏览器另核对 Ctrl+L 聚焦、歌曲按钮焦点下 Space 暂停、输入框空格不切歌。未声称硬件键或所有系统输入法实测。 |
| 9 | Media Session 控制和元数据 | `a11.test.mjs` 合成 handler/元数据映射通过。此前 A11 用户反馈媒体键正常；本次未重新验证 Windows 浮层、封面或所有硬件键。 |
| 10 | 歌词跟随、seek、手动滚动和清理 | `a11-integration.test.mjs`、`performance.test.mjs` 合成通过；测试将 5 秒等待缩短以验证恢复逻辑，不能当作本次真实 5 秒交互验收。 |
| 11 | 进度拖动与 seeked 歌词同步 | `performance.test.mjs` 和 `a11-integration.test.mjs` 合成通过；舞台进度接手当前不存在、未测。 |
| 12 | 本地最近播放及清空确认 | `a11-integration.test.mjs` 合成覆盖；本次没有清除用户本机真实记录。 |
| 13 | 网易歌单 ≤100、FM 主列表 ≤200 | 网易 100 条的合成测试通过；FM 200 条上限按当前 JSX 静态检查，未构造真实 200+ 项实机样本。队列弹层当前全量渲染，不属于此上限。 |
| 14 | 恢复暂停、pagehide、3 秒节流 | 持久化模拟测试覆盖恢复和事件；此前 A7 用户确认过重启默认暂停。本次未重新关闭用户真实应用，异常退出与精确时间仍需区分。 |
| 15 | QQ 登录、授权、诊断外观行为 | 模拟登录/授权及诊断测试通过，本次截图为合成状态；未进行真实 QQ 登录、授权或播放请求。 |

## 5. 已观察到的基线差异

- 当前 QQ 歌单列表表头显示“双击歌曲播放”，但 QQ 行实际单击播放；视觉改造时应纠正文案，同时不能改变 QQ 现有点击语义。这个问题只记录，未在第 0 期改源码。
- 当前 QQ 授权提示的按钮呈浏览器默认浅色样式；队列和二维码仍是居中弹窗，歌词为右下浮层；这些是现有基线，不是 Lumen 实现。
- 当前 850 px 合成页面的播放进度 range 约 24.63 px 宽；是否需要改动按后续阶段设计和实际窗口复核，不以本样本直接下结论。
- 项目当前存在多个事件驱动的短期定时器：扫码开启时轮询、播放状态保存节流、歌词手动滚动后的 5 秒恢复。不能只凭无 `setInterval` 就声称任何时刻完全没有定时器；暂停稳定且无相关交互时的 DevTools 周期任务尚未实测。

## 6. 未完成与下一步

未用真实 Windows WebView2 做完整附录 A；未测 125%/150% DPI、系统屏幕阅读器和 DevTools Performance；未测试不存在的舞台/舞台歌词。由于这些是第 0 期退出条件的一部分，不把它们算作通过，也不自动进入第 1 期。D1–D11 仍按规范在相应阶段确认；特别是字体许可与打包、真实取色方案不能仅凭本次合成预览决定。

## 7. 补充：用户真实桌面验收

用户于本轮使用 A11 版本 Prism.exe，反馈网易歌曲播放、切换 QQ 工作区后返回、打开与关闭队列和歌词、系统媒体播放／暂停键均正常。这是用户一次整体反馈；未逐项观测具体事件、未测试 QQ 歌曲播放，也不能替代附录 A 全部项目、不同 DPI 或性能检查。
