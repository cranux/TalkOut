import { NextResponse } from "next/server";
import { dailyCharacterId, todayKey } from "@/lib/daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const date = todayKey();
  return NextResponse.json({ date, characterId: dailyCharacterId(date) });
}
