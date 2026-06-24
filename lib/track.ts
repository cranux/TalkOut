// 极简埋点:fire-and-forget,失败不影响游戏。事件落到 .data/events.ndjson。

export function track(event: string, props: Record<string, unknown> = {}) {
  try {
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, props }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
