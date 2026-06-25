"use client";

import { useEffect, useRef, useState } from "react";
import type { Character, Emotion, GuardTurn, Outcome } from "@/lib/types";
import { track } from "@/lib/track";
import ShareCard, { type CardData } from "./ShareCard";
import DailyResult from "./DailyResult";
import ThemeSwitcher from "./ThemeSwitcher";

interface Line {
  role: "user" | "assistant";
  content: string;
  delta?: number;
}

const EMOJI: Record<Emotion, string> = {
  wary: "🤨",
  amused: "😏",
  annoyed: "😠",
  won_over: "🥹",
};

export default function Game({
  character,
  onExit,
  daily,
}: {
  character: Character;
  onExit: () => void;
  /** 每日同题模式:传入当天日期 YYYY-MM-DD */
  daily?: string;
}) {
  const mode = daily ? "daily" : "free";
  const [lines, setLines] = useState<Line[]>([
    { role: "assistant", content: character.opener },
  ]);
  const [persuasion, setPersuasion] = useState(0);
  const [outcome, setOutcome] = useState<Outcome>("ongoing");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [emotion, setEmotion] = useState<Emotion>("wary");
  const [best, setBest] = useState<{ content: string; delta: number } | null>(
    null
  );
  const [netError, setNetError] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const rounds = lines.filter((l) => l.role === "user").length;

  useEffect(() => {
    track("game_start", { mode, characterId: character.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.id]);

  useEffect(() => {
    chatRef.current?.scrollTo({
      top: chatRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [lines, loading, outcome]);

  async function send() {
    const text = input.trim();
    if (!text || loading || outcome !== "ongoing") return;

    const prevLines = lines;
    const nextLines: Line[] = [...lines, { role: "user", content: text }];
    setLines(nextLines);
    setInput("");
    setLoading(true);
    setNetError(false);

    try {
      const res = await fetch("/api/talk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId: character.id,
          history: nextLines.map((l) => ({ role: l.role, content: l.content })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const turn = (await res.json()) as GuardTurn;

      const withDelta = nextLines.map((l, i) =>
        i === nextLines.length - 1 ? { ...l, delta: turn.persuasion_delta } : l
      );
      const newScore = Math.max(
        0,
        Math.min(character.threshold, persuasion + turn.persuasion_delta)
      );

      setPersuasion(newScore);
      setEmotion(turn.emotion);
      setLines([...withDelta, { role: "assistant", content: turn.reply }]);
      if (!best || turn.persuasion_delta > best.delta) {
        setBest({ content: text, delta: turn.persuasion_delta });
      }

      let end: Outcome = "ongoing";
      if (turn.redline_hit) end = "lost_redline";
      else if (newScore >= character.threshold) end = "won";
      else if (rounds + 1 >= character.maxRounds) end = "lost_rounds";

      if (end !== "ongoing") {
        setOutcome(end);
        track("game_end", {
          mode,
          characterId: character.id,
          outcome: end,
          rounds: rounds + 1,
          score: newScore,
        });
      }
    } catch {
      // 网络抽风/请求失败:这一回合作废,回滚到发送前 —— 不计入回合数,
      // 把刚才那句还给输入框,让用户原样重发。
      setLines(prevLines);
      setInput(text);
      setNetError(true);
    } finally {
      setLoading(false);
    }
  }

  function restart() {
    setLines([{ role: "assistant", content: character.opener }]);
    setPersuasion(0);
    setOutcome("ongoing");
    setEmotion("wary");
    setBest(null);
    setInput("");
    track("game_start", { mode, characterId: character.id });
  }

  const ended = outcome !== "ongoing";
  const cardData: CardData | null = ended
    ? {
        character,
        outcome: outcome as CardData["outcome"],
        rounds,
        score: persuasion,
        bestLine: best && best.delta > 0 ? best.content : null,
        lastLine: lines[lines.length - 1]?.content ?? "",
        daily,
      }
    : null;

  return (
    <div className="app">
      <ThemeSwitcher />
      <div className="header">
        <button className="back" onClick={onExit}>
          ← 返回
        </button>
        <h1>
          {EMOJI[emotion]} {character.name}
          {daily && <span className="daily-tag">每日挑战</span>}
        </h1>
        <div className="scene">{character.scene}</div>
        <div className="goal">🎯 {character.goal}</div>
        <div className="meter">
          <div className="bar">
            <div
              className="fill"
              style={{ width: `${(persuasion / character.threshold) * 100}%` }}
            />
          </div>
          <div className="label">
            <span>
              说服度 {persuasion}/{character.threshold}
            </span>
            <span>
              回合 {rounds}/{character.maxRounds}
            </span>
          </div>
        </div>
      </div>

      <div className="chat" ref={chatRef}>
        {lines.map((l, i) => (
          <div key={i} style={{ display: "contents" }}>
            <div className={`bubble ${l.role === "user" ? "me" : "them"}`}>
              {l.content}
            </div>
            {l.delta !== undefined && l.delta !== 0 && (
              <div className={`delta ${l.delta > 0 ? "up" : "down"}`}>
                说服度 {l.delta > 0 ? "+" : ""}
                {l.delta}
              </div>
            )}
          </div>
        ))}

        {loading && <div className="typing">{character.name} 正在想…</div>}

        {netError && !loading && (
          <div className="net-error" role="alert">
            ⚠️ 网络抽风,这句没发出去 —— 不算回合,再点发送试一次。
          </div>
        )}

        {outcome === "won" && (
          <div className="outcome won">🎉 你说服了 {character.name}！</div>
        )}
        {outcome === "lost_redline" && (
          <div className="outcome lost">💥 你踩了红线，当场翻车。</div>
        )}
        {outcome === "lost_rounds" && (
          <div className="outcome lost">⏳ 回合用尽，没能说服。</div>
        )}

        {cardData && <ShareCard data={cardData} />}

        {ended && daily && (
          <DailyResult
            date={daily}
            characterId={character.id}
            outcome={outcome as "won" | "lost_redline" | "lost_rounds"}
            rounds={rounds}
            score={persuasion}
          />
        )}
      </div>

      {ended ? (
        <div className="end-actions">
          <button className="ghost" onClick={onExit}>
            返回
          </button>
          <button className="restart" onClick={restart}>
            再来一局
          </button>
        </div>
      ) : (
        <div className="composer">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="说点什么说服他…"
            disabled={loading}
            autoFocus
          />
          <button onClick={send} disabled={loading || !input.trim()}>
            发送
          </button>
        </div>
      )}
    </div>
  );
}
