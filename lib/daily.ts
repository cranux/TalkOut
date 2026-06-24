import { CHARACTER_LIST } from "./characters";

// 每日同题:同一天所有人面对同一个角色,确定性地由日期推出。

export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

export function dailyCharacterId(date: string): string {
  const n = CHARACTER_LIST.length;
  const i = ((dayIndex(date) % n) + n) % n;
  return CHARACTER_LIST[i].id;
}
