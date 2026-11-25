// Rewrites bait YouTube titles from Milind's home feed with both models through Sieve's writePlainTitles.
// Descriptions come from the logged-out watch pages bench/fetch.mjs already saved (same request plainTitlesFor makes).
// Usage: bench/run.sh bench/titles.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { writePlainTitles } from "../src/core/plain-titles.js";
import { DEFAULT_CONFIG } from "../src/defaults.js";

// Picked by hand from the 83 home-feed videos: titles that hide what the video is about.
const IDS = [
  "Jatwf_XOncE", "-7KfhmvkJkI", "MCfeEZGilCw", "7FIufJFQpIE", "yhkacIvaHrM", "guvFKt_Zjqw", "qk8pNOtZhaU",
  "ytmawkPTP24", "SkTiGX4StOg", "zfH2Jwuf3sM", "dkNb5OJNZQ4", "kkKFt3ptYwQ", "PHSsdHu2Er0", "2CIz-P3kIUM",
  "hmYPh5CYtWw", "jhp0XrzQSXE", "dfqMJXp8Vpw",
];
const raw: Array<{ id: string; title: string; channel: string; desc: string }> = JSON.parse(readFileSync("bench/data/raw-yt.json", "utf8"));
const jobs = IDS.map((id) => raw.find((r) => r.id === id)!).map((r) => ({ id: r.id, title: r.title, desc: r.desc }));

const usage = { input: 0, output: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const res = await realFetch(input, init);
  try {
    const j = await res.clone().json();
    if (j?.usage?.output_tokens !== undefined) {
      usage.input += j.usage.input_tokens;
      usage.output += j.usage.output_tokens;
    }
  } catch {
    // not JSON
  }
  return res;
};

const keyFile = `${homedir()}/.config/sieve/anthropic-key`;
const out: Record<string, unknown> = {};
for (const mode of ["local", "claude"] as const) {
  const model = mode === "claude" ? "claude-haiku-5-5" : DEFAULT_CONFIG.grader.model;
  const apiKey = mode === "claude" && existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : "";
  const cfg = { ...DEFAULT_CONFIG, grader: { ...DEFAULT_CONFIG.grader, mode, model, apiKey } };
  const titles: Record<string, string> = {};
  const calls: Array<{ n: number; ms: number; error?: string }> = [];
  // A YouTube page asks for a few bait titles at a time; 6 per call is a typical screenful.
  for (let i = 0; i < jobs.length; i += 6) {
    const t = Date.now();
    try {
      for (const [id, title] of await writePlainTitles(jobs.slice(i, i + 6), cfg)) titles[id] = title;
      calls.push({ n: jobs.slice(i, i + 6).length, ms: Date.now() - t });
    } catch (e) {
      calls.push({ n: jobs.slice(i, i + 6).length, ms: Date.now() - t, error: String(e) });
    }
  }
  out[mode] = { model, titles, calls, ...(mode === "claude" ? { usage: { ...usage }, cost: (usage.input * 0.1 + usage.output * 0.5) / 1e6 } : {}) };
  console.log(model, calls, `${Object.keys(titles).length}/${jobs.length} rewritten`);
}
writeFileSync("bench/data/titles.json", JSON.stringify({ jobs: jobs.map(({ id, title }) => ({ id, title })), ...out }, null, 1));
