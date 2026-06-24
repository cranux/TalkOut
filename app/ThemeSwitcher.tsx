"use client";

import { useEffect, useState } from "react";
import { THEMES, applyTheme, currentTheme } from "@/lib/theme";

export default function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(THEMES[0].id);

  useEffect(() => {
    setCur(currentTheme());
  }, []);

  const active = THEMES.find((t) => t.id === cur) ?? THEMES[0];

  return (
    <div className="theme-switch">
      <button
        className="ts-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="切换主题"
      >
        {active.emoji}
      </button>
      {open && (
        <>
          <div className="ts-backdrop" onClick={() => setOpen(false)} />
          <div className="ts-menu">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`ts-item ${t.id === cur ? "on" : ""}`}
                onClick={() => {
                  applyTheme(t.id);
                  setCur(t.id);
                  setOpen(false);
                }}
              >
                <span className="ts-emoji">{t.emoji}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
