// Re-runs Sieve's current rules (whatever src/ is now) over the bench posts.
// Writes bench/data/rules-now.json (posts the rules now decide) and bench/data/posts-new.json (the rest, for the grader).
import { readFileSync, writeFileSync } from "node:fs";
import { creatorKeysFor, evaluateLocalDecision } from "../src/core/sieve.js";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import type { FeedItem, SeedSets } from "../src/types.js";

const seedSet = (f: string) =>
  new Set(readFileSync(`extension/assets/seeds/${f}`, "utf8").split("\n").map((s) => s.trim().toLowerCase()).filter(Boolean));
const seeds: SeedSets = {
  hnVideos: seedSet("hn-videos.txt"), hnChannels: seedSet("hn-channels.txt"), slopChannels: seedSet("slop-channels.txt"),
  warnChannels: seedSet("slop-warn-channels.txt"),
};
const addHint = (item: FeedItem, hint: string): FeedItem => ({ ...item, secondaryText: [item.secondaryText, hint].filter(Boolean).join(" · ") });
const memory = { getItemVerdict: () => undefined, getCreatorVerdict: () => undefined };
const posts: FeedItem[] = JSON.parse(readFileSync("bench/data/posts.json", "utf8"));
const decided: Record<string, { verdict: string; reason: string }> = {};
const rest: FeedItem[] = [];
for (const p of posts) {
  const d = evaluateLocalDecision(p, DEFAULT_CONFIG, seeds, memory);
  if (d.verdict !== "uncertain") {
    decided[p.id] = { verdict: d.verdict, reason: d.reason };
    continue;
  }
  // Same hints runSieveDetailed and withDislikeHints (background/index.ts) add before grading.
  let item = creatorKeysFor(p).some((k) => seeds.warnChannels?.has(k)) ? addHint(p, "channel is flagged as partly AI-generated") : p;
  if (item.platform === "youtube" && /^[\w-]{11}$/.test(item.id)) {
    try {
      const res = await fetch(`https://returnyoutubedislikeapi.com/votes?videoId=${item.id}`, { signal: AbortSignal.timeout(3000) });
      const v = res.ok ? await res.json() : null;
      const likes = typeof v?.likes === "number" ? v.likes : 0, dislikes = typeof v?.dislikes === "number" ? v.dislikes : 0;
      const share = likes + dislikes >= 200 ? dislikes / (likes + dislikes) : 0;
      if (share >= 0.2) item = addHint(item, `${Math.round(share * 100)}% of votes are dislikes`);
    } catch {
      // no hint, as in the extension
    }
  }
  rest.push(item);
}
writeFileSync("bench/data/rules-now.json", JSON.stringify(decided, null, 1));
writeFileSync("bench/data/posts-new.json", JSON.stringify(rest, null, 1));
console.log("rules now decide", Object.keys(decided).length, decided, "grader gets", rest.length);
console.log("hinted:", rest.filter((r) => /partly AI|dislikes/.test(r.secondaryText ?? "")).map((r) => `${r.creatorHandle}: ${r.secondaryText}`));
