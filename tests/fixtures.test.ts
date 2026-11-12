// Runs the real rewrite path over captured feed responses. Skips when tests/fixtures is absent.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rewriteResponseBody, shouldFilterUrl } from "../src/background/rewrite.js";
import { runSieveDetailed } from "../src/core/sieve.js";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import type { FeedItem, MemoryStore, SeedSets, SieveConfig } from "../src/types.js";

const dir = path.join(process.cwd(), "tests", "fixtures");
const urlsFile = path.join(dir, "urls.json");
const have = existsSync(urlsFile);

function seedSet(name: string): Set<string> {
  const p = path.join(process.cwd(), "extension/assets/seeds", name);
  return new Set(existsSync(p) ? readFileSync(p, "utf8").split("\n").map((l) => l.trim()).filter(Boolean) : []);
}

const seeds: SeedSets = {
  hnVideos: seedSet("hn-videos.txt"),
  hnChannels: seedSet("hn-channels.txt"),
  slopChannels: seedSet("slop-channels.txt"),
};

const memory: MemoryStore = {
  getItemVerdict: () => undefined,
  getCreatorVerdict: () => undefined,
  recordVerdict: async () => {},
  clear: async () => {},
  counts: () => ({ cachedItems: 0, learnedCreators: 0, droppedTotal: 0 }),
};

/** Normalized key paths: array indexes collapse to [], values are ignored. */
export function keyPaths(node: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    out.add(`${prefix}[]`);
    for (const el of node) keyPaths(el, `${prefix}[]`, out);
  } else if (typeof node === "object" && node !== null) {
    for (const [k, v] of Object.entries(node)) {
      out.add(`${prefix}.${k}`);
      keyPaths(v, `${prefix}.${k}`, out);
    }
  }
  return out;
}

function listLengths(node: unknown, prefix = "", out = new Map<string, number>()): Map<string, number> {
  if (Array.isArray(node)) {
    out.set(prefix, (out.get(prefix) ?? 0) + node.length);
    for (const el of node) listLengths(el, `${prefix}[]`, out);
  } else if (typeof node === "object" && node !== null) {
    for (const [k, v] of Object.entries(node)) listLengths(v, `${prefix}.${k}`, out);
  }
  return out;
}

const config = (over: Partial<SieveConfig> = {}): SieveConfig => ({
  ...DEFAULT_CONFIG,
  grader: { ...DEFAULT_CONFIG.grader, mode: "off" },
  ...over,
});

interface Row {
  fixture: string;
  endpoint: string;
  bytes: number;
  seen: number;
  dimmed: number;
  removed: number;
  reasons: string;
}

describe.skipIf(!have)("captured fixtures", () => {
  const urls: Record<string, string> = have ? JSON.parse(readFileSync(urlsFile, "utf8")) : {};
  const rows: Row[] = [];

  for (const hide of [false, true]) {
    it(`rewrites every accepted fixture safely (hideDropped=${hide})`, async () => {
      for (const site of readdirSync(dir).filter((n) => existsSync(path.join(dir, n)) && !n.endsWith(".json"))) {
        for (const file of readdirSync(path.join(dir, site)).sort()) {
          const id = `${site}/${file.replace(".json", "")}`;
          const url = urls[id];
          if (!url) continue;
          const cfg = config({ display: { hideDropped: hide }, tiktok: { ...DEFAULT_CONFIG.tiktok, enabled: false } });
          if (!shouldFilterUrl(new URL(url), cfg)) continue;

          const body = readFileSync(path.join(dir, site, file), "utf8");
          let seen = 0;
          const reasons = new Map<string, number>();
          const res = await rewriteResponseBody(url, `https://${new URL(url).hostname}/`, body, cfg, {
            evaluate: async (items: FeedItem[]) => {
              seen += items.length;
              return runSieveDetailed(items, cfg, seeds, memory);
            },
          });

          if (res === null) {
            // Allowed only when the body is not JSON.
            expect(() => JSON.parse(body), `${id} returned null for JSON input`).toThrow();
            continue;
          }
          const before: unknown = JSON.parse(body);
          const after: unknown = JSON.parse(res.body);

          // Structure: no key the page needs may vanish unless it sat inside a list that shrank.
          const pIn = keyPaths(before);
          const pOut = keyPaths(after);
          const lenIn = listLengths(before);
          const lenOut = listLengths(after);
          const shrank = [...lenIn].some(([p, n]) => (lenOut.get(p) ?? 0) < n);
          const missing = [...pIn].filter((p) => !pOut.has(p));
          if (!shrank) expect(missing, `${id}: keys vanished without any list shrinking`).toEqual([]);
          for (const p of missing) expect(p.includes("[]"), `${id}: top-level key vanished: ${p}`).toBe(true);
          // Nothing new invented except fields the adapters touch in place.
          const added = [...pOut].filter((p) => !pIn.has(p));
          expect(added, `${id}: unexpected new keys`).toEqual([]);

          if (!hide) {
            // Dim mode keeps graded drops: only hard removals may shrink lists.
            const shrunk = [...lenIn].reduce((s, [p, n]) => s + Math.max(0, n - (lenOut.get(p) ?? 0)), 0);
            expect(shrunk, `${id}: list shrank beyond hard removals`).toBeLessThanOrEqual(res.hard.length * 2 + 0);
          }
          for (const d of res.dimmed) expect(d.reason.length).toBeGreaterThan(0);

          if (!hide) {
            const r = new Map<string, number>();
            for (const d of res.dimmed) r.set(d.reason, (r.get(d.reason) ?? 0) + 1);
            for (const h of res.hard) r.set(h.reason, (r.get(h.reason) ?? 0) + 1);
            rows.push({
              fixture: id,
              endpoint: new URL(url).pathname.split("/").pop() ?? "",
              bytes: body.length,
              seen,
              dimmed: res.dimmed.length,
              removed: res.hard.length,
              reasons: [...r].map(([k, v]) => `${k}:${v}`).join(" "),
            });
          }
        }
      }
    }, 60_000);
  }

  it("dim mode never changes the JSON when every item is graded as a drop", async () => {
    let checked = 0;
    for (const [id, url] of Object.entries(urls)) {
      const cfg = config();
      if (!shouldFilterUrl(new URL(url), cfg)) continue;
      const body = readFileSync(path.join(dir, `${id}.json`), "utf8");
      const run = (dropAll: boolean) =>
        rewriteResponseBody(url, `https://${new URL(url).hostname}/`, body, cfg, {
          evaluate: async (items) => new Map(dropAll ? items.map((i) => [i.id, "test"]) : []),
        });
      const base = await run(false);
      const dropped = await run(true);
      expect(dropped!.body, `${id}: dim mode altered the body`).toBe(base!.body);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("prints the per-fixture table", () => {
    console.table(rows);
    expect(rows.length).toBeGreaterThan(0);
  });
});
