// Dev-only fixture recorder: raw intercepted bodies in IndexedDB (extension origin, shared by
// the service worker and the options page).
const DB_NAME = "sieve_fixtures_v1";
const STORE = "samples";
export const FIXTURE_CAP = 40;

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

/** Stores the origin+path (no query string, which can carry tokens) and the raw body; newest 40 win. */
export async function addFixture(site: string, rawUrl: string, body: string): Promise<void> {
  const u = new URL(rawUrl);
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  store.add({ site, url: u.origin + u.pathname, time: Date.now(), body } satisfies FixtureRow);
  const keysReq = store.getAllKeys();
  keysReq.onsuccess = () => {
    const extra = keysReq.result.length - FIXTURE_CAP;
    for (let i = 0; i < extra; i++) store.delete(keysReq.result[i]!);
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
