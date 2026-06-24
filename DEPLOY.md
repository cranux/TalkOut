# 部署文档 · 嘴遁 TalkOut

本项目是 **Next.js 15 全栈应用**(前端 + API 后端一体),需要能跑 Node 的环境,**不能当纯静态站托管**。
推荐 **Vercel + Upstash Redis**(都有免费额度,零运维);也支持自托管 / Docker。

---

## 前置准备

| 需要 | 说明 |
|---|---|
| **Node ≥ 18**(建议 20/22 LTS) | 本地构建用;`node -v` 查看 |
| **一个模型服务商的 key** | NPC 对话用,OpenAI / DeepSeek / 通义 / Kimi / GLM / 中转网关皆可,见 [§0](#0-你需要准备的变量) |
| **Vercel 账号**(免费) | 托管平台,[vercel.com](https://vercel.com) |
| **Upstash 账号**(免费) | 排行榜/埋点存储,[upstash.com](https://upstash.com);线上必需 |
| **GitHub 账号**(可选) | 连仓库自动部署用;不连也能 CLI 部署 |

> 全程免费档即可跑起来:Vercel Hobby + Upstash Free + 一个按量计费的模型 key(对话才花钱,通常几分钱一局)。

---

## 0. 你需要准备的变量

| 变量 | 用途 | 必填 |
|---|---|---|
| `LLM_API_KEY` | 模型服务商的 key(NPC 对话) | ✅ 必填 |
| `LLM_MODEL` | 模型名,如 `gpt-4o-mini` / `deepseek-chat` | ✅ 必填 |
| `LLM_BASE_URL` | 接口地址;留空 = OpenAI 官方端点 | 选填 |
| `UPSTASH_REDIS_REST_URL` | 排行榜/埋点存储 | 部署到 Vercel 必填 |
| `UPSTASH_REDIS_REST_TOKEN` | 同上 | 部署到 Vercel 必填 |

> 模型走统一 OpenAI 协议,换服务商 = 改 `LLM_BASE_URL` + `LLM_MODEL` + `LLM_API_KEY` 这三件套即可。
> 可选 `LLM_MAX_TOKENS`(默认 1024,思考模型调高,如 2048)、`LLM_TOOL_MODE`(`auto`|`tool`|`json`,纯推理模型如 deepseek-reasoner 用 `json`)。
> 不配 Upstash 也能启动,但会退回**文件存储**——在 Vercel 这种 serverless 上磁盘不持久化,排行榜会丢。所以线上务必配 Upstash。

### 拿模型 Key + 对应 base_url

去对应控制台拿 key 填进 `LLM_API_KEY`,并按下表配 `LLM_BASE_URL` / `LLM_MODEL`:

| 服务商 | 控制台 | `LLM_BASE_URL` | 型号示例 |
|---|---|---|---|
| OpenAI | [platform.openai.com](https://platform.openai.com) | 留空 | `gpt-4o-mini` |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com) | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 阿里通义 Qwen | 百炼 DashScope | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Moonshot(Kimi) | [platform.moonshot.cn](https://platform.moonshot.cn) | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 智谱 GLM | [open.bigmodel.cn](https://open.bigmodel.cn) | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| 中转/私有网关 | 你的网关 | 你的 `…/v1` 地址 | 网关支持的型号 |

### 建 Upstash Redis(免费)

1. 登录 [console.upstash.com](https://console.upstash.com) → **Create Database**(Redis)。
2. **区域选离用户最近的**(国内受众选日本/新加坡延迟更低)。
3. 进数据库详情页 → **REST API** 区块,复制:
   - `UPSTASH_REDIS_REST_URL`(形如 `https://xxx.upstash.io`)
   - `UPSTASH_REDIS_REST_TOKEN`

---

## 1. 本地先跑通(强烈建议)

部署前先在本地确认能聊、能上榜,排错最快:

```bash
cd /Users/crounix/data/www/project/game
npm install
cp .env.example .env.local     # 填好 LLM_API_KEY + LLM_MODEL(+ 可选 LLM_BASE_URL)
npm run dev                    # http://localhost:3000,点角色聊一局看能否对话
npm run preflight              # 自检:校验环境变量 + 跑一次 next build,失败会非零退出
```

> 本地不配 Upstash 会用文件存储 `.data/`(已 gitignore),排行榜本地能用;上线再配 Upstash。

---

## 2. 部署到 Vercel(推荐)

### 方式 A:连 Git 仓库(适合长期维护)

1. 把代码推到 GitHub/GitLab:
   ```bash
   cd /Users/crounix/data/www/project/game
   git init && git add . && git commit -m "init: talkout"
   git branch -M main
   git remote add origin <你的仓库地址>
   git push -u origin main
   ```
   > `.gitignore` 已排除 `node_modules / .next / .env / .env.local / .data`,**不会泄露 key**。

2. 打开 [vercel.com/new](https://vercel.com/new) → 导入该仓库。Framework 自动识别为 Next.js,构建命令无需改。

3. 在导入页(或 Project → Settings → **Environment Variables**)添加变量:
   ```
   LLM_API_KEY                = <你的模型 key>
   LLM_MODEL                  = deepseek-chat
   LLM_BASE_URL               = https://api.deepseek.com/v1   # 用 OpenAI 官方可留空
   UPSTASH_REDIS_REST_URL     = https://xxx.upstash.io
   UPSTASH_REDIS_REST_TOKEN   = ...
   ```
   都勾选 **Production**(以及 Preview/Development 视需要)。

4. 点 **Deploy**。完成后给你一个 `https://<项目名>.vercel.app` 域名。

> 之后每次 `git push` 到 main 会自动重新部署。改了环境变量需在 Deployments 里 **Redeploy** 才生效。

### 方式 B:CLI(适合快速一次性上线)

```bash
npm i -g vercel
cd /Users/crounix/data/www/project/game
vercel              # 首次:登录 + 创建项目(一路回车用默认)
# 配置环境变量(每个会让你粘贴值)
vercel env add LLM_API_KEY production
vercel env add LLM_MODEL production
vercel env add LLM_BASE_URL production        # 用 OpenAI 官方可跳过
vercel env add UPSTASH_REDIS_REST_URL production
vercel env add UPSTASH_REDIS_REST_TOKEN production
vercel --prod       # 正式部署
```

### 绑定自定义域名(可选)

1. Project → Settings → **Domains** → 输入你的域名(如 `talkout.example.com`)→ Add。
2. 按提示去你的 DNS 服务商加记录:
   - 子域名 → 加 **CNAME** 指向 `cname.vercel-dns.com`
   - 根域名 → 加 **A** 记录指向 Vercel 给的 IP(或用 ALIAS/ANAME)
3. 解析生效后 Vercel 自动签发 HTTPS 证书,几分钟内可用。

---

## 3. 上线后验证(2 分钟)

把 `<你的域名>` 换成实际地址:

```bash
# 1) 每日同题接口
curl -s https://<你的域名>/api/daily
# 期望:{"date":"2026-06-23","characterId":"..."}

# 2) 提交一条假成绩(date/characterId 用上一步返回的值)
curl -s -X POST https://<你的域名>/api/leaderboard \
  -H 'Content-Type: application/json' \
  -d '{"date":"<date>","characterId":"<characterId>","name":"测试","anonId":"t1","outcome":"won","rounds":3,"score":100}'
# 期望:{"rank":1,"total":1,"top":[...]}  → 说明 Redis 通了

# 3) 浏览器打开首页,点「今日挑战」实际聊一局
#    能正常对话 = LLM_API_KEY/MODEL 生效
#    聊赢能上榜 = Redis 生效
```

第 2 步报错或排行榜刷新后消失 → 检查 Upstash 两个变量是否都配了、值是否正确。

---

## 4. 自托管(VPS / 自己的服务器)

需要 Node ≥ 18 的常驻进程。

```bash
cd /path/to/talkout
npm ci
npm run build
# 环境变量建议写进 .env(用进程管理器注入),不要硬编码进启动脚本
npm run start        # 默认 0.0.0.0:3000
```

- 自托管若是**单实例**,可不配 Upstash,用默认文件存储(`.data/` 会持久化);**多实例**则仍需 Upstash 共享。
- `navigator.share` / 复制到剪贴板等 API **需要 HTTPS** 才生效,务必配证书。

### 用 systemd 守护(推荐)

把密钥放到 `/path/to/talkout/.env`,再建 `/etc/systemd/system/talkout.service`:

```ini
[Unit]
Description=TalkOut
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/talkout
EnvironmentFile=/path/to/talkout/.env
ExecStart=/usr/bin/npm run start
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now talkout
sudo systemctl status talkout      # 看是否 running
```

> 也可用 pm2:`pm2 start "npm run start" --name talkout && pm2 save`。

### 前置 Nginx 反代 + HTTPS

`/etc/nginx/sites-available/talkout`:

```nginx
server {
  listen 80;
  server_name talkout.example.com;

  location / {
    proxy_pass         http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/talkout /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d talkout.example.com    # 自动签发 + 续期 HTTPS
```

### Docker(可选)

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm","run","start"]
```

```bash
docker build -t talkout .
docker run -d -p 3000:3000 --name talkout --restart unless-stopped \
  -e LLM_API_KEY=<你的模型 key> \
  -e LLM_MODEL=deepseek-chat \
  -e LLM_BASE_URL=https://api.deepseek.com/v1 \
  -e UPSTASH_REDIS_REST_URL=https://xxx.upstash.io \
  -e UPSTASH_REDIS_REST_TOKEN=... \
  talkout
```

---

## 5. 区域与国内访问

这是个面向中文用户的应用,延迟和可达性值得注意:

- **`*.vercel.app` 在中国大陆经常被墙或很慢**。要稳定的国内访问:
  - 绑**自定义域名**走 CDN,或
  - **自托管在国内服务器**(公网域名需 **ICP 备案**)。
- **三方都尽量同区**:Vercel 函数区域、Upstash Redis 区域、模型端点最好都靠近用户。一次对话 = 函数 → 模型 → Redis,跨洋叠加会很慢。
  - Vercel 函数区域:Project → Settings → **Functions** → Region(Hobby 单区域,选香港/东京等近的)。
- 若模型用**国内中转网关**,把应用也放近一点(或干脆自托管国内),避免 Vercel 海外 → 国内网关来回绕。

---

## 6. 成本 / 免费额度

| 项 | 免费档 | 说明 |
|---|---|---|
| Vercel Hobby | 免费 | 个人项目够用;商用需 Pro |
| Upstash Redis | 免费档 | 小流量足够;按命令数计费,超了才花钱 |
| 模型 API | 按量付费 | **唯一持续花钱的**;选便宜模型(如 `deepseek-chat` / `gpt-4o-mini` / `glm-4-flash`)一局通常几分钱 |

> `vercel.json` 已把 `/api/*` 的 `maxDuration` 设为 30s,给慢模型留足时间。

---

## 7. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 对话报错、聊不动 | `LLM_API_KEY` / `LLM_MODEL` 没配或无效,或 `LLM_BASE_URL` 与 key 不匹配;查 Vercel 函数日志 |
| 报 `Thinking mode does not support this tool_choice` 之类 | 模型是思考/推理类;设 `LLM_TOOL_MODE=json`,推理长再加 `LLM_MAX_TOKENS=2048` |
| 排行榜刷新就清空 | 没配 Upstash → 走了文件存储,serverless 不持久化。配上两个 Upstash 变量重新部署 |
| 分享/复制文案无效 | 这些 API 需要 **HTTPS**;Vercel 默认 HTTPS,自托管要配证书 |
| `/api/talk` 超时 | LLM 响应慢;`vercel.json` 已设 `maxDuration:30`,如仍超时检查网络/区域(见 §5) |
| 改了环境变量没生效 | Vercel 改 env 后要 **Redeploy**;自托管要重启进程(`systemctl restart talkout`) |
| 改了代码线上没更新 | 方式 A 需 `git push`;方式 B 需重跑 `vercel --prod` |
| 国内访问慢/打不开 | 见 §5,`*.vercel.app` 在国内不稳,绑域名或自托管 |

---

## 速查:最短路径

```bash
# 1. 本地 npm install && cp .env.example .env.local 填 key/model，npm run dev 跑通
# 2. 建 Upstash Redis,拿 URL + Token
# 3. 推代码到 GitHub
# 4. vercel.com/new 导入 → 配 5 个环境变量 → Deploy
# 5. curl https://<域名>/api/daily 验证,再浏览器实聊一局
```
