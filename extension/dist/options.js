"use strict";
(() => {
  // src/types.ts
  var isGraderMode = (v) => v === "off" || v === "local" || v === "api" || v === "claude";
  function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  // src/defaults.ts
  var SCHEMA_VERSION = 1;
  var DEFAULT_RUBRIC = `You filter a feed for one person: a person who loves craft and curiosity. The point is taste, not safety: hide what a thoughtful person would regret scrolling past, keep what they would be glad they saw.

Keep: genuine human craft, curiosity, engineering, hardware, software, science, design, art, photography, filmmaking and cinematography, media studies, journalism and criticism, music and live sets, film and TV trailers, stand-up comedy, outdoor sports, timely primary news, and earnest humor, even from tiny unknown creators.

Drop: engagement farming and viral sludge. Ragebait, culture-war fights, cynical dunking, celebrity or reality-TV gossip, viral shock and "kalesh" clips (fights, accidents, crowds filming an incident), relationship and dating drama posted for reactions, "am I crazy / AITA" bait, short-drama cliffhangers, AI-generated narration or visuals, engagement hooks ("wait till the end", "feel illegal to know", "comment X for link", siren-emoji fake breaking news), hustle or crypto grifts, manufactured anxiety, and ads or promos.`;
  var OLD_DEFAULT_RUBRICS = /* @__PURE__ */ new Set([
    'Evaluate each item across four axes:\n1. Specificity: concrete builds, demos, facts, or craft vs vague hype or mystery bait.\n2. Authenticity: genuine human voice or primary source vs engagement farming or bot cadence.\n3. Substance: real signal, art, humor, or insight vs padded filler or recycled sludge.\n4. Freshness: timely updates, strange rabbit holes, or original work vs rehashed outrage.\n\nKeep items that show genuine human craft, curiosity, engineering, hardware, software, science, design, art, cinematography, music, timely primary news, or earnest humor, even from tiny unknown creators.\n\nDrop items that fail Authenticity or Substance: ragebait, political or culture-war fights, cynical dunking, celebrity or reality-TV gossip, episodic short-drama cliffhangers, AI-generated narration or visual slop, engagement hooks ("wait till the end", "feel illegal to know", "comment X for link", siren-emoji fake breaking hype), hustle or crypto grifts, and manufactured anxiety. When uncertain, keep.\n\nKEEP section. Never drop these topics, even when they are niche, long-form, slow, or from tiny creators:\n- photography\n- filmmaking and cinematography\n- media: journalism, criticism, and production\n- outdoor sports',
    'Evaluate each item across four axes:\n1. Specificity: concrete builds, demos, facts, or craft vs vague hype or mystery bait.\n2. Authenticity: genuine human voice or primary source vs engagement farming or bot cadence.\n3. Substance: real signal, art, humor, or insight vs padded filler or recycled sludge.\n4. Freshness: timely updates, strange rabbit holes, or original work vs rehashed outrage.\n\nKeep items that show genuine human craft, curiosity, engineering, hardware, software, science, design, art, cinematography, music, timely primary news, or earnest humor, even from tiny unknown creators.\n\nDrop items that fail Authenticity or Substance: ragebait, political or culture-war fights, cynical dunking, celebrity or reality-TV gossip, episodic short-drama cliffhangers, AI-generated narration or visual slop, engagement hooks ("wait till the end", "feel illegal to know", "comment X for link", siren-emoji fake breaking hype), hustle or crypto grifts, and manufactured anxiety. When uncertain, keep.'
  ]);
  var LOCAL_DEFAULT_ENDPOINT = "http://127.0.0.1:11434/v1/chat/completions";
  var LOCAL_DEFAULT_MODEL = "qwen3.5:4b";
  var API_DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  var API_DEFAULT_MODEL = "gemini-2.5-flash-lite";
  var CLAUDE_DEFAULT_MODEL = "claude-haiku-5-5";
  var CLAUDE_ENDPOINT = "https://api.anthropic.com";
  var OPENAI_DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
  var OPENAI_DEFAULT_MODEL = "gpt-5.4-nano";
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

  // src/background/fixtures.ts
  var DB_NAME = "sieve_fixtures_v1";
  var STORE = "samples";
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function done(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async function listFixtures() {
    const db = await openDb();
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    const rows = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows;
  }
  async function clearFixtures() {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await done(tx);
    db.close();
  }

  // src/background/stats.ts
  var STATS_KEY = "sieveStats";
  var LOG_KEY = "sieveLog";
  var DIAG_KEY = "sieveDiag";
  var emptyCounts = () => ({ seen: 0, dimmed: 0, removed: 0, reasons: {} });
  function dayKey(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function sumStats(days, onlyDay) {
    const out = {};
    for (const [day, sites] of Object.entries(days)) {
      if (onlyDay && day !== onlyDay) continue;
      for (const [site, c] of Object.entries(sites)) {
        const t = out[site] ??= emptyCounts();
        t.seen += c.seen;
        t.dimmed += c.dimmed;
        t.removed += c.removed;
        for (const [r, n] of Object.entries(c.reasons)) t.reasons[r] = (t.reasons[r] ?? 0) + n;
      }
    }
    return out;
  }
  async function readStatsData(kv2) {
    const raw = (await kv2.get(STATS_KEY))[STATS_KEY];
    return isRecord(raw) ? raw : {};
  }
  async function readLogEntries(kv2) {
    const raw = (await kv2.get(LOG_KEY))[LOG_KEY];
    return Array.isArray(raw) ? raw : [];
  }
  async function readDiag(kv2) {
    const raw = (await kv2.get(DIAG_KEY))[DIAG_KEY];
    return { graderUnreachable: isRecord(raw) && typeof raw.graderUnreachable === "number" ? raw.graderUnreachable : 0 };
  }

  // src/ui/options.ts
  var kv = {
    get: (key) => chrome.storage.local.get(key),
    set: (items) => chrome.storage.local.set(items)
  };
  function cell(row, text, tag = "td") {
    const c = document.createElement(tag);
    c.textContent = text;
    row.append(c);
  }
  function reasonText(c) {
    return Object.entries(c.reasons).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(", ");
  }
  async function renderStats(table, diagEl) {
    const data = await readStatsData(kv);
    const today = sumStats(data, dayKey(Date.now()));
    const all = sumStats(data);
    table.replaceChildren();
    const head = document.createElement("tr");
    for (const h of ["site", "period", "seen", "dimmed", "%", "removed", "reasons"]) cell(head, h, "th");
    table.append(head);
    for (const site of ["youtube", "x", "instagram"]) {
      for (const [label, src] of [["today", today], ["all time", all]]) {
        const c = src[site];
        if (!c) continue;
        const row = document.createElement("tr");
        cell(row, site);
        cell(row, label);
        cell(row, String(c.seen));
        cell(row, String(c.dimmed));
        cell(row, c.seen > 0 ? `${Math.round(c.dimmed / c.seen * 100)}%` : "0%");
        cell(row, String(c.removed));
        cell(row, reasonText(c));
        table.append(row);
      }
    }
    if (diagEl) {
      const d = await readDiag(kv);
      diagEl.textContent = `grader unreachable: ${d.graderUnreachable}`;
    }
  }
  async function renderLog(table, site) {
    const rows = (await readLogEntries(kv)).filter((e) => !site || e.site === site).slice(-200).reverse();
    table.replaceChildren();
    const head = document.createElement("tr");
    for (const h of ["time", "site", "reason", "text"]) cell(head, h, "th");
    table.append(head);
    for (const e of rows) {
      const row = document.createElement("tr");
      cell(row, new Date(e.time).toLocaleString());
      cell(row, e.site);
      cell(row, e.reason);
      cell(row, e.text);
      table.append(row);
    }
  }
  function parseLines(raw) {
    return raw.split("\n").map((line) => line.trim()).filter(Boolean);
  }
  var PRESETS = {
    local: { mode: "local", endpoint: LOCAL_DEFAULT_ENDPOINT, model: LOCAL_DEFAULT_MODEL },
    claude: { mode: "claude", endpoint: CLAUDE_ENDPOINT, model: CLAUDE_DEFAULT_MODEL },
    openai: { mode: "api", endpoint: OPENAI_DEFAULT_ENDPOINT, model: OPENAI_DEFAULT_MODEL },
    gemini: { mode: "api", endpoint: API_DEFAULT_ENDPOINT, model: API_DEFAULT_MODEL }
  };
  function parseGraderMode(val) {
    return PRESETS[val]?.mode ?? (isGraderMode(val) ? val : DEFAULT_CONFIG.grader.mode);
  }
  function menuValueFor(mode, endpoint) {
    if (mode !== "api") return mode;
    if (endpoint === OPENAI_DEFAULT_ENDPOINT) return "openai";
    if (endpoint === API_DEFAULT_ENDPOINT) return "gemini";
    return "api";
  }
  function requireElement(id, ctor) {
    const el = document.getElementById(id);
    if (!(el instanceof ctor)) {
      throw new Error(`Missing element #${id}`);
    }
    return el;
  }
  async function initOptions() {
    const stored = await chrome.storage.local.get("sieveConfig");
    let config = mergeConfig(stored.sieveConfig);
    const passFollowedEl = requireElement("pass-followed", HTMLInputElement);
    const hideDroppedEl = requireElement("hide-dropped", HTMLInputElement);
    const recorderEl = requireElement("recorder-enabled", HTMLInputElement);
    const noveltyFilterEl = requireElement("novelty-filter", HTMLInputElement);
    const modeEl = requireElement("grader-mode", HTMLSelectElement);
    const holdEl = requireElement("grader-hold", HTMLInputElement);
    const endpointEl = requireElement("grader-endpoint", HTMLInputElement);
    const modelEl = requireElement("grader-model", HTMLInputElement);
    const keyEl = requireElement("grader-key", HTMLInputElement);
    const rubricEl = requireElement("grader-rubric", HTMLTextAreaElement);
    const allowEl = requireElement("allow-handles", HTMLTextAreaElement);
    const blockEl = requireElement("block-handles", HTMLTextAreaElement);
    const testBtn = requireElement("test-grader", HTMLButtonElement);
    const saveIndicator = document.getElementById("save-indicator");
    const testResult = document.getElementById("test-result");
    const statsEl = document.getElementById("memory-stats");
    function populateFields() {
      const idle = (el) => el !== document.activeElement;
      if (idle(passFollowedEl)) passFollowedEl.checked = config.passFollowed;
      if (idle(hideDroppedEl)) hideDroppedEl.checked = config.display.hideDropped;
      if (idle(recorderEl)) recorderEl.checked = config.recorder.enabled;
      if (idle(noveltyFilterEl)) noveltyFilterEl.checked = config.noveltyFilter;
      if (idle(modeEl)) modeEl.value = menuValueFor(config.grader.mode, config.grader.endpoint);
      if (idle(holdEl)) holdEl.value = String(config.grader.streamHoldMs);
      if (idle(endpointEl)) endpointEl.value = config.grader.endpoint;
      if (idle(modelEl)) modelEl.value = config.grader.model;
      if (idle(keyEl)) keyEl.value = config.grader.apiKey;
      if (idle(rubricEl)) rubricEl.value = config.grader.rubric;
      if (idle(allowEl)) allowEl.value = config.allowHandles.join("\n");
      if (idle(blockEl)) blockEl.value = config.blockHandles.join("\n");
    }
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.sieveConfig) return;
      config = mergeConfig(changes.sieveConfig.newValue);
      populateFields();
    });
    let saveTimer;
    function scheduleSave(immediate = false) {
      if (saveIndicator) saveIndicator.textContent = "saving...";
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        const fresh = mergeConfig((await chrome.storage.local.get("sieveConfig")).sieveConfig);
        const rubricChanged = fresh.grader.rubric !== rubricEl.value;
        const config2 = fresh;
        config2.display.hideDropped = hideDroppedEl.checked;
        config2.recorder.enabled = recorderEl.checked;
        config2.passFollowed = passFollowedEl.checked;
        config2.noveltyFilter = noveltyFilterEl.checked;
        config2.grader.mode = parseGraderMode(modeEl.value);
        config2.grader.streamHoldMs = Math.max(
          100,
          Number.parseInt(holdEl.value, 10) || DEFAULT_CONFIG.grader.streamHoldMs
        );
        config2.grader.endpoint = endpointEl.value.trim();
        config2.grader.model = modelEl.value.trim();
        config2.grader.apiKey = keyEl.value.trim();
        config2.grader.rubric = rubricEl.value;
        config2.allowHandles = parseLines(allowEl.value);
        config2.blockHandles = parseLines(blockEl.value);
        await chrome.storage.local.set({ sieveConfig: config2 });
        if (saveIndicator) saveIndicator.textContent = "saved locally";
        if (rubricChanged) void chrome.runtime.sendMessage({ type: "CLEAR_VERDICT_CACHE" }).catch(() => {
        });
      }, immediate ? 0 : 180);
    }
    async function ensureEndpointPermission() {
      const mode = parseGraderMode(modeEl.value);
      if (mode === "local" || mode === "off") return true;
      try {
        const origin = `${new URL(endpointEl.value.trim()).origin}/*`;
        return await chrome.permissions.request({ origins: [origin] });
      } catch {
        return false;
      }
    }
    modeEl.addEventListener("change", () => {
      const nextMode = parseGraderMode(modeEl.value);
      const preset = PRESETS[modeEl.value];
      if (preset) {
        endpointEl.value = preset.endpoint;
        modelEl.value = preset.model;
      }
      scheduleSave();
      if (nextMode !== "local" && nextMode !== "off") {
        void ensureEndpointPermission().then((ok) => {
          if (!ok && testResult) testResult.textContent = "host permission not granted";
        });
      }
    });
    for (const el of [
      passFollowedEl,
      hideDroppedEl,
      recorderEl,
      noveltyFilterEl,
      holdEl,
      endpointEl,
      modelEl,
      keyEl,
      rubricEl,
      allowEl,
      blockEl
    ]) {
      el.addEventListener("input", () => scheduleSave());
      el.addEventListener("change", () => scheduleSave());
    }
    document.getElementById("save-rubric")?.addEventListener("click", () => scheduleSave(true));
    document.getElementById("reset-rubric")?.addEventListener("click", () => {
      rubricEl.value = DEFAULT_RUBRIC;
      scheduleSave(true);
    });
    testBtn.addEventListener("click", async () => {
      testBtn.disabled = true;
      if (testResult) testResult.textContent = "testing...";
      try {
        if (!await ensureEndpointPermission()) {
          if (testResult) testResult.textContent = "host permission not granted";
          return;
        }
        const res = await chrome.runtime.sendMessage({
          type: "TEST_GRADER",
          graderOverride: {
            mode: parseGraderMode(modeEl.value),
            endpoint: endpointEl.value.trim(),
            model: modelEl.value.trim(),
            apiKey: keyEl.value.trim(),
            rubric: rubricEl.value,
            streamHoldMs: Number.parseInt(holdEl.value, 10) || DEFAULT_CONFIG.grader.streamHoldMs
          }
        });
        if (testResult && isRecord(res)) {
          if (res.ok !== true) {
            const msg = typeof res.error === "string" ? res.error : "unreachable";
            testResult.textContent = `failed: ${msg}`;
          } else {
            const ms = typeof res.ms === "number" ? res.ms : 0;
            testResult.textContent = `ok \xB7 ${ms}ms \xB7 slop probe ${res.droppedProbeSlop ? "dropped" : "kept"}`;
          }
        }
      } catch {
        if (testResult) testResult.textContent = "connection failed";
      } finally {
        testBtn.disabled = false;
      }
    });
    async function refreshStats() {
      if (!statsEl) return;
      try {
        const s = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
        if (!isRecord(s)) return;
        const hnVideos = typeof s.hnVideos === "number" ? s.hnVideos : 0;
        const slopChannels = typeof s.slopChannels === "number" ? s.slopChannels : 0;
        const cachedItems = typeof s.cachedItems === "number" ? s.cachedItems : 0;
        const learnedCreators = typeof s.learnedCreators === "number" ? s.learnedCreators : 0;
        const dwelledCount = typeof s.dwelledCount === "number" ? s.dwelledCount : 0;
        statsEl.textContent = `${hnVideos.toLocaleString()} hn videos \xB7 ${slopChannels.toLocaleString()} slop channels \xB7 ${cachedItems} cached \xB7 ${learnedCreators} creators \xB7 ${dwelledCount} dwelled`;
      } catch {
        statsEl.textContent = "stats unavailable";
      }
    }
    document.getElementById("clear-cache")?.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "CLEAR_CACHE" });
      await refreshStats();
    });
    const statsTable = requireElement("stats-table", HTMLTableElement);
    const logTable = requireElement("log-table", HTMLTableElement);
    const logSite = requireElement("log-site", HTMLSelectElement);
    const diagEl = document.getElementById("diag-line");
    const samplesNote = document.getElementById("samples-note");
    const refreshTables = async () => {
      await renderStats(statsTable, diagEl);
      await renderLog(logTable, logSite.value);
    };
    document.getElementById("reset-counts")?.addEventListener("click", async () => {
      await chrome.storage.local.remove([STATS_KEY, DIAG_KEY]);
      await refreshTables();
    });
    document.getElementById("clear-log")?.addEventListener("click", async () => {
      await chrome.storage.local.remove(LOG_KEY);
      await refreshTables();
    });
    logSite.addEventListener("change", () => void renderLog(logTable, logSite.value));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && (changes[STATS_KEY] || changes[LOG_KEY] || changes[DIAG_KEY])) {
        void refreshTables();
      }
    });
    document.getElementById("export-samples")?.addEventListener("click", async () => {
      const rows = await listFixtures();
      if (samplesNote) samplesNote.textContent = `${rows.length} samples`;
      if (rows.length === 0) return;
      const blob = new Blob([JSON.stringify(rows.map(({ site, url, body }) => ({ site, url, body })))], {
        type: "application/json"
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "sieve-samples.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1e4);
    });
    document.getElementById("clear-samples")?.addEventListener("click", async () => {
      await clearFixtures();
      if (samplesNote) samplesNote.textContent = "cleared";
    });
    populateFields();
    await refreshStats();
    await refreshTables();
  }
  void initOptions();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    document.documentElement.classList.add("theme-switching");
    void document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("theme-switching");
    });
  });
})();
