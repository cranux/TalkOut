"use client";

import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { track } from "@/lib/track";
import type { Character, Outcome } from "@/lib/types";

export interface CardData {
  character: Character;
  outcome: Exclude<Outcome, "ongoing">;
  rounds: number;
  score: number;
  /** 玩家本局最骚的一句(说服度涨最多) */
  bestLine: string | null;
  /** AI 角色最后一句台词 */
  lastLine: string;
  /** 每日同题日期 YYYY-MM-DD;自由练习则为 undefined */
  daily?: string;
}

function buildShareText(data: CardData): string {
  const who = data.character.name;
  const url = typeof window !== "undefined" ? window.location.origin : "";
  const tail = url ? ` 👉 ${url}` : "";
  if (data.outcome === "won") {
    return data.daily
      ? `🗣️ 我在「嘴遁」${data.daily} 今日挑战 ${data.rounds} 回合说服了${who}！来挑同一题${tail}`
      : `🗣️ 我 ${data.rounds} 回合在「嘴遁」说服了${who}！你也来试试${tail}`;
  }
  if (data.outcome === "lost_redline") {
    return `💥 我在「嘴遁」嘴瓢踩了${who}的红线,当场翻车…不服来试${tail}`;
  }
  return `😮‍💨 我在「嘴遁」没能说服${who},就差一点!你来挑战${tail}`;
}

const STAMP: Record<CardData["outcome"], { text: string; cls: string }> = {
  won: { text: "说服成功", cls: "won" },
  lost_redline: { text: "当场翻车", cls: "lost" },
  lost_rounds: { text: "差一点…", cls: "lost" },
};

export default function ShareCard({ data }: { data: CardData }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const stamp = STAMP[data.outcome];

  async function render(): Promise<string | null> {
    if (!cardRef.current) return null;
    return toPng(cardRef.current, { pixelRatio: 2, cacheBust: true });
  }

  async function save() {
    setBusy(true);
    try {
      const url = await render();
      if (!url) return;
      const a = document.createElement("a");
      a.href = url;
      a.download = `talkout-${data.character.id}.png`;
      a.click();
      track("card_save", { characterId: data.character.id, outcome: data.outcome });
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    setBusy(true);
    try {
      const url = await render();
      if (!url) return;
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], "talkout.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "嘴遁 · TalkOut",
          text: buildShareText(data),
        });
        track("card_share", { characterId: data.character.id, outcome: data.outcome });
      } else {
        await save();
      }
    } catch {
      /* 用户取消分享,忽略 */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sharecard-wrap">
      <div className={`sharecard ${stamp.cls}`} ref={cardRef}>
        <div className="sc-stamp">{stamp.text}</div>
        {data.daily && <div className="sc-daily">🗓 {data.daily} 今日挑战</div>}
        <div className="sc-avatar">{data.character.avatar}</div>
        <div className="sc-name">{data.character.name}</div>
        <div className="sc-goal">🎯 {data.character.goal}</div>

        <div className="sc-quotes">
          {data.bestLine && (
            <div className="sc-quote me">
              <span className="sc-who">我</span>
              {data.bestLine}
            </div>
          )}
          <div className="sc-quote them">
            <span className="sc-who">{data.character.name}</span>
            {data.lastLine}
          </div>
        </div>

        <div className="sc-stats">
          <span>说服度 {data.score}/{data.character.threshold}</span>
          <span>{data.rounds} 回合</span>
        </div>
        <div className="sc-mark">嘴遁 · TalkOut</div>
      </div>

      <div className="card-actions">
        <button onClick={save} disabled={busy}>
          {busy ? "生成中…" : "保存图片"}
        </button>
        <button onClick={share} disabled={busy} className="primary">
          分享战报
        </button>
      </div>
      <button
        className="copy-text"
        onClick={() => {
          navigator.clipboard?.writeText(buildShareText(data));
          setCopied(true);
        }}
      >
        {copied ? "✓ 文案已复制" : "复制分享文案"}
      </button>
    </div>
  );
}
