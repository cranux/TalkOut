import { promises as fs } from "fs";
import path from "path";
import { Redis } from "@upstash/redis";

// 双后端存储:
//   有 UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN  → 用 Upstash Redis(可部署)
//   否则                                                  → 文件版(本地零配置)
// API 路由只依赖下面三个导出函数,后端切换对其透明。

export interface Entry {
  name: string;
  anonId: string;
  rounds: number;
  score: number;
  ts: number;
}

interface Backend {
  getBoard(date: string, top: number): Promise<Entry[]>;
  submit(
    date: string,
    entry: Entry,
    top: number
  ): Promise<{ rank: number; total: number; top: Entry[] }>;
  recordEvent(ev: Record<string, unknown>): Promise<void>;
}

// 排名:回合越少越靠前,其次说服度越高,其次越早提交
function rankEntries(entries: Entry[]): Entry[] {
  return [...entries].sort(
    (a, b) => a.rounds - b.rounds || b.score - a.score || a.ts - b.ts
  );
}

/* ----------------------------- 文件后端 ----------------------------- */

const DATA_DIR = path.join(process.cwd(), ".data");
const LB_FILE = path.join(DATA_DIR, "leaderboard.json");
const EV_FILE = path.join(DATA_DIR, "events.ndjson");

let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

type Board = Record<string, Entry[]>;

const fileBackend: Backend = {
  async getBoard(date, top) {
    const b = await readFileBoard();
    return rankEntries(b[date] || []).slice(0, top);
  },
  async submit(date, entry, top) {
    return withLock(async () => {
      const b = await readFileBoard();
      const list = b[date] || [];
      const i = list.findIndex((x) => x.anonId === entry.anonId);
      if (i >= 0) {
        if (entry.rounds < list[i].rounds) list[i] = entry;
      } else {
        list.push(entry);
      }
      b[date] = list;
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(LB_FILE, JSON.stringify(b));
      const ranked = rankEntries(list);
      const idx = ranked.findIndex((x) => x.anonId === entry.anonId);
      return { rank: idx + 1, total: ranked.length, top: ranked.slice(0, top) };
    });
  },
  async recordEvent(ev) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.appendFile(EV_FILE, JSON.stringify({ ...ev, ts: Date.now() }) + "\n");
  },
};

async function readFileBoard(): Promise<Board> {
  try {
    return JSON.parse(await fs.readFile(LB_FILE, "utf8")) as Board;
  } catch {
    return {};
  }
}

/* ----------------------------- Redis 后端 ---------------------------- */

const DAY_TTL = 60 * 24 * 3600; // 榜单保留 60 天
const EPOCH = Math.floor(Date.UTC(2025, 0, 1) / 1000);

// 把 (回合↑优, 说服度↓优, 时间↓优) 压成一个用于 ZSET 升序的复合分数。
// 量级:rounds*1e12(主) + (100-score)*1e9(次) + tsSec(末),最大约 2e13 << 2^53,整数精确。
function composite(e: Entry): number {
  const tsSec = Math.floor(e.ts / 1000) - EPOCH;
  return e.rounds * 1e12 + (100 - e.score) * 1e9 + tsSec;
}

function makeRedisBackend(redis: Redis): Backend {
  const zKey = (d: string) => `lb:z:${d}`; // ZSET: member=anonId, score=composite
  const hKey = (d: string) => `lb:h:${d}`; // HASH: anonId -> Entry

  async function detailsFor(date: string, ids: string[]): Promise<Entry[]> {
    if (ids.length === 0) return [];
    const raws = await Promise.all(
      ids.map((id) => redis.hget<Entry>(hKey(date), id))
    );
    return raws
      .map((r) => (typeof r === "string" ? (JSON.parse(r) as Entry) : r))
      .filter((e): e is Entry => !!e);
  }

  return {
    async getBoard(date, top) {
      const ids = (await redis.zrange<string[]>(zKey(date), 0, top - 1)) || [];
      return detailsFor(date, ids);
    },

    async submit(date, entry, top) {
      const existing = await redis.hget<Entry>(hKey(date), entry.anonId);
      const prev =
        typeof existing === "string" ? (JSON.parse(existing) as Entry) : existing;
      // 同一玩家只保留更优(回合更少)成绩
      if (!prev || entry.rounds < prev.rounds) {
        await redis.zadd(zKey(date), { score: composite(entry), member: entry.anonId });
        await redis.hset(hKey(date), { [entry.anonId]: entry });
        await redis.expire(zKey(date), DAY_TTL);
        await redis.expire(hKey(date), DAY_TTL);
      }
      const rankAsc = await redis.zrank(zKey(date), entry.anonId);
      const total = await redis.zcard(zKey(date));
      const ids = (await redis.zrange<string[]>(zKey(date), 0, top - 1)) || [];
      return {
        rank: (rankAsc ?? 0) + 1,
        total,
        top: await detailsFor(date, ids),
      };
    },

    async recordEvent(ev) {
      await redis.rpush("events", JSON.stringify({ ...ev, ts: Date.now() }));
      await redis.ltrim("events", -5000, -1); // 只留最近 5000 条
    },
  };
}

/* --------------------------- 选择后端并导出 -------------------------- */

const backend: Backend =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? makeRedisBackend(Redis.fromEnv())
    : fileBackend;

export const STORE_BACKEND =
  process.env.UPSTASH_REDIS_REST_URL ? "upstash-redis" : "file";

export function getBoard(date: string, top = 20): Promise<Entry[]> {
  return backend.getBoard(date, top);
}

export function submit(
  date: string,
  entry: Entry,
  top = 20
): Promise<{ rank: number; total: number; top: Entry[] }> {
  return backend.submit(date, entry, top);
}

export async function recordEvent(ev: Record<string, unknown>): Promise<void> {
  try {
    await backend.recordEvent(ev);
  } catch {
    /* 埋点失败不影响主流程 */
  }
}
