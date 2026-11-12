import { clearDeArrowCache, lookupDeArrowTitles } from "../core/dearrow.js";
import { gradeItemsBatch } from "../core/llm.js";
import { runSieveDetailed } from "../core/sieve.js";
import { DEFAULT_CONFIG, mergeConfig } from "../defaults.js";
import {
  isRecord,
  type EvaluateSsrItemsResponse,
  type FeedItem,
  type GraderSettings,
  type ResolveDearrowTitlesResponse,
  type SeedSets,
  type SieveConfig,
  type SieveStatus,
  type TestGraderResponse,
} from "../types.js";
import { createMemoryStore } from "./memory.js";
import { createNoveltyMemory } from "./novelty.js";
import { addFixture } from "./fixtures.js";
import { rewriteResponseBody } from "./rewrite.js";
import { createStats } from "./stats.js";
import { matchesInterceptUrl, MAX_STREAM_BYTES } from "../shared/intercept.js";

let config: SieveConfig = structuredClone(DEFAULT_CONFIG);
// MV3 service workers sleep after ~30s idle: nothing below is assumed to survive a wake.
// Config and seeds reload through ensureReady(); the session counter lives in storage.session.
const SESSION_COUNT_KEY = "sieveSessionFiltered";

async function getSessionCount(): Promise<number> {
  const stored = await chrome.storage.session.get(SESSION_COUNT_KEY);
  const n = stored[SESSION_COUNT_KEY];
  return typeof n === "number" ? n : 0;
}

async function setSessionCount(n: number): Promise<void> {
  await chrome.storage.session.set({ [SESSION_COUNT_KEY]: n });
}

const seeds: SeedSets = {
  hnVideos: new Set(),
  hnChannels: new Set(),
  slopChannels: new Set(),
};

const stats = createStats({
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
});

const memory = createMemoryStore();
const novelty = createNoveltyMemory();

async function loadSeedSet(assetPath: string, target: Set<string>): Promise<void> {
  try {
    const res = await fetch(chrome.runtime.getURL(assetPath));
    if (!res.ok) return;
    const text = await res.text();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) target.add(trimmed);
    }
  } catch {
    // Missing seed assets leave the corresponding Set empty.
  }
}

async function initConfigAndSeeds(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get("sieveConfig");
    config = mergeConfig(stored.sieveConfig);
  } catch {
    config = structuredClone(DEFAULT_CONFIG);
  }

  await Promise.all([
    loadSeedSet("assets/seeds/hn-videos.txt", seeds.hnVideos),
    loadSeedSet("assets/seeds/hn-channels.txt", seeds.hnChannels),
    loadSeedSet("assets/seeds/slop-channels.txt", seeds.slopChannels),
  ]);
}

let ready: Promise<void> | undefined;
function ensureReady(): Promise<void> {
  // Await IndexedDB hydration so the first batch after a wake sees cached verdicts.
  ready ??= Promise.all([initConfigAndSeeds(), memory.ready, novelty.ready]).then(() => undefined);
  return ready;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.sieveConfig) {
    config = mergeConfig(changes.sieveConfig.newValue);
  }
});

// The one place a rule or grader drop is decided, counted and logged (id -> reason).
async function evaluate(items: FeedItem[], docKey: string): Promise<Map<string, string>> {
  const dropped = await runSieveDetailed(items, config, seeds, memory, fetch, novelty, {
    onGraderError: () => void stats.bumpDiag().catch(() => undefined),
  });
  await stats.record(docKey, items, dropped).catch(() => undefined);
  if (dropped.size > 0) await setSessionCount((await getSessionCount()) + dropped.size);
  return dropped;
}

function docKeyOf(sender: chrome.runtime.MessageSender): string {
  return sender.documentId ?? `${sender.tab?.id ?? "x"}:${sender.frameId ?? 0}`;
}

function parseGraderOverride(raw: unknown): GraderSettings | undefined {
  if (!isRecord(raw)) return undefined;
  const mode = raw.mode === "off" || raw.mode === "local" || raw.mode === "api" ? raw.mode : null;
  if (
    !mode ||
    typeof raw.endpoint !== "string" ||
    typeof raw.model !== "string" ||
    typeof raw.apiKey !== "string" ||
    typeof raw.rubric !== "string" ||
    typeof raw.streamHoldMs !== "number"
  ) {
    return undefined;
  }
  return {
    mode,
    endpoint: raw.endpoint,
    model: raw.model,
    apiKey: raw.apiKey,
    rubric: raw.rubric,
    streamHoldMs: raw.streamHoldMs,
  };
}

function handle(
  raw: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> | undefined {
  if (!isRecord(raw) || typeof raw.type !== "string") return undefined;

  if (raw.type === "REWRITE_RESPONSE") {
    // Only content scripts in a tab may ask, and only for URLs the interceptor wraps.
    if (
      !sender.tab ||
      typeof raw.url !== "string" ||
      typeof raw.pageUrl !== "string" ||
      typeof raw.body !== "string" ||
      raw.body.length > MAX_STREAM_BYTES ||
      !matchesInterceptUrl(raw.url)
    ) {
      return Promise.resolve({ body: null });
    }
    const docKey = docKeyOf(sender);
    return rewriteResponseBody(raw.url, raw.pageUrl, raw.body, config, {
      evaluate: (items) => evaluate(items, docKey),
      recordFixture: addFixture,
    }).then(async (res) => {
      if (!res) return { body: null };
      await stats.recordRemoved(res.hard).catch(() => undefined);
      return { body: res.body, dimmed: res.dimmed };
    });
  }

  if (raw.type === "GET_STATUS") {
    const stats = memory.counts();
    return getSessionCount().then(
      (sessionFilteredCount): SieveStatus => ({
        sessionFilteredCount,
        cachedItems: stats.cachedItems,
        learnedCreators: stats.learnedCreators,
        dwelledCount: novelty.size(),
        hnVideos: seeds.hnVideos.size,
        slopChannels: seeds.slopChannels.size,
      }),
    );
  }

  if (raw.type === "CLEAR_CACHE") {
    novelty.clear();
    clearDeArrowCache();
    return Promise.all([setSessionCount(0), memory.clear()]).then(() => ({ ok: true }));
  }

  if (raw.type === "CLEAR_VERDICT_CACHE") {
    return memory.clear().then(() => ({ ok: true }));
  }

  if (raw.type === "RECORD_DWELL" && typeof raw.text === "string") {
    if (config.enabled && config.noveltyFilter) {
      novelty.recordDwelled(raw.text);
    }
    return Promise.resolve({ ok: true });
  }

  if (raw.type === "RESOLVE_DEARROW_TITLES" && Array.isArray(raw.videoIds)) {
    if (!config.enabled || !config.youtube.enabled || !config.youtube.dearrowTitles) {
      return Promise.resolve({ titles: {} } satisfies ResolveDearrowTitlesResponse);
    }
    const videoIds = raw.videoIds.filter((id): id is string => typeof id === "string");
    return lookupDeArrowTitles(videoIds).then(
      (map): ResolveDearrowTitlesResponse => ({
        titles: Object.fromEntries(map),
      }),
    );
  }

  if (raw.type === "EVALUATE_SSR_ITEMS" && Array.isArray(raw.items)) {
    const items = raw.items.filter(
      (item): item is FeedItem =>
        isRecord(item) && typeof item.id === "string" && typeof item.titleOrText === "string",
    );
    return evaluate(items, docKeyOf(sender)).then(
      (dropped): EvaluateSsrItemsResponse => ({
        dropped: [...dropped.keys()],
        reasons: Object.fromEntries(dropped),
      }),
    );
  }

  if (raw.type === "TEST_GRADER") {
    const override = parseGraderOverride(raw.graderOverride);
    const testConfig: SieveConfig = override ? { ...config, grader: override } : config;
    const probe: FeedItem[] = [
      {
        platform: "youtube",
        id: "probe_craft",
        creatorHandle: "maker",
        surface: "home",
        titleOrText: "Machining a brass flexure stage on a manual mill",
      },
      {
        platform: "youtube",
        id: "probe_slop",
        creatorHandle: "rage_daily",
        surface: "home",
        titleOrText: "CELEBRITY MELTDOWN EXPOSED!! COMMENT LINK FOR FREE CRYPTO!!",
      },
    ];
    const started = Date.now();
    return gradeItemsBatch(probe, testConfig)
      .then(
        (drops): TestGraderResponse => ({
          ok: true,
          ms: Date.now() - started,
          droppedProbeSlop: drops.has("probe_slop"),
        }),
      )
      .catch(
        (err: unknown): TestGraderResponse => ({
          ok: false,
          ms: Date.now() - started,
          error: err instanceof Error ? err.message : "Request failed",
        }),
      );
  }

  return undefined;
}

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  void ensureReady()
    .then(() => handle(raw, sender))
    .then(sendResponse, () => sendResponse(undefined));
  return true; // keep the channel open for the async reply
});

void ensureReady();
