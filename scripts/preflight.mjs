#!/usr/bin/env node
// 部署前自检:环境变量 → 构建。任一硬性检查失败则非零退出。
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

let hardFail = false;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  hardFail = true;
};

// 同时从 .env.local 读取(本地);Vercel/CI 用真实 process.env
function loadEnvLocal() {
  const env = { ...process.env };
  if (existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

console.log("\n▶ TalkOut 部署自检\n");
const env = loadEnvLocal();

// 1) Node 版本
const major = Number(process.versions.node.split(".")[0]);
major >= 18 ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node}(需 ≥18)`);

// 2) 必填:模型三件套(key + model;base_url 选填,留空走 OpenAI 官方)
env.LLM_API_KEY
  ? ok("LLM_API_KEY 已设置")
  : bad("缺 LLM_API_KEY(对话功能必需)");
env.LLM_MODEL
  ? ok(`LLM_MODEL = ${env.LLM_MODEL}${env.LLM_BASE_URL ? ` @ ${env.LLM_BASE_URL}` : " (OpenAI 官方端点)"}`)
  : bad("缺 LLM_MODEL(对话功能必需,如 gpt-4o-mini / deepseek-chat)");

// 3) 存储后端
const hasUrl = !!env.UPSTASH_REDIS_REST_URL;
const hasTok = !!env.UPSTASH_REDIS_REST_TOKEN;
if (hasUrl && hasTok) ok("Upstash Redis 已配置(可部署到 serverless)");
else if (hasUrl || hasTok) bad("Upstash 变量只配了一半,需同时设置 URL 和 TOKEN");
else warn("未配 Upstash → 用文件存储。serverless(Vercel)上排行榜不会持久化,上线请配置");

// 4) 构建
console.log("\n▶ 运行 next build …\n");
try {
  execSync("npm run build", { stdio: "inherit" });
  ok("构建通过");
} catch {
  bad("构建失败(见上方输出)");
}

console.log("");
if (hardFail) {
  console.log("\x1b[31m自检未通过,先修复上面的 ✗ 再部署。\x1b[0m\n");
  process.exit(1);
}
console.log("\x1b[32m自检通过,可以部署 🚀\x1b[0m\n");
