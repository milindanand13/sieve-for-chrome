// Scores qwen and Haiku on the neutral default rubric against two stronger reference graders
// (Sonnet 5.5 and Opus 5.5, medium effort). Only posts where both references agree count.
// Usage: node bench/score-neutral.mjs
import { readFileSync } from "node:fs";

const J = (f) => JSON.parse(readFileSync(f, "utf8"));
const posts = J("bench/data/posts.json");
const R = J("bench/data/rules-now.json");
const G = (f) => J(`bench/data/grades-${f}.json`).verdicts;
const dim = (g, id) => (R[id] ? R[id].verdict === "drop" : g[id]?.v === "d"); // "unsure" is kept
const refS = G("ref-neutral");
const refO = G("ref-opus-neutral");
const sure = posts.filter((p) => dim(refS, p.id) === dim(refO, p.id));
const truth = (id) => dim(refS, id);
console.log(`references agree on ${sure.length}/${posts.length}; reference dims ${sure.filter((p) => truth(p.id)).length}`);

const models = { qwen: ["local-neutral1", "local-neutral2"], Haiku: ["claude-neutral1", "claude-neutral2"] };
for (const [name, files] of Object.entries(models)) {
  const runs = files.map(G);
  const avg = (f) => runs.reduce((s, g) => s + f(g), 0) / runs.length;
  const right = avg((g) => sure.filter((p) => dim(g, p.id) === truth(p.id)).length);
  const falseDim = avg((g) => sure.filter((p) => dim(g, p.id) && !truth(p.id)).length);
  const missed = avg((g) => sure.filter((p) => !dim(g, p.id) && truth(p.id)).length);
  const dims = avg((g) => posts.filter((p) => dim(g, p.id)).length);
  const stable = posts.filter((p) => dim(runs[0], p.id) === dim(runs[1], p.id)).length;
  const ms = files.map((f) => {
    const b = J(`bench/data/grades-${f}.json`).batches.map((x) => x.ms);
    return Math.round(b.reduce((s, x) => s + x, 0) / b.length);
  });
  console.log(
    `${name}: right ${right.toFixed(1)}/${sure.length} (${((right / sure.length) * 100).toFixed(1)}%) | wrong dims ${falseDim.toFixed(1)} | misses ${missed.toFixed(1)} | dims ${dims.toFixed(1)}/200 | same both runs ${stable}/200 | avg batch ms ${ms}`,
  );
  const tests = [
    ["wrongly dims", (g, p) => dim(g, p.id) && !truth(p.id)],
    ["misses", (g, p) => !dim(g, p.id) && truth(p.id)],
  ];
  for (const [kind, test] of tests) {
    const ex = sure.filter((p) => runs.some((g) => test(g, p)));
    console.log(`  ${kind} (${ex.length}): ` + ex.map((p) => `${p.platform[0]}:@${p.creatorHandle ?? "?"} "${p.titleOrText.slice(0, 55).replace(/\s+/g, " ")}"`).join(" | "));
  }
}
const ref = J("bench/data/grades-ref-neutral.json");
const refo = J("bench/data/grades-ref-opus-neutral.json");
const hk = ["claude-neutral1", "claude-neutral2"].map((f) => J(`bench/data/grades-${f}.json`).cost.toFixed(4));
console.log(`cost: Sonnet ref $${ref.cost.toFixed(3)}, Opus ref $${refo.cost.toFixed(3)}, Haiku neutral runs $${hk.join(", $")}`);
