import Anthropic from "@anthropic-ai/sdk";
import { isRecord, type FeedItem, type JsonRecord, type SieveConfig } from "../types.js";

const MAX_BATCH_SIZE = 20;
const BACKGROUND_TIMEOUT_MS = 6000;

export function extractJsonObject(rawInput: string): JsonRecord | null {
  // qwen3.x may emit reasoning first; drop closed and unterminated <think> blocks.
  const raw = rawInput.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "");
  if (!raw.trim()) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = (fenced?.[1] ?? raw).trim();
  const braceStart = candidate.indexOf("{");
  const braceEnd = candidate.lastIndexOf("}");
  if (braceStart === -1 || braceEnd <= braceStart) return null;

  try {
    const parsed: unknown = JSON.parse(candidate.slice(braceStart, braceEnd + 1));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export type GraderLetter = "k" | "u" | "d";
export interface GraderVerdict {
  verdict: GraderLetter;
  /** Short label from the model, only on drops. */
  why?: string;
}

function cleanWhy(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.replace(/\s+/g, " ").trim().slice(0, 40);
  return t || undefined;
}

/**
 * Parses a grader reply into explicit per-id verdicts. Only ids the model actually judged
 * appear: empty or malformed replies give an empty map, and "u" is never treated as keep.
 * Accepts {"drop":[...],"unsure":[...],"why":{...}} (ids or indexes) and {"0":"k|u|d"}.
 */
export function parseVerdictMap(raw: string, orderedIds: string[]): Map<string, GraderVerdict> {
  const out = new Map<string, GraderVerdict>();
  const parsed = extractJsonObject(raw);
  if (!parsed) return out;

  const validSet = new Set(orderedIds);
  const resolve = (ref: unknown): string | undefined => {
    const key = typeof ref === "number" ? String(ref) : ref;
    if (typeof key !== "string") return undefined;
    if (validSet.has(key)) return key;
    return /^\d+$/.test(key) ? orderedIds[Number.parseInt(key, 10)] : undefined;
  };
  const why = isRecord(parsed.why) ? parsed.why : {};
  const whyFor = (ref: unknown, id: string): string | undefined =>
    cleanWhy(why[id]) ?? cleanWhy(typeof ref === "string" || typeof ref === "number" ? why[String(ref)] : undefined);

  if (Array.isArray(parsed.drop)) {
    for (const ref of parsed.drop) {
      const id = resolve(ref);
      if (id) out.set(id, { verdict: "d", why: whyFor(ref, id) });
    }
    if (Array.isArray(parsed.unsure)) {
      for (const ref of parsed.unsure) {
        const id = resolve(ref);
        if (id && !out.has(id)) out.set(id, { verdict: "u" });
      }
    }
    // Listed as neither drop nor unsure: the model judged it keep.
    for (const id of orderedIds) if (!out.has(id)) out.set(id, { verdict: "k" });
    return out;
  }

  for (const [key, val] of Object.entries(parsed)) {
    if (typeof val !== "string") continue;
    const v = val.trim().toLowerCase();
    const id = resolve(key);
    if (!id) continue;
    if (v === "d" || v === "drop") out.set(id, { verdict: "d", why: whyFor(key, id) });
    else if (v === "k" || v === "keep") out.set(id, { verdict: "k" });
    else if (v === "u") out.set(id, { verdict: "u" });
  }
  return out;
}

function summarizeIndexedItem(item: FeedItem, index: number) {
  return {
    i: String(index),
    p: item.platform,
    by: item.creatorHandle || item.creatorId || "",
    text: item.titleOrText.slice(0, 240),
    ...(item.secondaryText ? { ctx: item.secondaryText.slice(0, 180) } : {}),
    ...(item.durationSec ? { dur: item.durationSec } : {}),
    ...(item.isFollowed ? { f: 1 } : {}),
  };
}

const VERDICT_OUTPUT_INSTRUCTIONS = `Label each item index "0", "1", ... with one letter:
- "k" = keep: craft, engineering, science, design, art, photography, film, music (including live sets and DJ mixes), film/TV trailers and reviews, stand-up comedy, sports played or explained, demos, links, dry humor, real opinions, weird rabbit holes, or normal human updates even if only a few words long
- "u" = unsure (kept)
- "d" = drop: ragebait, political or culture-war outrage, dunking, public humiliation, celebrity or influencer gossip about private lives, crypto or hustle grifts, DM-funnel bait, short-drama cliffhangers, AI voiceover or AI-generated slop, viral shock clips (fights, "kalesh", accidents, dash-cam, snakes, crowds filming an incident, "watch till the end"), relationship and dating drama or "am I crazy / AITA" bait, reaction or repost aggregator accounts, and ads, upsells or promos
"f":1 means the user follows this account: keep their own posts unless they are clearly one of the drop types.
"Celebrity gossip" is talk about people's private lives. An "Official Trailer" or teaser that lists actor names is a trailer: keep it. Stand-up comedy and interviews about work are not gossip.

Return ONLY a JSON object listing the indexes of drops, optional unsure indexes, and a 2-4 word label for each drop, like:
{"drop":["2"],"unsure":["1"],"why":{"2":"outrage bait"}}
Every index not listed is kept. Use {"drop":[]} when nothing should be dropped.`;

function readFirstChoiceContent(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body.choices)) return "";
  const first = body.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return "";
  return typeof first.message.content === "string" ? first.message.content : "";
}

export async function gradeItemsBatch(
  items: FeedItem[],
  config: SieveConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<Set<string>> {
  const verdicts = await gradeItemsDetailed(items, config, fetchImpl);
  const dropped = new Set<string>();
  for (const [id, v] of verdicts) if (v.verdict === "d") dropped.add(id);
  return dropped;
}

// One local model: chunks from all callers run one at a time, so the 6s abort times the request, not the queue.
let chunkQueue: Promise<unknown> = Promise.resolve();
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const next = chunkQueue.then(fn, fn);
  chunkQueue = next.catch(() => undefined);
  return next;
}

/** Grades any number of items in sequential chunks of 20. A failure after the first chunk keeps earlier verdicts. */
export async function gradeItemsDetailed(
  items: FeedItem[],
  config: SieveConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, GraderVerdict>> {
  const out = new Map<string, GraderVerdict>();
  for (let i = 0; i < items.length; i += MAX_BATCH_SIZE) {
    try {
      for (const [id, v] of await queued(() => gradeChunk(items.slice(i, i + MAX_BATCH_SIZE), config, fetchImpl))) {
        out.set(id, v);
      }
    } catch (err) {
      if (out.size === 0) throw err;
      break;
    }
  }
  return out;
}

async function gradeChunk(
  items: FeedItem[],
  config: SieveConfig,
  fetchImpl: typeof fetch,
): Promise<Map<string, GraderVerdict>> {
  if (config.grader.mode === "off" || items.length === 0) return new Map();
  const reply = await chatJson(
    config,
    `${config.grader.rubric.trim()}\n\n${VERDICT_OUTPUT_INSTRUCTIONS}`,
    JSON.stringify(items.map(summarizeIndexedItem)),
    BACKGROUND_TIMEOUT_MS,
    fetchImpl,
  );
  return parseVerdictMap(reply, items.map((item) => item.id));
}

/** One chat completion against the configured grader; returns the raw reply text. */
export async function chatJson(
  config: SieveConfig,
  system: string,
  user: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (config.grader.mode === "claude") return claudeChat(config, system, user, timeoutMs);
  if (!config.grader.endpoint || !config.grader.model) {
    throw new Error("Missing grader endpoint or model");
  }
  if (config.grader.mode === "api" && !config.grader.apiKey.trim()) {
    throw new Error("Missing API key");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.grader.apiKey.trim()) {
    headers.Authorization = `Bearer ${config.grader.apiKey.trim()}`;
  }

  const isLocal = config.grader.mode === "local";

  try {
    const res = await fetchImpl(config.grader.endpoint, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.grader.model,
        temperature: 0,
        ...(isLocal
          ? {
              seed: 42,
              keep_alive: "30m",
              // Ollama: turn off qwen3.x reasoning output. Unknown fields are ignored by servers.
              reasoning_effort: "none", // Ollama /v1 ignores think:false (8s); this gives ~0.25s
              response_format: { type: "json_object" },
            }
          : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const body: unknown = await res.json();
    return readFirstChoiceContent(body);
  } finally {
    clearTimeout(timer);
  }
}

/** Claude through the official SDK. The key is the user's own, kept in local extension storage. */
async function claudeChat(config: SieveConfig, system: string, user: string, timeoutMs: number): Promise<string> {
  const apiKey = config.grader.apiKey.trim();
  if (!apiKey) throw new Error("Missing API key");
  // Extension service workers look like a browser to the SDK; the key never reaches a web page.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: timeoutMs });
  const msg = await client.messages.create({
    model: config.grader.model || "claude-haiku-5-5",
    max_tokens: 4096,
    // A short labeling job: low effort keeps it fast and cheap.
    output_config: { effort: "low" },
    system,
    messages: [{ role: "user", content: user }],
  });
  if (msg.stop_reason === "refusal") throw new Error("Claude declined this batch");
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}
