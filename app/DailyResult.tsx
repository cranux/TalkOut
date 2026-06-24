"use client";

import { useState } from "react";
import { getAnonId, getName, setName as persistName } from "@/lib/identity";
import { track } from "@/lib/track";
import Leaderboard from "./Leaderboard";

export default function DailyResult({
  date,
  characterId,
  outcome,
  rounds,
  score,
}: {
  date: string;
  characterId: string;
  outcome: "won" | "lost_redline" | "lost_rounds";
  rounds: number;
  score: number;
}) {
  const anonId = getAnonId();
  const [name, setName] = useState(getName());
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ rank: number; total: number } | null>(
    null
  );

  async function submit() {
    const nm = name.trim() || "无名氏";
    persistName(nm);
    setSubmitting(true);
    try {
      const res = await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          characterId,
          name: nm,
          anonId,
          outcome,
          rounds,
          score,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        setResult({ rank: d.rank, total: d.total });
        track("daily_submit", { characterId, rounds, score, rank: d.rank });
      }
    } finally {
      setSubmitting(false);
    }
  }

  // 没通关:不能上榜,只看榜
  if (outcome !== "won") {
    return (
      <div className="daily-result">
        <div className="dr-hint">今天没说服成功，明天再来挑战 👀</div>
        <Leaderboard date={date} anonId={anonId} />
      </div>
    );
  }

  // 通关但还没提交
  if (!result) {
    return (
      <div className="daily-result">
        <div className="dr-hint">
          🎉 {rounds} 回合通关！留个名字上今日榜单：
        </div>
        <div className="dr-submit">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="你的昵称"
            maxLength={16}
          />
          <button onClick={submit} disabled={submitting} className="primary">
            {submitting ? "提交中…" : "上榜"}
          </button>
        </div>
      </div>
    );
  }

  // 已提交
  return (
    <div className="daily-result">
      <div className="dr-rank">
        你今天排第 <b>{result.rank}</b> / 共 {result.total} 人
      </div>
      <Leaderboard key="submitted" date={date} anonId={anonId} />
    </div>
  );
}
