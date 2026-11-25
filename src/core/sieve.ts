import { DEFAULT_CONFIG } from "../defaults.js";
import type {
  FeedItem,
  MemoryLookup,
  MemoryStore,
  NoveltyLookup,
  SeedSets,
  SieveConfig,
  Verdict,
} from "../types.js";
import { normalizeHandle } from "./dehype.js";
import { gradeItemsDetailed, type GraderVerdict } from "./llm.js";
import { isStructuralSlop } from "./slop-cadence.js";

const COMMENT_BAIT_RE =
  /\bcomment\s+["'“”]?[a-z0-9_-]{2,20}["'“”]?\s+(and\s+i'?ll|to\s+get|for\s+the|for\s+my)\s+(dm|send|link|free|guide|template)\b/i;

const CRYPTO_CASINO_SPAM_RE =
  /\b(use\s+code\s+\w+\s+on\s+stake|100x\s+memecoin|telegram\s+pump\s+group|free\s+airdrop\s+link\s+in\s+bio)\b/i;

const SHORT_DRAMA_RE =
  /(?:#(?:reelshort|dramabox|shortdrama|shortdramas|pinedrama|shortmax|minidrama)\b|\/shortdrama\/episode\/|\b(?:part|ep(?:isode)?)\s*\d+\s*[|:-].*\b(?:billionaire|ceo|heiress|secretly\s+marries|alpha\s+wolf|werewolf|mistress)\b)/i;

const ATTENTION_TRAP_RE =
  /(?:🚨+\s*(?:breaking|just\s+in|huge|urgent)\b.*(?:\bkilled\b|\bover\s+for\b|\binsane\b|\bforever\b|🧵)|\b\d+\s+(?:ai\s+)?(?:websites|tools|prompts|extensions|repos)\s+that\s+feel\s+illegal\s+to\s+know\b|\bbookmark\s+this\s+before\s+it(?:'s|\s+is|\s+gets)\s+deleted\b|\bwrong\s+answers\s+only\b|#(?:redditstories|aita)\b.*#(?:minecraft|subwaysurfers|satisfying)\b)/i;

const GOSSIP_DOMAIN_RE =
  /\b(?:celebrity|reality\s*tv|k-?pop\s*stan|tabloid|love\s*island|kardashian)\b/i;

const YT_URL_ID_RE =
  /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^\s#"'<>]*&)?v=|embed\/|v\/))([A-Za-z0-9_-]{11})/gi;

export function extractYouTubeIdsFromText(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  YT_URL_ID_RE.lastIndex = 0;
  while ((match = YT_URL_ID_RE.exec(text)) !== null) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

export function creatorKeysFor(item: FeedItem): string[] {
  const keys: string[] = [];
  const byId = normalizeHandle(item.creatorId);
  const byHandle = normalizeHandle(item.creatorHandle);
  if (byId) keys.push(byId);
  if (byHandle && byHandle !== byId) keys.push(byHandle);
  return keys;
}

export interface LocalDecision {
  verdict: Verdict;
  /** Short human label for the branch that decided; set on every drop. */
  reason: string;
}

const KEEP = (reason: string): LocalDecision => ({ verdict: "keep", reason });
const DROP = (reason: string): LocalDecision => ({ verdict: "drop", reason });

export function evaluateLocalDecision(
  item: FeedItem,
  config: SieveConfig,
  seeds: SeedSets,
  memory: MemoryLookup,
  novelty?: NoveltyLookup,
): LocalDecision {
  // The user's own call (context-menu feedback) beats every rule.
  const own = memory.getItemReason?.(item.platform, item.id);
  const ownVerdict = own?.startsWith("you: ") ? memory.getItemVerdict(item.platform, item.id) : undefined;
  if (own && ownVerdict) return { verdict: ownVerdict, reason: own };

  if (item.isSponsored) return DROP("sponsored");

  const keys = creatorKeysFor(item);
  if (config.blockHandles.length > 0) {
    const blocked = new Set(config.blockHandles.map((h) => normalizeHandle(h)).filter(Boolean));
    if (keys.some((k) => blocked.has(k))) return DROP("blocked handle");
  }

  if (config.allowHandles.length > 0) {
    const allowed = new Set(config.allowHandles.map((h) => normalizeHandle(h)).filter(Boolean));
    if (keys.some((k) => allowed.has(k))) return KEEP("allowed handle");
  }

  // Followed accounts are graded too (the grader is told, and is lenient); passFollowed only skips the heuristics below.

  if (item.platform === "youtube" && seeds.hnVideos.has(item.id)) return KEEP("hn video");
  if (keys.some((k) => seeds.hnChannels.has(k))) return KEEP("hn channel");

  const ytIds = item.linkedYoutubeIds ?? extractYouTubeIdsFromText(item.titleOrText);
  if (ytIds.some((vid) => seeds.hnVideos.has(vid))) return KEEP("hn video link");

  if (keys.some((k) => seeds.slopChannels.has(k))) return DROP("slop list");

  const fullText = `${item.titleOrText} ${item.secondaryText ?? ""}`;
  if (COMMENT_BAIT_RE.test(fullText)) return DROP("comment bait");
  if (CRYPTO_CASINO_SPAM_RE.test(fullText)) return DROP("crypto spam");
  if (SHORT_DRAMA_RE.test(fullText)) return DROP("short drama");
  if (ATTENTION_TRAP_RE.test(fullText)) return DROP("hype headline");
  if (GOSSIP_DOMAIN_RE.test(fullText)) return DROP("gossip");

  if (!(config.passFollowed && item.isFollowed)) {
    if (item.platform === "x" && config.x.slopCadenceFilter) {
      if (isStructuralSlop(item.titleOrText, {}, 65)) return DROP("slop cadence");
    } else if (item.platform !== "youtube" && item.platform !== "x") {
      if (isStructuralSlop(item.titleOrText, {}, 74)) return DROP("slop cadence");
    }

    // X only: a YouTube title from the same series or a video you already watched is not a rehash.
    if (item.platform === "x" && config.noveltyFilter && novelty?.isRedundantRehash(item.titleOrText)) {
      return DROP("seen before");
    }
  }

  const cachedVerdict = memory.getItemVerdict(item.platform, item.id);
  if (cachedVerdict) {
    const original = memory.getItemReason?.(item.platform, item.id);
    return { verdict: cachedVerdict, reason: original ? `${original} (cached)` : "cached verdict" };
  }

  for (const key of keys) {
    const learned = memory.getCreatorVerdict(item.platform, key);
    if (learned) {
      return { verdict: learned, reason: learned === "drop" ? "known-bad creator" : "known-good creator" };
    }
  }

  if (item.platform === "x" && !item.isFollowed && item.metrics) {
    const likes = item.metrics.likes ?? 0;
    const replies = item.metrics.replies ?? 0;
    const quotes = item.metrics.quotes ?? 0;
    if (replies >= 40 && (replies > likes * 1.4 || quotes > likes * 1.1)) {
      return DROP("ragebait ratio");
    }
  }

  return { verdict: "uncertain", reason: "uncertain" };
}

export interface SieveHooks {
  /** Called when the grader request fails or times out (item then fails open). */
  onGraderError?: (err: unknown) => void;
  /** Do not wait for the grader at all (dim mode): its drops arrive through onLate. */
  skipHold?: boolean;
  /** Grader drops that finished after the batch was already returned (id -> reason). */
  onLate?: (dropped: Map<string, string>) => void;
}

function graderDrops(verdicts: Map<string, GraderVerdict>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, v] of verdicts) {
    if (v.verdict === "d") out.set(id, v.why ? `grader: ${v.why}` : "grader");
  }
  return out;
}

/** Drops with reasons: id -> reason. This is the one place a graded or rule drop is decided. */
export async function runSieveDetailed(
  items: FeedItem[],
  config: SieveConfig,
  seeds: SeedSets,
  memory: MemoryStore,
  fetchImpl: typeof fetch = fetch,
  novelty?: NoveltyLookup,
  hooks: SieveHooks = {},
): Promise<Map<string, string>> {
  const dropped = new Map<string, string>();
  const uncertain: FeedItem[] = [];

  for (const item of items) {
    const decision = evaluateLocalDecision(item, config, seeds, memory, novelty);
    if (decision.verdict === "drop") {
      dropped.set(item.id, decision.reason);
    } else if (decision.verdict === "uncertain") {
      uncertain.push(item);
    }
  }

  if (uncertain.length === 0 || config.grader.mode === "off") {
    return dropped;
  }

  const holdMs = Math.max(50, config.grader.streamHoldMs || DEFAULT_CONFIG.grader.streamHoldMs);
  const gradingPromise = gradeItemsDetailed(uncertain, config, fetchImpl)
    .then(async (verdicts) => {
      // Cache only what the model explicitly judged: "u", malformed and missing replies stay uncached.
      await Promise.all(
        uncertain.map((item) => {
          const g = verdicts.get(item.id);
          if (g?.verdict === "k") return memory.recordVerdict(item, "keep");
          if (g?.verdict === "d") return memory.recordVerdict(item, "drop", g.why ? `grader: ${g.why}` : "grader");
          return undefined;
        }),
      );
      return verdicts;
    })
    .catch((err: unknown) => {
      hooks.onGraderError?.(err);
      return new Map<string, GraderVerdict>();
    });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = Symbol("timeout");
  const outcome = hooks.skipHold
    ? timedOut
    : await Promise.race([
        gradingPromise,
        new Promise<typeof timedOut>((resolve) => {
          timer = setTimeout(() => resolve(timedOut), holdMs);
        }),
      ]);
  if (timer) clearTimeout(timer);

  if (outcome === timedOut) {
    // Too slow to wait for: deliver the grader's drops to the page when they arrive.
    void gradingPromise.then((verdicts) => {
      const late = graderDrops(verdicts);
      if (late.size > 0) hooks.onLate?.(late);
    });
  } else {
    for (const [id, reason] of graderDrops(outcome)) dropped.set(id, reason);
  }

  return dropped;
}
