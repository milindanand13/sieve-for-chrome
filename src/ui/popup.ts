import { DEFAULT_CONFIG, mergeConfig } from "../defaults.js";
import { isRecord, type Platform, type SieveConfig } from "../types.js";

interface SwitchSpec {
  label: string;
  get: (c: SieveConfig) => boolean;
  set: (c: SieveConfig, val: boolean) => void;
}

interface PlatformCardSpec {
  id: Platform;
  title: string;
  enabledGet: (c: SieveConfig) => boolean;
  enabledSet: (c: SieveConfig, val: boolean) => void;
  switches: SwitchSpec[];
}

const UNIVERSAL_SWITCHES: SwitchSpec[] = [
  {
    label: "skip pattern checks for followed creators",
    get: (c) => c.passFollowed,
    set: (c, v) => {
      c.passFollowed = v;
    },
  },
  {
    label: "dwell novelty memory (48h)",
    get: (c) => c.noveltyFilter,
    set: (c, v) => {
      c.noveltyFilter = v;
    },
  },
  {
    label: "tier 2 local / api grader",
    get: (c) => c.grader.mode !== "off",
    set: (c, v) => {
      c.grader.mode = !v ? "off" : c.grader.model.startsWith("claude-") ? "claude" : c.grader.apiKey ? "api" : "local";
    },
  },
];

const PLATFORM_CARDS: PlatformCardSpec[] = [
  {
    id: "youtube",
    title: "youtube",
    enabledGet: (c) => c.youtube.enabled,
    enabledSet: (c, v) => {
      c.youtube.enabled = v;
    },
    switches: [
      {
        label: "caliber filter",
        get: (c) => c.youtube.caliberFilter,
        set: (c, v) => {
          c.youtube.caliberFilter = v;
        },
      },
      {
        label: "block shorts",
        get: (c) => c.youtube.hideShorts,
        set: (c, v) => {
          c.youtube.hideShorts = v;
        },
      },
      {
        label: "clean header & chips",
        get: (c) => c.youtube.cleanHeader,
        set: (c, v) => {
          c.youtube.cleanHeader = v;
        },
      },
      {
        label: "mid-frame thumbnails",
        get: (c) => c.youtube.midFrameThumbs,
        set: (c, v) => {
          c.youtube.midFrameThumbs = v;
        },
      },
      {
        label: "calm all-caps titles",
        get: (c) => c.youtube.calmTitles,
        set: (c, v) => {
          c.youtube.calmTitles = v;
        },
      },
      {
        label: "curated non-vague titles",
        get: (c) => c.youtube.dearrowTitles,
        set: (c, v) => {
          c.youtube.dearrowTitles = v;
        },
      },
    ],
  },
  {
    id: "x",
    title: "twitter / x",
    enabledGet: (c) => c.x.enabled,
    enabledSet: (c, v) => {
      c.x.enabled = v;
    },
    switches: [
      {
        label: "caliber filter",
        get: (c) => c.x.caliberFilter,
        set: (c, v) => {
          c.x.caliberFilter = v;
        },
      },
      {
        label: "llm cadence filter",
        get: (c) => c.x.slopCadenceFilter,
        set: (c, v) => {
          c.x.slopCadenceFilter = v;
        },
      },
      {
        label: "classic twitter bird",
        get: (c) => c.x.classicBird,
        set: (c, v) => {
          c.x.classicBird = v;
        },
      },
      {
        label: "clean right sidebar",
        get: (c) => c.x.cleanSidebar,
        set: (c, v) => {
          c.x.cleanSidebar = v;
        },
      },
      {
        label: "clean left navigation",
        get: (c) => c.x.cleanNav,
        set: (c, v) => {
          c.x.cleanNav = v;
        },
      },
      {
        label: "restore link headlines",
        get: (c) => c.x.restoreHeadlines,
        set: (c, v) => {
          c.x.restoreHeadlines = v;
        },
      },
    ],
  },
  {
    id: "instagram",
    title: "instagram",
    enabledGet: (c) => c.instagram.enabled,
    enabledSet: (c, v) => {
      c.instagram.enabled = v;
    },
    switches: [
      {
        label: "filter home feed",
        get: (c) => c.instagram.caliberFilter,
        set: (c, v) => {
          c.instagram.caliberFilter = v;
        },
      },
      {
        label: "filter reels for craft",
        get: (c) => c.instagram.filterReels,
        set: (c, v) => {
          c.instagram.filterReels = v;
        },
      },
      {
        label: "hide right rail & clutter",
        get: (c) => c.instagram.hideClutter,
        set: (c, v) => {
          c.instagram.hideClutter = v;
        },
      },
    ],
  },
];

export function detectPlatformFromUrl(url?: string): Platform | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (host.endsWith("youtube.com")) return "youtube";
    if (host === "x.com" || host.endsWith(".x.com") || host.endsWith("twitter.com")) return "x";
    if (host.endsWith("instagram.com")) return "instagram";
  } catch {
    return null;
  }
  return null;
}

function makeSwitchInput(checked: boolean, onChange: (val: boolean) => void): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.className = "switch";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));

  const track = document.createElement("span");
  track.className = "switch-track";
  const thumb = document.createElement("span");
  thumb.className = "switch-thumb";
  track.appendChild(thumb);

  wrap.appendChild(input);
  wrap.appendChild(track);
  return wrap;
}

type Save = (apply: (c: SieveConfig) => void) => Promise<void>;

function renderSwitchRow(
  spec: SwitchSpec,
  config: SieveConfig,
  save: Save,
): HTMLElement {
  const row = document.createElement("label");
  row.className = "row";

  const text = document.createElement("span");
  text.className = "row-label";
  text.textContent = spec.label;

  const toggle = makeSwitchInput(spec.get(config), (val) => {
    spec.set(config, val);
    void save((c) => spec.set(c, val));
  });

  row.appendChild(text);
  row.appendChild(toggle);
  return row;
}

function renderCard(
  titleText: string,
  isOff: boolean,
  switches: SwitchSpec[],
  config: SieveConfig,
  save: Save,
  headerAction?: HTMLElement,
): HTMLElement {
  const card = document.createElement("section");
  card.className = `card${isOff ? " is-off" : ""}`;

  const head = document.createElement("div");
  head.className = "card-head";
  const title = document.createElement("span");
  title.className = "card-title";
  title.textContent = titleText;
  head.appendChild(title);
  if (headerAction) head.appendChild(headerAction);
  card.appendChild(head);

  const body = document.createElement("div");
  body.className = "card-body";
  for (const sw of switches) {
    body.appendChild(renderSwitchRow(sw, config, save));
  }
  card.appendChild(body);
  return card;
}

async function initPopup(): Promise<void> {
  const stored = await chrome.storage.local.get("sieveConfig");
  let config = mergeConfig(stored.sieveConfig);

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const detected = detectPlatformFromUrl(tabs[0]?.url);

  const siteLabel = document.getElementById("active-site");
  const rawMaster = document.getElementById("master-enabled");
  const masterInput = rawMaster instanceof HTMLInputElement ? rawMaster : null;
  const primaryMount = document.getElementById("primary-mount");
  const secondaryMount = document.getElementById("secondary-mount");
  const rawDetails = document.getElementById("other-platforms");
  const detailsEl = rawDetails instanceof HTMLDetailsElement ? rawDetails : null;
  const indicatorEl = document.getElementById("other-indicator");

  if (siteLabel) {
    const matchedCard = PLATFORM_CARDS.find((p) => p.id === detected);
    siteLabel.textContent = matchedCard ? matchedCard.title : "all sites";
  }

  // Re-read and apply only the toggled field, so edits made elsewhere (options page, right-click) survive.
  let saving: Promise<void> = Promise.resolve();
  // Chained so two quick toggles don't both read the old config and undo each other.
  const saveAndRerender: Save = (apply) => (saving = saving.then(async () => {
    const fresh = mergeConfig((await chrome.storage.local.get("sieveConfig")).sieveConfig);
    apply(fresh);
    await chrome.storage.local.set({ sieveConfig: fresh });
    config = fresh;
    renderAll();
    updateStatusMode();
  }).catch(() => {}));

  if (masterInput) {
    masterInput.checked = config.enabled;
    masterInput.addEventListener("change", () => {
      config.enabled = masterInput.checked;
      const on = masterInput.checked;
      void saveAndRerender((c) => {
        c.enabled = on;
      });
    });
  }

  if (detailsEl && indicatorEl) {
    detailsEl.addEventListener("toggle", () => {
      indicatorEl.textContent = detailsEl.open ? "-" : "+";
    });
  }

  function renderUniversalAndSitesGeneralView(mount: HTMLElement): void {
    const platformSwitches: SwitchSpec[] = PLATFORM_CARDS.map((p) => ({
      label: p.title,
      get: p.enabledGet,
      set: p.enabledSet,
    }));
    mount.appendChild(
      renderCard("active platforms", !config.enabled, platformSwitches, config, saveAndRerender),
    );
    mount.appendChild(
      renderCard("universal", !config.enabled, UNIVERSAL_SWITCHES, config, saveAndRerender),
    );
  }

  function renderActivePlatformView(
    primarySpec: PlatformCardSpec,
    mount: HTMLElement,
    otherMount: HTMLElement,
  ): void {
    const siteSwitch = makeSwitchInput(primarySpec.enabledGet(config), (val) => {
      primarySpec.enabledSet(config, val);
      void saveAndRerender((c) => primarySpec.enabledSet(c, val));
    });
    mount.appendChild(
      renderCard(
        primarySpec.title,
        !config.enabled || !primarySpec.enabledGet(config),
        primarySpec.switches,
        config,
        saveAndRerender,
        siteSwitch,
      ),
    );

    const uniGroup = document.createElement("div");
    uniGroup.className = "sub-group";
    const uniTitle = document.createElement("div");
    uniTitle.className = "sub-title";
    uniTitle.textContent = "universal";
    uniGroup.appendChild(uniTitle);
    for (const sw of UNIVERSAL_SWITCHES) {
      uniGroup.appendChild(renderSwitchRow(sw, config, saveAndRerender));
    }
    otherMount.appendChild(uniGroup);

    for (const other of PLATFORM_CARDS.filter((p) => p.id !== primarySpec.id)) {
      const group = document.createElement("div");
      group.className = "sub-group";
      group.appendChild(
        renderSwitchRow(
          {
            label: other.title,
            get: other.enabledGet,
            set: other.enabledSet,
          },
          config,
          saveAndRerender,
        ),
      );
      otherMount.appendChild(group);
    }
  }

  function renderAll(): void {
    if (!primaryMount || !secondaryMount) return;
    primaryMount.replaceChildren();
    secondaryMount.replaceChildren();

    const activeSpec = detected ? PLATFORM_CARDS.find((p) => p.id === detected) : undefined;
    if (!activeSpec) {
      if (detailsEl) detailsEl.hidden = true;
      renderUniversalAndSitesGeneralView(primaryMount);
    } else {
      if (detailsEl) detailsEl.hidden = false;
      renderActivePlatformView(activeSpec, primaryMount, secondaryMount);
    }
  }

  let cachedCount = 0;
  const statusLine = document.getElementById("status-line");

  function updateStatusMode(): void {
    if (!statusLine) return;
    const modeLabel =
      config.grader.mode === "off"
        ? "sets only"
        : config.grader.mode === "local"
          ? "local"
          : config.grader.mode;
    statusLine.textContent = `${cachedCount} filtered · ${modeLabel}`;
  }

  renderAll();

  try {
    const status: unknown = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    if (isRecord(status) && typeof status.sessionFilteredCount === "number") {
      cachedCount = status.sessionFilteredCount;
    }
    updateStatusMode();
  } catch {
    if (statusLine) statusLine.textContent = DEFAULT_CONFIG.grader.mode;
  }

  document.getElementById("open-options")?.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
    window.close();
  });
}

if (typeof chrome !== "undefined" && chrome.storage) {
  void initOptionsThemeGuard();
  void initPopup();
}

function initOptionsThemeGuard(): void {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    document.documentElement.classList.add("theme-switching");
    void document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("theme-switching");
    });
  });
}
