import { isRecord } from "../types.js";

const DEARROW_MIRROR_BASE = "https://dearrow.minibomba.pro/sbserver/api/branding";
const BUCKET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2500;

const VAGUE_TITLE_RE =
  /(?:\b(?:this changed everything|changes everything|why nobody|no one talks about|you won'?t believe|what happened|i tried\b|for \d+ days|the truth about|it'?s over|he'?s done|she'?s done|they'?re done|stop doing this|before it'?s too late|secret to|insane|shocking|destroyed|exposed|here'?s why|this is why|the real reason|nobody (?:tells|told)|i (?:bought|tested|quit)|went wrong|changed everything|literally|game.?changer|mind.?blow\w*|unbelievable|nobody expected|is (?:dead|over)|finally (?:here|happened)|watch this|until you watch|you need to (?:see|know)|the only \w+(?: \w+)? you(?:'ll)? (?:ever )?need)\b|!(?:\s*\([^)]*\))?\s*$|\.\.\.\s*$|\?\s*$|\?!|!\?)/i;

const titleCache = new Map<string, string | null>();
/** Community-picked thumbnail frame (seconds into the video), or null when there is none. */
const thumbCache = new Map<string, number | null>();
const DEARROW_THUMB_BASE = "https://dearrow-thumb.ajay.app/api/v1/getThumbnail";
const fetchedPrefixes = new Map<string, number>();

export async function sha256Prefix4(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  const b0 = view[0]?.toString(16).padStart(2, "0") ?? "00";
  const b1 = view[1]?.toString(16).padStart(2, "0") ?? "00";
  return `${b0}${b1}`;
}

export function cleanDeArrowTitle(raw: string): string {
  return raw.replace(/(^|\s)>(\S)/g, "$1$2").replace(/\s+/g, " ").trim();
}

// Songs and music videos ("ft.", "Official Video", lyrics) are titles, not bait; the title writer also leaves songs alone.
const MUSIC_TITLE_RE = /\b(?:ft|feat)\.|\b(?:official (?:music )?video|official audio|lyrics?|visuali[sz]er|remix)\b/i;

// ALL-CAPS emphasis on an ordinary word ("This NEW Update", "Watch THIS"), not acronyms like NASA or AI.
const SHOUTED_WORD_RE = /\b(?:NEW|THIS|HUGE|BEST|WORST|NEVER|EVERYTHING|INSANE|CRAZY|WILD|REAL|TRUTH|BIGGEST|ONLY|FINALLY|STOP|WHY|DON'?T|MUST|SHOCKING)\b/;

export function isVagueClickbaitTitle(title: string): boolean {
  if (!title || MUSIC_TITLE_RE.test(title)) return false;
  if (SHOUTED_WORD_RE.test(title)) return true;
  if (VAGUE_TITLE_RE.test(title)) return true;
  const letters = title.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 10) {
    const upper = letters.replace(/[^A-Z]/g, "").length;
    if (upper / letters.length >= 0.7) return true;
  }
  return false;
}

export function getCachedDeArrowTitle(videoId: string): string | undefined {
  return titleCache.get(videoId) ?? undefined;
}

export function clearDeArrowCache(): void {
  titleCache.clear();
  thumbCache.clear();
  fetchedPrefixes.clear();
}

function pickBestCommunityTitle(record: unknown): string | null {
  if (!isRecord(record) || !Array.isArray(record.titles)) return null;
  for (const candidate of record.titles) {
    if (!isRecord(candidate) || candidate.original === true) continue;
    const votes = typeof candidate.votes === "number" ? candidate.votes : -1;
    if (candidate.locked !== true && votes < 0) continue;
    if (typeof candidate.title !== "string") continue;
    const cleaned = cleanDeArrowTitle(candidate.title);
    if (cleaned.length >= 4) return cleaned;
  }
  return null;
}

/** The frame volunteers voted best, like the title pick: skipped when the original thumbnail won. */
export function pickBestCommunityThumb(record: unknown): number | null {
  if (!isRecord(record) || !Array.isArray(record.thumbnails)) return null;
  for (const t of record.thumbnails) {
    if (!isRecord(t)) continue;
    const votes = typeof t.votes === "number" ? t.votes : -1;
    if (t.locked !== true && votes < 0) continue;
    if (t.original === true) return null;
    if (typeof t.timestamp === "number" && t.timestamp >= 0) return t.timestamp;
  }
  return null;
}

/** DeArrow thumbnail URLs (video id -> url, "" when there is none) for ids whose bucket was fetched. */
export async function lookupDeArrowThumbs(videoIds: string[], fetchImpl: typeof fetch = fetch): Promise<Map<string, string>> {
  await lookupDeArrowTitles(videoIds, fetchImpl); // same buckets; fills thumbCache too
  const out = new Map<string, string>();
  for (const vid of videoIds) {
    if (!thumbCache.has(vid)) continue; // bucket not fetched yet: the page asks again later
    const t = thumbCache.get(vid);
    out.set(vid, t == null ? "" : `${DEARROW_THUMB_BASE}?videoID=${vid}&time=${t}`);
  }
  return out;
}

export async function lookupDeArrowTitles(
  videoIds: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const uniqueIds = [...new Set(videoIds.filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id)))];
  if (uniqueIds.length === 0) return result;

  const now = Date.now();
  const prefixesToFetch = new Map<string, string[]>();

  for (const vid of uniqueIds) {
    if (titleCache.has(vid)) {
      const hit = titleCache.get(vid);
      if (hit) result.set(vid, hit);
      continue;
    }
    const prefix = await sha256Prefix4(vid);
    const fetchedAt = fetchedPrefixes.get(prefix);
    if (fetchedAt && now - fetchedAt < BUCKET_TTL_MS) {
      titleCache.set(vid, null);
      continue;
    }
    let list = prefixesToFetch.get(prefix);
    if (!list) {
      list = [];
      prefixesToFetch.set(prefix, list);
    }
    list.push(vid);
  }

  const prefixEntries = [...prefixesToFetch.entries()].slice(0, 6);
  await Promise.all(
    prefixEntries.map(async ([prefix, requestedVids]) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetchImpl(`${DEARROW_MIRROR_BASE}/${prefix}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const bucket: unknown = await res.json();
        if (!isRecord(bucket)) return;
        fetchedPrefixes.set(prefix, now);

        for (const [vid, rec] of Object.entries(bucket)) {
          titleCache.set(vid, pickBestCommunityTitle(rec));
          thumbCache.set(vid, pickBestCommunityThumb(rec));
        }
        for (const reqVid of requestedVids) {
          if (!titleCache.has(reqVid)) titleCache.set(reqVid, null);
          if (!thumbCache.has(reqVid)) thumbCache.set(reqVid, null);
          const hit = titleCache.get(reqVid);
          if (hit) result.set(reqVid, hit);
        }
      } catch {
        // Mirror timeouts fail open without blocking titles.
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  return result;
}
