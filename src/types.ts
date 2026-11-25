export type Platform = "youtube" | "x" | "instagram" | "tiktok";

export type FeedSurface = "home" | "search" | "watch_next" | "timeline" | "reels";

export type ResolvedVerdict = "keep" | "drop";

export type Verdict = ResolvedVerdict | "uncertain";

export type GraderMode = "off" | "local" | "api" | "claude";
export const isGraderMode = (v: unknown): v is GraderMode =>
  v === "off" || v === "local" || v === "api" || v === "claude";

export type JsonRecord = Record<string, unknown>;

export function isRecord(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

interface YouTubeSettings {
  enabled: boolean;
  caliberFilter: boolean;
  hideShorts: boolean;
  cleanHeader: boolean;
  midFrameThumbs: boolean;
  calmTitles: boolean;
  dearrowTitles: boolean;
}

interface TwitterSettings {
  enabled: boolean;
  caliberFilter: boolean;
  slopCadenceFilter: boolean;
  classicBird: boolean;
  cleanSidebar: boolean;
  cleanNav: boolean;
  restoreHeadlines: boolean;
}

interface InstagramSettings {
  enabled: boolean;
  caliberFilter: boolean;
  filterReels: boolean;
  hideClutter: boolean;
}

interface TikTokSettings {
  enabled: boolean;
  caliberFilter: boolean;
  cleanChrome: boolean;
  lightMode: boolean;
  postOnlyMode: boolean;
}

export interface GraderSettings {
  mode: GraderMode;
  endpoint: string;
  model: string;
  apiKey: string;
  rubric: string;
  /** The user's own description of who they are; prepended to the rubric. */
  aboutMe: string;
  streamHoldMs: number;
}

export interface DisplaySettings {
  hideDropped: boolean;
}

export interface RecorderSettings {
  enabled: boolean;
}

export interface SieveConfig {
  schemaVersion: number;
  enabled: boolean;
  passFollowed: boolean;
  noveltyFilter: boolean;
  youtube: YouTubeSettings;
  x: TwitterSettings;
  instagram: InstagramSettings;
  tiktok: TikTokSettings;
  grader: GraderSettings;
  display: DisplaySettings;
  recorder: RecorderSettings;
  allowHandles: string[];
  blockHandles: string[];
}

export interface FeedItem {
  platform: Platform;
  id: string;
  creatorId?: string;
  creatorHandle?: string;
  isFollowed?: boolean;
  isSponsored?: boolean;
  surface: FeedSurface;
  titleOrText: string;
  secondaryText?: string;
  durationSec?: number;
  /** Second DOM-visible identifier (Instagram shortcode). */
  altId?: string;
  linkedYoutubeIds?: string[];
  metrics?: {
    likes?: number;
    replies?: number;
    quotes?: number;
  };
}

export interface SeedSets {
  hnVideos: Set<string>;
  hnChannels: Set<string>;
  slopChannels: Set<string>;
}

export interface CreatorRecord {
  key: string;
  keeps: number;
  drops: number;
  updatedAt: number;
}

export interface MemoryLookup {
  getItemVerdict(platform: Platform, id: string): ResolvedVerdict | undefined;
  /** Reason stored with the cached verdict, if any. */
  getItemReason?(platform: Platform, id: string): string | undefined;
  getCreatorVerdict(platform: Platform, creatorKey: string): ResolvedVerdict | undefined;
}

export interface MemoryStore extends MemoryLookup {
  recordVerdict(item: FeedItem, verdict: ResolvedVerdict, reason?: string): Promise<void>;
  /** keepUser: keep the user's own verdicts (and creators), drop grader-made ones. */
  clear(options?: { keepUser?: boolean }): Promise<void>;
  /** Resolves once persisted rows are loaded (service worker wake). */
  ready?: Promise<void>;
  counts(): { cachedItems: number; learnedCreators: number };
}

export interface NoveltyLookup {
  isRedundantRehash(text: string): boolean;
}

export interface NoveltyMemory extends NoveltyLookup {
  recordDwelled(text: string): void;
  clear(): void;
  size(): number;
  ready?: Promise<void>;
}

export type BatchDecider = (items: FeedItem[]) => Promise<Set<string>>;

/** A graded drop that stays in the JSON; the content script dims the matching card. */
export interface DimEntry {
  id: string;
  alt?: string;
  site: Platform;
  reason: string;
  text: string;
}

/** An unconditional removal (ad, shorts, promoted, suggested) that is counted and logged. */
export interface HardRemoval {
  site: Platform;
  reason: string;
  text: string;
}

/** Collected by adapters while they rewrite one response. */
export interface DropSink {
  /** true when display.hideDropped: graded drops are removed from the JSON instead of dimmed. */
  remove: boolean;
  /** id -> reason, filled by the decider wrapper. */
  reasons: Map<string, string>;
  dimmed: DimEntry[];
  hard: HardRemoval[];
}

export type RewriteResult = { body: string; dimmed: DimEntry[]; hard: HardRemoval[] };

export type RuntimeMessage =
  | { type: "GET_STATUS" }
  | { type: "CLEAR_CACHE" }
  | { type: "CLEAR_VERDICT_CACHE" }
  | { type: "RECORD_DWELL"; text: string }
  | { type: "RESOLVE_DEARROW_TITLES"; videoIds: string[]; titles?: Record<string, string> }
  | { type: "EVALUATE_SSR_ITEMS"; items: FeedItem[] }
  | { type: "TEST_GRADER"; graderOverride?: GraderSettings };

export interface SieveStatus {
  sessionFilteredCount: number;
  cachedItems: number;
  learnedCreators: number;
  dwelledCount: number;
  hnVideos: number;
  slopChannels: number;
}

export interface EvaluateSsrItemsResponse {
  dropped: string[];
  /** id -> reason for every id in `dropped`. */
  reasons: Record<string, string>;
}

export interface ResolveDearrowTitlesResponse {
  titles: Record<string, string>;
}

export type TestGraderResponse =
  | { ok: true; ms: number; droppedProbeSlop: boolean }
  | { ok: false; ms: number; error: string };
