import { filterInstagramJson } from "../adapters/instagram-json.js";
import { filterTikTokJson } from "../adapters/tiktok-json.js";
import { filterTwitterJson } from "../adapters/twitter-json.js";
import { filterYouTubeJson } from "../adapters/youtube-json.js";
import type { FeedItem, SieveConfig } from "../types.js";

type DecideBatch = (items: FeedItem[]) => Promise<Set<string>>;

const TWITTER_TIMELINE_RE =
  /\/i\/api\/graphql\/[^/]+\/(HomeTimeline|HomeLatestTimeline|ExplorePage|GenericTimelineById|ExploreSidebar|SearchTimeline)/;

export function shouldFilterUrl(url: URL, config: SieveConfig): boolean {
  if (!config.enabled) return false;
  const host = url.hostname;
  const path = url.pathname;
  if (host.endsWith("youtube.com")) {
    return config.youtube.enabled && path.startsWith("/youtubei/v1/");
  }
  if (host === "x.com" || host === "twitter.com") {
    return config.x.enabled && TWITTER_TIMELINE_RE.test(path);
  }
  if (host.endsWith("instagram.com")) {
    return (
      config.instagram.enabled &&
      (path === "/graphql/query" ||
        path.startsWith("/api/v1/clips/home") ||
        path.startsWith("/api/v1/feed/timeline"))
    );
  }
  if (host.endsWith("tiktok.com")) {
    return (
      config.tiktok.enabled &&
      (path.startsWith("/api/recommend/item_list") || path.startsWith("/api/post/item_list"))
    );
  }
  return false;
}

/** Returns the rewritten body, or null to leave the response untouched. Never throws. */
export async function rewriteResponseBody(
  rawUrl: string,
  pageUrl: string,
  text: string,
  config: SieveConfig,
  decideBatch: DecideBatch,
): Promise<string | null> {
  try {
    const url = new URL(rawUrl);
    if (!shouldFilterUrl(url, config)) return null;
    const json: unknown = JSON.parse(text);
    const host = url.hostname;
    const path = url.pathname;
    let out: unknown = json;
    if (host.endsWith("youtube.com")) {
      out = await filterYouTubeJson(json, path, pageUrl, config, decideBatch);
    } else if (host === "x.com" || host === "twitter.com") {
      out = await filterTwitterJson(json, path, config, decideBatch);
    } else if (host.endsWith("instagram.com")) {
      out = await filterInstagramJson(json, path, config, decideBatch, pageUrl);
    } else if (host.endsWith("tiktok.com")) {
      out = await filterTikTokJson(json, config, decideBatch, path, pageUrl);
    }
    return JSON.stringify(out);
  } catch {
    return null;
  }
}
