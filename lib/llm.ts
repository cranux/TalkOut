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
// 强调“每一轮”——防止多轮对话里模型漂回纯聊天、忘了套 JSON。
const JSON_INSTRUCTION = `输出格式(每一轮都必须遵守,不管第几轮):优先调用工具 ${TOOL_NAME};若不调用工具,则本次回复**只能是一个 JSON 对象**,不许有任何前后缀、解释或代码围栏。角色台词写进 reply 字段,不要直接当聊天发出来。字段:
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

// 进程级记忆:发现一次就记住,后续不再重复试错
let runtimeToolsDisabled = false; // 模型不支持工具调用
let runtimeJsonFormatUnsupported = false; // 端点不支持 response_format

/** 从模型回复里拿不到可用结构(没工具调用、正文也没 JSON)→ 触发降级,而非直接 500 */
class NoJsonError extends Error {
  constructor(msg = "模型输出里找不到 JSON") {
    super(msg);
    this.name = "NoJsonError";
  }
}

/**
 * 统一入口:给 system + 对话,返回结构化的一轮结果。逐级降级,任何 OpenAI 兼容端点都能跑:
 *   1) 工具调用(tool_choice=auto)        ——结构最稳
 *   2) response_format=json_object        ——解码层强制只吐 JSON,**多轮不会漂**
 *   3) 纯提示词 + 容错解析                ——连 response_format 都不收的端点兜底
 * 环境变量 LLM_TOOL_MODE:auto(默认,1→2→3) | tool(只走 1,失败即抛) | json(2→3,从不发工具)
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

  // 模式 tool:只走工具,失败如实抛(诊断用)
  if (mode === "tool") {
    return parseTurn(await complete(client, cfg, sys, messages, { useTools: true }));
  }

  // 模式 auto:① 先试工具
  if (mode === "auto" && !runtimeToolsDisabled) {
    try {
      return parseTurn(await complete(client, cfg, sys, messages, { useTools: true }));
    } catch (err) {
      if (isToolUnsupported(err)) {
        runtimeToolsDisabled = true;
        console.warn("[llm] 模型不支持工具调用 → 降级 JSON 模式");
      } else if (!(err instanceof NoJsonError)) {
        throw err; // 网络/鉴权/限流等真错误,如实抛出
      }
      // NoJsonError(没调工具、正文也没 JSON)或工具不支持 → 落到 ② JSON 模式
    }
  }

  // ② response_format=json_object → ③ 纯提示词
  return jsonCompletion(client, cfg, sys, messages);
}

/** JSON 模式:先用 response_format 强约束;端点不支持就退回纯提示词 */
async function jsonCompletion(
  client: OpenAI,
  cfg: ResolvedConfig,
  sys: string,
  messages: Msg[]
): Promise<GuardTurn> {
  if (!runtimeJsonFormatUnsupported) {
    try {
      return parseTurn(
        await complete(client, cfg, sys, messages, { jsonMode: true })
      );
    } catch (err) {
      if (isResponseFormatUnsupported(err)) {
        runtimeJsonFormatUnsupported = true;
        console.warn("[llm] 端点不支持 response_format → 退回纯提示词");
      } else {
        throw err; // 含 NoJsonError:json_object 都没 JSON,属异常
      }
    }
  }
  // ③ 最后兜底:纯提示词 + 容错解析
  return parseTurn(await complete(client, cfg, sys, messages, {}));
}

/** 发一次请求。useTools→带工具定义;jsonMode→带 response_format。都不带 = 纯文本。 */
async function complete(
  client: OpenAI,
  cfg: ResolvedConfig,
  sys: string,
  messages: Msg[],
  opts: { useTools?: boolean; jsonMode?: boolean } = {}
) {
  const res = await client.chat.completions.create({
    model: cfg.model,
    // 思考模型的推理 token 也算在内,太小容易只剩推理 → 默认 1024,可用 LLM_MAX_TOKENS 调高
    max_tokens: Number(process.env.LLM_MAX_TOKENS) || 1024,
    messages: [{ role: "system", content: sys }, ...messages],
    ...(opts.useTools ? { tools: TOOLS, tool_choice: "auto" as const } : {}),
    ...(opts.jsonMode
      ? { response_format: { type: "json_object" as const } }
      : {}),
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
  // 没工具调用、也没正文 → 当作"拿不到结构化输出",交给上层降级
  throw new NoJsonError("模型没有返回可用的工具调用或文本内容");
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

/** 判断错误是否为"端点不支持 response_format / json_object"的 400 */
function isResponseFormatUnsupported(err: unknown): boolean {
  const e = err as {
    status?: number;
    message?: string;
    error?: { message?: string };
  };
  if (e?.status !== 400) return false;
  const m = `${e?.message ?? ""} ${e?.error?.message ?? ""}`.toLowerCase();
  return /response_format|response format|json_object|json mode|不支持/.test(m);
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
    throw new NoJsonError();
  }
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    // 截断/畸形 JSON 也当作"拿不到结构化输出",交给上层降级(而非裸 SyntaxError → 500)
    throw new NoJsonError("JSON 解析失败(可能被 max_tokens 截断)");
  }
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
