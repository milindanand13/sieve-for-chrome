import { filterInstagramJson } from "../adapters/instagram-json.js";
import { filterTwitterJson } from "../adapters/twitter-json.js";
import { filterYouTubeJson } from "../adapters/youtube-json.js";
import { createSink } from "../core/sink.js";
import { X_TIMELINE_OPS } from "../shared/intercept.js";
import type { FeedItem, Platform, RewriteResult, SieveConfig } from "../types.js";

const TWITTER_TIMELINE_RE = new RegExp(`/i/api/graphql/[^/]+/(${X_TIMELINE_OPS.join("|")})`);

export function siteForHost(host: string): Platform | null {
  if (host.endsWith("youtube.com")) return "youtube";
  if (host === "x.com" || host === "twitter.com") return "x";
  if (host.endsWith("instagram.com")) return "instagram";
  return null;
}

export function shouldFilterUrl(url: URL, config: SieveConfig): boolean {
  if (!config.enabled) return false;
  const path = url.pathname;
  switch (siteForHost(url.hostname)) {
    case "youtube":
      return config.youtube.enabled && path.startsWith("/youtubei/v1/");
    case "x":
      return config.x.enabled && TWITTER_TIMELINE_RE.test(path);
    case "instagram":
      return (
        config.instagram.enabled &&
        (path === "/graphql/query" ||
          path.startsWith("/api/v1/clips/home") ||
          path.startsWith("/api/v1/feed/timeline"))
      );
    default:
      return false;
  }
}

const MIN_FIXTURE_CHARS = 2048;

export interface RewriteDeps {
  /** Rule + grader decision for a batch: id -> reason for every dropped item. */
  evaluate: (items: FeedItem[]) => Promise<Map<string, string>>;
  /** Dev recorder sink; only called when config.recorder.enabled. */
  recordFixture?: (site: string, url: string, body: string) => Promise<void>;
}

/** Returns the rewritten body plus dim/removal lists, or null to leave the response untouched. Never throws. */
export async function rewriteResponseBody(
  rawUrl: string,
  pageUrl: string,
  text: string,
  config: SieveConfig,
  deps: RewriteDeps,
): Promise<RewriteResult | null> {
  try {
    const url = new URL(rawUrl);
    const site = siteForHost(url.hostname);
    if (!shouldFilterUrl(url, config)) return null;
    // Only feed responses worth testing against: not noise endpoints, not tiny bodies.
    if (config.recorder.enabled && site && deps.recordFixture && text.length >= MIN_FIXTURE_CHARS) {
      await deps.recordFixture(site, rawUrl, text).catch(() => undefined);
    }

    const json: unknown = JSON.parse(text);
    const sink = createSink(config.display.hideDropped);
    const decide = async (items: FeedItem[]): Promise<Set<string>> => {
      const dropped = await deps.evaluate(items);
      for (const [id, reason] of dropped) sink.reasons.set(id, reason);
      return new Set(dropped.keys());
    };
    const path = url.pathname;
    let out: unknown = json;
    if (site === "youtube") {
      out = await filterYouTubeJson(json, path, pageUrl, config, decide, sink);
    } else if (site === "x") {
      out = await filterTwitterJson(json, path, config, decide, sink);
    } else if (site === "instagram") {
      out = await filterInstagramJson(json, path, config, decide, pageUrl, sink);
    }
    return { body: JSON.stringify(out), dimmed: sink.dimmed, hard: sink.hard };
  } catch {
    return null;
  }
}
