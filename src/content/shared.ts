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
    try {
      chrome.runtime
        .sendMessage({ type: "REWRITE_RESPONSE", url: d.url, pageUrl: d.pageUrl, body: d.body })
        .then((res: unknown) => {
          if (isRecord(res) && Array.isArray(res.dimmed)) registerDimmed(res.dimmed as DimEntry[]);
          reply(isRecord(res) && typeof res.body === "string" ? res.body : null);
        })
        .catch(() => reply(null));
    } catch {
      // Orphaned after an extension reload: sendMessage throws synchronously; don't make the page wait out its timeout.
      reply(null);
    }
  });
}

// ---- Dimming: graded drops stay in the page; matching cards get a data attribute and a label.
const dimReasons = new Map<string, string>();
const DIM_CAP = 1500;

export interface DimSite {
  /** CSS selector matching one feed card (used for hover lookups). */
  cardSelector: string;
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

/** Saves a keep/dim call for one card and applies it to every card showing that post. */
async function sendFeedback(action: string, card: HTMLElement, ids: string[], text: string): Promise<unknown> {
  const keep = action === "keep" || action === "keepCreator";
  let res: unknown;
  try {
    res = await chrome.runtime.sendMessage({ type: "USER_FEEDBACK", action, ids, text });
  } catch {
    return { ok: false, error: "Sieve was reloaded, refresh this page" };
  }
  if (!isRecord(res) || res.ok !== true || !dimSite) return res ?? { ok: false, error: "no reply from Sieve" };
  // By id, not element: the clicked element may now show a different post.
  const site = dimSite;
  const targets = ids.length ? [...site.cards()].filter((c) => site.idsOf(c).some((id) => ids.includes(id))) : [card];
  if (keep) {
    ids.forEach((id) => (dimReasons.delete(id), keptIds.add(id)));
    targets.forEach((c) => (unmarkCard(c), delete c.dataset.sieveDimDirect));
  } else {
    ids.forEach((id) => (keptIds.delete(id), rememberDim(id, "you: slop")));
    targets.forEach((c) => markCard(c, "you: slop"));
  }
  return res;
}

/**
 * Thumbs up / down on the card under the pointer. One fixed element outside the page's own
 * tree (in a shadow root), so React feeds are never touched and site CSS cannot reach it.
 */
function installFeedbackButtons(): void {
  const host = document.createElement("sieve-feedback");
  host.style.cssText = "position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    .pill{position:fixed;display:none;flex-direction:column;gap:4px;padding:4px;border-radius:999px;
      background:rgba(20,20,20,.82);pointer-events:auto;box-shadow:0 1px 4px rgba(0,0,0,.4)}
    button{all:unset;cursor:pointer;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;
      font-size:15px;line-height:1}
    button:hover,button:focus-visible{background:rgba(255,255,255,.18);outline:none}
    button[aria-pressed="true"]{background:rgba(255,255,255,.32)}
    .msg{font:11px/1.2 ui-monospace,monospace;color:#fff;text-align:center;min-height:0}
  </style><div class="pill" role="group" aria-label="Sieve feedback">
    <button data-a="keep" aria-label="Sieve: good, keep posts like this" title="Good, keep posts like this">👍</button>
    <button data-a="drop" aria-label="Sieve: slop, dim posts like this" title="Slop, dim posts like this">👎</button>
    <div class="msg" aria-live="polite"></div></div>`;
  const pill = root.querySelector<HTMLElement>(".pill")!;
  const msg = root.querySelector<HTMLElement>(".msg")!;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("button")];
  let current: HTMLElement | undefined;

  const place = (): void => {
    if (!current || !current.isConnected) return hide();
    const r = current.getBoundingClientRect();
    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, innerHeight);
    if (bottom - top < 70 || r.width < 120) return hide();
    pill.style.left = `${r.left + 6}px`;
    pill.style.top = `${(top + bottom) / 2 - pill.offsetHeight / 2}px`;
  };
  const show = (card: HTMLElement): void => {
    if (card !== current) {
      current = card;
      msg.textContent = "";
      const dimmed = card.dataset.sieveDim === "1";
      buttons[0]!.setAttribute("aria-pressed", "false");
      buttons[1]!.setAttribute("aria-pressed", String(dimmed));
    }
    pill.style.display = "flex";
    place();
  };
  function hide(): void {
    current = undefined;
    pill.style.display = "none";
  }

  document.addEventListener(
    "mouseover",
    (ev) => {
      if (!dimSite || document.documentElement?.dataset.sieveActive !== "1") return hide();
      if (ev.composedPath().includes(host)) return;
      const card = ev.target instanceof Element ? ev.target.closest<HTMLElement>(dimSite.cardSelector) : null;
      if (card) return dimSite.idsOf(card).some(Boolean) ? show(card) : hide();
      // YouTube's hover preview covers the thumbnail but sits outside the card.
      const r = current?.getBoundingClientRect();
      if (r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) return;
      hide();
    },
    { capture: true, passive: true },
  );
  addEventListener("scroll", () => place(), { capture: true, passive: true });

  for (const btn of buttons) {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const card = current;
      if (!card || !dimSite) return;
      const action = btn.dataset.a!;
      const ids = dimSite.idsOf(card).filter(Boolean);
      if (ids.length === 0) {
        msg.textContent = "!";
        btn.title = "Sieve could not read this post's id";
        return;
      }
      void sendFeedback(action, card, ids, (card.innerText || "").slice(0, 300)).then((res) => {
        const ok = isRecord(res) && res.ok === true;
        msg.textContent = ok ? "✓" : "!";
        if (!ok) msg.title = isRecord(res) && typeof res.error === "string" ? res.error : "not saved";
        buttons[0]!.setAttribute("aria-pressed", String(ok && action === "keep"));
        buttons[1]!.setAttribute("aria-pressed", String(ok && action === "drop"));
      });
    });
  }
  const mount = (): void => void document.documentElement.append(host);
  if (document.documentElement) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
}

export function bootSiteAdapter(
  onConfig: (config: SieveConfig) => void,
  isOn: (config: SieveConfig) => boolean,
): void {
  installInterceptRelay();
  // Grader verdicts that finished after the response was already delivered.
  chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
    if (sender.id !== chrome.runtime.id || !isRecord(msg) || msg.type !== "LATE_DIMS") return;
    if (Array.isArray(msg.dimmed)) registerDimmed(msg.dimmed as DimEntry[]);
  });
  // Right-click feedback: remember what was clicked, apply the verdict when the menu item fires.
  // Resolved at right-click time: the page can scroll or re-render before the menu item fires.
  let lastCard: HTMLElement | undefined;
  let lastIds: string[] = [];
  let lastText = "";
  document.addEventListener(
    "contextmenu",
    (ev) => {
      const cards = dimSite ? [...dimSite.cards()] : [];
      const hit = (c: HTMLElement): boolean => {
        const r = c.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      };
      // YouTube's hover preview player sits over the thumbnail but outside the card, so fall back to position.
      lastCard = cards.find((c) => ev.target instanceof Node && c.contains(ev.target)) ?? cards.find(hit);
      lastIds = lastCard && dimSite ? dimSite.idsOf(lastCard) : [];
      lastText = (lastCard?.innerText || "").slice(0, 300);
    },
    true,
  );
  chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !isRecord(msg) || msg.type !== "FEEDBACK") return;
    const action = msg.action;
    if (!lastCard || !dimSite || typeof action !== "string") {
      sendResponse({ ok: false, error: "no post under the click" });
      return;
    }
    void sendFeedback(action, lastCard, lastIds, lastText).then(sendResponse);
    return true; // reply after the background answers
  });
  installFeedbackButtons();
  const baseOnConfig = onConfig;
  onConfig = (cfg) => {
    if (document.documentElement) {
      document.documentElement.dataset.sieveHide = cfg.display.hideDropped ? "1" : "0";
      // dim.css is gated on this, so turning Sieve or the site off clears dimming without a reload.
      document.documentElement.dataset.sieveActive = isOn(cfg) ? "1" : "0";
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
      // DeArrow frame failed to render: back to the image YouTube gave.
      if (target.src.includes("dearrow-thumb.ajay.app") && target.dataset.sieveOrigSrc) {
        target.src = target.dataset.sieveOrigSrc;
        return;
      }
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
