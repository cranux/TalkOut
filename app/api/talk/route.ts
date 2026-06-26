import { NextRequest, NextResponse } from "next/server";
import { getCharacter } from "@/lib/characters";
import { generateGuardTurn } from "@/lib/llm";
import type { Character, GuardTurn, TalkHistoryItem, TalkRequest } from "@/lib/types";

export const runtime = "nodejs";

type Msg = { role: "user" | "assistant"; content: string };

export async function POST(req: NextRequest) {
  let body: TalkRequest;
  try {
    body = (await req.json()) as TalkRequest;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const character = getCharacter(body.characterId);
  if (!character) return NextResponse.json({ error: "unknown character" }, { status: 404 });

  if (!Array.isArray(body.history) || body.history.length === 0) {
    return NextResponse.json({ error: "empty history" }, { status: 400 });
  }
  if (body.history.length > character.maxRounds * 2 + 2) {
    return NextResponse.json({ error: "too many rounds" }, { status: 400 });
  }

  const convo = normalizeHistory(body.history);
  if (convo.length === 0) {
    return NextResponse.json({ error: "no user turn" }, { status: 400 });
  }

  try {
    const turn = await generateGuardTurn(buildSystem(character), convo);
    return NextResponse.json(turn satisfies GuardTurn);
  } catch (err) {
    console.error("[/api/talk] LLM error:", err);
    return NextResponse.json({ error: "llm failed" }, { status: 500 });
  }
}

function buildSystem(c: Character): string {
  return `${c.persona}

${c.softSpot}

${c.redLine}

玩家的目标是:${c.goal}
你刚才已经对玩家开口说过:"${c.opener}"

【评分规则 persuasion_delta(-20~+20)】严格、克制,像真人一样不轻易被说动:
- 空泛求情、重复同一套说辞、"我很急/很重要"、单纯情绪施压 → 0 或负分。
- 一般站得住脚的论点 → +3~+8。
- 首次精准戳中你的隐藏弱点、给出你真正在意的理由 → +10~+18。
- 同一个点反复用边际递减;逻辑前后矛盾、谎言被你戳穿 → 负分。
- 累计说服度接近 ${c.threshold} 时不要无故反弹,按这句话的真实分量给分。

【红线 redline_hit】仅当玩家明确越界(见上"红线")才为 true;单纯语气冲、不礼貌不算红线。

无论第几轮,都必须按下方规定的结构化格式回应一次,reply 贴合人设、简短口语。`;
}

/**
 * 把前端给的对话历史规整成模型友好的形式:
 * 1) 剥掉开头的 assistant 消息(开场白已写进 system,且首条必须是 user)。
 * 2) assistant 消息包成完整四字段 JSON 喂回——
 *    这是根治"模型多轮里漏字段"的关键:模型看见自己上一轮长这样,
 *    本轮就会照样吐齐 reply/emotion/persuasion_delta/redline_hit。
 *    没 meta(opener 或异常数据)时退化成 {reply},至少不漂回纯文本。
 */
function normalizeHistory(history: TalkHistoryItem[]): Msg[] {
  const h = [...history];
  while (h.length && h[0].role === "assistant") h.shift();
  return h.map((m) => {
    if (m.role !== "assistant") return { role: "user", content: m.content };
    const payload = m.meta ? { reply: m.content, ...m.meta } : { reply: m.content };
    return { role: "assistant", content: JSON.stringify(payload) };
  });
}
