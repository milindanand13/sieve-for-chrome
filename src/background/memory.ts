import { creatorKeysFor } from "../core/sieve.js";
import {
  isRecord,
  type CreatorRecord,
  type FeedItem,
  type MemoryStore,
  type Platform,
  type ResolvedVerdict,
} from "../types.js";

const ITEM_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// The user's own right-click verdicts never expire by age (LRU eviction at the cap still applies).
const expired = (v: { at: number; reason?: string }, now: number): boolean =>
  !v.reason?.startsWith("you: ") && now - v.at > ITEM_TTL_MS;
const CREATOR_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DB_NAME = "sieve_memory_v1";

interface StoredVerdict {
  key: string;
  verdict: ResolvedVerdict;
  reason?: string;
  at: number;
}

interface MemoryOptions {
  maxItems?: number;
}

function isStoredVerdict(v: unknown): v is StoredVerdict {
  return (
    isRecord(v) &&
    typeof v.key === "string" &&
    (v.verdict === "keep" || v.verdict === "drop") &&
    typeof v.at === "number"
  );
}

function isCreatorRecord(v: unknown): v is CreatorRecord {
  return (
    isRecord(v) &&
    typeof v.key === "string" &&
    typeof v.keeps === "number" &&
    typeof v.drops === "number" &&
    typeof v.updatedAt === "number"
  );
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("items")) {
          db.createObjectStore("items", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("creators")) {
          db.createObjectStore("creators", { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function createMemoryStore(options: MemoryOptions = {}): MemoryStore {
  const maxItems = options.maxItems ?? 50_000;
  const items = new Map<string, StoredVerdict>();
  const creators = new Map<string, CreatorRecord>();

  const dbPromise = openDb();
  const ready: Promise<void> = dbPromise.then((db) => {
    if (!db) return;
    const now = Date.now();
    return new Promise<void>((done) => {
    try {
      // Readwrite so expired rows are deleted instead of re-read on every wake.
      const tx = db.transaction(["items", "creators"], "readwrite");
      const itemStore = tx.objectStore("items");
      const itemReq = itemStore.getAll();
      itemReq.onsuccess = () => {
        if (!Array.isArray(itemReq.result)) return;
        const live: StoredVerdict[] = [];
        for (const row of itemReq.result) {
          if (!isStoredVerdict(row)) continue;
          if (expired(row, now)) itemStore.delete(row.key);
          else live.push(row);
        }
        // Over the cap, keep the newest rows (oldest first = LRU order in the Map).
        for (const row of live.sort((a, b) => a.at - b.at).slice(-maxItems)) items.set(row.key, row);
      };
      const creatorStore = tx.objectStore("creators");
      const creatorReq = creatorStore.getAll();
      creatorReq.onsuccess = () => {
        if (!Array.isArray(creatorReq.result)) return;
        for (const row of creatorReq.result) {
          if (!isCreatorRecord(row)) continue;
          if (now - row.updatedAt <= CREATOR_TTL_MS) creators.set(row.key, row);
          else creatorStore.delete(row.key);
        }
      };
      tx.oncomplete = () => done();
      tx.onerror = () => done();
      tx.onabort = () => done();
    } catch {
      // Restricted or private contexts fall back to in-memory Maps.
      done();
    }
    });
  });

  function itemMapKey(platform: Platform, id: string): string {
    return `${platform}:${id}`;
  }

  function creatorMapKey(platform: Platform, creatorKey: string): string {
    return `${platform}:${creatorKey}`;
  }

  function evaluateCreatorRecord(rec: CreatorRecord | undefined): ResolvedVerdict | undefined {
    if (!rec) return undefined;
    if (Date.now() - rec.updatedAt > CREATOR_TTL_MS) {
      creators.delete(rec.key);
      return undefined;
    }
    const total = rec.keeps + rec.drops;
    if (total >= 3 && rec.keeps / total >= 0.8) return "keep";
    if (total >= 5 && rec.keeps / total <= 0.15) return "drop";
    return undefined;
  }

  return {
    ready,
    getItemVerdict(platform, id) {
      const key = itemMapKey(platform, id);
      const hit = items.get(key);
      if (!hit) return undefined;
      if (expired(hit, Date.now())) {
        items.delete(key);
        return undefined;
      }
      items.delete(key);
      items.set(key, hit);
      return hit.verdict;
    },

    getItemReason(platform, id) {
      return items.get(itemMapKey(platform, id))?.reason;
    },

    getCreatorVerdict(platform, rawKey) {
      const normalized = rawKey.toLowerCase();
      // Per-site keys only: a verdict learned on YouTube never applies to X or Instagram.
      return evaluateCreatorRecord(creators.get(creatorMapKey(platform, normalized)));
    },

    async recordVerdict(item: FeedItem, verdict: ResolvedVerdict, reason?: string) {
      const now = Date.now();
      const iKey = itemMapKey(item.platform, item.id);
      // A grader verdict never overrides the user's own call on the same item.
      if (!reason?.startsWith("you: ") && items.get(iKey)?.reason?.startsWith("you: ")) return;
      const entry: StoredVerdict = { key: iKey, verdict, at: now, ...(reason ? { reason } : {}) };

      // A repeat of the user's same call on the same post must not count toward the creator again.
      const repeat = !!reason?.startsWith("you: ") && items.get(iKey)?.reason === reason;
      if (items.has(iKey)) items.delete(iKey);
      items.set(iKey, entry);

      let evictedKey: string | undefined;
      if (items.size > maxItems) {
        evictedKey = items.keys().next().value;
        if (evictedKey) items.delete(evictedKey);
      }

      const updatedCreators: CreatorRecord[] = [];
      const bucketKeys = new Set<string>();
      for (const cKey of creatorKeysFor(item)) {
        bucketKeys.add(creatorMapKey(item.platform, cKey));
      }

      for (const fullKey of bucketKeys) {
        const existing = creators.get(fullKey) ?? {
          key: fullKey,
          keeps: 0,
          drops: 0,
          updatedAt: now,
        };
        // The user's own calls count double, so two corrections teach Sieve a creator.
        const weight = repeat ? 0 : reason?.startsWith("you: ") ? 2 : 1;
        if (verdict === "keep") existing.keeps += weight;
        else existing.drops += weight;
        existing.updatedAt = now;
        creators.set(fullKey, existing);
        updatedCreators.push(existing);
      }

      const db = await dbPromise;
      if (!db) return;
      try {
        const tx = db.transaction(["items", "creators"], "readwrite");
        const itemStore = tx.objectStore("items");
        itemStore.put(entry);
        if (evictedKey) itemStore.delete(evictedKey);
        const creatorStore = tx.objectStore("creators");
        for (const rec of updatedCreators) creatorStore.put(rec);
      } catch {
        // Private browsing or quota limits leave in-memory entries active.
      }
    },

    async clear(options = {}) {
      // keepUser: the user's own item calls stay; creator counts mix grader verdicts, so they always reset.
      for (const [k, v] of items) if (!options.keepUser || !v.reason?.startsWith("you: ")) items.delete(k);
      creators.clear();
      const db = await dbPromise;
      if (!db) return;
      try {
        const tx = db.transaction(["items", "creators"], "readwrite");
        if (options.keepUser) {
          const cursorReq = tx.objectStore("items").openCursor();
          cursorReq.onsuccess = () => {
            const cur = cursorReq.result;
            if (!cur) return;
            if (!(cur.value as StoredVerdict).reason?.startsWith("you: ")) cur.delete();
            cur.continue();
          };
          tx.objectStore("creators").clear();
        } else {
          tx.objectStore("items").clear();
          tx.objectStore("creators").clear();
        }
      } catch {
        // Private browsing may reject write transactions.
      }
    },

    counts() {
      let learnedCreators = 0;
      for (const rec of creators.values()) {
        if (evaluateCreatorRecord(rec) !== undefined) learnedCreators += 1;
      }
      return {
        cachedItems: items.size,
        learnedCreators,
      };
    },
  };
}
