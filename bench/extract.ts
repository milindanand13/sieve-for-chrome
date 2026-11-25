// Builds bench/data/posts.json: real posts that would reach the AI grader (rules could not decide them).
// Sources: recorded X/Instagram fixtures + logged-out YouTube search pages (bench/data/yt/*.json).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { rewriteResponseBody } from "../src/background/rewrite.js";
import { evaluateLocalDecision } from "../src/core/sieve.js";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import type { FeedItem, SeedSets } from "../src/types.js";

const root = process.cwd();
const fx = path.join(root, "tests", "fixtures");
const seedSet = (f: string) =>
  new Set(readFileSync(path.join(root, "extension/assets/seeds", f), "utf8").split("\n").map((s) => s.trim().toLowerCase()).filter(Boolean));
const seeds: SeedSets = {
  hnVideos: seedSet("hn-videos.txt"),
  hnChannels: seedSet("hn-channels.txt"),
  slopChannels: seedSet("slop-channels.txt"),
};
const memory = { getItemVerdict: () => undefined, getCreatorVerdict: () => undefined };

const all = new Map<string, FeedItem>();
async function feed(url: string, page: string, body: string) {
  await rewriteResponseBody(url, page, body, DEFAULT_CONFIG, {
    evaluate: async (items) => {
      for (const i of items) all.set(`${i.platform}:${i.id}`, i);
      return new Map();
    },
  });
}

const urls: Record<string, string> = JSON.parse(readFileSync(path.join(fx, "urls.json"), "utf8"));
for (const site of ["x", "instagram"]) {
  for (const f of readdirSync(path.join(fx, site))) {
    const url = urls[`${site}/${f.replace(".json", "")}`];
    if (url) await feed(url, site === "x" ? "https://x.com/home" : "https://www.instagram.com/", readFileSync(path.join(fx, site, f), "utf8"));
  }
}
for (const s of JSON.parse(readFileSync(path.join(fx, "sieve-samples.json"), "utf8")) as Array<{ site: string; url: string; body: string }>) {
  await feed(s.url, s.site === "x" ? "https://x.com/home" : "https://www.instagram.com/", s.body);
}
const ytDir = path.join(root, "bench/data/yt");
if (existsSync(ytDir)) {
  for (const f of readdirSync(ytDir)) {
    await feed("https://www.youtube.com/youtubei/v1/search", "https://www.youtube.com/results", readFileSync(path.join(ytDir, f), "utf8"));
  }
}

// Posts collected from Milind's own feeds on 2026-11-25 (bench/fetch.mjs filled in the text).
type RawYt = { id: string; title?: string; channel?: string; channelId?: string; dur?: number; error?: string };
for (const v of JSON.parse(readFileSync(path.join(root, "bench/data/raw-yt.json"), "utf8")) as RawYt[]) {
  if (v.error || !v.title) continue;
  all.set(`youtube:${v.id}`, {
    platform: "youtube", id: v.id, creatorId: v.channelId, creatorHandle: v.channel, surface: "home",
    titleOrText: v.title, ...(v.channel ? { secondaryText: v.channel } : {}), ...(v.dur ? { durationSec: v.dur } : {}),
  });
}
type RawX = { id: string; by?: string; text?: string; quoted?: string; media?: string; error?: string };
for (const v of JSON.parse(readFileSync(path.join(root, "bench/data/raw-x.json"), "utf8")) as RawX[]) {
  if (v.error || !v.by) continue;
  const ctx = [v.media ? `[${v.media}]` : "", v.quoted ? `quoting @${v.quoted.slice(0, 150)}` : ""].filter(Boolean).join(" ");
  all.set(`x:${v.id}`, {
    platform: "x", id: v.id, creatorHandle: v.by, surface: "timeline",
    titleOrText: v.text || `@${v.by}`, ...(ctx ? { secondaryText: ctx } : {}),
  });
}
// Instagram home feed, not "Suggested for you": accounts Milind follows.
for (const [by, cap, sug, code] of JSON.parse(readFileSync(path.join(root, "bench/data/ig-dom.json"), "utf8")) as [string, string, number, string][]) {
  all.set(`instagram:${code}`, {
    platform: "instagram", id: code, creatorHandle: by, isFollowed: !sug, surface: "timeline", titleOrText: cap || `@${by}`,
  });
}

const counts: Record<string, Record<string, number>> = {};
const graderBound: FeedItem[] = [];
const seenText = new Set<string>();
for (const item of all.values()) {
  const d = evaluateLocalDecision(item, DEFAULT_CONFIG, seeds, memory).verdict;
  (counts[item.platform] ??= {})[d] = (counts[item.platform]![d] ?? 0) + 1;
  const key = item.titleOrText.trim().toLowerCase();
  if (d === "uncertain" && key.length > 3 && !seenText.has(key)) {
    seenText.add(key);
    graderBound.push(item);
  }
}
console.log("rule verdicts by platform:", counts);
console.log("grader-bound, deduped:", graderBound.length, Object.fromEntries(["youtube", "x", "instagram"].map((p) => [p, graderBound.filter((i) => i.platform === p).length])));
writeFileSync(path.join(root, "bench/data/all-grader-bound.json"), JSON.stringify(graderBound, null, 1));

// Bench set: every YouTube and Instagram post, X cut to an even 200 total by a fixed-seed shuffle.
// Order stays as collected and grouped by platform, like real batches that come from one feed response.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const xs = graderBound.filter((i) => i.platform === "x");
const keepX = new Set(xs.map((i) => [rand(), i.id] as const).sort((a, b) => a[0] - b[0]).slice(0, 200 - (graderBound.length - xs.length)).map((p) => p[1]));
const set = graderBound.filter((i) => i.platform !== "x" || keepX.has(i.id));
writeFileSync(path.join(root, "bench/data/posts.json"), JSON.stringify(set, null, 1));
console.log("bench set:", set.length);
