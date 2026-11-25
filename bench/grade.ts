// Grades bench/data/posts.json with Sieve's real grader path (gradeItemsDetailed, 20 per batch, 6 s limit).
// Usage: bench/run.sh bench/grade.ts local|claude [runLabel]
// A batch that fails the real path is re-sent once with a 60 s limit so every post still gets a verdict
// (marked late); the failure itself is recorded. The Anthropic key is read from ~/.config/sieve/anthropic-key
// and never printed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { chatJson, gradeItemsDetailed, parseVerdictMap } from "../src/core/llm.js";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import type { FeedItem } from "../src/types.js";

const mode = process.argv[2] === "claude" ? ("claude" as const) : ("local" as const);
const label = process.argv[3] ?? "1";
const keyFile = `${homedir()}/.config/sieve/anthropic-key`;
const apiKey = mode === "claude" && existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : "";
const model = mode === "claude" ? "claude-haiku-5-5" : DEFAULT_CONFIG.grader.model;
const cfg = { ...DEFAULT_CONFIG, grader: { ...DEFAULT_CONFIG.grader, mode, model, apiKey } };
const posts: FeedItem[] = JSON.parse(readFileSync(process.env.POSTS ?? "bench/data/posts.json", "utf8"));

// Watch every request/response without touching src/: last request text, raw reply, Claude usage.
let lastReq: { system: string; user: string } | null = null;
let lastRaw = "";
const usage: Array<{ input: number; output: number }> = [];
const realFetch = globalThis.fetch;
const watched: typeof fetch = async (input, init) => {
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  if (body?.messages) {
    lastReq = body.system !== undefined
      ? { system: String(body.system), user: String(body.messages[0]?.content ?? "") }
      : { system: String(body.messages[0]?.content ?? ""), user: String(body.messages[1]?.content ?? "") };
  }
  const res = await realFetch(input, init);
  try {
    const j = await res.clone().json();
    if (j?.usage?.output_tokens !== undefined) {
      usage.push({ input: j.usage.input_tokens + (j.usage.cache_read_input_tokens ?? 0), output: j.usage.output_tokens });
    }
    lastRaw = j?.choices?.[0]?.message?.content ?? (Array.isArray(j?.content) ? j.content.map((b: { text?: string }) => b.text ?? "").join("") : "");
  } catch {
    // not JSON; leave as is
  }
  return res;
};
globalThis.fetch = watched; // the Anthropic SDK picks up global fetch when each client is built

if (mode === "local") {
  // Warm the model like a browsing session would (keep_alive 30m); not counted.
  await gradeItemsDetailed(posts.slice(0, 3), cfg, watched).catch(() => undefined);
  usage.length = 0;
}

const batches: unknown[] = [];
const verdicts: Record<string, { v: string; why?: string; late?: boolean }> = {};
for (let i = 0; i < posts.length; i += 20) {
  const batch = posts.slice(i, i + 20);
  lastRaw = "";
  const before = usage.length;
  const t = Date.now();
  let error = "";
  let got = new Map<string, { verdict: string; why?: string }>();
  try {
    got = await gradeItemsDetailed(batch, cfg, watched);
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  const ms = Date.now() - t;
  const badJson = !error && got.size < batch.length;
  let lateMs = 0;
  if ((error || badJson) && lastReq) {
    const t2 = Date.now();
    try {
      const raw = await chatJson(cfg, lastReq.system, lastReq.user, 60000, watched);
      const late = parseVerdictMap(raw, batch.map((b) => b.id));
      for (const [id, v] of late) if (!got.has(id)) verdicts[id] = { v: v.verdict, why: v.why, late: true };
    } catch {
      // still nothing: those posts stay unjudged
    }
    lateMs = Date.now() - t2;
  }
  for (const [id, v] of got) verdicts[id] = { v: v.verdict, ...(v.why ? { why: v.why } : {}) };
  const u = usage.slice(before);
  batches.push({
    start: i, size: batch.length, ms, judged: got.size, error, badJson,
    ...(badJson ? { raw: lastRaw.slice(0, 400) } : {}), lateMs,
    inTok: u.reduce((a, x) => a + x.input, 0), outTok: u.reduce((a, x) => a + x.output, 0),
  });
  console.log(`batch ${i / 20 + 1}: ${ms} ms, judged ${got.size}/${batch.length}${error ? `, ${error}` : ""}${badJson ? ", short/bad JSON" : ""}`);
}

const inTok = usage.reduce((a, x) => a + x.input, 0);
const outTok = usage.reduce((a, x) => a + x.output, 0);
const cost = mode === "claude" ? (inTok * 0.1 + outTok * 0.5) / 1e6 : 0; // Haiku 5.5: $0.10 / $0.50 per million
writeFileSync(`bench/data/grades-${mode}-${label}.json`, JSON.stringify({ model, mode, at: new Date().toISOString(), inTok, outTok, cost, batches, verdicts }, null, 1));
console.log(`${model}: ${Object.keys(verdicts).length}/${posts.length} judged; tokens in ${inTok} out ${outTok}; cost $${cost.toFixed(4)}`);
