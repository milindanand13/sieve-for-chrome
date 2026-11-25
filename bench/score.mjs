// Scores both graders against Milind's answers from the rating page.
// First export the page's database: ArtifactData list (answers, titles) with out_dir bench/data/answers.
// Usage: node bench/score.mjs
import { existsSync, readdirSync, readFileSync } from "node:fs";

const D = JSON.parse(readFileSync("bench/data/page-data.json", "utf8"));
const read = (coll) => {
  const dir = `bench/data/answers/${coll}`;
  if (!existsSync(dir)) return {};
  return Object.fromEntries(readdirSync(dir).map((f) => {
    const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
    const body = j.data ?? j;
    return [f.replace(/\.json$/, ""), body];
  }));
};
const ans = read("answers");
const picks = read("titles");

// "unsure" is kept in Sieve, so only "d" counts as dim.
const right = (v, a) => (v === "d") === (a === "dim");
const rows = D.posts.filter((p) => ans[p.key]?.a).map((p) => ({ ...p, a: ans[p.key].a }));
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
for (const group of [["disagreements", rows.filter((r) => r.disagree)], ["agreed sample", rows.filter((r) => !r.disagree)], ["all answered", rows]]) {
  const [name, rs] = group;
  if (!rs.length) continue;
  const q = sum(rs.map((r) => (right(r.q.v, r.a) ? 1 : 0)));
  const h = sum(rs.map((r) => (r.h.filter((v) => right(v.v, r.a)).length / r.h.length)));
  console.log(`${name}: ${rs.length} answered | qwen right ${q} | Haiku right ${h.toFixed(1)} (avg of 2 runs)`);
}
const miss = (who) => rows.filter((r) => (who === "q" ? !right(r.q.v, r.a) : r.h.some((v) => !right(v.v, r.a))));
for (const who of ["q", "h"]) {
  const m = miss(who);
  const fp = m.filter((r) => r.a === "keep"), fn = m.filter((r) => r.a === "dim");
  console.log(`\n${who === "q" ? "qwen" : "Haiku"} wrong: dimmed ${fp.length} you'd keep, kept ${fn.length} you'd dim`);
  for (const r of m) console.log(`  [you: ${r.a}] ${r.platform} @${r.by}: ${r.text.slice(0, 90).replace(/\n/g, " ")}`);
}
const tp = D.titles.map((t) => picks[t.key]?.pick).filter(Boolean);
console.log(`\ntitles: ${tp.length} picked | qwen ${tp.filter((x) => x === "q").length} | Haiku ${tp.filter((x) => x === "h").length} | neither ${tp.filter((x) => x === "none").length}`);
