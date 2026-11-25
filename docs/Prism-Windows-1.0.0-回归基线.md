# Prism Windows 1.0.0 回归基线

对应[三平台移植方案](Prism-三平台移植方案.md)第一阶段的 Windows 部分。基线是 [`v1.0.0`](https://github.com/yingqianlan1234/Prism/tree/v1.0.0) 指向的 [`0f78f2b`](https://github.com/yingqianlan1234/Prism/commit/0f78f2b98913b451228175c861a1829b21dc4060)，Windows 目标为 `x86_64-pc-windows-msvc`，应用标识为 `local.xianyu.music`。`package.json`、`Cargo.toml` 和 Tauri 配置的版本均为 `1.0.0`。

## 自动化与打包

| 项目 | 结果及证据 |
| --- | --- |
| macOS 上的前端构建与模拟回归 | macOS 27.0.1（ARM64），Node `26.12.0` 与 `22.23.5` 上分别执行 `npm test`。两次均通过 31 个单测和 20 个集成脚本。Node `22.23.5` 又单独通过 5 次 `desktop-p2a.test.mjs`。 |
| Windows 第一次自动化 | 31 个前端单测和前 18 个集成脚本通过。`desktop-p2a.test.mjs` 等待“保存按钮可点击”超时，串联脚本提前结束。该运行未执行 Rust 测试和打包。[运行记录](https://github.com/yingqianlan1234/Prism/actions/runs/45551271347) |
| Windows 独立验证 | 同一提交、同一 Windows Server 2022 runner 镜像。前端再次在 P2-A 的相同等待点超时。Rust 79 通过、0 失败、5 个已标记忽略的联网探针。NSIS 和 MSI Release 打包完成。由于前端失败，整条运行仍显示失败。[运行记录](https://github.com/yingqianlan1234/Prism/actions/runs/45551576947) |
| Windows 单独重跑 | P2-A `desktop-p2a.test.mjs` 与 P2-B `local-library-p2b.test.mjs` 单独运行均通过。整套串行回归两次在 P2-A 超时，该结果保留。[运行记录](https://github.com/yingqianlan1234/Prism/actions/runs/45553409142) |
| Windows 安装冒烟 | 在两个独立 runner 上按 SHA-256 核对 NSIS 和 MSI。两种包均静默安装成功，各检测到一个 Prism 1.0.0 卸载项，启动后均观测到主窗口句柄。静默卸载成功，程序和卸载项均移除。[运行记录](https://github.com/yingqianlan1234/Prism/actions/runs/45553409142) |

首次 Windows 运行使用 Node `22.23.5`、npm `10.9.9`、Rust `1.100.0`，目标为 MSVC x64。测试覆盖见 [`package.json`](../package.json) 与 [`src-tauri/src`](../src-tauri/src)。默认 Rust 测试保留仓内对联网探针的忽略设置。

### 安装包与证据来源

GitHub Releases 当前无记录，Windows 测试机也未保留原始 NSIS 或 MSI 文件。本轮以 GitHub Actions 从标签提交重建的测试包为基线，登记两种产物各自的文件名、大小、SHA-256、签名状态和获取来源。

| 类型 | 文件 | 字节数 | SHA-256 | 签名 |
| --- | --- | ---: | --- | --- |
| NSIS | `Prism_1.0.0_x64-setup.exe` | 3,926,697 | `9F9B9DE16BEBF42E10EBDC5FFDFEDD77749575CE6D17C307DED8C337BD868014` | `NotSigned` |
| MSI | `Prism_1.0.0_x64_en-US.msi` | 5,652,480 | `862F2EEA037D844767DD81F148AC54087225762983357D213FDB1C55728C182F` | `NotSigned` |

已下载产物，并逐项复核文件大小及哈希。两份安装包、构建环境和哈希清单均见 [Actions 产物](https://github.com/yingqianlan1234/Prism/actions/runs/45551576947/artifacts/14994363610)。该 Actions 产物保留至 2026-12-09 13:24（新加坡时间）。

以 Windows x64 和 MSVC 工具链运行下列命令。WebView2 用于运行程序，MSI 打包还依赖 WiX 与 VBScript。[Tauri Windows 构建说明](https://v2.tauri.app/distribute/windows-installer/)

```powershell
git switch --detach v1.0.0
git rev-parse HEAD
npm ci --no-audit --no-fund
npm test
cargo test --locked --target x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --ci --no-sign --target x86_64-pc-windows-msvc --bundles nsis,msi -- --locked
```

## Windows 桌面验收

在 Windows 桌面登录会话中记录系统版本、架构、WebView2 运行时版本及两个安装包各自的 SHA-256。安装路径可使用两个独立测试用户或 VM 快照。按 NSIS 与 MSI 分别保留一份能启动、能卸载的 1.0.0 环境，以便后续同系列覆盖升级。

| 项目 | 操作和通过条件 | 当前实机结果 |
| --- | --- | --- |
| NSIS、MSI 全新安装 | 分别安装并通过开始菜单启动。窗口正常出现，Windows 已安装应用中只登记一个 Prism 1.0.0。退出并卸载后，程序与对应卸载项移除。 | 待确认交互安装和卸载 |
| 网易云普通播放和账号恢复 | 登录，播放有权限的歌曲，暂停、切歌、拖动进度并观察歌词。浏览 QQ 或本地曲库时继续出声。正常退出后账号、队列与进度恢复为暂停，手动播放从恢复位置继续。 | 待实机 |
| 私人 FM | 进入私人 FM，听到首曲并切至下一首。验证 FM 队列独立，浏览别的来源时继续播放。正常退出后确认来源和进度可恢复。 | 待实机 |
| QQ 音乐 | 完成授权并播放有权使用的曲目，验证出声、切歌、拖动进度、退出和重启恢复。账号、上游或曲目权限问题按发生的步骤登记。 | 待实机 |
| 本地目录、歌词和续播 | 使用原生对话框选择含 MP3、FLAC、WAV、M4A、Ogg 的测试目录，扫描后分别试播和定位。验证同名 `.lrc` 同步，重启恢复队列与进度。检查移除目录后的提示。 | 待实机 |
| 托盘 | 播放中选择后台运行，关闭窗口后音频继续。托盘可重新打开窗口和退出。正常退出后由重启验证播放状态。 | 待实机 |
| 全局快捷键 | 启用功能并将焦点移到另一程序，验证 `Ctrl+Alt+P` 播放或暂停、左右键切歌、上下键改音量、`Ctrl+Alt+D` 切换桌面歌词。更改绑定后确认旧绑定失效，注册冲突时保留旧有效绑定。 | 待实机 |
| 悬浮歌词 | 验证正在播放的歌词可见且跟随切歌。拖动后重启确认位置恢复，测试锁定穿透、解锁和关闭。 | 待实机 |
| 窗口与标题栏 | 检查首帧、标题栏配色、窗口最小尺寸、上次位置及最大化恢复。记录 Windows 版本和显示缩放。 | 待实机 |
| 同系列覆盖升级 | 第二阶段分别以 `1.0.0 NSIS → 候选 NSIS`、`1.0.0 MSI → 候选 MSI` 验证。检查无重复卸载项，账号、曲库和播放状态仍可读取，候选版可正常卸载。 | 等待候选版 |

实机记录按“包类型与 SHA-256、Windows 和 WebView2 版本、用例、结果、复现步骤”填写。真实账号标识、凭据及播放直链放在测试环境内。

## 历史证据

- [网易云日常体验验证](../Prism-A11-网易云日常体验验证.md#L30)记录了旧构建上的真实网易云播放和媒体键。它对应旧的独立 EXE。
- [当前代码交接记录](../CODEX-HANDOFF.md#L25)描述了 QQ 免费曲目播放及进度定位，列出了网易云新增接口、原生热键、歌词窗口和本地音频格式的实机待测范围。
- [原生标题栏验证](../Prism-C1-系统标题栏验证.md)记录了历史 Windows 11 和 125% 缩放环境。当前基线仍需复测。
