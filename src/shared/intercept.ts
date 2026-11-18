// Shared by the MAIN-world interceptor, the isolated relay and the service worker.
export const INTERCEPT_TAG = "sieve-intercept-v1";
export const MAX_STREAM_BYTES = 12 * 1024 * 1024;
// shortcut: fixed ceiling, MAIN world cannot read grader.streamHoldMs; upgrade by relaying config.
export const REWRITE_TIMEOUT_MS = 6000;

// HTML first-screen URLs (/ and /results) are not here: MV3 cannot rewrite navigations.
export const INTERCEPT_URLS = [
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
  "https://www.tiktok.com/api/post/item_list/*",
];

const INTERCEPT_RES = INTERCEPT_URLS.map(
  (glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`),
);

export function matchesInterceptUrl(url: string): boolean {
  return INTERCEPT_RES.some((re) => re.test(url));
}
