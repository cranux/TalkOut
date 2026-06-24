# 嘴遁 · TalkOut — M2

用一张嘴说服一个有性格、有底线、有隐藏弱点的 AI,让它做它本来不愿做的事。
含 **8 个角色 + 角色选择 + 对话循环 + 说服度判定 + 战报卡导出/分享 + 每日同题 + 排行榜 + 埋点**。详见 [`MVP.md`](./MVP.md)。

## 运行

```bash
npm install
cp .env.example .env.local   # 填入 LLM_API_KEY + LLM_MODEL(可选 LLM_BASE_URL)
npm run dev                  # http://localhost:3000
```

## 结构

```
app/
  page.tsx                角色选择页 + 今日挑战入口
  Game.tsx                单局对话(说服度条 / 三种结局 / 最骚金句 / 埋点 / daily 模式)
  ShareCard.tsx           战报卡:html-to-image 转 PNG,保存 / Web Share 分享
  DailyResult.tsx         每日结算:上榜提交 + 我的排名
  Leaderboard.tsx         今日排行榜
  api/talk/route.ts       任意 OpenAI 兼容模型,工具调用 / 纯 JSON 拿结构化输出
  api/daily/route.ts      今日同题:由日期确定性推出角色
  api/leaderboard/route.ts  GET 拉榜 / POST 提交(仅当天、当日角色、通关)
  api/track/route.ts      埋点接收
  layout.tsx · globals.css
lib/
  llm.ts          模型配置层:OpenAI 协议三件套(key+model+base_url)+ 工具/JSON 自适应
  characters.ts   8 个角色(人设 + 隐藏弱点 + 红线 + 阈值)
  daily.ts        今日 key + 确定性选角
  store.ts        文件版存储(.data/);上线换 Redis/Postgres,接口不变
  identity.ts     匿名 anonId + 昵称(localStorage)
  track.ts        客户端埋点
  types.ts        共享类型
```

## 数据 / 排行榜

- **双后端,自动切换**(`lib/store.ts`):设了 `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` 就用 **Upstash Redis**;没设就用本地文件 `.data/`(已 gitignore)。API 路由对此透明。
- 排名规则:**通关者按回合数升序**(越少越强),其次说服度,其次提交时间;同一玩家只留最好成绩。
  - Redis 实现用一个 ZSET/天,把三档规则压成单个复合分数(`rounds*1e12 + (100-score)*1e9 + tsSec`,整数精确),配 HASH 存详情,榜单 60 天 TTL 自动过期。
- 埋点事件:`game_start` / `game_end` / `card_save` / `card_share` / `daily_submit`(Redis 下进 `events` 列表,保留最近 5000 条)。

## 部署(Vercel + Upstash)

1. 在 [console.upstash.com](https://console.upstash.com) 建一个 Redis 数据库,复制 **REST URL** 和 **REST Token**。
2. 本地跑一次自检:`npm run preflight`(检查环境变量 + 构建,有问题会非零退出)。
3. 部署到 Vercel(`vercel` 或连 Git 仓库),在 Project → Settings → Environment Variables 配:
   - `LLM_API_KEY` + `LLM_MODEL`(+ 可选 `LLM_BASE_URL`)
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
4. 重新部署。排行榜/埋点即走 Redis,跨实例持久化,无需改任何代码。
   - `vercel.json` 已把 `/api/*` 的 `maxDuration` 设为 30s,给 LLM 调用留足时间。

> 本地想验证 Redis 路径:把上面两个 Upstash 变量也写进 `.env.local`,`npm run dev` 即可。不写则继续用文件存储。

## 脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发 |
| `npm run preflight` | 部署前自检:环境变量 + 构建 |
| `npm run eval` | 判定准度评测:用剧本台词打 `/api/talk`,逐轮打印 delta/结局供眼检(需先 `npm run dev` 且配好 key) |

## 换模型(只改环境变量)

NPC 大脑由 `lib/llm.ts` 统一走 OpenAI 协议,换模型不动业务代码。**三件套**:

| 变量 | 必填 | 说明 |
|---|---|---|
| `LLM_API_KEY` | ✓ | 服务商的 key |
| `LLM_MODEL` | ✓ | 模型名,如 `gpt-4o-mini` / `deepseek-chat` |
| `LLM_BASE_URL` | 选填 | 接口地址;留空 = OpenAI 官方端点 |

常见服务商的 `LLM_BASE_URL`(填官方型号名即可):

| 服务商 | LLM_BASE_URL | 型号示例 |
|---|---|---|
| OpenAI | 留空 | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 阿里 Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Moonshot | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| 中转/私有 | 你的网关地址 `…/v1` | 网关支持的型号 |

```bash
LLM_API_KEY=sk-xxx
LLM_MODEL=deepseek-chat
LLM_BASE_URL=https://api.deepseek.com/v1
```

**可选**:`LLM_MAX_TOKENS`(默认 1024,思考模型调高)、`LLM_TOOL_MODE`:
- `auto`(默认)— 先试工具调用,遇到不支持自动降级为纯 JSON
- `tool` — 强制 function calling(结构最稳)
- `json` — 从不发 tools,纯提示词 + 解析,**兼容纯推理模型**(如 deepseek-reasoner)

## 分享文案

战报卡支持一键带文案分享:移动端 `navigator.share` 直接把图片 + 文案(含每日挑战钩子和站点链接)发到系统分享面板;桌面端可「复制分享文案」。文案逻辑见 `app/ShareCard.tsx` 的 `buildShareText`。

## 角色(8)

门卫·老张 / 海关 AI·K / 前任·小薇 / 老板·陈总 / 外星调查员·Zorp / 退款 AI·9527 / 丈母娘·王阿姨 / 智能门锁·小锁。

## 核心机制

- 模型每轮**一次调用**同时「扮演角色 + 当裁判」,返回:
  `{ reply, emotion, persuasion_delta(-20..20), redline_hit }`
- 前端累计说服度:满 `threshold`(100)= 赢;`redline_hit` = 当场翻车;回合耗尽 = 失败。

## M0 验证目标

跑通后只问一个问题:**玩完想不想再来一局 / 想不想发给朋友?**
是 → 继续做 M1(8 角色 + 战报卡);不是 → 改角色(弱点/红线/金句),别先改技术。
