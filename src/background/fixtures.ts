// Dev-only fixture recorder: raw intercepted bodies in IndexedDB (extension origin, shared by
// the service worker and the options page).
const DB_NAME = "sieve_fixtures_v1";
const STORE = "samples";
export const FIXTURE_CAP = 60;

export interface FixtureRow {
  site: string;
  url: string;
  time: number;
  body: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const SITE_CAP = 25;

/**
 * Stores origin+path (no query string, which can carry tokens) and the raw body.
 * Exact duplicates are skipped; at most 25 per site and 60 overall, oldest evicted first.
 */
export async function addFixture(site: string, rawUrl: string, body: string): Promise<void> {
  const u = new URL(rawUrl);
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const cursorReq = store.openCursor();
  const rows: Array<{ key: IDBValidKey; site: string; same: boolean }> = [];
  cursorReq.onsuccess = () => {
    const cur = cursorReq.result;
    if (cur) {
      const row = cur.value as FixtureRow;
      rows.push({ key: cur.key, site: row.site, same: row.site === site && row.body === body });
      cur.continue();
      return;
    }
    if (rows.some((r) => r.same)) return;
    store.add({ site, url: u.origin + u.pathname, time: Date.now(), body } satisfies FixtureRow);
    const own = rows.filter((r) => r.site === site);
    for (const r of own.slice(0, Math.max(0, own.length + 1 - SITE_CAP))) {
      store.delete(r.key);
      rows.splice(rows.indexOf(r), 1);
    }
    for (const r of rows.slice(0, Math.max(0, rows.length + 1 - FIXTURE_CAP))) store.delete(r.key);
  };
  await done(tx);
  db.close();
}

export async function listFixtures(): Promise<FixtureRow[]> {
  const db = await openDb();
  const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
  const rows = await new Promise<FixtureRow[]>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as FixtureRow[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows;
}

export async function clearFixtures(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).clear();
  await done(tx);
  db.close();
}
