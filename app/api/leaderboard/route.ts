import { NextRequest, NextResponse } from "next/server";
import { dailyCharacterId, todayKey } from "@/lib/daily";
import { getBoard, submit, type Entry } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") || todayKey();
  const top = await getBoard(date);
  return NextResponse.json({ date, top });
}

export async function POST(req: NextRequest) {
  let body: {
    date?: string;
    characterId?: string;
    name?: string;
    anonId?: string;
    outcome?: string;
    rounds?: number;
    score?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const today = todayKey();
  // 只接受当天、对应当日角色、且通关的成绩
  if (body.date !== today) {
    return NextResponse.json({ error: "not today" }, { status: 400 });
  }
  if (body.characterId !== dailyCharacterId(today)) {
    return NextResponse.json({ error: "wrong character" }, { status: 400 });
  }
  if (body.outcome !== "won") {
    return NextResponse.json({ error: "not a win" }, { status: 400 });
  }
  if (
    typeof body.rounds !== "number" ||
    body.rounds < 1 ||
    body.rounds > 20 ||
    typeof body.score !== "number" ||
    !body.anonId
  ) {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  const entry: Entry = {
    name: (body.name || "无名氏").slice(0, 16),
    anonId: String(body.anonId).slice(0, 32),
    rounds: Math.round(body.rounds),
    score: Math.round(body.score),
    ts: Date.now(),
  };

  const result = await submit(today, entry);
  return NextResponse.json(result);
}
