"use client";

import { useEffect, useState } from "react";
import { CHARACTER_LIST, getCharacter } from "@/lib/characters";
import type { Character } from "@/lib/types";
import Game from "./Game";
import ThemeSwitcher from "./ThemeSwitcher";

interface Pick {
  character: Character;
  daily?: string;
}

export default function Page() {
  const [picked, setPicked] = useState<Pick | null>(null);
  const [daily, setDaily] = useState<{ date: string; character: Character } | null>(
    null
  );

  useEffect(() => {
    fetch("/api/daily")
      .then((r) => r.json())
      .then((d) => {
        const c = getCharacter(d.characterId);
        if (c) setDaily({ date: d.date, character: c });
      })
      .catch(() => {});
  }, []);

  if (picked) {
    return (
      <Game
        character={picked.character}
        daily={picked.daily}
        onExit={() => setPicked(null)}
      />
    );
  }

  return (
    <div className="app">
      <ThemeSwitcher />
      <div className="select">
        <div className="select-hero">
          <h1>嘴遁 · TalkOut</h1>
          <p>用一张嘴，说服一个死活不肯松口的 AI。挑个对手开聊。</p>
        </div>

        {daily && (
          <button
            className="daily-banner"
            onClick={() =>
              setPicked({ character: daily.character, daily: daily.date })
            }
          >
            <span className="db-badge">🏆 今日挑战</span>
            <span className="db-avatar">{daily.character.avatar}</span>
            <span className="db-name">{daily.character.name}</span>
            <span className="db-sub">人人同题 · 比谁回合最少 · 上榜</span>
          </button>
        )}

        <div className="select-label">自由练习</div>
        <div className="card-grid">
          {CHARACTER_LIST.map((c) => (
            <button
              key={c.id}
              className="char-card"
              onClick={() => setPicked({ character: c })}
            >
              <span className="cc-avatar">{c.avatar}</span>
              <span className="cc-name">{c.name}</span>
              <span className="cc-tagline">{c.tagline}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
