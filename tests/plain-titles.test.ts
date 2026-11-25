import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractShortDescription, writePlainTitles } from "../src/core/plain-titles.js";
import { DEFAULT_CONFIG } from "../src/defaults.js";

describe("extractShortDescription", () => {
  it("reads the escaped description string from a watch page", () => {
    const html = 'x"shortDescription":"Line one\\nWe test \\"real\\" boots.","isCrawlable":true';
    expect(extractShortDescription(html)).toBe('Line one\nWe test "real" boots.');
    expect(extractShortDescription("<html></html>")).toBe("");
  });
});

// Live: SIEVE_LIVE=1 SIEVE_TITLE_PAGES=<json [{id,title,file}]> with saved watch pages.
const pages = process.env.SIEVE_TITLE_PAGES;
describe.skipIf(process.env.SIEVE_LIVE !== "1" || !pages || !existsSync(pages))("plain titles (Ollama)", () => {
  it("rewrites bait titles from real descriptions", async () => {
    const list: Array<{ id: string; title: string; file: string }> = JSON.parse(readFileSync(pages!, "utf8"));
    const jobs = list.map((p) => ({ id: p.id, title: p.title, desc: extractShortDescription(readFileSync(p.file, "utf8")) }));
    const t = Date.now();
    const out = await writePlainTitles(jobs, { ...DEFAULT_CONFIG, grader: { ...DEFAULT_CONFIG.grader, mode: "local" } });
    console.log(`${Date.now() - t}ms`);
    for (const j of jobs) console.log(`${j.title}\n  -> ${out.get(j.id) ?? "(unchanged)"}`);
    expect(out.size).toBeGreaterThan(0);
  }, 60000);
});
