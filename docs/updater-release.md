# Vesper 客户端更新与自动发版指南

Vesper 基于 **Tauri 2 官方 `tauri-plugin-updater`** 实现应用内安全更新：所有安装包均使用 **minisign 非对称签名** 校验，即使通过国内加速镜像下载，只要安装包被篡改任意一个字节也会被本地拦截。

---

## 一、首次初始化（只需执行一次）

### 1. 生成 minisign 签名密钥对
在本地仓库根目录执行：

```powershell
npx tauri signer generate -w "$HOME\.tauri\vesper.key"
```

命令行会提示输入（或留空）私钥密码，并输出两段关键信息：
- **公钥（Public Key）**：一串 Base64 文本（可安全公开，需写入项目配置）
- **私钥文件**：保存在 `~\.tauri\vesper.key`（**绝对不要提交到 Git 仓库！**）

### 2. 将公钥填入客户端配置
打开 `src-tauri/tauri.conf.json`，找到 `plugins.updater.pubkey`，填入刚才生成的公钥字符串：

```json
"plugins": {
  "updater": {
    "endpoints": [
      "https://github.com/yingqianlan1234/Vesper/releases/latest/download/latest.json"
    ],
    "pubkey": "这里粘贴你生成的公钥",
    "windows": {
      "installMode": "passive"
    }
  }
}
```

提交并推送这次配置改动到 `main`。

### 3. 配置 GitHub 仓库 Secrets
打开 GitHub 仓库：**Settings → Secrets and variables → Actions → New repository secret**，添加以下 Secrets：

1. `TAURI_SIGNING_PRIVATE_KEY`：粘贴 `~\.tauri\vesper.key` 文件的完整内容
2. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：生成密钥时设置的密码（如果当时直接回车无密码，请创建一个空串或留空处理；建议设置强密码）

---

## 二、日常发版流程

1. 同步更新以下 3 处版本号（保持一致，例如 `1.2.0`）：
   - `package.json` → `"version": "1.2.0"`
   - `src-tauri/tauri.conf.json` → `"version": "1.2.0"`
   - `src-tauri/Cargo.toml` → `version = "1.2.0"`
2. 提交变更并打版本标签推送：
   ```powershell
   git commit -am "release: v1.2.0"
   git tag v1.2.0
   git push origin main --tags
   ```
3. GitHub Actions（`.github/workflows/release.yml`）会自动：
   - 运行 `npm run test` 与 `cargo test`
   - 构建并签名 Windows NSIS 安装包
   - 自动生成 `latest.json` 与 `.sig` 签名文件
   - 在 GitHub Releases 创建一个 **Draft（草稿）** Release
4. 到 GitHub Releases 页面编辑草稿的更新日志，确认无误后点击 **Publish release** 正式发布。

---

## 三、控制客户端是否主动弹窗

Vesper 客户端会根据版本号与 Release Notes 首行标签自动分级提醒：

| 发版场景 | 客户端行为 | 触发规则 |
| --- | --- | --- |
| **常规修复（Patch）** | **不弹窗**，仅设置齿轮亮起暖琥珀点 | 仅递增修订号（如 `1.1.0 → 1.1.1`），或在更新日志写 `[patch]` / `[silent]` / `[bugfix]` |
| **功能更新（Feature）** | **启动自动检查时弹出一次提示框** | 主/次版本号递增（如 `1.1.0 → 1.2.0`），或在更新日志写 `[feature]` / `[major]` / `[important]` |

> 说明：即使新版本是 Minor 版本（如 `1.2.0`），只要在 Release Notes 中加上 `[patch]` 也可强制静默；反之 Patch 版本（如 `1.1.1`）加上 `[feature]` 也会温柔弹窗。客户端渲染日志时会自动剔除这些控制标签。
