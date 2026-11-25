import { isGraderMode, isRecord, type SieveConfig } from "./types.js";

const SCHEMA_VERSION = 1;

export const DEFAULT_RUBRIC = `You filter a social feed for one person. The point is taste, not safety: hide what a thoughtful person would regret scrolling past, keep what they would be glad they saw.

Keep: genuine human craft and curiosity, engineering, science, design, art, photography, film, music and live sets, film and TV trailers, writing and criticism, stand-up comedy, sports played or explained, timely primary news, earnest humor and funny memes, animals, and ordinary updates from real people, even from tiny unknown creators.

Drop: engagement farming and viral sludge. Ragebait, culture-war fights, cynical dunking, celebrity or reality-TV gossip, viral shock clips (fights, accidents, crowds filming an incident), relationship and dating drama posted for reactions, "am I crazy / AITA" bait, short-drama cliffhangers, AI-generated narration or visuals, engagement hooks ("wait till the end", "feel illegal to know", "comment X for the guide", siren-emoji fake breaking news), stories or threads cut off mid-sentence so you have to open them, hustle or crypto grifts, manufactured anxiety, and ads, sponsored posts or promos.`;

/** FNV-1a over UTF-16 code units: identifies a stored rubric without keeping its text in the code. */
export function rubricHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Earlier built-in rubrics, by hash: a stored copy of one is upgraded to the current default; edited rubrics are left alone.
const OLD_DEFAULT_RUBRIC_HASHES = new Set<string>([
  "93423b03",
  "4e86f553",
  "e0d2b94a",
  "818280cc",
]);

// Earlier defaults opened with the owner's own description; it moves to "About you" on upgrade.
export function aboutFromOldRubric(rubric: string): string {
  const m = /^You filter a feed for one person: ([^.]+)\./.exec(rubric);
  if (!m?.[1]) return "";
  const who = m[1].replace(/^an? /, "").trim();
  return `${who.charAt(0).toUpperCase()}${who.slice(1)}.${rubric.includes("Cats always stay") ? " Cats always stay." : ""}`;
}

export const LOCAL_DEFAULT_ENDPOINT = "http://127.0.0.1:11434/v1/chat/completions";
export const LOCAL_DEFAULT_MODEL = "qwen3.5:4b";

export const API_DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
export const API_DEFAULT_MODEL = "gemini-2.5-flash-lite";

export const CLAUDE_DEFAULT_MODEL = "claude-haiku-5-5";
export const CLAUDE_ENDPOINT = "https://api.anthropic.com";
export const OPENAI_DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
export const OPENAI_DEFAULT_MODEL = "gpt-5.4-nano";

export const DEFAULT_CONFIG: SieveConfig = {
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
    dearrowTitles: true,
  },
  x: {
    enabled: true,
    caliberFilter: true,
    slopCadenceFilter: true,
    classicBird: true,
    cleanSidebar: true,
    cleanNav: true,
    restoreHeadlines: true,
  },
  instagram: {
    enabled: true,
    caliberFilter: true,
    filterReels: true,
    hideClutter: true,
  },
  tiktok: {
    enabled: false,
    caliberFilter: true,
    cleanChrome: true,
    lightMode: true,
    postOnlyMode: false,
  },
  grader: {
    mode: "local",
    endpoint: LOCAL_DEFAULT_ENDPOINT,
    model: LOCAL_DEFAULT_MODEL,
    apiKey: "",
    rubric: DEFAULT_RUBRIC,
    aboutMe: "",
    streamHoldMs: 1500,
  },
  display: { hideDropped: false },
  recorder: { enabled: false },
  allowHandles: [],
  blockHandles: [],
};

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function bool(obj: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof obj[key] === "boolean" ? obj[key] : fallback;
}

export function mergeConfig(stored?: unknown): SieveConfig {
  if (!isRecord(stored)) return structuredClone(DEFAULT_CONFIG);

  const yt = isRecord(stored.youtube) ? stored.youtube : {};
  const x = isRecord(stored.x) ? stored.x : {};
  const ig = isRecord(stored.instagram) ? stored.instagram : {};
  const tt = isRecord(stored.tiktok) ? stored.tiktok : {};
  const gr = isRecord(stored.grader) ? stored.grader : {};
  const disp = isRecord(stored.display) ? stored.display : {};
  const rec = isRecord(stored.recorder) ? stored.recorder : {};
  const d = DEFAULT_CONFIG;
  const mode =
    isGraderMode(gr.mode) ? gr.mode : d.grader.mode;
  const oldRubric = typeof gr.rubric === "string" && OLD_DEFAULT_RUBRIC_HASHES.has(rubricHash(gr.rubric));

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
      dearrowTitles: bool(yt, "dearrowTitles", d.youtube.dearrowTitles),
    },
    x: {
      enabled: bool(x, "enabled", d.x.enabled),
      caliberFilter: bool(x, "caliberFilter", d.x.caliberFilter),
      slopCadenceFilter: bool(x, "slopCadenceFilter", d.x.slopCadenceFilter),
      classicBird: bool(x, "classicBird", d.x.classicBird),
      cleanSidebar: bool(x, "cleanSidebar", d.x.cleanSidebar),
      cleanNav: bool(x, "cleanNav", d.x.cleanNav),
      restoreHeadlines: bool(x, "restoreHeadlines", d.x.restoreHeadlines),
    },
    instagram: {
      enabled: bool(ig, "enabled", d.instagram.enabled),
      caliberFilter: bool(ig, "caliberFilter", d.instagram.caliberFilter),
      filterReels: bool(ig, "filterReels", d.instagram.filterReels),
      hideClutter: bool(ig, "hideClutter", d.instagram.hideClutter),
    },
    tiktok: {
      enabled: bool(tt, "enabled", d.tiktok.enabled),
      caliberFilter: bool(tt, "caliberFilter", d.tiktok.caliberFilter),
      cleanChrome: bool(tt, "cleanChrome", d.tiktok.cleanChrome),
      lightMode: bool(tt, "lightMode", d.tiktok.lightMode),
      postOnlyMode: bool(tt, "postOnlyMode", d.tiktok.postOnlyMode),
    },
    grader: {
      mode,
      endpoint: typeof gr.endpoint === "string" ? gr.endpoint : d.grader.endpoint,
      model: typeof gr.model === "string" ? gr.model : d.grader.model,
      apiKey: typeof gr.apiKey === "string" ? gr.apiKey : d.grader.apiKey,
      rubric: typeof gr.rubric === "string" && !oldRubric ? gr.rubric : d.grader.rubric,
      aboutMe: typeof gr.aboutMe === "string" ? gr.aboutMe : oldRubric ? aboutFromOldRubric(gr.rubric as string) : d.grader.aboutMe,
      streamHoldMs:
        typeof gr.streamHoldMs === "number" && Number.isFinite(gr.streamHoldMs)
          ? gr.streamHoldMs
          : d.grader.streamHoldMs,
    },
    display: { hideDropped: bool(disp, "hideDropped", d.display.hideDropped) },
    recorder: { enabled: bool(rec, "enabled", d.recorder.enabled) },
    allowHandles: readStringList(stored.allowHandles),
    blockHandles: readStringList(stored.blockHandles),
  };
}
