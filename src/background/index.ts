import { clearDeArrowCache, lookupDeArrowTitles } from "../core/dearrow.js";
import { gradeItemsBatch } from "../core/llm.js";
import { runSieveDetailed } from "../core/sieve.js";
import { DEFAULT_CONFIG, mergeConfig } from "../defaults.js";
import {
  isRecord,
  type EvaluateSsrItemsResponse,
  type DimEntry,
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
import { snippet } from "../core/sink.js";
import { feedbackBlock, type FeedbackEntry } from "../core/feedback.js";
import { normalizeHandle } from "../core/dehype.js";
import { rewriteResponseBody, siteForHost } from "./rewrite.js";
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
    feedback = parseFeedback((await chrome.storage.local.get(FEEDBACK_KEY))[FEEDBACK_KEY]);
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
  if (area === "local" && changes.sieveFeedback) feedback = parseFeedback(changes.sieveFeedback.newValue);
});

// ---- Right-click feedback: corrections persist and are shown to the grader as examples.
let feedback: FeedbackEntry[] = [];
const FEEDBACK_KEY = "sieveFeedback";
const FEEDBACK_CAP = 30;
const RECENT_CAP = 3000;
const recentItems = new Map<string, FeedItem>();
const FEEDBACK_ACTIONS = ["keep", "drop", "keepCreator", "dropCreator"];

function parseFeedback(raw: unknown): FeedbackEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is FeedbackEntry =>
      isRecord(e) && typeof e.text === "string" && (e.verdict === "keep" || e.verdict === "drop"),
  );
}

function rememberRecent(item: FeedItem): void {
  for (const id of [item.id, item.altId]) {
    if (!id) continue;
    const key = `${item.platform}:${id}`;
    if (!recentItems.has(key) && recentItems.size >= RECENT_CAP) {
      recentItems.delete(recentItems.keys().next().value!);
    }
    recentItems.set(key, item);
  }
}

async function handleFeedback(
  action: string,
  ids: string[],
  pageText: string,
  sender: chrome.runtime.MessageSender,
) {
  const platform = siteForHost(new URL(sender.tab?.url ?? "http://x").hostname);
  if (!platform) return { ok: false, error: "unknown site" };
  const known = ids.map((id) => recentItems.get(`${platform}:${id}`)).find(Boolean);
  // shortcut: recentItems is lost when the service worker sleeps, so older cards fall back to the
  // card's own text and no creator; persist it to storage.session if creator actions fail often.
  const item: FeedItem = known ?? { platform, id: ids[0]!, surface: "home", titleOrText: pageText };
  const keep = action === "keep" || action === "keepCreator";
  if (action === "keepCreator" || action === "dropCreator") {
    const handle = item.creatorHandle || item.creatorId;
    if (!handle) return { ok: false, error: "no creator known" };
    const norm = normalizeHandle(handle);
    const same = (h: string): boolean => normalizeHandle(h) === norm;
    const next: SieveConfig = {
      ...config,
      allowHandles: config.allowHandles.filter((h) => !same(h)),
      blockHandles: config.blockHandles.filter((h) => !same(h)),
    };
    (keep ? next.allowHandles : next.blockHandles).push(handle);
    config = next;
    await chrome.storage.local.set({ sieveConfig: next });
  }
  const reason = keep ? "you: keep" : "you: slop";
  await memory.recordVerdict(item, keep ? "keep" : "drop", reason);
  // Unknown item: the id the feed used may be any of the card's ids (Instagram shortcode vs pk).
  if (!known) for (const id of ids.slice(1)) await memory.recordVerdict({ ...item, id }, keep ? "keep" : "drop", reason);
  const text = snippet(item.titleOrText);
  if (text) {
    const verdict = keep ? "keep" : "drop";
    const rest = feedback.filter((e) => e.text !== text); // latest click wins
    feedback = [...rest, { text, verdict } as FeedbackEntry].slice(-FEEDBACK_CAP);
    await chrome.storage.local.set({ [FEEDBACK_KEY]: feedback });
  }
  return { ok: true };
}

chrome.runtime.onInstalled.addListener(() => {
  const documentUrlPatterns = [
    "*://*.youtube.com/*",
    "*://x.com/*",
    "*://*.x.com/*",
    "*://twitter.com/*",
    "*://*.twitter.com/*",
    "*://*.instagram.com/*",
  ];
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "sieve", title: "Sieve", contexts: ["all"], documentUrlPatterns });
    const entries: [string, string][] = [
      ["keep", "Not slop, keep this"],
      ["drop", "Slop, dim this"],
      ["keepCreator", "Always keep this creator"],
      ["dropCreator", "Always dim this creator"],
    ];
    for (const [id, title] of entries) {
      chrome.contextMenus.create({ id, parentId: "sieve", title, contexts: ["all"], documentUrlPatterns });
    }
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.id === undefined || typeof info.menuItemId !== "string") return;
  chrome.tabs
    .sendMessage(tab.id, { type: "FEEDBACK", action: info.menuItemId }, { frameId: info.frameId ?? 0 })
    .catch(() => undefined);
});

// The one place a rule or grader drop is decided, counted and logged (id -> reason).
// In dim mode the grader is not awaited: its drops reach the page later as LATE_DIMS.
async function evaluate(
  items: FeedItem[],
  docKey: string,
  target?: { tabId: number; frameId: number },
): Promise<Map<string, string>> {
  items.forEach(rememberRecent);
  const graded: SieveConfig = {
    ...config,
    grader: { ...config.grader, rubric: config.grader.rubric + feedbackBlock(feedback) },
  };
  const dropped = await runSieveDetailed(items, graded, seeds, memory, fetch, novelty, {
    skipHold: !config.display.hideDropped,
    onGraderError: () => void stats.bumpDiag().catch(() => undefined),
    onLate: (late) => {
      void stats.record(docKey, items, late).catch(() => undefined);
      void getSessionCount().then((n) => setSessionCount(n + late.size)).catch(() => undefined);
      if (!target) return;
      const dimmed: DimEntry[] = [];
      for (const [id, reason] of late) {
        const item = items.find((i) => i.id === id);
        if (item) {
          dimmed.push({ id, alt: item.altId, site: item.platform, reason, text: snippet(item.titleOrText) });
        }
      }
      chrome.tabs
        .sendMessage(target.tabId, { type: "LATE_DIMS", dimmed }, { frameId: target.frameId })
        .catch(() => undefined);
    },
  });
  await stats.record(docKey, items, dropped).catch(() => undefined);
  if (dropped.size > 0) await setSessionCount((await getSessionCount()) + dropped.size);
  return dropped;
}

function targetOf(sender: chrome.runtime.MessageSender) {
  return sender.tab?.id === undefined ? undefined : { tabId: sender.tab.id, frameId: sender.frameId ?? 0 };
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
      evaluate: (items) => evaluate(items, docKey, targetOf(sender)),
      recordFixture: addFixture,
    }).then(async (res) => {
      if (!res) return { body: null };
      await stats.recordRemoved(res.hard).catch(() => undefined);
      return { body: res.body, dimmed: res.dimmed };
    });
  }

  if (raw.type === "USER_FEEDBACK") {
    if (
      !sender.tab ||
      sender.id !== chrome.runtime.id ||
      typeof raw.action !== "string" ||
      !FEEDBACK_ACTIONS.includes(raw.action) ||
      !Array.isArray(raw.ids) ||
      raw.ids.length === 0 ||
      raw.ids.length > 10 ||
      !raw.ids.every((id): id is string => typeof id === "string" && id.length > 0 && id.length < 300)
    ) {
      return Promise.resolve({ ok: false, error: "bad request" });
    }
    const text = typeof raw.text === "string" ? raw.text.slice(0, 300) : "";
    return handleFeedback(raw.action, raw.ids, text, sender);
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
    return evaluate(items, docKeyOf(sender), targetOf(sender)).then(
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

// Ollama returns 403 to chrome-extension:// origins. Session rules (unlike static ones) may use tabIds,
// so -1 limits this to requests made by the extension itself, not by pages.
void chrome.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [1],
  addRules: [
    {
      id: 1,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        requestHeaders: [{ header: "origin", operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE }],
      },
      condition: {
        regexFilter: "^http://(127\\.0\\.0\\.1|localhost):11434/",
        tabIds: [-1],
        resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST, chrome.declarativeNetRequest.ResourceType.OTHER],
      },
    },
  ],
});
