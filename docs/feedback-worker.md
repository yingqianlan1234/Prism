# Vesper 问题反馈 Worker 部署说明

Vesper 桌面客户端的「问题反馈」采用 **Cloudflare Worker 中转方案**：客户端将反馈正文与可选脱敏环境信息通过 HTTPS POST 发送到自定义域名接口，由 Worker 校验、限流并携带服务端保管的 `GITHUB_TOKEN` 自动在 `yingqianlan1234/Vesper` 仓库创建 GitHub Issue。

- 客户端接口地址：`https://feedback.yingqianlan.top/api/feedback`
- Worker 目录：`workers/feedback/`

---

## 第一步：创建最小权限 GitHub Token

为确保安全，**不要**使用个人经典全权 Token，请创建仅绑定单个仓库的 **Fine-grained Personal Access Token**：

1. 登录 GitHub，进入 **Settings → Developer settings → Personal access tokens → Fine-grained tokens**。
2. 点击 **Generate new token**：
   - **Token name**：`vesper-feedback-worker`
   - **Expiration**：建议选 `90 days` 或 `1 year`（到期前更新 Secret 即可）
   - **Repository access**：选择 **Only select repositories** → 选中 `yingqianlan1234/Vesper`
   - **Permissions → Repository permissions**：
     - 仅将 **Issues** 设为 **Read and write**（其余权限全部保持 `No access`）
3. 生成后复制保存这串 `github_pat_...` Token（页面关闭后不可再查看）。

---

## 第二步：配置 Secret 并部署 Worker

在 `workers/feedback/` 目录下执行（如果本机尚未登录 Wrangler，会先拉起浏览器完成授权）：

```powershell
Set-Location "workers/feedback"
npx wrangler login
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

- 执行 `npx wrangler secret put GITHUB_TOKEN` 时，粘贴第一步复制的 `github_pat_...` Token 并回车。
- `wrangler.jsonc` 中已绑定自定义域名 `feedback.yingqianlan.top`（`custom_domain: true`），部署时 Cloudflare 会自动配置域名路由与 SSL 证书。

> 提示：你也可以在 Cloudflare Dashboard 的 **Workers & Pages → vesper-feedback → Settings → Variables and Secrets** 中添加类型为 **Secret**、名称为 `GITHUB_TOKEN` 的变量。

---

## 第三步：验证接口连通性

部署完成后，在终端或浏览器访问健康检查接口：

```powershell
curl https://feedback.yingqianlan.top/health
```

预期返回：

```json
{"ok":true,"service":"vesper-feedback"}
```

随后打开 Vesper 客户端 → **设置 → 问题反馈**，填写一条测试反馈点击「发送反馈」，即可在 `https://github.com/yingqianlan1234/Vesper/issues` 中看到自动创建的 Issue。
