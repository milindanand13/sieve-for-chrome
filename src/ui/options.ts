import {
  API_DEFAULT_ENDPOINT,
  API_DEFAULT_MODEL,
  CLAUDE_DEFAULT_MODEL,
  CLAUDE_ENDPOINT,
  OPENAI_DEFAULT_ENDPOINT,
  OPENAI_DEFAULT_MODEL,
  DEFAULT_CONFIG,
  DEFAULT_RUBRIC,
  LOCAL_DEFAULT_ENDPOINT,
  LOCAL_DEFAULT_MODEL,
  mergeConfig,
} from "../defaults.js";
import { clearFixtures, listFixtures } from "../background/fixtures.js";
import {
  DIAG_KEY,
  LOG_KEY,
  STATS_KEY,
  dayKey,
  readDiag,
  readLogEntries,
  readStatsData,
  sumStats,
  type Counts,
} from "../background/stats.js";
import { isGraderMode, isRecord, type GraderMode, type Platform, type SieveConfig } from "../types.js";

const kv = {
  get: (key: string) => chrome.storage.local.get(key),
  set: (items: Record<string, unknown>) => chrome.storage.local.set(items),
};

function cell(row: HTMLTableRowElement, text: string, tag: "td" | "th" = "td"): void {
  const c = document.createElement(tag);
  c.textContent = text;
  row.append(c);
}

function reasonText(c: Counts): string {
  return Object.entries(c.reasons)
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `${r} ${n}`)
    .join(", ");
}

async function renderStats(table: HTMLElement, diagEl: HTMLElement | null): Promise<void> {
  const data = await readStatsData(kv);
  const today = sumStats(data, dayKey(Date.now()));
  const all = sumStats(data);
  table.replaceChildren();
  const head = document.createElement("tr");
  for (const h of ["site", "period", "seen", "dimmed", "%", "removed", "reasons"]) cell(head, h, "th");
  table.append(head);
  for (const site of ["youtube", "x", "instagram"] as Platform[]) {
    for (const [label, src] of [["today", today], ["all time", all]] as const) {
      const c = src[site];
      if (!c) continue;
      const row = document.createElement("tr");
      cell(row, site);
      cell(row, label);
      cell(row, String(c.seen));
      cell(row, String(c.dimmed));
      cell(row, c.seen > 0 ? `${Math.round((c.dimmed / c.seen) * 100)}%` : "0%");
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

async function renderLog(table: HTMLElement, site: string): Promise<void> {
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

function parseLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

// Menu entries; openai and gemini are presets of the openai-compatible "api" mode.
const PRESETS: Record<string, { mode: GraderMode; endpoint: string; model: string }> = {
  local: { mode: "local", endpoint: LOCAL_DEFAULT_ENDPOINT, model: LOCAL_DEFAULT_MODEL },
  claude: { mode: "claude", endpoint: CLAUDE_ENDPOINT, model: CLAUDE_DEFAULT_MODEL },
  openai: { mode: "api", endpoint: OPENAI_DEFAULT_ENDPOINT, model: OPENAI_DEFAULT_MODEL },
  gemini: { mode: "api", endpoint: API_DEFAULT_ENDPOINT, model: API_DEFAULT_MODEL },
};

function parseGraderMode(val: string): GraderMode {
  return PRESETS[val]?.mode ?? (isGraderMode(val) ? val : DEFAULT_CONFIG.grader.mode);
}

/** Which menu entry a saved config shows as. */
function menuValueFor(mode: GraderMode, endpoint: string): string {
  if (mode !== "api") return mode;
  if (endpoint === OPENAI_DEFAULT_ENDPOINT) return "openai";
  if (endpoint === API_DEFAULT_ENDPOINT) return "gemini";
  return "api";
}

function requireElement<T extends HTMLElement>(
  id: string,
  ctor: abstract new (...args: never[]) => T,
): T {
  const el = document.getElementById(id);
  if (!(el instanceof ctor)) {
    throw new Error(`Missing element #${id}`);
  }
  return el;
}

async function initOptions(): Promise<void> {
  const stored = await chrome.storage.local.get("sieveConfig");
  let config: SieveConfig = mergeConfig(stored.sieveConfig);

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

  // Skips the field being edited so a refresh from storage never clobbers typing.
  function populateFields(): void {
    const idle = (el: Element): boolean => el !== document.activeElement;
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

  // Picks up changes made elsewhere (popup toggles, right-click "always keep/dim this creator").
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.sieveConfig) return;
    config = mergeConfig(changes.sieveConfig.newValue);
    populateFields();
  });

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSave(immediate = false): void {
    if (saveIndicator) saveIndicator.textContent = "saving...";
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      // Re-read so changes made elsewhere since this tab opened are not written back stale.
      const fresh = mergeConfig((await chrome.storage.local.get("sieveConfig")).sieveConfig);
      // Old verdicts were graded under the old rubric, so drop them when it changes.
      const rubricChanged = fresh.grader.rubric !== rubricEl.value;
      const config = fresh;
      config.display.hideDropped = hideDroppedEl.checked;
      config.recorder.enabled = recorderEl.checked;
      config.passFollowed = passFollowedEl.checked;
      config.noveltyFilter = noveltyFilterEl.checked;
      config.grader.mode = parseGraderMode(modeEl.value);
      config.grader.streamHoldMs = Math.max(
        100,
        Number.parseInt(holdEl.value, 10) || DEFAULT_CONFIG.grader.streamHoldMs,
      );
      config.grader.endpoint = endpointEl.value.trim();
      config.grader.model = modelEl.value.trim();
      config.grader.apiKey = keyEl.value.trim();
      config.grader.rubric = rubricEl.value;
      config.allowHandles = parseLines(allowEl.value);
      config.blockHandles = parseLines(blockEl.value);

      await chrome.storage.local.set({ sieveConfig: config });
      if (saveIndicator) saveIndicator.textContent = "saved locally";
      if (rubricChanged) void chrome.runtime.sendMessage({ type: "CLEAR_VERDICT_CACHE" }).catch(() => {});
    }, immediate ? 0 : 180);
  }

  // Cloud hosts are optional_host_permissions; ask on a user gesture. Local hosts are granted already.
  async function ensureEndpointPermission(): Promise<boolean> {
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
    blockEl,
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
      if (!(await ensureEndpointPermission())) {
        if (testResult) testResult.textContent = "host permission not granted";
        return;
      }
      const res: unknown = await chrome.runtime.sendMessage({
        type: "TEST_GRADER",
        graderOverride: {
          mode: parseGraderMode(modeEl.value),
          endpoint: endpointEl.value.trim(),
          model: modelEl.value.trim(),
          apiKey: keyEl.value.trim(),
          rubric: rubricEl.value,
          streamHoldMs: Number.parseInt(holdEl.value, 10) || DEFAULT_CONFIG.grader.streamHoldMs,
        },
      });

      if (testResult && isRecord(res)) {
        if (res.ok !== true) {
          const msg = typeof res.error === "string" ? res.error : "unreachable";
          testResult.textContent = `failed: ${msg}`;
        } else {
          const ms = typeof res.ms === "number" ? res.ms : 0;
          testResult.textContent = `ok · ${ms}ms · slop probe ${res.droppedProbeSlop ? "dropped" : "kept"}`;
        }
      }
    } catch {
      if (testResult) testResult.textContent = "connection failed";
    } finally {
      testBtn.disabled = false;
    }
  });

  async function refreshStats(): Promise<void> {
    if (!statsEl) return;
    try {
      const s: unknown = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
      if (!isRecord(s)) return;
      const hnVideos = typeof s.hnVideos === "number" ? s.hnVideos : 0;
      const slopChannels = typeof s.slopChannels === "number" ? s.slopChannels : 0;
      const cachedItems = typeof s.cachedItems === "number" ? s.cachedItems : 0;
      const learnedCreators = typeof s.learnedCreators === "number" ? s.learnedCreators : 0;
      const dwelledCount = typeof s.dwelledCount === "number" ? s.dwelledCount : 0;
      statsEl.textContent = `${hnVideos.toLocaleString()} hn videos · ${slopChannels.toLocaleString()} slop channels · ${cachedItems} cached · ${learnedCreators} creators · ${dwelledCount} dwelled`;
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
  const refreshTables = async (): Promise<void> => {
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
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sieve-samples.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
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
