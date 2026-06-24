import { NextRequest, NextResponse } from "next/server";
import { recordEvent } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { event, props } = await req.json();
    if (typeof event === "string") {
      await recordEvent({ event, ...(props || {}) });
    }
  } catch {
    /* ignore */
  }
  return NextResponse.json({ ok: true });
}
