import { snippet } from "../core/sink.js";
import { isRecord, type FeedItem, type HardRemoval, type Platform } from "../types.js";

export const STATS_KEY = "sieveStats";
export const LOG_KEY = "sieveLog";
export const DIAG_KEY = "sieveDiag";
export const LOG_CAP = 2000;
const MAX_DAYS = 400;
const MAX_DOC_SESSIONS = 50;

export interface Counts {
  seen: number;
  /** Graded or rule drops (dimmed, or removed when hideDropped is on). */
  dimmed: number;
  /** Unconditional removals: ad, shorts, promoted, suggested. */
  removed: number;
  reasons: Record<string, number>;
}
export type DayStats = Partial<Record<Platform, Counts>>;
export type StatsData = Record<string, DayStats>;
export interface LogEntry {
  site: Platform;
  text: string;
  reason: string;
  time: number;
}
export interface Diag {
  graderUnreachable: number;
}

/** Subset of chrome.storage.local, so tests can pass a fake. */
export interface KeyValueStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export const emptyCounts = (): Counts => ({ seen: 0, dimmed: 0, removed: 0, reasons: {} });

export function dayKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function sumStats(days: StatsData, onlyDay?: string): Partial<Record<Platform, Counts>> {
  const out: Partial<Record<Platform, Counts>> = {};
  for (const [day, sites] of Object.entries(days)) {
    if (onlyDay && day !== onlyDay) continue;
    for (const [site, c] of Object.entries(sites) as Array<[Platform, Counts]>) {
      const t = (out[site] ??= emptyCounts());
      t.seen += c.seen;
      t.dimmed += c.dimmed;
      t.removed += c.removed;
      for (const [r, n] of Object.entries(c.reasons)) t.reasons[r] = (t.reasons[r] ?? 0) + n;
    }
  }
  return out;
}

export function createStats(kv: KeyValueStore, now: () => number = Date.now) {
  // Writes are read-modify-write, so run them one at a time.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  // shortcut: page-session dedupe lives in memory; a service worker restart may recount an item once.
  const seenByDoc = new Map<string, Set<string>>();

  async function readStats(): Promise<StatsData> {
    const raw = (await kv.get(STATS_KEY))[STATS_KEY];
    return isRecord(raw) ? (raw as StatsData) : {};
  }
  async function readLog(): Promise<LogEntry[]> {
    const raw = (await kv.get(LOG_KEY))[LOG_KEY];
    return Array.isArray(raw) ? (raw as LogEntry[]) : [];
  }

  return {
    /** Counts items once per page session and records graded drops (id -> reason). */
    record(docKey: string, items: FeedItem[], dropped: Map<string, string>): Promise<void> {
      return serial(async () => {
        let seen = seenByDoc.get(docKey);
        if (!seen) {
          if (seenByDoc.size >= MAX_DOC_SESSIONS) seenByDoc.delete(seenByDoc.keys().next().value!);
          seen = new Set();
          seenByDoc.set(docKey, seen);
        }
        const t = now();
        const stats = await readStats();
        const day = (stats[dayKey(t)] ??= {});
        const logAdds: LogEntry[] = [];
        for (const item of items) {
          const key = `${item.platform}:${item.id}`;
          const c = (day[item.platform] ??= emptyCounts());
          if (!seen.has(key)) {
            seen.add(key);
            c.seen += 1;
          }
          const reason = dropped.get(item.id);
          if (reason !== undefined) {
            c.dimmed += 1;
            c.reasons[reason] = (c.reasons[reason] ?? 0) + 1;
            logAdds.push({ site: item.platform, text: snippet(item.titleOrText), reason, time: t });
          }
        }
        await write(stats, logAdds);
      });
    },

    recordRemoved(removals: HardRemoval[]): Promise<void> {
      if (removals.length === 0) return Promise.resolve();
      return serial(async () => {
        const t = now();
        const stats = await readStats();
        const day = (stats[dayKey(t)] ??= {});
        for (const r of removals) {
          const c = (day[r.site] ??= emptyCounts());
          c.removed += 1;
          c.reasons[r.reason] = (c.reasons[r.reason] ?? 0) + 1;
        }
        await write(
          stats,
          removals.map((r) => ({ site: r.site, text: r.text, reason: r.reason, time: t })),
        );
      });
    },

    bumpDiag(): Promise<void> {
      return serial(async () => {
        const raw = (await kv.get(DIAG_KEY))[DIAG_KEY];
        const n = isRecord(raw) && typeof raw.graderUnreachable === "number" ? raw.graderUnreachable : 0;
        await kv.set({ [DIAG_KEY]: { graderUnreachable: n + 1 } satisfies Diag });
      });
    },
  };

  async function write(stats: StatsData, logAdds: LogEntry[]): Promise<void> {
    for (const day of Object.keys(stats).sort().slice(0, -MAX_DAYS)) delete stats[day];
    const update: Record<string, unknown> = { [STATS_KEY]: stats };
    if (logAdds.length > 0) update[LOG_KEY] = [...(await readLog()), ...logAdds].slice(-LOG_CAP);
    await kv.set(update);
  }
}

// Readers and resets used by the options page (it has direct access to storage.local).
export async function readStatsData(kv: KeyValueStore): Promise<StatsData> {
  const raw = (await kv.get(STATS_KEY))[STATS_KEY];
  return isRecord(raw) ? (raw as StatsData) : {};
}
export async function readLogEntries(kv: KeyValueStore): Promise<LogEntry[]> {
  const raw = (await kv.get(LOG_KEY))[LOG_KEY];
  return Array.isArray(raw) ? (raw as LogEntry[]) : [];
}
export async function readDiag(kv: KeyValueStore): Promise<Diag> {
  const raw = (await kv.get(DIAG_KEY))[DIAG_KEY];
  return { graderUnreachable: isRecord(raw) && typeof raw.graderUnreachable === "number" ? raw.graderUnreachable : 0 };
}
