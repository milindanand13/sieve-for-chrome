// Picks the posts for Milind's rating page: every post where the models' keep/dim calls differ in any run,
// plus 20 random posts where all runs agree. Writes bench/data/page-data.json.
import { readFileSync, writeFileSync } from "node:fs";
const P = JSON.parse(readFileSync("bench/data/posts.json", "utf8"));
const G = (f) => JSON.parse(readFileSync(`bench/data/grades-${f}.json`, "utf8")).verdicts;
const q = [G("local-1"), G("local-2")], h = [G("claude-1"), G("claude-2")];
const dim = (g, id) => g[id]?.v === "d";
let seed = 11;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const shuffle = (a) => a.map((x) => [rand(), x]).sort((x, y) => x[0] - y[0]).map((p) => p[1]);
const allSame = (id) => new Set([...q, ...h].map((g) => dim(g, id))).size === 1;
const dis = P.filter((p) => !allSame(p.id));
const agree = shuffle(P.filter((p) => allSame(p.id))).slice(0, 20);
const link = (p) =>
  p.platform === "youtube" ? `https://www.youtube.com/watch?v=${p.id}`
  : p.platform === "x" ? `https://x.com/i/status/${p.id}`
  : `https://www.instagram.com/p/${p.altId ?? p.id}/`;
const show = (gs, id) => gs.map((g) => ({ v: g[id]?.v ?? "-", why: g[id]?.why ?? "" }));
const posts = shuffle([...dis, ...agree]).map((p) => ({
  key: `${p.platform}_${p.id}`, platform: p.platform, by: p.creatorHandle ?? "", text: p.titleOrText.slice(0, 400),
  ctx: p.secondaryText ?? "", url: link(p), q: show(q, p.id)[0], h: show(h, p.id), disagree: !allSame(p.id),
}));
const T = JSON.parse(readFileSync("bench/data/titles.json", "utf8"));
const titles = T.jobs.map((j) => {
  const opts = shuffle([{ m: "q", t: T.local.titles[j.id] ?? j.title }, { m: "h", t: T.claude.titles[j.id] ?? j.title }]);
  return { key: `yt_${j.id}`, id: j.id, orig: j.title, a: opts[0], b: opts[1] };
});
writeFileSync("bench/data/page-data.json", JSON.stringify({ posts, titles }));
console.log("posts", posts.length, "disagree", dis.length, "agree", agree.length, "titles", titles.length);
