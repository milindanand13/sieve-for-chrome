// Re-runs Sieve's current rules (whatever src/ is now) over the bench posts.
// Writes bench/data/rules-now.json (posts the rules now decide) and bench/data/posts-new.json (the rest, for the grader).
import { readFileSync, writeFileSync } from "node:fs";
import { evaluateLocalDecision } from "../src/core/sieve.js";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import type { FeedItem, SeedSets } from "../src/types.js";

const seedSet = (f: string) =>
  new Set(readFileSync(`extension/assets/seeds/${f}`, "utf8").split("\n").map((s) => s.trim().toLowerCase()).filter(Boolean));
const seeds: SeedSets = { hnVideos: seedSet("hn-videos.txt"), hnChannels: seedSet("hn-channels.txt"), slopChannels: seedSet("slop-channels.txt") };
const memory = { getItemVerdict: () => undefined, getCreatorVerdict: () => undefined };
const posts: FeedItem[] = JSON.parse(readFileSync("bench/data/posts.json", "utf8"));
const decided: Record<string, { verdict: string; reason: string }> = {};
const rest: FeedItem[] = [];
for (const p of posts) {
  const d = evaluateLocalDecision(p, DEFAULT_CONFIG, seeds, memory);
  if (d.verdict === "uncertain") rest.push(p);
  else decided[p.id] = { verdict: d.verdict, reason: d.reason };
}
writeFileSync("bench/data/rules-now.json", JSON.stringify(decided, null, 1));
writeFileSync("bench/data/posts-new.json", JSON.stringify(rest, null, 1));
console.log("rules now decide", Object.keys(decided).length, decided, "grader gets", rest.length);
