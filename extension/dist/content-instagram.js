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

  // src/types.ts
  var isGraderMode = (v) => v === "off" || v === "local" || v === "api" || v === "claude";
  function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  // src/defaults.ts
  var SCHEMA_VERSION = 1;
  var DEFAULT_RUBRIC = `You filter a feed for one person: a person who loves craft and curiosity. The point is taste, not safety: hide what a thoughtful person would regret scrolling past, keep what they would be glad they saw.

Keep: genuine human craft, curiosity, engineering, hardware, software, science, design, art, photography, filmmaking and cinematography, media studies, journalism and criticism, music and live sets, film and TV trailers, stand-up comedy, outdoor sports, timely primary news, and earnest humor, even from tiny unknown creators. Funny memes are fine: never drop a post just for being a meme. Cats always stay.

Drop: engagement farming and viral sludge. Ragebait, culture-war fights, cynical dunking, celebrity or reality-TV gossip, viral shock and "kalesh" clips (fights, accidents, crowds filming an incident), relationship and dating drama posted for reactions, "am I crazy / AITA" bait, short-drama cliffhangers, AI-generated narration or visuals, engagement hooks ("wait till the end", "feel illegal to know", "comment X for the guide", siren-emoji fake breaking news), stories or threads cut off mid-sentence so you have to open them, sponsored or partner posts, hustle or crypto grifts, manufactured anxiety, and ads or promos.`;
  var OLD_DEFAULT_RUBRICS = /* @__PURE__ */ new Set([
    'You filter a feed for one person: a person who loves craft and curiosity. The point is taste, not safety: hide what a thoughtful person would regret scrolling past, keep what they would be glad they saw.\n\nKeep: genuine human craft, curiosity, engineering, hardware, software, science, design, art, photography, filmmaking and cinematography, media studies, journalism and criticism, music and live sets, film and TV trailers, stand-up comedy, outdoor sports, timely primary news, and earnest humor, even from tiny unknown creators.\n\nDrop: engagement farming and viral sludge. Ragebait, culture-war fights, cynical dunking, celebrity or reality-TV gossip, viral shock and "kalesh" clips (fights, accidents, crowds filming an incident), relationship and dating drama posted for reactions, "am I crazy / AITA" bait, short-drama cliffhangers, AI-generated narration or visuals, engagement hooks ("wait till the end", "feel illegal to know", "comment X for link", siren-emoji fake breaking news), hustle or crypto grifts, manufactured anxiety, and ads or promos.',
    'Evaluate each item across four axes:\n1. Specificity: concrete builds, demos, facts, or craft vs vague hype or mystery bait.\n2. Authenticity: genuine human voice or primary source vs engagement farming or bot cadence.\n3. Substance: real signal, art, humor, or insight vs padded filler or recycled sludge.\n4. Freshness: timely updates, strange rabbit holes, or original work vs rehashed outrage.\n\nKeep items that show genuine human craft, curiosity, engineering, hardware, software, science, design, art, cinematography, music, timely primary news, or earnest humor, even from tiny unknown creators.\n\nDrop items that fail Authenticity or Substance: ragebait, political or culture-war fights, cynical dunking, celebrity or reality-TV gossip, episodic short-drama cliffhangers, AI-generated narration or visual slop, engagement hooks ("wait till the end", "feel illegal to know", "comment X for link", siren-emoji fake breaking hype), hustle or crypto grifts, and manufactured anxiety. When uncertain, keep.\n\nKEEP section. Never drop these topics, even when they are niche, long-form, slow, or from tiny creators:\n- photography\n- filmmaking and cinematography\n- media: journalism, criticism, and production\n- outdoor sports',
    'Evaluate each item across four axes:\n1. Specificity: concrete builds, demos, facts, or craft vs vague hype or mystery bait.\n2. Authenticity: genuine human voice or primary source vs engagement farming or bot cadence.\n3. Substance: real signal, art, humor, or insight vs padded filler or recycled sludge.\n4. Freshness: timely updates, strange rabbit holes, or original work vs rehashed outrage.\n\nKeep items that show genuine human craft, curiosity, engineering, hardware, software, science, design, art, cinematography, music, timely primary news, or earnest humor, even from tiny unknown creators.\n\nDrop items that fail Authenticity or Substance: ragebait, political or culture-war fights, cynical dunking, celebrity or reality-TV gossip, episodic short-drama cliffhangers, AI-generated narration or visual slop, engagement hooks ("wait till the end", "feel illegal to know", "comment X for link", siren-emoji fake breaking hype), hustle or crypto grifts, and manufactured anxiety. When uncertain, keep.'
  ]);
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
    const mode = isGraderMode(gr.mode) ? gr.mode : d.grader.mode;
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
        rubric: typeof gr.rubric === "string" && !OLD_DEFAULT_RUBRICS.has(gr.rubric) ? gr.rubric : d.grader.rubric,
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
  var X_TIMELINE_OPS = [
    "HomeTimeline",
    "HomeLatestTimeline",
    "ExplorePage",
    "GenericTimelineById",
    "ExploreSidebar",
    "SearchTimeline"
  ];
  var INTERCEPT_URLS = [
    "https://www.youtube.com/youtubei/v1/browse*",
    "https://www.youtube.com/youtubei/v1/next*",
    "https://www.youtube.com/youtubei/v1/search*",
    "https://m.youtube.com/youtubei/v1/browse*",
    "https://m.youtube.com/youtubei/v1/next*",
    "https://m.youtube.com/youtubei/v1/search*",
    ...["x.com", "twitter.com"].flatMap(
      (h) => X_TIMELINE_OPS.map((op) => `https://${h}/i/api/graphql/*/${op}*`)
    ),
    "https://www.instagram.com/graphql/query*",
    "https://www.instagram.com/api/v1/clips/home/*",
    "https://www.instagram.com/api/v1/feed/timeline/*",
    "https://i.instagram.com/api/v1/clips/home/*",
    "https://i.instagram.com/api/v1/feed/timeline/*"
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
      try {
        chrome.runtime.sendMessage({ type: "REWRITE_RESPONSE", url: d.url, pageUrl: d.pageUrl, body: d.body }).then((res) => {
          if (isRecord(res) && Array.isArray(res.dimmed)) registerDimmed(res.dimmed);
          reply(isRecord(res) && typeof res.body === "string" ? res.body : null);
        }).catch(() => reply(null));
      } catch {
        reply(null);
      }
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
  async function sendFeedback(action, card, ids, text) {
    const keep = action === "keep" || action === "keepCreator";
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "USER_FEEDBACK", action, ids, text });
    } catch {
      return { ok: false, error: "Sieve was reloaded, refresh this page" };
    }
    if (!isRecord(res) || res.ok !== true || !dimSite) return res ?? { ok: false, error: "no reply from Sieve" };
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
  function installFeedbackButtons() {
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
    <button data-a="keep" aria-label="Sieve: good, keep posts like this" title="Good, keep posts like this">\u{1F44D}</button>
    <button data-a="drop" aria-label="Sieve: slop, dim posts like this" title="Slop, dim posts like this">\u{1F44E}</button>
    <div class="msg" aria-live="polite"></div></div>`;
    const pill = root.querySelector(".pill");
    const msg = root.querySelector(".msg");
    const buttons = [...root.querySelectorAll("button")];
    let current;
    const place = () => {
      if (!current || !current.isConnected) return hide();
      const r = current.getBoundingClientRect();
      const top = Math.max(r.top, 0);
      const bottom = Math.min(r.bottom, innerHeight);
      if (bottom - top < 70 || r.width < 120) return hide();
      pill.style.left = `${r.left + 6}px`;
      pill.style.top = `${(top + bottom) / 2 - pill.offsetHeight / 2}px`;
    };
    const show = (card) => {
      if (card !== current) {
        current = card;
        msg.textContent = "";
        const dimmed = card.dataset.sieveDim === "1";
        buttons[0].setAttribute("aria-pressed", "false");
        buttons[1].setAttribute("aria-pressed", String(dimmed));
      }
      pill.style.display = "flex";
      place();
    };
    function hide() {
      current = void 0;
      pill.style.display = "none";
    }
    document.addEventListener(
      "mouseover",
      (ev) => {
        if (!dimSite || document.documentElement?.dataset.sieveActive !== "1") return hide();
        if (ev.composedPath().includes(host)) return;
        const card = ev.target instanceof Element ? ev.target.closest(dimSite.cardSelector) : null;
        if (card) return dimSite.idsOf(card).some(Boolean) ? show(card) : hide();
        const r = current?.getBoundingClientRect();
        if (r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) return;
        hide();
      },
      { capture: true, passive: true }
    );
    addEventListener("scroll", () => place(), { capture: true, passive: true });
    for (const btn of buttons) {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const card = current;
        if (!card || !dimSite) return;
        const action = btn.dataset.a;
        const ids = dimSite.idsOf(card).filter(Boolean);
        if (ids.length === 0) {
          msg.textContent = "!";
          btn.title = "Sieve could not read this post's id";
          return;
        }
        void sendFeedback(action, card, ids, (card.innerText || "").slice(0, 300)).then((res) => {
          const ok = isRecord(res) && res.ok === true;
          msg.textContent = ok ? "\u2713" : "!";
          if (!ok) msg.title = isRecord(res) && typeof res.error === "string" ? res.error : "not saved";
          buttons[0].setAttribute("aria-pressed", String(ok && action === "keep"));
          buttons[1].setAttribute("aria-pressed", String(ok && action === "drop"));
        });
      });
    }
    const mount = () => void document.documentElement.append(host);
    if (document.documentElement) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });
  }
  function bootSiteAdapter(onConfig, isOn) {
    installInterceptRelay();
    chrome.runtime.onMessage.addListener((msg, sender) => {
      if (sender.id !== chrome.runtime.id || !isRecord(msg) || msg.type !== "LATE_DIMS") return;
      if (Array.isArray(msg.dimmed)) registerDimmed(msg.dimmed);
    });
    let lastCard;
    let lastIds = [];
    let lastText = "";
    document.addEventListener(
      "contextmenu",
      (ev) => {
        const cards = dimSite ? [...dimSite.cards()] : [];
        const hit = (c) => {
          const r = c.getBoundingClientRect();
          return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
        };
        lastCard = cards.find((c) => ev.target instanceof Node && c.contains(ev.target)) ?? cards.find(hit);
        lastIds = lastCard && dimSite ? dimSite.idsOf(lastCard) : [];
        lastText = (lastCard?.innerText || "").slice(0, 300);
      },
      true
    );
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id || !isRecord(msg) || msg.type !== "FEEDBACK") return;
      const action = msg.action;
      if (!lastCard || !dimSite || typeof action !== "string") {
        sendResponse({ ok: false, error: "no post under the click" });
        return;
      }
      void sendFeedback(action, lastCard, lastIds, lastText).then(sendResponse);
      return true;
    });
    installFeedbackButtons();
    const baseOnConfig = onConfig;
    onConfig = (cfg) => {
      if (document.documentElement) {
        document.documentElement.dataset.sieveHide = cfg.display.hideDropped ? "1" : "0";
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
  function pauseAllMedia(root = document) {
    root.querySelectorAll("video, audio").forEach((el) => {
      try {
        el.muted = true;
        if (!el.paused) el.pause();
      } catch {
      }
    });
  }

  // src/content/instagram.ts
  var SPONSORED_LABELS = /* @__PURE__ */ new Set(["ad", "sponsored", "paid partnership"]);
  var SUGGESTED_LABELS = /* @__PURE__ */ new Set([
    "suggested for you",
    "suggested post",
    "suggested posts",
    "recommended for you"
  ]);
  var ZERO_WIDTH_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g;
  var activeConfig = null;
  var evaluatedIgPosts = /* @__PURE__ */ new Set();
  function readHeaderLabels(article) {
    const actionBoundary = article.querySelector("section");
    if (!actionBoundary) return [];
    const labels = [];
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    let node;
    let steps = 0;
    while ((node = walker.nextNode()) && steps++ < 160) {
      if (!(actionBoundary.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING)) {
        break;
      }
      const parent = node.parentElement;
      if (!parent || parent.closest("button, [role='button'], figure, blockquote")) continue;
      const clean = (node.nodeValue ?? "").replace(ZERO_WIDTH_RE, "").replace(/\s+/g, " ").trim().toLowerCase();
      if (parent.closest("a") && !SPONSORED_LABELS.has(clean) && !SUGGESTED_LABELS.has(clean)) continue;
      if (clean && clean.length <= 36) labels.push(clean);
    }
    return labels;
  }
  function hasUnfollowedHeaderButton(article) {
    const boundary = article.querySelector("section");
    if (!boundary) return false;
    for (const btn of article.querySelectorAll("button, [role='button']")) {
      if (!(boundary.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_PRECEDING)) continue;
      const label = (btn.textContent ?? "").trim().toLowerCase();
      if (label === "follow") return true;
    }
    return false;
  }
  function hideHomeRightRail(main, hideClutter) {
    if (!hideClutter) {
      document.querySelectorAll('[data-sieve-ig-right-rail="1"]').forEach((el) => {
        delete el.dataset.sieveIgRightRail;
      });
      return;
    }
    const markers = main.querySelectorAll(
      'a[href*="/explore/people"], a[href*="about.instagram.com"], a[href*="/legal/terms"]'
    );
    for (const marker of markers) {
      let cur = marker.parentElement;
      let candidate = null;
      while (cur && cur !== main) {
        if (cur.querySelector("article")) break;
        const rect = cur.getBoundingClientRect();
        if (rect.width >= 220 && rect.width <= 440) {
          candidate = cur;
        }
        cur = cur.parentElement;
      }
      if (candidate) {
        candidate.dataset.sieveIgRightRail = "1";
      }
    }
  }
  function calmRenderedCaptions(root) {
    root.querySelectorAll("h1:not([data-sieve-calm]), span:not([data-sieve-calm])").forEach((el) => {
      if (el.childElementCount > 0) return;
      const raw = el.textContent;
      if (!raw || raw.length < 12) return;
      el.dataset.sieveCalm = "1";
      const calmed = calmTitle(raw);
      if (calmed !== raw) el.textContent = calmed;
    });
  }
  async function evaluateHomeArticles(main) {
    if (!activeConfig?.instagram.caliberFilter) return;
    const batch = [];
    const articleById = /* @__PURE__ */ new Map();
    main.querySelectorAll("article:not([data-sieve-hidden])").forEach((article, idx) => {
      if (article.parentElement?.closest("article")) return;
      const postLink = article.querySelector('a[href^="/p/"], a[href^="/reel/"]');
      const href = postLink?.getAttribute("href") ?? "";
      const authorLink = article.querySelector('a[href^="/"]');
      const handle = authorLink?.getAttribute("href")?.replace(/^\/|\/$/g, "").split("/")[0] ?? void 0;
      const text = article.textContent?.replace(/\s+/g, " ").trim().slice(0, 220) ?? "";
      const id = href || `ig_dom_${idx}_${text.slice(0, 24)}`;
      if (!id || !rememberBounded(evaluatedIgPosts, id)) return;
      articleById.set(id, article);
      batch.push({
        platform: "instagram",
        id,
        creatorHandle: handle,
        // Followed posts are graded too; the grader is told and keeps their own posts.
        isFollowed: !hasUnfollowedHeaderButton(article),
        surface: "timeline",
        titleOrText: text
      });
    });
    await evaluateDomBatch(batch, (dropId, reason) => {
      rememberDim(dropId, reason);
      const article = articleById.get(dropId);
      if (article) markCard(article, reason, !dropId.startsWith("/"));
    });
  }
  function sweepInstagramDom() {
    const path = window.location.pathname;
    const igOn = Boolean(activeConfig?.enabled && activeConfig.instagram.enabled);
    const main = document.querySelector('main[role="main"], main');
    if (!igOn || !main) {
      document.querySelectorAll('[data-sieve-hidden="1"], [data-sieve-ig-right-rail="1"]').forEach((el) => {
        delete el.dataset.sieveHidden;
        delete el.dataset.sieveIgRightRail;
      });
      return;
    }
    calmRenderedCaptions(main);
    if (path !== "/" && path !== "") {
      document.querySelectorAll('[data-sieve-ig-right-rail="1"]').forEach((el) => {
        delete el.dataset.sieveIgRightRail;
      });
      return;
    }
    hideHomeRightRail(main, Boolean(activeConfig?.instagram.hideClutter));
    main.querySelectorAll("article").forEach((article) => {
      if (article.parentElement?.closest("article")) return;
      const labels = readHeaderLabels(article);
      const isAd = labels.some((t) => SPONSORED_LABELS.has(t));
      const isSuggested = activeConfig?.instagram.hideClutter && labels.some((t) => SUGGESTED_LABELS.has(t));
      if (isAd || isSuggested) {
        article.dataset.sieveHidden = "1";
        pauseAllMedia(article);
      } else if (article.dataset.sieveHidden) {
        delete article.dataset.sieveHidden;
      }
    });
    void evaluateHomeArticles(main);
  }
  var scheduleSweep = createRafScheduler(sweepInstagramDom);
  function instagramPostRefs(article) {
    const href = article.querySelector('a[href^="/p/"], a[href^="/reel/"]')?.getAttribute("href") ?? "";
    const code = /^\/(?:p|reel)\/([^/]+)/.exec(href)?.[1];
    return [href, ...code ? [code] : []];
  }
  installDimMarker({
    cardSelector: "main article",
    cards: () => document.querySelectorAll("main article"),
    idsOf: instagramPostRefs
  });
  bootSiteAdapter((cfg) => {
    activeConfig = cfg;
    const igOn = cfg.enabled && cfg.instagram.enabled;
    applyHtmlFlags({
      sieveIgOn: igOn ? "1" : "0",
      sieveIgClutter: igOn && cfg.instagram.hideClutter ? "1" : "0"
    });
    scheduleSweep();
  }, (cfg) => cfg.enabled && cfg.instagram.enabled);
  window.addEventListener("popstate", scheduleSweep);
  var observer = new MutationObserver(() => {
    if (activeConfig?.enabled && activeConfig.instagram.enabled) {
      scheduleSweep();
    }
  });
  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
