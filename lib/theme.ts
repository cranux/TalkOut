export interface Theme {
  id: string;
  label: string;
  emoji: string;
}

export const THEMES: Theme[] = [
  { id: "light", label: "牛皮纸", emoji: "📜" },
  { id: "dark", label: "夜墨", emoji: "🌚" },
  { id: "sunset", label: "蜜桃", emoji: "🍑" },
  { id: "mint", label: "薄荷", emoji: "🌿" },
];

export const DEFAULT_THEME = "light";
const KEY = "talkout_theme";

export function applyTheme(id: string) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

export function currentTheme(): string {
  if (typeof document === "undefined") return DEFAULT_THEME;
  return document.documentElement.dataset.theme || DEFAULT_THEME;
}
