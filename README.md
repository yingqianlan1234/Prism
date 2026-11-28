<p align="center">
  <img src="app-icon-source.png" alt="Vesper 图标" width="112" height="112">
</p>

<h1 align="center">Vesper</h1>

<p align="center">
  深夜电台风格的桌面多源音乐播放器（原名 Prism）<br>
  基于 Tauri 2 + React 19 + Rust 构建 · 轻量化原生桌面歌词 · 三源独立工作区
</p>

---

## 主要特性

### 1. 深夜电台视觉与四套光学主题
- 提供 **深空黑曜 / 暖炭玄岩 / 深夜雨窗 / 白昼冷晶** 四套深浅主题，搭配专辑封面漫反射取色、可调地平线环境光与 3A 无边框艺术顶栏。
- 居中悬浮控制岛与横向错落封面波段（支持刚体滑轨切歌动效），播放队列支持跟手拖拽调序、边缘滚屏、键盘微调与「下一首播放」置顶；隐藏至系统托盘或最小化时自动暂停背景动画。

### 2. 三源独立工作区与跨源本机歌单（切来源不断播）
- **跨源本机歌单**：支持将网易云、QQ 音乐与本地曲库曲目混编入自建本机歌单，自动持久化落盘至 `app_data_dir()/custom-playlists.json` 并支持 JSON 导入/导出备份。
- **网易云音乐**：支持二维码登录与系统凭据恢复、四档音质切换与试听标识、红心喜欢列表同步、自建歌单增删曲目、四分类分页搜索、私人 FM 直达歌词舞台、每日推荐 / 推荐歌单 / 推荐新歌，以及本地持久化最近播放（含封面）。
- **QQ 音乐**：独立授权窗口支持 QQ 或微信扫码登录，按账号隔离会话。支持免费曲目受控流代理播放、VIP 曲目清晰标识，以及免签公开「推荐歌单 / 推荐新歌」。
- **本地音乐**：独立本机曲库，支持按需目录选择与递归扫描、`MP3 / FLAC / WAV / M4A / OGG` 元数据及同目录 `.lrc` 歌词解析、内嵌封面按需提取（JPEG / PNG / WebP 并参与舞台取色）、关键词与目录筛选、队列与播放进度恢复。
- 任意平台切换浏览时，当前正在播放的歌曲保持唯一音频实例不中断。

### 3. Direct2D / DirectWrite 原生桌面悬浮歌词
- 零额外 WebView2 进程，纯原生 Win32 分层窗口绘制，采用 DirectWrite 矢量轮廓渲染，描边与逐字卡拉 OK 分界清晰锐利。
- **离手无痕，悬停显壳**：未锁定时平时纯字飘浮不挡屏幕；鼠标移上去柔和淡入胶囊底板与 9 项迷你播控条（上一首、播放/暂停、下一首、译文、单/双行、字号调节、锁定、关闭），支持拖动左右边缘调宽。
- **锁定穿透 + 迷你解锁圆钮**：锁定时歌词本体保持 100% 鼠标穿透，鼠标移到歌词区域时正上方居中浮现一枚 `26×26` 迷你开锁按钮（贴顶自动翻至下方），点一下即刻解除锁定。
- **双行预告与暖光推进**：支持「双行下一句柔光预告 / 单行聚焦」、换句过渡、4 套主题配色（深夜琥珀 / 高对比 / 暖金 / 随封面色）、4 档字号、居中/靠左对齐、透明度调节，并在系统托盘右键提供播控与快捷锁定。

### 4. 独立设置页与更多桌面能力
- 6 分组独立设置页、全局自定义系统热键（后台与托盘可用）、托盘右键播控与动态播放状态提示、Windows 开机自动启动（默认关闭）、应用内自动签名更新（支持 GitHub 直连与国内加速镜像切换）。
- 支持译文与音译歌词开关、播放倍速（`0.75×–2.0×`）、睡眠定时关闭、点播自动进入歌词舞台开关与关闭窗口行为选择（转入后台托盘 / 退出）。
- 账号凭据按来源隔离，Windows 使用凭据管理器，macOS 使用钥匙串。重启后可恢复上次播放队列、进度与专辑封面。

---

## 下载与安装（Windows 10 / 11 x64）

前往 [GitHub Releases 最新版本](https://github.com/yingqianlan1234/Vesper/releases/latest) 下载对应文件：

| 安装形态 | 说明 |
| :--- | :--- |
| **`Vesper_1.2.0_x64-setup.exe`** | **推荐**：NSIS 简体中文安装向导（当前用户安装，支持完整安装与卸载） |
| **`Vesper_1.2.0_x64_en-US.msi`** | 标准 Windows MSI 安装包 |

> **使用提示**
> - 需要 Windows 10 / 11（64 位）及系统自带 WebView2 Runtime。
> - 本项目暂无商业代码签名，首次运行如弹出 Windows SmartScreen 提示，可核对 Release 页附带的 SHA-256 校验和后选择「仍要运行」。
> - **从 v1.1.0 / v1.0.0 升级**：可在 Vesper 设置页「更新与关于」直接应用内一键更新（基于 minisign 签名校验），或下载同系列安装包覆盖安装，账号会话、跨源歌单与播放记录会自动保留。

---

## 本地开发与构建

### 环境要求
- Node.js 22+（含 npm）
- Rust 工具链（`cargo` / `rustc`）
- Windows 使用 MSVC 构建工具，macOS 使用 Xcode Command Line Tools

### 常用命令

```powershell
# 安装前端依赖
npm install

# 启动开发环境（如 cargo 未加入系统 PATH，请先将 %USERPROFILE%\.cargo\bin 加入 PATH）
npm run tauri dev

# 运行前端构建 + 全部单元测试与集成脚本
npm run test

# 运行 Rust 离线单元测试
cargo test --offline --manifest-path src-tauri/Cargo.toml

# 构建正式 Release 单文件与 Windows 安装包
npm run tauri build
```


### macOS Apple Silicon 本地构建

```bash
npm ci
npm run tauri -- build --bundles app,dmg --no-sign -- --locked
```

产物位于 `src-tauri/target/release/bundle/`。macOS 测试版包含网易云、QQ 音乐和本地曲库。使用微信登录 QQ 音乐时，在「QQ / 微信登录」打开的授权窗口里选择「微信登录」，扫码确认后回到 Vesper 完成授权。系统托盘、全局快捷键和原生悬浮歌词目前由 Windows 提供。

---

## 项目结构与设计

- 前端（React 19 + Vite 8）：[src/](src/)，设计规范与视觉档案见 [design-brief.md](design-brief.md)
- 桌面宿主与原生能力（Tauri 2 + Rust）：[src-tauri/](src-tauri/)
- 发布页提供 **Windows x64** 安装包。macOS Apple Silicon 可从源码构建测试版，后续计划见[跨平台移植方案](docs/Prism-三平台移植方案.md)。

---

## 声明与许可

- 本项目仅供个人学习、技术研究与本地音乐管理使用，不绕过任何音乐平台的版权保护或会员付费限制。
- 网易云接口协议适配参考及许可说明见 [src-tauri/NETEASE-API-LICENSE.txt](src-tauri/NETEASE-API-LICENSE.txt)；内置字体许可见 [src/fonts/](src/fonts/) 下的 `OFL.txt`。
