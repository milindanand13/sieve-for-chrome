// Live grader latency check. Runs only with SIEVE_LIVE=1 and a local Ollama with qwen3.5:4b.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rewriteResponseBody, shouldFilterUrl } from "../src/background/rewrite.js";
import { gradeItemsDetailed } from "../src/core/llm.js";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import type { FeedItem } from "../src/types.js";

const live = process.env.SIEVE_LIVE === "1";
const dir = path.join(process.cwd(), "tests", "fixtures");
const urlsFile = path.join(dir, "urls.json");
const NOTES = "grader-latency.md";

async function itemsFromFixtures(): Promise<FeedItem[]> {
  const urls: Record<string, string> = JSON.parse(readFileSync(urlsFile, "utf8"));
  const out = new Map<string, FeedItem>();
  for (const site of readdirSync(dir).filter((n) => !n.endsWith(".json"))) {
    for (const file of readdirSync(path.join(dir, site))) {
      const url = urls[`${site}/${file.replace(".json", "")}`];
      if (!url || !shouldFilterUrl(new URL(url), DEFAULT_CONFIG)) continue;
      await rewriteResponseBody(url, "https://x.com/", readFileSync(path.join(dir, site, file), "utf8"), DEFAULT_CONFIG, {
        evaluate: async (items) => {
          for (const i of items) out.set(`${i.platform}:${i.id}`, i);
          return new Map();
        },
      });
    }
  }
  return [...out.values()];
}

describe.skipIf(!live || !existsSync(urlsFile))("live grader (Ollama)", () => {
  it("scores fixture items in batches and reports latency", async () => {
    const items = await itemsFromFixtures();
    expect(items.length).toBeGreaterThan(0);
    const cfg = { ...DEFAULT_CONFIG, grader: { ...DEFAULT_CONFIG.grader, mode: "local" as const } };
    const lines: string[] = [];
    const rows: Array<{ size: number; ms: number; judged: number; dropped: number; unsure: number }> = [];
    let n = 0;
    for (const size of [20, 5]) {
      for (let i = 0; i < items.length; i += size) {
        const batch = items.slice(i, i + size);
        const t = Date.now();
        const v = await gradeItemsDetailed(batch, cfg);
        const ms = Date.now() - t;
        const vals = [...v.values()];
        rows.push({
          size: batch.length,
          ms,
          judged: v.size,
          dropped: vals.filter((x) => x.verdict === "d").length,
          unsure: vals.filter((x) => x.verdict === "u").length,
        });
        n++;
      }
    }
    console.table(rows);
    const first = rows[0]!;
    const warm = rows.slice(1);
    const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length));
    const dropRate = (rows.reduce((a, r) => a + r.dropped, 0) / rows.reduce((a, r) => a + r.judged, 0)) * 100;
    lines.push(
      "# Grader latency (qwen3.5:4b via Ollama, real gradeItemsDetailed path)",
      "",
      `Items from fixtures: ${items.length} (instagram + x). Batches: ${n}.`,
      `First call: ${first.ms} ms (batch of ${first.size}). Warm average: ${avg(warm.map((r) => r.ms))} ms.`,
      `Max: ${Math.max(...rows.map((r) => r.ms))} ms. Drop rate over judged items: ${dropRate.toFixed(1)}%.`,
      `Default stream hold is ${DEFAULT_CONFIG.grader.streamHoldMs} ms; batches slower than that fail open (item passes undimmed).`,
      "",
      "| batch size | ms | judged | dropped | unsure |",
      "|---|---|---|---|---|",
      ...rows.map((r) => `| ${r.size} | ${r.ms} | ${r.judged} | ${r.dropped} | ${r.unsure} |`),
      "",
    );
    writeFileSync(NOTES, lines.join("\n"));
  }, 600_000);
});
