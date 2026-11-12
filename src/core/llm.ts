import { isRecord, type FeedItem, type JsonRecord, type SieveConfig } from "../types.js";

const MAX_BATCH_SIZE = 20;
const BACKGROUND_TIMEOUT_MS = 6000;

function extractJsonObject(rawInput: string): JsonRecord | null {
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

export function parseIndexedVerdicts(raw: string, orderedIds: string[]): Set<string> {
  const dropped = new Set<string>();
  for (const [id, v] of parseVerdictMap(raw, orderedIds)) if (v.verdict === "d") dropped.add(id);
  return dropped;
}

function summarizeIndexedItem(item: FeedItem, index: number) {
  return {
    i: String(index),
    p: item.platform,
    by: item.creatorHandle || item.creatorId || "",
    text: item.titleOrText.slice(0, 240),
    ...(item.secondaryText ? { ctx: item.secondaryText.slice(0, 180) } : {}),
    ...(item.durationSec ? { dur: item.durationSec } : {}),
  };
}

const VERDICT_OUTPUT_INSTRUCTIONS = `Label each item index "0", "1", ... with one letter:
- "k" = keep (engineering, hardware, software, science, space, design, art, photography, music, demos, links, dry humor/jokes, opinions, weird rabbit holes, or normal human updates even if only a few words long)
- "u" = unsure or neutral (kept by default when in doubt)
- "d" = confident drop (ONLY clear ragebait, public humiliation/dunk clips, political/culture-war outrage, celebrity/influencer gossip, crypto/memecoin shills, hustle-bro/DM-funnel bait, short-drama cliffhangers, or AI voiceover sleep-slop)

Return ONLY a JSON object listing the indexes of confident drops, optional unsure indexes, and a 2-4 word label for each drop, like:
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

/** Items past MAX_BATCH_SIZE are not graded and get no verdict. */
export async function gradeItemsDetailed(
  items: FeedItem[],
  config: SieveConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, GraderVerdict>> {
  if (config.grader.mode === "off" || items.length === 0) return new Map();
  if (!config.grader.endpoint || !config.grader.model) {
    throw new Error("Missing grader endpoint or model");
  }
  if (config.grader.mode === "api" && !config.grader.apiKey.trim()) {
    throw new Error("Missing API key");
  }

  const batch = items.slice(0, MAX_BATCH_SIZE);
  const orderedIds = batch.map((item) => item.id);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKGROUND_TIMEOUT_MS);

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
          {
            role: "system",
            content: `${config.grader.rubric.trim()}\n\n${VERDICT_OUTPUT_INSTRUCTIONS}`,
          },
          {
            role: "user",
            content: JSON.stringify(batch.map(summarizeIndexedItem)),
          },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const body: unknown = await res.json();
    return parseVerdictMap(readFirstChoiceContent(body), orderedIds);
  } finally {
    clearTimeout(timer);
  }
}
