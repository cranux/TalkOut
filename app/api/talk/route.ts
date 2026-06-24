import { NextRequest, NextResponse } from "next/server";
import { getCharacter } from "@/lib/characters";
import { generateGuardTurn } from "@/lib/llm";
import type { GuardTurn, TalkRequest } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: TalkRequest;
  try {
    body = (await req.json()) as TalkRequest;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const character = getCharacter(body.characterId);
  if (!character) {
    return NextResponse.json({ error: "unknown character" }, { status: 404 });
  }
  if (!Array.isArray(body.history) || body.history.length === 0) {
    return NextResponse.json({ error: "empty history" }, { status: 400 });
  }
  if (body.history.length > character.maxRounds * 2 + 2) {
    return NextResponse.json({ error: "too many rounds" }, { status: 400 });
  }

  const system = `${character.persona}

${character.softSpot}

${character.redLine}

玩家的目标是:${character.goal}
你刚才已经对玩家开口说过:"${character.opener}"

【评分规则 persuasion_delta(-20~+20)】严格、克制,像真人一样不轻易被说动:
- 空泛求情、重复同一套说辞、"我很急/很重要"、单纯情绪施压 → 0 或负分。
- 一般站得住脚的论点 → +3~+8。
- 首次精准戳中你的隐藏弱点、给出你真正在意的理由 → +10~+18。
- 同一个点反复用边际递减;逻辑前后矛盾、谎言被你戳穿 → 负分。
- 累计说服度接近 ${character.threshold} 时不要无故反弹,按这句话的真实分量给分。

【红线 redline_hit】仅当玩家明确越界(见上"红线")才为 true;单纯语气冲、不礼貌不算红线。

无论如何,每一轮都必须调用 guard_response 工具来回应,reply 贴合人设、简短口语。`;

  // Anthropic 要求首条消息为 user:剥掉开场白等前导的 assistant 消息(开场白已写进 system)
  const convo = (() => {
    const h = [...body.history];
    while (h.length && h[0].role === "assistant") h.shift();
    return h.map((m) => ({ role: m.role, content: m.content }));
  })();
  if (convo.length === 0) {
    return NextResponse.json({ error: "no user turn" }, { status: 400 });
  }

  try {
    const turn = (await generateGuardTurn(system, convo)) as GuardTurn;
    // 钳制范围,防止模型给出越界的 delta
    turn.persuasion_delta = Math.max(-20, Math.min(20, turn.persuasion_delta));
    return NextResponse.json(turn);
  } catch (err) {
    console.error("[/api/talk] LLM error:", err);
    return NextResponse.json({ error: "llm failed" }, { status: 500 });
  }
}
