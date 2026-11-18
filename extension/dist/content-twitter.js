"use strict";
(() => {
  // src/core/dehype.ts
  var PRESERVED_ACRONYMS = /* @__PURE__ */ new Set([
    "2D",
    "3D",
    "AI",
    "API",
    "ARM",
    "ASIC",
    "CAD",
    "CAM",
    "CEO",
    "CERN",
    "CGI",
    "CLI",
    "CNC",
    "CPU",
    "CRT",
    "CSS",
    "CTO",
    "DAC",
    "DIY",
    "DMA",
    "DNS",
    "DSP",
    "EDA",
    "EEG",
    "EMC",
    "EMI",
    "ESP",
    "EU",
    "FM",
    "FPGA",
    "GCC",
    "GLSL",
    "GPIO",
    "GPS",
    "GPU",
    "GUI",
    "HDL",
    "HDMI",
    "HF",
    "HTML",
    "HTTP",
    "HTTPS",
    "I2C",
    "IC",
    "IDE",
    "IOT",
    "IP",
    "IR",
    "ISA",
    "JIT",
    "JPL",
    "JS",
    "JSON",
    "LAN",
    "LASER",
    "LCD",
    "LED",
    "LIDAR",
    "LLM",
    "LNA",
    "LORA",
    "MAC",
    "MCU",
    "MEMS",
    "MIDI",
    "MIT",
    "ML",
    "MLX",
    "MOSFET",
    "MRI",
    "NASA",
    "NFC",
    "NLP",
    "NVME",
    "NYC",
    "OLED",
    "OS",
    "PCB",
    "PCI",
    "PCIE",
    "PDF",
    "PID",
    "PLL",
    "PWM",
    "QFP",
    "QR",
    "RADAR",
    "RAM",
    "RF",
    "RGB",
    "RISC",
    "RL",
    "ROM",
    "ROS",
    "RTOS",
    "RUST",
    "SBC",
    "SDK",
    "SDR",
    "SF",
    "SIMD",
    "SLA",
    "SLS",
    "SMD",
    "SMT",
    "SOC",
    "SPI",
    "SQL",
    "SRAM",
    "SSD",
    "SSH",
    "SVG",
    "SWD",
    "TCP",
    "TLA",
    "TLS",
    "TPU",
    "TS",
    "TTL",
    "TV",
    "UART",
    "UDP",
    "UHF",
    "UI",
    "UK",
    "URL",
    "US",
    "USA",
    "USB",
    "USB-C",
    "UV",
    "UX",
    "VCO",
    "VFD",
    "VFX",
    "VGA",
    "VHF",
    "VHS",
    "VLSI",
    "VM",
    "VPN",
    "VR",
    "WASM",
    "WIFI",
    "X86",
    "XML"
  ]);
  var YT_THUMB_RE = /^https?:\/\/i\d*\.ytimg\.com\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})\//i;
  function stripPunct(token) {
    const match = /^([^A-Za-z0-9]*)([A-Za-z0-9][A-Za-z0-9'-]*[A-Za-z0-9]|[A-Za-z0-9])([^A-Za-z0-9]*)$/.exec(
      token
    );
    if (!match) return { lead: "", core: token, trail: "" };
    return { lead: match[1] ?? "", core: match[2] ?? token, trail: match[3] ?? "" };
  }
  function isAcronym(core) {
    return PRESERVED_ACRONYMS.has(core.toUpperCase());
  }
  function isShoutWord(core) {
    if (isAcronym(core)) return false;
    const letters = core.replace(/[^A-Za-z]/g, "");
    return letters.length >= 2 && letters === letters.toUpperCase();
  }
  function capitalizeWord(word) {
    return word.replace(/[A-Za-z]/, (ch) => ch.toUpperCase());
  }
  function isUrlOrHandle(part) {
    return /^(?:https?:\/\/|www\.|@)/i.test(part.trim()) || part.includes("_");
  }
  function calmTitle(title) {
    if (!title) return title;
    const collapsed = title.replace(/!{2,}/g, "!").replace(/\?{2,}/g, "?");
    const parts = collapsed.split(/(\s+)/);
    const wordIndices = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part || /^\s+$/.test(part) || isUrlOrHandle(part)) continue;
      const { core } = stripPunct(part);
      const letters = core.replace(/[^A-Za-z]/g, "");
      if (letters.length >= 2 && !isAcronym(core)) {
        wordIndices.push(i);
      }
    }
    if (wordIndices.length === 0) return collapsed;
    const shoutCount = wordIndices.filter((idx) => isShoutWord(stripPunct(parts[idx]).core)).length;
    const fullShout = shoutCount / wordIndices.length >= 0.75;
    if (fullShout) {
      let sentenceStart = true;
      return parts.map((part) => {
        if (!part || /^\s+$/.test(part) || isUrlOrHandle(part)) return part;
        const { lead, core, trail } = stripPunct(part);
        const letters = core.replace(/[^A-Za-z]/g, "");
        if (!letters) return part;
        let nextCore;
        if (isAcronym(core)) {
          nextCore = core.toUpperCase();
        } else {
          const lower = core.toLowerCase();
          nextCore = sentenceStart ? capitalizeWord(lower) : lower;
        }
        sentenceStart = /[:.!?]$/.test(trail);
        return `${lead}${nextCore}${trail}`;
      }).join("");
    }
    const nonSpaceIndices = [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] && !/^\s+$/.test(parts[i])) nonSpaceIndices.push(i);
    }
    let runStart = -1;
    const lowerPositions = /* @__PURE__ */ new Set();
    for (let k = 0; k <= nonSpaceIndices.length; k++) {
      const partIdx = nonSpaceIndices[k];
      const partVal = partIdx !== void 0 ? parts[partIdx] : "";
      const shouting = partIdx !== void 0 && !isUrlOrHandle(partVal) && isShoutWord(stripPunct(partVal).core);
      if (shouting) {
        if (runStart === -1) runStart = k;
      } else if (runStart !== -1) {
        if (k - runStart >= 2) {
          for (let j = runStart; j < k; j++) lowerPositions.add(nonSpaceIndices[j]);
        }
        runStart = -1;
      }
    }
    if (lowerPositions.size === 0) return collapsed;
    return parts.map((part, idx) => {
      if (!lowerPositions.has(idx)) return part;
      const { lead, core, trail } = stripPunct(part);
      const lowered = core.toLowerCase();
      return `${lead}${idx === nonSpaceIndices[0] ? capitalizeWord(lowered) : lowered}${trail}`;
    }).join("");
  }
  function midFrameThumbUrl(url, videoId) {
    if (!url) return url;
    const match = YT_THUMB_RE.exec(url);
    const resolvedId = match?.[1] ?? (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : "");
    if (!resolvedId) return url;
    return `https://i.ytimg.com/vi/${resolvedId}/hq2.jpg`;
  }

  // src/types.ts
  function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  // src/defaults.ts
  var SCHEMA_VERSION = 1;
  var DEFAULT_RUBRIC = `Evaluate each item across four axes:
1. Specificity: concrete builds, demos, facts, or craft vs vague hype or mystery bait.
2. Authenticity: genuine human voice or primary source vs engagement farming or bot cadence.
3. Substance: real signal, art, humor, or insight vs padded filler or recycled sludge.
4. Freshness: timely updates, strange rabbit holes, or original work vs rehashed outrage.

Keep items that show genuine human craft, curiosity, engineering, hardware, software, science, design, art, cinematography, music, timely primary news, or earnest humor, even from tiny unknown creators.

Drop items that fail Authenticity or Substance: ragebait, political or culture-war fights, cynical dunking, celebrity or reality-TV gossip, episodic short-drama cliffhangers, AI-generated narration or visual slop, engagement hooks ("wait till the end", "feel illegal to know", "comment X for link", siren-emoji fake breaking hype), hustle or crypto grifts, and manufactured anxiety. When uncertain, keep.

KEEP section. Never drop these topics, even when they are niche, long-form, slow, or from tiny creators:
- photography
- filmmaking and cinematography
- media: journalism, criticism, and production
- outdoor sports`;
  var LOCAL_DEFAULT_ENDPOINT = "http://127.0.0.1:11434/v1/chat/completions";
  var LOCAL_DEFAULT_MODEL = "qwen3.5:4b";
  var DEFAULT_CONFIG = {
    schemaVersion: SCHEMA_VERSION,
    enabled: true,
    passFollowed: true,
    noveltyFilter: true,
    youtube: {
      enabled: true,
      caliberFilter: true,
      hideShorts: true,
      cleanHeader: true,
      midFrameThumbs: true,
      calmTitles: true,
      dearrowTitles: true
    },
    x: {
      enabled: true,
      caliberFilter: true,
      slopCadenceFilter: true,
      classicBird: true,
      cleanSidebar: true,
      cleanNav: true,
      restoreHeadlines: true
    },
    instagram: {
      enabled: true,
      caliberFilter: true,
      filterReels: true,
      hideClutter: true
    },
    tiktok: {
      enabled: false,
      caliberFilter: true,
      cleanChrome: true,
      lightMode: true,
      postOnlyMode: false
    },
    grader: {
      mode: "local",
      endpoint: LOCAL_DEFAULT_ENDPOINT,
      model: LOCAL_DEFAULT_MODEL,
      apiKey: "",
      rubric: DEFAULT_RUBRIC,
      streamHoldMs: 1500
    },
    display: { hideDropped: false },
    recorder: { enabled: false },
    allowHandles: [],
    blockHandles: []
  };
  function readStringList(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((item) => typeof item === "string");
  }
  function bool(obj, key, fallback) {
    return typeof obj[key] === "boolean" ? obj[key] : fallback;
  }
  function mergeConfig(stored) {
    if (!isRecord(stored)) return structuredClone(DEFAULT_CONFIG);
    const yt = isRecord(stored.youtube) ? stored.youtube : {};
    const x = isRecord(stored.x) ? stored.x : {};
    const ig = isRecord(stored.instagram) ? stored.instagram : {};
    const tt = isRecord(stored.tiktok) ? stored.tiktok : {};
    const gr = isRecord(stored.grader) ? stored.grader : {};
    const disp = isRecord(stored.display) ? stored.display : {};
    const rec = isRecord(stored.recorder) ? stored.recorder : {};
    const d = DEFAULT_CONFIG;
    const mode = gr.mode === "off" || gr.mode === "local" || gr.mode === "api" ? gr.mode : d.grader.mode;
    return {
      schemaVersion: SCHEMA_VERSION,
      enabled: bool(stored, "enabled", d.enabled),
      passFollowed: bool(stored, "passFollowed", d.passFollowed),
      noveltyFilter: bool(stored, "noveltyFilter", d.noveltyFilter),
      youtube: {
        enabled: bool(yt, "enabled", d.youtube.enabled),
        caliberFilter: bool(yt, "caliberFilter", d.youtube.caliberFilter),
        hideShorts: bool(yt, "hideShorts", d.youtube.hideShorts),
        cleanHeader: bool(yt, "cleanHeader", d.youtube.cleanHeader),
        midFrameThumbs: bool(yt, "midFrameThumbs", d.youtube.midFrameThumbs),
        calmTitles: bool(yt, "calmTitles", d.youtube.calmTitles),
        dearrowTitles: bool(yt, "dearrowTitles", d.youtube.dearrowTitles)
      },
      x: {
        enabled: bool(x, "enabled", d.x.enabled),
        caliberFilter: bool(x, "caliberFilter", d.x.caliberFilter),
        slopCadenceFilter: bool(x, "slopCadenceFilter", d.x.slopCadenceFilter),
        classicBird: bool(x, "classicBird", d.x.classicBird),
        cleanSidebar: bool(x, "cleanSidebar", d.x.cleanSidebar),
        cleanNav: bool(x, "cleanNav", d.x.cleanNav),
        restoreHeadlines: bool(x, "restoreHeadlines", d.x.restoreHeadlines)
      },
      instagram: {
        enabled: bool(ig, "enabled", d.instagram.enabled),
        caliberFilter: bool(ig, "caliberFilter", d.instagram.caliberFilter),
        filterReels: bool(ig, "filterReels", d.instagram.filterReels),
        hideClutter: bool(ig, "hideClutter", d.instagram.hideClutter)
      },
      tiktok: {
        enabled: bool(tt, "enabled", d.tiktok.enabled),
        caliberFilter: bool(tt, "caliberFilter", d.tiktok.caliberFilter),
        cleanChrome: bool(tt, "cleanChrome", d.tiktok.cleanChrome),
        lightMode: bool(tt, "lightMode", d.tiktok.lightMode),
        postOnlyMode: bool(tt, "postOnlyMode", d.tiktok.postOnlyMode)
      },
      grader: {
        mode,
        endpoint: typeof gr.endpoint === "string" ? gr.endpoint : d.grader.endpoint,
        model: typeof gr.model === "string" ? gr.model : d.grader.model,
        apiKey: typeof gr.apiKey === "string" ? gr.apiKey : d.grader.apiKey,
        rubric: typeof gr.rubric === "string" ? gr.rubric : d.grader.rubric,
        streamHoldMs: typeof gr.streamHoldMs === "number" && Number.isFinite(gr.streamHoldMs) ? gr.streamHoldMs : d.grader.streamHoldMs
      },
      display: { hideDropped: bool(disp, "hideDropped", d.display.hideDropped) },
      recorder: { enabled: bool(rec, "enabled", d.recorder.enabled) },
      allowHandles: readStringList(stored.allowHandles),
      blockHandles: readStringList(stored.blockHandles)
    };
  }

  // src/shared/intercept.ts
  var INTERCEPT_TAG = "sieve-intercept-v1";
  var MAX_STREAM_BYTES = 12 * 1024 * 1024;
  var INTERCEPT_URLS = [
    "https://www.youtube.com/youtubei/v1/browse*",
    "https://www.youtube.com/youtubei/v1/next*",
    "https://www.youtube.com/youtubei/v1/search*",
    "https://m.youtube.com/youtubei/v1/browse*",
    "https://m.youtube.com/youtubei/v1/next*",
    "https://m.youtube.com/youtubei/v1/search*",
    "https://x.com/i/api/graphql/*",
    "https://twitter.com/i/api/graphql/*",
    "https://www.instagram.com/graphql/query*",
    "https://www.instagram.com/api/v1/clips/home/*",
    "https://www.instagram.com/api/v1/feed/timeline/*",
    "https://i.instagram.com/api/v1/clips/home/*",
    "https://i.instagram.com/api/v1/feed/timeline/*",
    "https://www.tiktok.com/api/recommend/item_list/*",
    "https://www.tiktok.com/api/post/item_list/*"
  ];
  var INTERCEPT_RES = INTERCEPT_URLS.map(
    (glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
  );

  // src/content/shared.ts
  var LOCAL_CACHE_KEY = "__sieve_cached_flags_v1";
  function readCachedFlags() {
    try {
      const raw = localStorage.getItem(LOCAL_CACHE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!isRecord(parsed)) return {};
      const out = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    } catch {
      return {};
    }
  }
  function applyHtmlFlags(flags) {
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
    }
  }
  var relayInstalled = false;
  function installInterceptRelay() {
    if (relayInstalled) return;
    relayInstalled = true;
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const d = event.data;
      if (!isRecord(d) || d.tag !== INTERCEPT_TAG || d.dir !== "req" || typeof d.id !== "string") {
        return;
      }
      const id = d.id;
      const reply = (body) => window.postMessage({ tag: INTERCEPT_TAG, dir: "res", id, body }, location.origin);
      chrome.runtime.sendMessage({ type: "REWRITE_RESPONSE", url: d.url, pageUrl: d.pageUrl, body: d.body }).then((res) => {
        if (isRecord(res) && Array.isArray(res.dimmed)) registerDimmed(res.dimmed);
        reply(isRecord(res) && typeof res.body === "string" ? res.body : null);
      }).catch(() => reply(null));
    });
  }
  var dimReasons = /* @__PURE__ */ new Map();
  var DIM_CAP = 1500;
  var dimSite;
  function markCard(card, reason, direct = false) {
    if (isKept(card)) return;
    if (card.dataset.sieveDim !== "1") card.dataset.sieveDim = "1";
    if (direct) card.dataset.sieveDimDirect = "1";
    if (card.dataset.sieveDimReason !== reason) card.dataset.sieveDimReason = reason;
  }
  function unmarkCard(card) {
    delete card.dataset.sieveDim;
    delete card.dataset.sieveDimReason;
  }
  var keptIds = /* @__PURE__ */ new Set();
  var isKept = (card) => !!dimSite?.idsOf(card).some((id) => keptIds.has(id));
  function rememberDim(id, reason) {
    if (!id) return;
    if (!dimReasons.has(id) && dimReasons.size >= DIM_CAP) {
      dimReasons.delete(dimReasons.keys().next().value);
    }
    dimReasons.set(id, reason);
  }
  function scanDims() {
    if (!dimSite) return;
    for (const card of dimSite.cards()) {
      const reason = dimSite.idsOf(card).map((id) => dimReasons.get(id)).find(Boolean);
      if (isKept(card)) continue;
      if (reason) markCard(card, reason);
      else if (card.dataset.sieveDim === "1" && card.dataset.sieveDimDirect !== "1") unmarkCard(card);
    }
  }
  var scheduleDimScan = createRafScheduler(scanDims);
  function registerDimmed(entries) {
    for (const e of entries) {
      rememberDim(e.id, e.reason);
      if (e.alt) rememberDim(e.alt, e.reason);
    }
    scheduleDimScan();
  }
  function installDimMarker(site) {
    dimSite = site;
    const observe = () => {
      new MutationObserver(scheduleDimScan).observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      scheduleDimScan();
    };
    if (document.documentElement) observe();
    else document.addEventListener("DOMContentLoaded", observe, { once: true });
  }
  function bootSiteAdapter(onConfig) {
    installInterceptRelay();
    chrome.runtime.onMessage.addListener((msg, sender) => {
      if (sender.id !== chrome.runtime.id || !isRecord(msg) || msg.type !== "LATE_DIMS") return;
      if (Array.isArray(msg.dimmed)) registerDimmed(msg.dimmed);
    });
    let lastContext = null;
    document.addEventListener("contextmenu", (e) => lastContext = e.target, true);
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id || !isRecord(msg) || msg.type !== "FEEDBACK") return;
      const action = msg.action;
      const card = dimSite && lastContext instanceof Node && typeof action === "string" ? [...dimSite.cards()].find((c) => c.contains(lastContext)) : void 0;
      if (!card || !dimSite || typeof action !== "string") {
        sendResponse({ ok: false, error: "no post under the click" });
        return;
      }
      const ids = dimSite.idsOf(card);
      const keep = action === "keep" || action === "keepCreator";
      void chrome.runtime.sendMessage({ type: "USER_FEEDBACK", action, ids, text: (card.innerText || "").slice(0, 300) }).then((res) => {
        sendResponse(res ?? { ok: false, error: "no reply from Sieve" });
        if (!isRecord(res) || res.ok !== true) return;
        if (keep) {
          ids.forEach((id) => (dimReasons.delete(id), keptIds.add(id)));
          unmarkCard(card);
          delete card.dataset.sieveDimDirect;
        } else {
          ids.forEach((id) => (keptIds.delete(id), rememberDim(id, "you: slop")));
          markCard(card, "you: slop");
        }
      }).catch(() => sendResponse({ ok: false, error: "no reply from Sieve" }));
      return true;
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
    void chrome.storage.local.get("sieveConfig").then((stored) => {
      current = mergeConfig(stored.sieveConfig);
      onConfig(current);
    }).catch(() => {
      onConfig(current);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.sieveConfig) {
        current = mergeConfig(changes.sieveConfig.newValue);
        onConfig(current);
      }
    });
  }
  function rememberBounded(set, key, max = 4e3) {
    if (set.has(key)) return false;
    if (set.size >= max) {
      const oldest = set.values().next().value;
      if (oldest !== void 0) set.delete(oldest);
    }
    set.add(key);
    return true;
  }
  function createRafScheduler(run) {
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
  async function evaluateDomBatch(items, onDrop) {
    if (items.length === 0) return;
    try {
      const res = await chrome.runtime.sendMessage({
        type: "EVALUATE_SSR_ITEMS",
        items
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
    }
  }
  function installMidFrameThumbFallback() {
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
      true
    );
  }
  function createDwellTracker(extractText, dwellMs = 1800) {
    const timers = /* @__PURE__ */ new WeakMap();
    const observed = /* @__PURE__ */ new WeakSet();
    const recorded = /* @__PURE__ */ new WeakSet();
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
                  void chrome.runtime.sendMessage({ type: "RECORD_DWELL", text }).catch(() => {
                  });
                }
              }, dwellMs);
              timers.set(target, t);
            }
          } else {
            const pending = timers.get(target);
            if (pending !== void 0) {
              clearTimeout(pending);
              timers.delete(target);
            }
          }
        }
      },
      { threshold: [0, 0.65] }
    );
    return (el) => {
      if (observed.has(el)) return;
      observed.add(el);
      io.observe(el);
    };
  }

  // src/content/twitter.ts
  var BIRD_FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%231d9bf0' d='M23.643 4.937c-.835.37-1.732.62-2.675.733.962-.576 1.7-1.49 2.048-2.578-.9.534-1.897.922-2.958 1.13-.85-.904-2.06-1.47-3.4-1.47-2.572 0-4.658 2.086-4.658 4.66 0 .364.042.718.12 1.06-3.873-.195-7.304-2.05-9.602-4.868-.4.69-.63 1.49-.63 2.342 0 1.616.823 3.043 2.072 3.878-.764-.025-1.482-.234-2.11-.583v.06c0 2.257 1.605 4.14 3.737 4.568-.392.106-.803.162-1.227.162-.3 0-.593-.028-.877-.082.593 1.85 2.313 3.198 4.352 3.234-1.595 1.25-3.604 1.995-5.786 1.995-.376 0-.747-.022-1.112-.065 2.062 1.323 4.51 2.093 7.14 2.093 8.57 0 13.255-7.098 13.255-13.254 0-.2-.005-.402-.014-.602.91-.658 1.7-1.477 2.323-2.41z'/%3E%3C/svg%3E";
  var activeConfig = null;
  var evaluatedDomCells = /* @__PURE__ */ new Set();
  var trackTweetDwell = createDwellTracker(
    (tweet) => tweet.querySelector('[data-testid="tweetText"]')?.textContent ?? "",
    1800
  );
  installMidFrameThumbFallback();
  function syncBirdBranding() {
    if (!activeConfig?.enabled || !activeConfig.x.enabled || !activeConfig.x.classicBird) return;
    if (document.title.endsWith(" / X")) {
      document.title = `${document.title.slice(0, -4)} / Twitter`;
    } else if (document.title === "X") {
      document.title = "Twitter";
    }
    const icon = document.querySelector('link[rel="shortcut icon"], link[rel="icon"]');
    if (icon && icon.href !== BIRD_FAVICON) {
      icon.href = BIRD_FAVICON;
    }
  }
  async function evaluateExploreCells() {
    if (!activeConfig?.enabled || !activeConfig.x.enabled || !activeConfig.x.caliberFilter) return;
    if (!window.location.pathname.startsWith("/explore")) return;
    const cells = document.querySelectorAll(
      'div[data-testid="primaryColumn"] [data-testid="cellInnerDiv"]:not([data-sieve-x-dropped])'
    );
    const batch = [];
    const cellById = /* @__PURE__ */ new Map();
    cells.forEach((cell, idx) => {
      const trend = cell.querySelector('[data-testid="trend"]');
      if (trend) {
        const text = (trend.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!text || text.length < 3) return;
        const id = `dom_trend_${text.slice(0, 48)}`;
        if (!rememberBounded(evaluatedDomCells, id)) return;
        cellById.set(id, cell);
        batch.push({
          platform: "x",
          id,
          surface: "search",
          titleOrText: text.slice(0, 180)
        });
        return;
      }
      const tweet = cell.querySelector('[data-testid="tweet"]');
      if (tweet) {
        const statusLink = tweet.querySelector('a[href*="/status/"]');
        const match = /\/([^/]+)\/status\/(\d+)/.exec(statusLink?.getAttribute("href") ?? "");
        const tweetBody = tweet.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ?? "";
        if (!tweetBody) return;
        const id = match?.[2] ?? `dom_explore_tw_${idx}_${tweetBody.slice(0, 24)}`;
        if (!rememberBounded(evaluatedDomCells, id)) return;
        cellById.set(id, cell);
        batch.push({
          platform: "x",
          id,
          creatorHandle: match?.[1],
          surface: "search",
          titleOrText: tweetBody
        });
      }
    });
    await evaluateDomBatch(batch, (dropId, reason) => {
      rememberDim(dropId, reason);
      const cell = cellById.get(dropId);
      if (cell) markCard(cell, reason, !/^\d+$/.test(dropId));
    });
  }
  function polishTimelineDom() {
    if (!activeConfig?.enabled || !activeConfig.x.enabled) return;
    document.querySelectorAll('img[src*="ytimg.com/vi"]:not([data-sieve-thumb])').forEach((img) => {
      img.dataset.sieveThumb = "1";
      const next = midFrameThumbUrl(img.src);
      if (next !== img.src) img.src = next;
    });
    document.querySelectorAll('[data-testid="tweetText"]:not([data-sieve-calm])').forEach((tweetText) => {
      tweetText.dataset.sieveCalm = "1";
      const walker = document.createTreeWalker(tweetText, NodeFilter.SHOW_TEXT);
      let node;
      while (node = walker.nextNode()) {
        const val = node.nodeValue;
        if (!val || val.trim().length < 6) continue;
        const calmed = calmTitle(val);
        if (calmed !== val) node.nodeValue = calmed;
      }
    });
    document.querySelectorAll('[data-testid="tweet"]').forEach((tweetEl) => trackTweetDwell(tweetEl));
    void evaluateExploreCells();
  }
  var schedulePolish = createRafScheduler(polishTimelineDom);
  installDimMarker({
    cards: () => document.querySelectorAll('[data-testid="cellInnerDiv"]'),
    idsOf: (cell) => {
      const href = cell.querySelector('[data-testid="tweet"] a[href*="/status/"]')?.getAttribute("href");
      const m = /\/status\/(\d+)/.exec(href ?? "");
      return m?.[1] ? [m[1]] : [];
    }
  });
  bootSiteAdapter((cfg) => {
    activeConfig = cfg;
    const xOn = cfg.enabled && cfg.x.enabled;
    applyHtmlFlags({
      sieveXOn: xOn ? "1" : "0",
      sieveXBird: xOn && cfg.x.classicBird ? "1" : "0",
      sieveXSidebar: xOn && cfg.x.cleanSidebar ? "1" : "0",
      sieveXNav: xOn && cfg.x.cleanNav ? "1" : "0"
    });
    syncBirdBranding();
    schedulePolish();
  });
  var titleObserver = new MutationObserver(syncBirdBranding);
  var watchHead = () => {
    if (document.head) {
      syncBirdBranding();
      titleObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
    }
  };
  if (document.head) watchHead();
  else document.addEventListener("DOMContentLoaded", watchHead, { once: true });
  var bodyObserver = new MutationObserver(() => {
    if (activeConfig?.enabled && activeConfig.x.enabled) {
      schedulePolish();
    }
  });
  if (document.documentElement) {
    bodyObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
