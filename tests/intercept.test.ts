import { describe, expect, it } from "vitest";
import { rewriteResponseBody } from "../src/background/rewrite.js";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import { matchesInterceptUrl } from "../src/shared/intercept.js";

describe("intercept url list", () => {
  it("matches feed endpoints and ignores everything else", () => {
    expect(matchesInterceptUrl("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false")).toBe(true);
    expect(matchesInterceptUrl("https://x.com/i/api/graphql/abc/HomeTimeline")).toBe(true);
    expect(matchesInterceptUrl("https://www.instagram.com/graphql/query")).toBe(true);
    expect(matchesInterceptUrl("https://www.youtube.com/")).toBe(false);
    expect(matchesInterceptUrl("https://www.youtube.com/youtubei/v1/player")).toBe(false);
    expect(matchesInterceptUrl("https://evil.example/https://x.com/i/api/graphql/a")).toBe(false);
  });
});

describe("rewriteResponseBody", () => {
  const decide = { evaluate: async () => new Map<string, string>() };
  const url = "https://x.com/i/api/graphql/abc/HomeTimeline";

  it("fails open (null) on unparseable bodies and disabled config", async () => {
    expect(await rewriteResponseBody(url, "https://x.com/home", "not json", DEFAULT_CONFIG, decide)).toBeNull();
    const off = { ...DEFAULT_CONFIG, enabled: false };
    expect(await rewriteResponseBody(url, "https://x.com/home", "{}", off, decide)).toBeNull();
  });

  it("returns re-serialized JSON for a filtered endpoint", async () => {
    const out = await rewriteResponseBody(url, "https://x.com/home", "{}", DEFAULT_CONFIG, decide);
    expect(out).toEqual({ body: "{}", dimmed: [], hard: [] });
  });
});
