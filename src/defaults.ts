import { isRecord, type SieveConfig } from "./types.js";

const SCHEMA_VERSION = 1;

export const DEFAULT_RUBRIC = `You filter a feed for one person: a person who loves craft and curiosity. The point is taste, not safety: hide what a thoughtful person would regret scrolling past, keep what they would be glad they saw.

Keep: genuine human craft, curiosity, engineering, hardware, software, science, design, art, photography, filmmaking and cinematography, media studies, journalism and criticism, music and live sets, film and TV trailers, stand-up comedy, outdoor sports, timely primary news, and earnest humor, even from tiny unknown creators.

Drop: engagement farming and viral sludge. Ragebait, culture-war fights, cynical dunking, celebrity or reality-TV gossip, viral shock and "kalesh" clips (fights, accidents, crowds filming an incident), relationship and dating drama posted for reactions, "am I crazy / AITA" bait, short-drama cliffhangers, AI-generated narration or visuals, engagement hooks ("wait till the end", "feel illegal to know", "comment X for link", siren-emoji fake breaking news), hustle or crypto grifts, manufactured anxiety, and ads or promos.`;

// Earlier built-in rubrics: a stored copy of one is upgraded to the current default; edited rubrics are left alone.
const OLD_DEFAULT_RUBRICS = new Set<string>([
  "Evaluate each item across four axes:\n1. Specificity: concrete builds, demos, facts, or craft vs vague hype or mystery bait.\n2. Authenticity: genuine human voice or primary source vs engagement farming or bot cadence.\n3. Substance: real signal, art, humor, or insight vs padded filler or recycled sludge.\n4. Freshness: timely updates, strange rabbit holes, or original work vs rehashed outrage.\n\nKeep items that show genuine human craft, curiosity, engineering, hardware, software, science, design, art, cinematography, music, timely primary news, or earnest humor, even from tiny unknown creators.\n\nDrop items that fail Authenticity or Substance: ragebait, political or culture-war fights, cynical dunking, celebrity or reality-TV gossip, episodic short-drama cliffhangers, AI-generated narration or visual slop, engagement hooks (\"wait till the end\", \"feel illegal to know\", \"comment X for link\", siren-emoji fake breaking hype), hustle or crypto grifts, and manufactured anxiety. When uncertain, keep.\n\nKEEP section. Never drop these topics, even when they are niche, long-form, slow, or from tiny creators:\n- photography\n- filmmaking and cinematography\n- media: journalism, criticism, and production\n- outdoor sports",
  "Evaluate each item across four axes:\n1. Specificity: concrete builds, demos, facts, or craft vs vague hype or mystery bait.\n2. Authenticity: genuine human voice or primary source vs engagement farming or bot cadence.\n3. Substance: real signal, art, humor, or insight vs padded filler or recycled sludge.\n4. Freshness: timely updates, strange rabbit holes, or original work vs rehashed outrage.\n\nKeep items that show genuine human craft, curiosity, engineering, hardware, software, science, design, art, cinematography, music, timely primary news, or earnest humor, even from tiny unknown creators.\n\nDrop items that fail Authenticity or Substance: ragebait, political or culture-war fights, cynical dunking, celebrity or reality-TV gossip, episodic short-drama cliffhangers, AI-generated narration or visual slop, engagement hooks (\"wait till the end\", \"feel illegal to know\", \"comment X for link\", siren-emoji fake breaking hype), hustle or crypto grifts, and manufactured anxiety. When uncertain, keep.",
]);

export const LOCAL_DEFAULT_ENDPOINT = "http://127.0.0.1:11434/v1/chat/completions";
export const LOCAL_DEFAULT_MODEL = "qwen3.5:4b";

export const API_DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
export const API_DEFAULT_MODEL = "gemini-2.5-flash";

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
    gr.mode === "off" || gr.mode === "local" || gr.mode === "api" ? gr.mode : d.grader.mode;

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
      rubric: typeof gr.rubric === "string" && !OLD_DEFAULT_RUBRICS.has(gr.rubric) ? gr.rubric : d.grader.rubric,
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
