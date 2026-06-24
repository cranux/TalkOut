import OpenAI from "openai";
import type { Emotion, GuardTurn } from "./types";

// ── 模型配置层(统一 OpenAI 协议)──────────────────────────
// 任何 OpenAI 兼容端点都行,三件套即可:
//   LLM_API_KEY  = 服务商的 key                          (必填)
//   LLM_MODEL    = 模型名,如 gpt-4o-mini / deepseek-chat (必填)
//   LLM_BASE_URL = 接口地址,如 https://api.deepseek.com/v1(选填;留空 = OpenAI 官方端点)
// 另有可选:LLM_MAX_TOKENS(默认 1024)、LLM_TOOL_MODE(auto|tool|json,默认 auto)

type ResolvedConfig = { apiKey: string; model: string; baseURL?: string };

export function llmConfig(): {
  apiKey?: string;
  model?: string;
  baseURL?: string;
} {
  return {
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL,
    baseURL: process.env.LLM_BASE_URL, // 留空则走 OpenAI SDK 默认端点
  };
}

// 结构化输出的参数 schema(function calling)
const PARAMS = {
  type: "object",
  properties: {
    reply: { type: "string", description: "角色这一轮的台词(口语、简短、贴合人设)。" },
    emotion: {
      type: "string",
      enum: ["wary", "amused", "annoyed", "won_over"],
      description: "角色当前情绪。",
    },
    persuasion_delta: {
      type: "integer",
      description: "本轮说服度变化,-20 到 +20。",
    },
    redline_hit: { type: "boolean", description: "玩家是否踩了红线。" },
  },
  required: ["reply", "emotion", "persuasion_delta", "redline_hit"],
} as const;

const TOOL_NAME = "guard_response";

type Msg = { role: "user" | "assistant"; content: string };

// 兜底输出说明:当模型不调用工具时(思考模型常见),让它直接吐等价 JSON。
const JSON_INSTRUCTION = `输出要求:优先调用工具 ${TOOL_NAME} 返回结果;若无法调用工具,则只输出一个等价的 JSON 对象,不要任何额外文字或代码围栏,字段为:
{"reply": "角色台词", "emotion": "wary|amused|annoyed|won_over", "persuasion_delta": -20到20的整数, "redline_hit": true或false}`;

// guard_response 工具定义(支持 function calling 的模型走这条路,结构最稳)
const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: TOOL_NAME,
      description: "以角色身份回应玩家,并给出本轮说服度判定。每一轮都必须调用。",
      parameters: PARAMS,
    },
  },
];

// 进程级记忆:auto 模式下一旦发现模型不支持工具,后续直接走纯 JSON,不再每次试错
let runtimeToolsDisabled = false;

/**
 * 统一入口:给 system + 对话,返回结构化的一轮结果。
 * 三种模式(环境变量 LLM_TOOL_MODE 控制):
 *   auto(默认)— 先试工具调用,遇到"不支持工具/tool_choice"的 400 自动降级为纯 JSON
 *   tool       — 始终发工具(明确知道模型支持时用)
 *   json       — 从不发 tools,只靠提示词 + 容错解析(兼容纯推理模型)
 */
export async function generateGuardTurn(
  system: string,
  messages: Msg[]
): Promise<GuardTurn> {
  const raw = llmConfig();
  if (!raw.apiKey) throw new Error("缺少 LLM_API_KEY");
  if (!raw.model) throw new Error("缺少 LLM_MODEL(请指定模型名)");
  const cfg: ResolvedConfig = {
    apiKey: raw.apiKey,
    model: raw.model,
    baseURL: raw.baseURL,
  };

  const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
  const sys = `${system}\n\n${JSON_INSTRUCTION}`;

  const mode = (process.env.LLM_TOOL_MODE || "auto").toLowerCase();
  const tryTools = mode !== "json" && !runtimeToolsDisabled;

  if (tryTools) {
    try {
      return parseTurn(await complete(client, cfg, sys, messages, true));
    } catch (err) {
      // 只有 auto 模式才自动降级;tool 模式让错误抛出,方便排查
      if (mode === "auto" && isToolUnsupported(err)) {
        runtimeToolsDisabled = true;
        console.warn("[llm] 当前模型不支持工具调用,自动降级为纯 JSON 模式");
      } else {
        throw err;
      }
    }
  }

  // 纯 JSON 模式:不发 tools / tool_choice,任何 OpenAI 兼容端点都能跑
  return parseTurn(await complete(client, cfg, sys, messages, false));
}

/** 发一次请求;useTools=false 时完全不带 tools 字段(纯推理模型也不会报 400) */
async function complete(
  client: OpenAI,
  cfg: ResolvedConfig,
  sys: string,
  messages: Msg[],
  useTools: boolean
) {
  const res = await client.chat.completions.create({
    model: cfg.model,
    // 思考模型的推理 token 也算在内,400 容易只剩推理、答案为空 → 默认调高,可用 LLM_MAX_TOKENS 覆盖
    max_tokens: Number(process.env.LLM_MAX_TOKENS) || 1024,
    messages: [{ role: "system", content: sys }, ...messages],
    ...(useTools ? { tools: TOOLS, tool_choice: "auto" as const } : {}),
  });
  return res.choices[0]?.message;
}

/** 先认工具调用的参数,没有就退回从正文抠 JSON */
function parseTurn(
  msg: Awaited<ReturnType<typeof complete>>
): GuardTurn {
  const call = msg?.tool_calls?.[0];
  if (call && call.type === "function") {
    return normalizeGuardTurn(safeParse(call.function.arguments));
  }
  if (msg?.content) {
    return normalizeGuardTurn(extractJson(msg.content));
  }
  throw new Error("模型没有返回可用的工具调用或文本内容");
}

/** 判断错误是否为"模型/服务商不支持工具或强制 tool_choice"的 400 */
function isToolUnsupported(err: unknown): boolean {
  const e = err as {
    status?: number;
    message?: string;
    error?: { message?: string };
  };
  if (e?.status !== 400) return false;
  const m = `${e?.message ?? ""} ${e?.error?.message ?? ""}`.toLowerCase();
  return /tool|function|tool_choice|thinking|不支持/.test(m);
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return extractJson(s);
  }
}

/** 容错地从模型文本中提取 JSON:去掉 <think> 推理块与 ```json 围栏,取第一个 {...} */
function extractJson(text: string): unknown {
  let s = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1];
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("模型输出里找不到 JSON");
  }
  return JSON.parse(s.slice(start, end + 1));
}

/** 把可能脏的对象规整成合法的 GuardTurn(防止字符串数字、缺字段等) */
function normalizeGuardTurn(o: unknown): GuardTurn {
  const obj = (o ?? {}) as Record<string, unknown>;
  const emotions: Emotion[] = ["wary", "amused", "annoyed", "won_over"];

  let delta = Number(obj.persuasion_delta);
  if (!Number.isFinite(delta)) delta = 0;
  delta = Math.max(-20, Math.min(20, Math.round(delta)));

  const emotion = emotions.includes(obj.emotion as Emotion)
    ? (obj.emotion as Emotion)
    : "wary";

  return {
    reply: String(obj.reply ?? "").trim() || "……",
    emotion,
    persuasion_delta: delta,
    redline_hit: obj.redline_hit === true || obj.redline_hit === "true",
  };
}
