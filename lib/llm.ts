import OpenAI from "openai";
import type { Emotion, GuardTurn } from "./types";

// ── 配置 ─────────────────────────────────────────────────────────
// 任何 OpenAI 兼容端点都能跑,三件套必填:
//   LLM_API_KEY   服务商 key
//   LLM_MODEL     模型名(deepseek-chat / gpt-4o-mini / glm-4-flash / ...)
//   LLM_BASE_URL  端点地址,留空 = OpenAI 官方
// 可选:
//   LLM_TOOL_MODE   auto(默认,tool→json→prompt)| tool | json
//   LLM_MAX_TOKENS  默认 1024;思考模型建议调高
//   LLM_TIMEOUT_MS  默认 50000;略小于 vercel maxDuration 才能优雅返 500
//   LLM_MAX_RETRIES 默认 0;慢思考模型重试会叠加延迟撞函数上限
//   LLM_EXTRA_BODY  JSON 字符串,透传给接口的额外字段(最常用:关思考)

type ResolvedConfig = { apiKey: string; model: string; baseURL?: string };
type Msg = { role: "user" | "assistant"; content: string };
type Mode = "tool" | "json" | "prompt";

export function llmConfig() {
  return {
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL,
    baseURL: process.env.LLM_BASE_URL,
  };
}

// ── 结构化输出 schema ────────────────────────────────────────────

const TOOL_NAME = "guard_response";
const EMOTIONS: Emotion[] = ["wary", "amused", "annoyed", "won_over"];

const SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "角色这一轮的台词(口语、简短、贴合人设)。" },
    emotion: { type: "string", enum: EMOTIONS, description: "角色当前情绪。" },
    persuasion_delta: { type: "integer", description: "本轮说服度变化,-20 到 +20。" },
    redline_hit: { type: "boolean", description: "玩家是否踩了红线。" },
  },
  required: ["reply", "emotion", "persuasion_delta", "redline_hit"],
} as const;

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: TOOL_NAME,
      description: "以角色身份回应玩家,并给出本轮说服度判定。每一轮都必须调用。",
      parameters: SCHEMA,
    },
  },
];

// 多轮里防止模型漂回纯聊天的兜底说明(json/prompt 模式需要它当 schema 文档)。
// 显式要求 4 字段全填:很多小模型会偷懒省"无意义"字段(0、false 之类),
// 漏字段在前端会渲染成"说服度 ？",玩家体验会以为是 bug。
const JSON_INSTRUCTION = `输出格式(每一轮都必须遵守):优先调用工具 ${TOOL_NAME};若不调用工具,则本次回复**只能是一个 JSON 对象**,不许有任何前后缀、解释或代码围栏。角色台词写进 reply 字段,不要直接当聊天发出来。

**四个字段全部必填,一个都不许省略**,即便 persuasion_delta 这一轮判 0、redline_hit 是 false,也必须显式写出来。字段:
{"reply": "角色台词", "emotion": "wary|amused|annoyed|won_over", "persuasion_delta": -20到20的整数, "redline_hit": true或false}`;

// ── 错误模型 ─────────────────────────────────────────────────────

/** 拿不到可解析结构(没调工具、正文也没 JSON)→ 触发降级,不当真错 */
class NoJsonError extends Error {
  override name = "NoJsonError";
  constructor(msg = "模型输出里找不到 JSON") {
    super(msg);
  }
}

// 进程级 sticky:端点 400 拒收某能力 → 记住,后续别再撞同一面墙。
// 注意:NoJsonError 不锁——那是模型多轮漂移,端点本身可能完全支持。
const blocked: Partial<Record<Mode, boolean>> = {};

const TOOL_REJECT = /tool|function|tool_choice|thinking|不支持/;
const JSON_REJECT = /response_format|response format|json_object|json mode|不支持/;

function endpointRejected(err: unknown, pattern: RegExp): boolean {
  const e = err as { status?: number; message?: string; error?: { message?: string } };
  if (e?.status !== 400) return false;
  const m = `${e?.message ?? ""} ${e?.error?.message ?? ""}`.toLowerCase();
  return pattern.test(m);
}

type Decision = "throw" | "retry" | "stick";

/** 错误归类:本模式失败后该怎么处理 */
function classify(err: unknown, mode: Mode): Decision {
  if (err instanceof NoJsonError) return "retry";
  if (mode === "tool" && endpointRejected(err, TOOL_REJECT)) return "stick";
  if (mode === "json" && endpointRejected(err, JSON_REJECT)) return "stick";
  return "throw"; // 网络 / 鉴权 / 限流 / 未识别 400 → 都是真错,不假装没事
}

// ── 主流程 ───────────────────────────────────────────────────────

/**
 * 给 system + 对话,返回结构化的一轮结果。
 * 降级链(任何 OpenAI 兼容端点都能跑):
 *   tool   工具调用,结构最稳(模型支持 function calling 才行)
 *   json   response_format=json_object,解码层强制 JSON
 *   prompt 纯提示词 + 容错解析,什么都不需要
 * LLM_TOOL_MODE:auto(默认)/ tool(只走工具,失败即抛)/ json(json→prompt)
 */
export async function generateGuardTurn(system: string, messages: Msg[]): Promise<GuardTurn> {
  const cfg = requireConfig();
  const client = buildClient(cfg);
  const sys = `${system}\n\n${JSON_INSTRUCTION}`;
  const chain = chainFor(envMode());

  let lastErr: unknown;
  for (const mode of chain) {
    if (blocked[mode]) continue;
    try {
      return await runOnce(mode, client, cfg, sys, messages);
    } catch (err) {
      lastErr = err;
      const decision = classify(err, mode);
      if (decision === "throw") throw err;
      if (decision === "stick") {
        blocked[mode] = true;
        console.warn(`[llm] ${mode} 模式端点拒收 → 永久降级`);
      } else {
        console.warn(`[llm] ${mode} 模式未返回可解析 JSON → 本次降级再试`);
      }
    }
  }
  throw lastErr ?? new Error("LLM 所有降级路径都失败");
}

function envMode(): "auto" | "tool" | "json" {
  const m = (process.env.LLM_TOOL_MODE || "auto").toLowerCase();
  return m === "tool" || m === "json" ? m : "auto";
}

function chainFor(mode: "auto" | "tool" | "json"): Mode[] {
  if (mode === "tool") return ["tool"];
  if (mode === "json") return ["json", "prompt"];
  return ["tool", "json", "prompt"];
}

// ── 单次请求 ─────────────────────────────────────────────────────

async function runOnce(
  mode: Mode,
  client: OpenAI,
  cfg: ResolvedConfig,
  sys: string,
  messages: Msg[]
): Promise<GuardTurn> {
  const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model: cfg.model,
    // 思考模型的推理 token 也算在内,太小容易只剩推理空间 → 默认 1024
    max_tokens: Number(process.env.LLM_MAX_TOKENS) || 1024,
    messages: [{ role: "system", content: sys }, ...messages],
    ...(mode === "tool" ? { tools: TOOLS, tool_choice: "auto" as const } : {}),
    ...(mode === "json" ? { response_format: { type: "json_object" as const } } : {}),
    ...extraBody(), // 放最后:可按需覆盖前面字段
  };
  const res = await client.chat.completions.create(body);
  return parseTurn(res.choices[0]?.message);
}

function parseTurn(msg: OpenAI.Chat.Completions.ChatCompletionMessage | undefined): GuardTurn {
  const call = msg?.tool_calls?.[0];
  if (call?.type === "function") return normalize(parseLoose(call.function.arguments));
  if (msg?.content) return normalize(extractJson(msg.content));
  throw new NoJsonError("模型没有返回可用的工具调用或文本内容");
}

// ── 客户端 / 配置 ────────────────────────────────────────────────

function requireConfig(): ResolvedConfig {
  const { apiKey, model, baseURL } = llmConfig();
  if (!apiKey) throw new Error("缺少 LLM_API_KEY");
  if (!model) throw new Error("缺少 LLM_MODEL(请指定模型名)");
  return { apiKey, model, baseURL };
}

function buildClient(cfg: ResolvedConfig): OpenAI {
  // 超时略小于 Vercel maxDuration:慢端点优雅返 500("网络抽风"且不计回合),
  // 不被平台硬超时成 504。maxRetries=0:429/5xx 重试会把耗时翻几倍撞函数上限。
  return new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL,
    timeout: Number(process.env.LLM_TIMEOUT_MS) || 50_000,
    maxRetries: Number(process.env.LLM_MAX_RETRIES) || 0,
  });
}

/**
 * LLM_EXTRA_BODY:透传到接口的额外字段。最大用途:关思考模型推理,大幅降延迟。
 * 不同网关参数名不同,任选其一:
 *   GLM/智谱:    {"thinking":{"type":"disabled"}}
 *   vLLM/中转:   {"chat_template_kwargs":{"enable_thinking":false}}
 *   通用推理档:  {"reasoning_effort":"low"}
 */
function extraBody(): Record<string, unknown> {
  const raw = process.env.LLM_EXTRA_BODY;
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? (o as Record<string, unknown>) : {};
  } catch {
    console.warn("[llm] LLM_EXTRA_BODY 不是合法 JSON,已忽略");
    return {};
  }
}

// ── 文本解析 ─────────────────────────────────────────────────────

function parseLoose(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return extractJson(s);
  }
}

/** 去 <think> 与 ```json 围栏,取最外层 {...}。失败抛 NoJsonError(让上层降级,不要 500)。 */
function extractJson(text: string): unknown {
  let s = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1];
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) throw new NoJsonError();
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    throw new NoJsonError("JSON 解析失败(可能被 max_tokens 截断)");
  }
}

function normalize(o: unknown): GuardTurn {
  const obj = (o ?? {}) as Record<string, unknown>;
  const raw = obj.persuasion_delta;
  // 显式区分"模型漏填/填错"和"模型给了 0":前者前端会渲染 ?,后者渲染 ±0
  const missing = raw === undefined || raw === null || !Number.isFinite(Number(raw));
  const delta = missing ? 0 : Math.max(-20, Math.min(20, Math.round(Number(raw))));
  return {
    reply: String(obj.reply ?? "").trim() || "……",
    emotion: EMOTIONS.includes(obj.emotion as Emotion) ? (obj.emotion as Emotion) : "wary",
    persuasion_delta: delta,
    delta_missing: missing,
    redline_hit: obj.redline_hit === true || obj.redline_hit === "true",
  };
}
