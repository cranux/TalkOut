# 部署文档 · 嘴遁 TalkOut

本项目是 **Next.js 全栈应用**(前端 + API 后端一体),需要能跑 Node 的环境,不能当纯静态站托管。
推荐 **Vercel + Upstash Redis**(都有免费额度,零运维)。

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
> 可选 `LLM_MAX_TOKENS`(默认 1024,思考模型调高)、`LLM_TOOL_MODE`(`auto`|`tool`|`json`,纯推理模型用 `json`)。
> 不配 Upstash 也能启动,但会退回**文件存储**——在 Vercel 这种 serverless 上磁盘不持久化,排行榜会丢。所以线上务必配 Upstash。

### 拿模型 Key + 对应 base_url
去对应控制台拿 key 填进 `LLM_API_KEY`,并按下表配 `LLM_BASE_URL` / `LLM_MODEL`:
- OpenAI → [platform.openai.com](https://platform.openai.com) · `LLM_BASE_URL` 留空 · 型号 `gpt-4o-mini`
- DeepSeek → [platform.deepseek.com](https://platform.deepseek.com) · `https://api.deepseek.com/v1` · `deepseek-chat`
- 阿里 Qwen → 百炼 DashScope · `https://dashscope.aliyuncs.com/compatible-mode/v1` · `qwen-plus`
- Moonshot(Kimi) → `https://api.moonshot.cn/v1` · `moonshot-v1-8k`
- 智谱 GLM → `https://open.bigmodel.cn/api/paas/v4` · `glm-4-flash`
- 中转/私有网关 → 你的 `…/v1` 地址 · 网关支持的型号

### 建 Upstash Redis(免费)
1. 登录 [console.upstash.com](https://console.upstash.com) → **Create Database**(Redis)。
2. 选离用户最近的区域(国内受众可选日本/新加坡)。
3. 进数据库详情页 → 找到 **REST API** 区块,复制:
   - `UPSTASH_REDIS_REST_URL`(形如 `https://xxx.upstash.io`)
   - `UPSTASH_REDIS_REST_TOKEN`

---

## 1. 部署到 Vercel(推荐)

### 方式 A:连 Git 仓库(适合长期维护)

1. 把代码推到 GitHub/GitLab:
   ```bash
   cd /Users/crounix/data/www/project/game
   git init && git add . && git commit -m "init: talkout"
   git branch -M main
   git remote add origin <你的仓库地址>
   git push -u origin main
   ```
   > `.gitignore` 已排除 `node_modules / .next / .env.local / .data`,不会泄露 key。

2. 打开 [vercel.com/new](https://vercel.com/new) → 导入该仓库。Framework 会自动识别为 Next.js,无需改构建命令。

3. 在导入页(或 Project → Settings → **Environment Variables**)添加变量:
   ```
   LLM_API_KEY                = <你的模型 key>
   LLM_MODEL                  = deepseek-chat
   LLM_BASE_URL               = https://api.deepseek.com/v1   # 用 OpenAI 官方可留空
   UPSTASH_REDIS_REST_URL     = https://xxx.upstash.io
   UPSTASH_REDIS_REST_TOKEN   = ...
   ```
   都勾选 Production(以及 Preview/Development 视需要)。

4. 点 **Deploy**。完成后给你一个 `https://<项目名>.vercel.app` 域名。

> 之后每次 `git push` 到 main 会自动重新部署。

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

### 上线前自检(可选但建议)
```bash
cp .env.example .env.local   # 填好三个变量
npm run preflight            # 检查环境变量 + 跑一次构建,失败会非零退出
```

---

## 2. 上线后验证(2 分钟)

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
#    能正常对话 = LLM_API_KEY 生效
#    聊赢能上榜 = Redis 生效
```

如果第 2 步报错或排行榜刷新后消失 → 检查 Upstash 两个变量是否都配了、值是否正确。

---

## 3. 自托管(VPS / 自己的服务器)

需要 Node ≥ 18 的常驻进程。

```bash
cd /path/to/talkout
npm ci
npm run build
# 环境变量(或写进 systemd / .env 由进程管理器注入)
export LLM_API_KEY=<你的模型 key>
export LLM_MODEL=deepseek-chat
export LLM_BASE_URL=https://api.deepseek.com/v1   # 用 OpenAI 官方可省略
export UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
export UPSTASH_REDIS_REST_TOKEN=...
npm run start        # 默认 0.0.0.0:3000
```

- 生产建议用 **pm2** 守护:`pm2 start "npm run start" --name talkout`。
- 前面挂 **Nginx** 反代 + HTTPS(`navigator.share` / 剪贴板等需要 HTTPS 才生效)。
- 自托管若是**单实例**,可以不配 Upstash,用默认文件存储(`.data/` 会持久化);多实例则仍需 Upstash 共享。

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
docker run -p 3000:3000 \
  -e LLM_API_KEY=<你的模型 key> \
  -e LLM_MODEL=deepseek-chat \
  -e LLM_BASE_URL=https://api.deepseek.com/v1 \
  -e UPSTASH_REDIS_REST_URL=https://xxx.upstash.io \
  -e UPSTASH_REDIS_REST_TOKEN=... \
  talkout
```

---

## 4. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 对话报错、聊不动 | `LLM_API_KEY` / `LLM_MODEL` 没配或无效,或 `LLM_BASE_URL` 与 key 不匹配;查 Vercel 函数日志 |
| 排行榜刷新就清空 | 没配 Upstash → 走了文件存储,serverless 不持久化。配上两个 Upstash 变量重新部署 |
| 分享/复制文案无效 | 这些 API 需要 **HTTPS**;Vercel 默认 HTTPS,自托管要配证书 |
| `/api/talk` 超时 | LLM 响应慢;`vercel.json` 已设 `maxDuration:30`,如仍超时检查网络/区域 |
| 改了代码线上没更新 | 方式 A 需 `git push`;方式 B 需重跑 `vercel --prod` |

---

## 速查:最短路径

```bash
# 1. 建 Upstash Redis,拿 URL + Token
# 2. 推代码到 GitHub
# 3. vercel.com/new 导入 → 配 3 个环境变量 → Deploy
# 4. curl https://<域名>/api/daily 验证
```
