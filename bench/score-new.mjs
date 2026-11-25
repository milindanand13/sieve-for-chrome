// Old prompt vs main's new prompt (commit fdbc3e1), scored against Milind's page answers.
// New pipeline = new rules first (rules-now.json), then the new-prompt grade. Memes are scored apart:
// Milind keeps some memes on no fixed logic, so a meme disagreement is a taste call, not a clear error.
import { readFileSync } from "node:fs";
const J = (f) => JSON.parse(readFileSync(f, "utf8"));
const D = J("bench/data/page-data.json");
const R = J("bench/data/rules-now.json");
const G = (f) => J(`bench/data/grades-${f}.json`).verdicts;
const runs = { qOld: [G("local-1"), G("local-2")], hOld: [G("claude-1"), G("claude-2")], qNew: [G("local-new1"), G("local-new2")], hNew: [G("claude-new1"), G("claude-new2")] };
// Picked by hand from the 55 page posts: image jokes, reaction posts and text-less photo posts.
const MEMES = new Set(["hardcatmemes", "beeple_crap", "FrostBite_Leo", "overheardnewyork", "BALUCIAGA", "BoringBiz_", "wyacole", "litcapital", "Nullyekk", "drazi1KH", "Abomination81", "_yes_but"]);
const isMeme = (p) => MEMES.has(p.by) || (p.platform === "x" && /^https:\/\/t\.co\/\S+$/.test(p.text));
const idOf = (key) => key.replace(/^[a-z]+_/, "");
const verdict = (run, id, isNew) => (isNew && R[id] ? (R[id].verdict === "drop" ? "d" : "k") : run[id]?.v);
const rows = D.posts.map((p) => ({ ...p, id: idOf(p.key), a: J(`bench/data/answers/answers/${p.key}.json`).a, meme: isMeme(p) }));
const score = (name, rs) => {
  const out = {};
  for (const [k, rr] of Object.entries(runs)) {
    out[k] = rs.reduce((s, r) => s + rr.filter((g) => (verdict(g, r.id, k.endsWith("New")) === "d") === (r.a === "dim")).length / rr.length, 0);
  }
  console.log(`${name.padEnd(22)} n=${String(rs.length).padStart(2)} | qwen old ${out.qOld.toFixed(1)} new ${out.qNew.toFixed(1)} | Haiku old ${out.hOld.toFixed(1)} new ${out.hNew.toFixed(1)}`);
};
score("clear (non-meme)", rows.filter((r) => !r.meme));
score("  of which disputed", rows.filter((r) => !r.meme && r.disagree));
score("memes (taste calls)", rows.filter((r) => r.meme));
score("all 55", rows);
console.log("\nHis dims the new rules catch with no model:", rows.filter((r) => r.a === "dim" && R[r.id]).map((r) => `@${r.by} (${R[r.id].reason})`).join(", ") || "none");
console.log("His dims still missed by qwen new:", rows.filter((r) => r.a === "dim" && !r.meme && runs.qNew.some((g) => verdict(g, r.id, true) !== "d")).map((r) => `@${r.by || "?"}: ${r.text.slice(0, 50).replace(/\s+/g, " ")}`).join(" | "));
console.log("His keeps Haiku new still dims:", rows.filter((r) => r.a === "keep" && !r.meme && runs.hNew.some((g) => verdict(g, r.id, true) === "d")).map((r) => `@${r.by || "?"}: ${r.text.slice(0, 50).replace(/\s+/g, " ")}`).join(" | "));
const dims = (rr) => rr.map((g) => Object.values(g).filter((v) => v.v === "d").length);
console.log("\nDims over the 199 graded posts: qwen old", dims(runs.qOld), "new", dims(runs.qNew), "| Haiku old", dims(runs.hOld), "new", dims(runs.hNew));
const ms = (f) => { const b = J(`bench/data/grades-${f}.json`).batches.map((x) => x.ms); return Math.round(b.reduce((s, x) => s + x, 0) / b.length); };
console.log("avg batch ms new: qwen", ms("local-new1"), ms("local-new2"), "Haiku", ms("claude-new1"), ms("claude-new2"));
