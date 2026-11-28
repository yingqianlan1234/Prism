# Prism B8：QQ 登录与播放验证

## 当前状态

- 已实现：QQ 用户交互式临时授权窗口候选、受限后端命令、最小账号资料查询候选及 Windows 独立凭据保存/恢复/本机退出代码；旧自动二维码/OAuth 路线仍未启用。QQ 匿名搜索保留。
- 模拟验证：独立 Tauri/WebView2 本机合成页面的虚构 Cookie 测试确认授权窗口能读取自有测试 Cookie、主窗口不能读取该 Cookie，远程页面调用应用自定义 IPC 被拒绝；密码自动保存和通用自动填充被关闭并读回，临时浏览数据清除和目录删除成功。测试窗口/服务均已退出。该 fixture 的合成结果不等于真实腾讯页面或账号成功。
- 真实网络与用户操作：用户本人完成一次 QQ 登录并看到资料，重启后确认资料恢复；本机退出尚未验证。
- QQ 创建/收藏歌单、曲目、歌词和免费歌曲播放已实现候选代码并通过合成测试，真实歌单及端到端播放尚待验证。旧版出现一次匿名搜索返回数据异常，原因尚未确认。

## 授权数据流与安全边界

主窗口调用固定用途命令，建立短暂的独立 WebView2 数据目录和 InPrivate 会话，限制顶层导航到已知腾讯登录主机/路径，不给远程页面主窗口 IPC 权限。后端在授权窗口显示前关闭并读回密码自动保存及通用自动填充设置，失败即停止。用户完成登录后，本机 Rust 仅从固定 QQ 音乐 HTTPS 域筛选账户及音乐会话必需字段，向 `https://u.y.qq.com/cgi-bin/musicu.fcg` 请求最小账号资料；仅在业务响应和账号校验成功且会话代次未改变时写入 Windows Credential Manager 的 QQ 独立目标。Cookie、音乐密钥、Token 不返回 React、普通日志或社区服务器。窗口关闭后尝试清除浏览数据并删除经校验的临时目录；清理失败会提示用户，异常终止仍可能遗留目录。

正常腾讯页面可能需要其他主机或额外会话字段，当前白名单和字段映射未经真实验证；缺失或冲突时失败并提示，不回退读取系统浏览器数据。网页登录态不等于 QQ 音乐播放授权、会员权限或可播放 URL。

## 代码与依赖

`src-tauri/src/qq_web_auth.rs` 新增授权与资料候选；`src-tauri/src/main.rs` 注册限定命令；`src/providers.js`、`src/qq-community.js` 和 `src/main.jsx` 增加用户交互入口与状态；`src/qq-login.test.mjs` 等测试使用虚构数据。`webview2-com 0.39` 和 `windows 0.62` 原已由 Tauri 间接依赖，本轮声明为 Windows 直接依赖以设置 WebView2 安全选项，Cargo.lock 只改变根依赖关系。无常驻 Node、第二常驻 WebView或第二 audio。

## 构建与测试

主工程 `npm run test`：17 项单测及全部模拟集成脚本通过；`cargo test --offline --manifest-path src-tauri/Cargo.toml`：33 通过、5 联网探针 ignored，不算通过。曾供歌单测试的候选版为 13,316,096 字节，SHA-256 `164433975634F2285B00121DDF3B50D70BE22A83A910ECFE8E4CF2A60836AB9F`；对应路径已更新为结果码分类诊断版（见下文），没有覆盖当时正在运行的程序，也未生成安装包。不进行听歌上报。

## 可复核的本机隔离 fixture

仅含合成数据的测试工程保留在 `tests/qq-auth-isolation-fixture`；可在 Windows 安装 Rust/WebView2 的环境执行 `cargo run --offline --manifest-path tests/qq-auth-isolation-fixture/Cargo.toml`。本轮复跑返回 `cookie_isolated=true`、`remote_custom_ipc=denied`、`password_and_autofill_disabled=true`、`isolated_profile_cleared=true` 和 `isolated_directory_removed=true`；这只证明该合成 fixture 的一次本机行为，不保证腾讯页面、所有运行时版本或异常退出时相同。该测试短暂创建本地 Rust 服务和授权窗并自行退出，不是应用的常驻服务。

测试进程退出时 WebView2 另输出 `Failed to unregister class Chrome_WidgetWin_0, Error = 1412`；fixture 退出码为 0 且报告目录清除成功，但该提示原因未独立定位，不能据此宣称真实授权窗在所有环境中均能干净退出。

## 用户 QQ 登录的真实验证

用户本轮单独同意 QQ 登录后，在独立测试版本人使用腾讯授权窗口操作，随后确认“显示账号资料”。按当前受限命令逻辑，资料展示仅在 QQ 资料业务响应验证及本机独立凭据写入后返回；这是用户反馈加代码路径证据，未读取或输出任何真实 Cookie、Token、账号、昵称、二维码或完整地址。不能据此推断 QQ 播放授权、歌单可用或长期会话有效。

用户随后按本人操作重启 Prism 并切到 QQ 工作区，反馈账号资料已恢复；这是真实用户界面反馈，不能代替本机凭据细节或 QQ 播放授权验证。未执行 QQ 本机退出。用户已同意歌单和一首免费歌曲测试；首次反馈的搜索错误发生在旧版进程，尚不能代表新版本的测试结果。

用户随后启动 `target-prism-b8-catalog/release/Prism.exe`，反馈 QQ 歌单与曲目列表能够显示；播放所选歌曲时显示“当前账号无权播放或歌曲不可用”。该提示来自上游未返回播放地址，并不能证明账号缺少权限；也可能是请求参数、会话或接口状态问题。当前源码已更正提示，且只区分结果码为零、非零或缺失，不输出具体请求、歌曲或凭据。尚未确认音频播放、歌词、跨工作区持续播放或该曲目的授权状态。旧版匿名搜索曾显示返回数据异常，具体原因尚未定位。

为检查空播放地址的响应类别，在主工程构建了独立诊断版 `src-tauri/target/release/Prism.exe`，13,309,440 字节，SHA-256 `8AC879A3E6CB63D0B7B39951AAF62A885B9503D91A637AE0F6088F0C500C757D`；未覆盖当时正在运行的候选版。该版只显示结果码零、非零或缺失，不暴露具体码、歌曲数据或凭据。修改后 Rust 离线测试 33 项通过、5 项联网探针 ignored；真实歌曲重试结果见下文。

用户重试后反馈结果码非零；不能仅凭该类别判定具体原因。[Music Assistant 社区报告](https://github.com/music-assistant/support/issues/6628)描述过某有权限歌曲的另一种 vkey 请求返回 104003，而替代请求在其单账号测试中成功；该报告的方法不同，不能证明 Prism 的结果码或修复有效。为避免猜测，本轮仅增加 104003、104009 及其他非零码的脱敏分类，尚未更换接口、添加设备伪装或作出权限结论。

结果码分类诊断版构建于 `music-desktop-workspaces-2.3-round7/target-prism-b8-catalog/release/Prism.exe`，13,314,560 字节，SHA-256 `F19FD96367B54DF6013AB8E4BB5B51B91EBE7769397EB7987F01799B5CB69946`；构建未覆盖正在运行的程序。新增分类的单项 Rust 测试通过；此前完整测试结果见上。等待用户本人用同一首歌曲重试并确认官方客户端能否播放。

用户随后反馈业务结果码 104003，且同一账号在 QQ 音乐官方客户端能够完整播放同一首歌曲。参考上述社区案例，曾测试同一 QQ 音乐固定主机的 `music.vkey.GetEVkey/CgiGetEVkey`，只请求标准 MP3、使用用户实际会话；没有自动回退或批量探测。该尝试及撤回情况见下文。

新候选构建路径 `music-desktop/src-tauri/target/release/Prism.exe`，13,314,560 字节，SHA-256 `7473646C2964B904C1FD8DB0172FBE68C015B6C7D14C66805D8FFE2269B21272`；构建前确认此路径无运行中的 Prism。Rust 离线测试 33 项通过、5 项联网探针 ignored，前端生产构建通过。先前该路径诊断版本的哈希仅为历史记录，已被新版替换。

用户实际重试 EVkey 候选仍为 104003，未获得音频。对上述社区讨论的后续维护者回复进行核对后，发现维护者将 EVkey 描述为加密资源接口，且不建议将普通歌曲全局切换到该接口；因此已撤回切换，恢复普通 `CgiGetVkey`，未实现加密资源解码。另据 [simple-music 的 QQ 客户端代码](https://github.com/Yyyangshenghao/simple-music/blob/master/server/lib/qq-client.ts)，播放与资料登录对凭据存在不同要求；Prism 只接受特定音乐 Cookie 字段，但尚未证明当前凭据是否满足播放或请求参数是否正确。104003 不能解释成已验证的歌曲版权结论，播放仍未实现真实验收。已停止尝试替代接口；两个版本均未取得播放地址，无法验证歌词显示、音频播放或跨工作区续播。

撤回 EVkey 后重新构建 `music-desktop/src-tauri/target/release/Prism.exe`，13,314,560 字节，SHA-256 `1839FF5AC9082A8BD153F2A1938EF7CD549DF63985ED68BC6E4F9A60ED2AB19C`；该路径此前 EVkey 测试版已被替换。最终源码 Rust 离线测试 33 通过、5 忽略，构建成功；此前用户所测普通请求返回 104003，重建并不改变该实测结果。
