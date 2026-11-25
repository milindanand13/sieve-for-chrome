// Reference labels from a stronger Claude model, for scoring the default rubric without a human.
// Sends the exact system prompt and batches Sieve's grader would send (captured from gradeItemsDetailed),
// but to Claude Sonnet 5.5 (or REF_MODEL) at medium effort with no time limit. Stops if spend passes $0.60.
// Usage: POSTS=bench/data/posts-new.json [REF_MODEL=claude-opus-5-5] bench/run.sh bench/ref.ts <label>
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { gradeItemsDetailed, parseVerdictMap } from "../src/core/llm.js";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import type { FeedItem } from "../src/types.js";

const MODEL = process.env.REF_MODEL ?? "claude-sonnet-5-5";
const PRICE = MODEL === "claude-opus-5-5" ? [4, 20] : [2, 10]; // $ per million in / out
const label = process.argv[2] ?? "sonnet";
const posts: FeedItem[] = JSON.parse(readFileSync(process.env.POSTS ?? "bench/data/posts.json", "utf8"));
const keyFile = `${homedir()}/.config/sieve/anthropic-key`;
const client = new Anthropic({ apiKey: existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : undefined, maxRetries: 2 });

// Capture what Sieve would send for a batch: run the real grader against a fake local endpoint.
async function promptFor(batch: FeedItem[]): Promise<{ system: string; user: string }> {
  let captured = { system: "", user: "" };
  const fake: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    captured = { system: body.messages[0].content, user: body.messages[1].content };
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"drop":[]}' } }] }), { status: 200 });
  };
  await gradeItemsDetailed(batch, { ...DEFAULT_CONFIG, grader: { ...DEFAULT_CONFIG.grader, mode: "local" } }, fake);
  return captured;
}

const verdicts: Record<string, { v: string; why?: string }> = {};
let inTok = 0, outTok = 0;
const cost = () => (inTok * PRICE[0] + outTok * PRICE[1]) / 1e6;
for (let i = 0; i < posts.length; i += 20) {
  if (cost() > 0.6) { console.log("spend cap reached, stopping"); break; }
  const batch = posts.slice(i, i + 20);
  const { system, user } = await promptFor(batch);
  const msg = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: user }],
  } as never);
  inTok += msg.usage.input_tokens;
  outTok += msg.usage.output_tokens;
  if (msg.stop_reason === "refusal") { console.log(`batch ${i / 20 + 1}: refused`); continue; }
  const text = msg.content.map((b: { type: string; text?: string }) => (b.type === "text" ? b.text : "")).join("");
  const got = parseVerdictMap(text, batch.map((b) => b.id));
  for (const [id, v] of got) verdicts[id] = { v: v.verdict, ...(v.why ? { why: v.why } : {}) };
  console.log(`batch ${i / 20 + 1}: judged ${got.size}/${batch.length}, spend so far $${cost().toFixed(3)}`);
}
writeFileSync(`bench/data/grades-ref-${label}.json`, JSON.stringify({ model: MODEL, effort: "medium", inTok, outTok, cost: cost(), verdicts }, null, 1));
console.log(`${MODEL}: ${Object.keys(verdicts).length}/${posts.length} judged; cost $${cost().toFixed(4)}`);
