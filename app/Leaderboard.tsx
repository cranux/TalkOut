"use client";

import { useEffect, useState } from "react";
import type { Entry } from "@/lib/store";

export default function Leaderboard({
  date,
  anonId,
}: {
  date: string;
  anonId?: string;
}) {
  const [rows, setRows] = useState<Entry[] | null>(null);

  useEffect(() => {
    let on = true;
    fetch(`/api/leaderboard?date=${date}`)
      .then((r) => r.json())
      .then((d) => on && setRows(d.top ?? []))
      .catch(() => on && setRows([]));
    return () => {
      on = false;
    };
  }, [date]);

  if (rows === null) return <div className="lb-empty">加载排行榜…</div>;
  if (rows.length === 0)
    return <div className="lb-empty">还没有人通关，来当第一个 👑</div>;

  return (
    <div className="lb">
      <div className="lb-title">🏆 今日排行榜</div>
      {rows.map((r, i) => (
        <div
          key={r.anonId + i}
          className={`lb-row ${r.anonId === anonId ? "me" : ""}`}
        >
          <span className="lb-rank">{i + 1}</span>
          <span className="lb-name">{r.name}</span>
          <span className="lb-meta">
            {r.rounds} 回合 · {r.score} 分
          </span>
        </div>
      ))}
    </div>
  );
}
