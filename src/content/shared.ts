import { DEFAULT_CONFIG, mergeConfig } from "../defaults.js";
import { INTERCEPT_TAG } from "../shared/intercept.js";
import { isRecord, type DimEntry, type FeedItem, type SieveConfig } from "../types.js";

const LOCAL_CACHE_KEY = "__sieve_cached_flags_v1";

function readCachedFlags(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function applyHtmlFlags(flags: Record<string, string>): void {
  const root = document.documentElement;
  if (!root) return;
  for (const [k, v] of Object.entries(flags)) {
    if (v === "0" || v === "") {
      delete root.dataset[k];
    } else {
      root.dataset[k] = v;
    }
  }
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(flags));
  } catch {
    // Sandboxed frames may block localStorage writes.
  }
}

let relayInstalled = false;

/** Relays MAIN-world intercept requests (content/intercept.ts) to the service worker. */
export function installInterceptRelay(): void {
  if (relayInstalled) return;
  relayInstalled = true;
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d: unknown = event.data;
    if (!isRecord(d) || d.tag !== INTERCEPT_TAG || d.dir !== "req" || typeof d.id !== "string") {
      return;
    }
    const id = d.id;
    const reply = (body: string | null): void =>
      window.postMessage({ tag: INTERCEPT_TAG, dir: "res", id, body }, location.origin);
    chrome.runtime
      .sendMessage({ type: "REWRITE_RESPONSE", url: d.url, pageUrl: d.pageUrl, body: d.body })
      .then((res: unknown) => {
        if (isRecord(res) && Array.isArray(res.dimmed)) registerDimmed(res.dimmed as DimEntry[]);
        reply(isRecord(res) && typeof res.body === "string" ? res.body : null);
      })
      .catch(() => reply(null));
  });
}

// ---- Dimming: graded drops stay in the page; matching cards get a data attribute and a label.
const dimReasons = new Map<string, string>();
const DIM_CAP = 1500;

export interface DimSite {
  cards: () => Iterable<HTMLElement>;
  /** Every identifier the card exposes (video id, status id, shortcode, href). */
  idsOf: (card: HTMLElement) => string[];
}
let dimSite: DimSite | undefined;

/**
 * Marks a card with data attributes only. The reason label is a CSS ::before (dim.css), so no
 * node is added inside framework-managed (React) subtrees: inserting one made Instagram's
 * feed throw on re-render and go blank.
 */
export function markCard(card: HTMLElement, reason: string, direct = false): void {
  if (isKept(card)) return; // user said keep this one
  if (card.dataset.sieveDim !== "1") card.dataset.sieveDim = "1";
  if (direct) card.dataset.sieveDimDirect = "1";
  if (card.dataset.sieveDimReason !== reason) card.dataset.sieveDimReason = reason;
}

function unmarkCard(card: HTMLElement): void {
  delete card.dataset.sieveDim;
  delete card.dataset.sieveDimReason;
}

// Kept by item id, not by element: YouTube and X reuse card elements for new items.
const keptIds = new Set<string>();
const isKept = (card: HTMLElement): boolean => !!dimSite?.idsOf(card).some((id) => keptIds.has(id));

export function rememberDim(id: string, reason: string): void {
  if (!id) return;
  if (!dimReasons.has(id) && dimReasons.size >= DIM_CAP) {
    dimReasons.delete(dimReasons.keys().next().value!);
  }
  dimReasons.set(id, reason);
}

function scanDims(): void {
  if (!dimSite) return;
  for (const card of dimSite.cards()) {
    const reason = dimSite.idsOf(card).map((id) => dimReasons.get(id)).find(Boolean);
    if (isKept(card)) continue;
    if (reason) markCard(card, reason);
    else if (card.dataset.sieveDim === "1" && card.dataset.sieveDimDirect !== "1") unmarkCard(card);
  }
}
const scheduleDimScan = createRafScheduler(scanDims);

export function registerDimmed(entries: DimEntry[]): void {
  for (const e of entries) {
    rememberDim(e.id, e.reason);
    if (e.alt) rememberDim(e.alt, e.reason);
  }
  scheduleDimScan();
}

/** Re-marks dimmed cards whenever the SPA re-renders. */
export function installDimMarker(site: DimSite): void {
  dimSite = site;
  const observe = (): void => {
    new MutationObserver(scheduleDimScan).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    scheduleDimScan();
  };
  if (document.documentElement) observe();
  else document.addEventListener("DOMContentLoaded", observe, { once: true });
}

export function bootSiteAdapter(onConfig: (config: SieveConfig) => void): void {
  installInterceptRelay();
  // Grader verdicts that finished after the response was already delivered.
  chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
    if (sender.id !== chrome.runtime.id || !isRecord(msg) || msg.type !== "LATE_DIMS") return;
    if (Array.isArray(msg.dimmed)) registerDimmed(msg.dimmed as DimEntry[]);
  });
  // Right-click feedback: remember what was clicked, apply the verdict when the menu item fires.
  let lastContext: EventTarget | null = null;
  document.addEventListener("contextmenu", (e) => (lastContext = e.target), true);
  chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
    if (sender.id !== chrome.runtime.id || !isRecord(msg) || msg.type !== "FEEDBACK") return;
    const action = msg.action;
    if (!dimSite || !(lastContext instanceof Node) || typeof action !== "string") return;
    const card = [...dimSite.cards()].find((c) => c.contains(lastContext as Node));
    if (!card) return;
    const ids = dimSite.idsOf(card);
    const keep = action === "keep" || action === "keepCreator";
    void chrome.runtime
      .sendMessage({ type: "USER_FEEDBACK", action, ids, text: (card.innerText || "").slice(0, 300) })
      .then((res: unknown) => {
        if (!isRecord(res) || res.ok !== true) return;
        if (keep) {
          ids.forEach((id) => (dimReasons.delete(id), keptIds.add(id)));
          unmarkCard(card);
          delete card.dataset.sieveDimDirect;
        } else {
          ids.forEach((id) => (keptIds.delete(id), rememberDim(id, "you: slop")));
          markCard(card, "you: slop");
        }
      })
      .catch(() => undefined);
  });
  const baseOnConfig = onConfig;
  onConfig = (cfg) => {
    if (document.documentElement) {
      document.documentElement.dataset.sieveHide = cfg.display.hideDropped ? "1" : "0";
    }
    baseOnConfig(cfg);
  };
  const cached = readCachedFlags();
  if (document.documentElement) {
    for (const [k, v] of Object.entries(cached)) {
      if (v && v !== "0") document.documentElement.dataset[k] = v;
    }
  }

  let current = structuredClone(DEFAULT_CONFIG);
  void chrome.storage.local
    .get("sieveConfig")
    .then((stored) => {
      current = mergeConfig(stored.sieveConfig);
      onConfig(current);
    })
    .catch(() => {
      onConfig(current);
    });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.sieveConfig) {
      current = mergeConfig(changes.sieveConfig.newValue);
      onConfig(current);
    }
  });
}

export function rememberBounded(set: Set<string>, key: string, max = 4000): boolean {
  if (set.has(key)) return false;
  if (set.size >= max) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) set.delete(oldest);
  }
  set.add(key);
  return true;
}

export function createRafScheduler(run: () => void): () => void {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      run();
    });
  };
}

export async function evaluateDomBatch(
  items: FeedItem[],
  onDrop: (id: string, reason: string) => void,
): Promise<void> {
  if (items.length === 0) return;
  try {
    const res: unknown = await chrome.runtime.sendMessage({
      type: "EVALUATE_SSR_ITEMS",
      items,
    });
    if (!isRecord(res) || !Array.isArray(res.dropped)) return;
    const reasons = isRecord(res.reasons) ? res.reasons : {};
    for (const id of res.dropped) {
      if (typeof id === "string") {
        const r = reasons[id];
        onDrop(id, typeof r === "string" ? r : "dropped");
      }
    }
  } catch {
    // Background reload fails open without hiding cards.
  }
}

export function installMidFrameThumbFallback(): void {
  document.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (target.src.includes("/hq2.jpg") && !target.dataset.sieveFallback) {
        target.dataset.sieveFallback = "1";
        target.src = target.src.replace("/hq2.jpg", "/hqdefault.jpg");
      }
    },
    true,
  );
}

export function pauseAllMedia(root: ParentNode = document): void {
  root.querySelectorAll<HTMLMediaElement>("video, audio").forEach((el) => {
    try {
      el.muted = true;
      if (!el.paused) el.pause();
    } catch {
      // Detached media nodes may throw on pause.
    }
  });
}

export function createDwellTracker(
  extractText: (el: HTMLElement) => string,
  dwellMs = 1800,
): (el: HTMLElement) => void {
  const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
  const observed = new WeakSet<Element>();
  const recorded = new WeakSet<Element>();

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!(entry.target instanceof HTMLElement)) continue;
        const target = entry.target;
        if (recorded.has(target)) continue;

        if (entry.isIntersecting && entry.intersectionRatio >= 0.65 && !document.hidden) {
          if (!timers.has(target)) {
            const t = setTimeout(() => {
              timers.delete(target);
              if (document.hidden) return;
              const text = extractText(target).trim();
              if (text.length >= 24) {
                recorded.add(target);
                io.unobserve(target);
                void chrome.runtime.sendMessage({ type: "RECORD_DWELL", text }).catch(() => {});
              }
            }, dwellMs);
            timers.set(target, t);
          }
        } else {
          const pending = timers.get(target);
          if (pending !== undefined) {
            clearTimeout(pending);
            timers.delete(target);
          }
        }
      }
    },
    { threshold: [0, 0.65] },
  );

  return (el: HTMLElement) => {
    if (observed.has(el)) return;
    observed.add(el);
    io.observe(el);
  };
}
