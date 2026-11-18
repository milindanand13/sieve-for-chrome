import { describe, expect, it } from "vitest";
import { filterInstagramJson } from "../src/adapters/instagram-json.js";
import { filterTwitterJson } from "../src/adapters/twitter-json.js";
import { filterYouTubeJson } from "../src/adapters/youtube-json.js";
import { createStats, dayKey, sumStats, type KeyValueStore } from "../src/background/stats.js";
import { createSink } from "../src/core/sink.js";
import { parseVerdictMap } from "../src/core/llm.js";
import { evaluateLocalDecision, runSieveDetailed } from "../src/core/sieve.js";
import { DEFAULT_CONFIG, DEFAULT_RUBRIC, mergeConfig } from "../src/defaults.js";
import type { FeedItem, MemoryStore, ResolvedVerdict, SeedSets } from "../src/types.js";

const seeds: SeedSets = { hnVideos: new Set(), hnChannels: new Set(), slopChannels: new Set(["slopper"]) };

function fakeMemory() {
  const recorded: Array<[string, ResolvedVerdict]> = [];
  const mem: MemoryStore = {
    getItemVerdict: () => undefined,
    getCreatorVerdict: () => undefined,
    recordVerdict: async (item, v) => void recorded.push([item.id, v]),
    clear: async () => {},
    counts: () => ({ cachedItems: 0, learnedCreators: 0, droppedTotal: 0 }),
  };
  return { mem, recorded };
}

const item = (id: string, text: string, handle = "someone"): FeedItem => ({
  platform: "youtube",
  id,
  creatorHandle: handle,
  surface: "home",
  titleOrText: text,
});

const fetchReply = (content: string): typeof fetch =>
  (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })) as typeof fetch;

describe("reasons", () => {
  it("local tiers give a reason on every drop", () => {
    const mem = fakeMemory().mem;
    expect(evaluateLocalDecision(item("a", "x", "slopper"), DEFAULT_CONFIG, seeds, mem).reason).toBe("slop list");
    expect(
      evaluateLocalDecision(item("b", "Love Island meltdown"), DEFAULT_CONFIG, seeds, mem).reason,
    ).toBe("gossip");
    const sponsored = { ...item("c", "buy"), isSponsored: true };
    expect(evaluateLocalDecision(sponsored, DEFAULT_CONFIG, seeds, mem).reason).toBe("sponsored");
  });

  it("grader drops are labelled 'grader: <why>' with a plain 'grader' fallback", async () => {
    const { mem } = fakeMemory();
    const items = [item("v1", "one"), item("v2", "two")];
    const out = await runSieveDetailed(
      items,
      DEFAULT_CONFIG,
      seeds,
      mem,
      fetchReply('{"drop":["0","1"],"why":{"0":"outrage bait"}}'),
    );
    expect(out.get("v1")).toBe("grader: outrage bait");
    expect(out.get("v2")).toBe("grader");
  });

  it("strips <think> blocks before parsing", () => {
    const m = parseVerdictMap('<think>maybe {"drop":["9"]}</think>{"drop":["0"]}', ["v1"]);
    expect(m.get("v1")?.verdict).toBe("d");
  });
});

describe("verdict cache", () => {
  it("caches only explicit keeps (and drops), never unsure, malformed or ungraded items", async () => {
    const run = async (reply: string) => {
      const { mem, recorded } = fakeMemory();
      await runSieveDetailed(
        [item("v1", "one"), item("v2", "two")],
        DEFAULT_CONFIG,
        seeds,
        mem,
        fetchReply(reply),
      );
      return recorded;
    };
    expect(await run('{"0":"k","1":"u"}')).toEqual([["v1", "keep"]]);
    expect(await run("not json at all")).toEqual([]);
    expect(await run("")).toEqual([]);
    expect(await run('{"0":"d","1":"k"}')).toEqual([
      ["v1", "drop"],
      ["v2", "keep"],
    ]);
  });
});

describe("dim lists", () => {
  it("youtube keeps a graded drop in the JSON and reports it", async () => {
    const payload = () => ({
      contents: [
        {
          richItemRenderer: {
            content: {
              videoRenderer: {
                videoId: "bad11111111",
                title: { runs: [{ text: "Outrage compilation" }] },
                ownerText: { runs: [{ text: "Slop", navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: "/@slop" } } }] },
              },
            },
          },
        },
      ],
    });
    const decide = async () => new Set(["bad11111111"]);

    const sink = createSink(false);
    sink.reasons.set("bad11111111", "grader: outrage bait");
    const kept = JSON.stringify(await filterYouTubeJson(payload(), "/youtubei/v1/browse", "https://www.youtube.com/", DEFAULT_CONFIG, decide, sink));
    expect(kept).toContain("bad11111111");
    expect(sink.dimmed).toEqual([
      { id: "bad11111111", alt: undefined, site: "youtube", reason: "grader: outrage bait", text: "Outrage compilation" },
    ]);

    const removeSink = createSink(true);
    const removed = JSON.stringify(await filterYouTubeJson(payload(), "/youtubei/v1/browse", "https://www.youtube.com/", DEFAULT_CONFIG, decide, removeSink));
    expect(removed).not.toContain("bad11111111");
    expect(removeSink.dimmed).toHaveLength(1);
  });

  it("youtube hard removals are counted with reasons", async () => {
    const sink = createSink(false);
    await filterYouTubeJson(
      { contents: [{ adSlotRenderer: {} }] },
      "/youtubei/v1/browse",
      "https://www.youtube.com/",
      DEFAULT_CONFIG,
      async () => new Set(),
      sink,
    );
    expect(sink.hard.map((h) => h.reason)).toContain("ad");
  });

  it("instagram reports pk and shortcode and keeps the post", async () => {
    const data = {
      feed_items: [
        {
          media_or_ad: {
            pk: "111",
            code: "CODEabc",
            caption: { text: "Celebrity gossip thread" },
            user: { pk: "u3", username: "gossip_page", friendship_status: { following: false } },
          },
        },
        { media_or_ad: { pk: "222", injected: { label: "Sponsored" }, user: { pk: "u2", username: "brand" } } },
      ],
    };
    const sink = createSink(false);
    sink.reasons.set("111", "gossip");
    const out = (await filterInstagramJson(data, "/api/v1/feed/timeline/", DEFAULT_CONFIG, async () => new Set(["111"]), undefined, sink)) as typeof data;
    expect(out.feed_items).toHaveLength(1);
    expect(sink.dimmed[0]).toMatchObject({ id: "111", alt: "CODEabc", site: "instagram", reason: "gossip" });
    expect(sink.hard).toEqual([{ site: "instagram", reason: "ad", text: "" }]);
  });

  it("x keeps a graded tweet and reports promoted removals", async () => {
    const data = {
      data: {
        home: {
          home_timeline_urt: {
            instructions: [
              {
                entries: [
                  { entryId: "promoted-1", content: { itemContent: { promotedMetadata: {}, tweet_results: { result: { rest_id: "9" } } } } },
                  {
                    entryId: "tweet-1",
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            __typename: "Tweet",
                            rest_id: "1002",
                            core: { user_results: { result: { rest_id: "u9", legacy: { screen_name: "slopper", following: false } } } },
                            legacy: { full_text: "hot take", favorite_count: 1, reply_count: 0, quote_count: 0 },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    };
    const sink = createSink(false);
    sink.reasons.set("1002", "slop list");
    const out = JSON.stringify(await filterTwitterJson(data, "/i/api/graphql/x/HomeTimeline", DEFAULT_CONFIG, async () => new Set(["1002"]), sink));
    expect(out).toContain("1002");
    expect(sink.dimmed[0]).toMatchObject({ id: "1002", site: "x", reason: "slop list", text: "hot take" });
    expect(sink.hard.map((h) => h.reason)).toEqual(["promoted"]);
  });
});

describe("cached verdict reason", () => {
  it("keeps the original grader reason when a cached drop is reused", async () => {
    const stored = new Map<string, { v: ResolvedVerdict; r?: string }>();
    const mem: MemoryStore = {
      getItemVerdict: (_p, id) => stored.get(id)?.v,
      getItemReason: (_p, id) => stored.get(id)?.r,
      getCreatorVerdict: () => undefined,
      recordVerdict: async (i, v, r) => void stored.set(i.id, { v, r }),
      clear: async () => {},
      counts: () => ({ cachedItems: 0, learnedCreators: 0, droppedTotal: 0 }),
    };
    const it1 = item("v1", "some vague title here");
    await runSieveDetailed([it1], DEFAULT_CONFIG, seeds, mem, fetchReply('{"drop":["0"],"why":{"0":"vague bait"}}'));
    const again = await runSieveDetailed([it1], DEFAULT_CONFIG, seeds, mem, fetchReply("{}"));
    expect(again.get("v1")).toBe("grader: vague bait (cached)");
  });
});

describe("late grader verdicts", () => {
  it("skipHold returns at once and delivers grader drops through onLate", async () => {
    const { mem } = fakeMemory();
    let late: Map<string, string> | undefined;
    const out = await runSieveDetailed(
      [item("v1", "one")],
      DEFAULT_CONFIG,
      seeds,
      mem,
      fetchReply('{"drop":["0"],"why":{"0":"bait"}}'),
      undefined,
      { skipHold: true, onLate: (l) => (late = l) },
    );
    expect(out.size).toBe(0);
    await new Promise((r) => setTimeout(r, 20));
    expect(late?.get("v1")).toBe("grader: bait");
  });

  it("grades more than 20 items in chunks instead of ignoring the rest", async () => {
    const { mem, recorded } = fakeMemory();
    const many = Array.from({ length: 45 }, (_, i) => item(`v${i}`, `video ${i}`));
    await runSieveDetailed(many, DEFAULT_CONFIG, seeds, mem, (async (_u: unknown, init: RequestInit) => {
      const n = (JSON.parse(String((init as { body: string }).body)).messages[1].content as string).match(/"i":/g)!.length;
      const reply = JSON.stringify(Object.fromEntries(Array.from({ length: n }, (_, k) => [String(k), "k"])));
      return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 });
    }) as unknown as typeof fetch);
    expect(recorded).toHaveLength(45);
  });
});

describe("stats", () => {
  function memKv(): KeyValueStore & { data: Record<string, unknown> } {
    const data: Record<string, unknown> = {};
    return {
      data,
      get: async (k) => ({ [k]: data[k] }),
      set: async (items) => void Object.assign(data, items),
    };
  }

  it("counts seen once per item per page session, dimmed by reason, removals, and caps the log", async () => {
    const kv = memKv();
    const t = new Date(2026, 10, 12, 12).getTime();
    const stats = createStats(kv, () => t);
    const items = [item("a", "alpha"), item("b", "beta")];
    await stats.record("doc1", items, new Map([["a", "slop list"]]));
    await stats.record("doc1", items, new Map([["a", "slop list"]]));
    await stats.record("doc2", [items[1]!], new Map());
    await stats.recordRemoved([{ site: "youtube", reason: "shorts", text: "" }]);

    const day = (kv.data.sieveStats as Record<string, unknown>)[dayKey(t)];
    expect(day).toBeDefined();
    const total = sumStats(kv.data.sieveStats as never).youtube!;
    expect(total.seen).toBe(3); // a, b in doc1; b again in doc2
    expect(total.dimmed).toBe(2);
    expect(total.removed).toBe(1);
    expect(total.reasons).toEqual({ "slop list": 2, shorts: 1 });
    expect((kv.data.sieveLog as unknown[]).length).toBe(3);

    const many = Array.from({ length: 2100 }, (_, i) => item(`i${i}`, `t${i}`));
    await stats.record("doc3", many, new Map(many.map((m) => [m.id, "x"])));
    expect((kv.data.sieveLog as unknown[]).length).toBe(2000);
  });
});

describe("defaults and rubric", () => {
  it("ships tiktok off and local qwen3.5:4b on Ollama", () => {
    expect(DEFAULT_CONFIG.tiktok.enabled).toBe(false);
    expect(DEFAULT_CONFIG.grader.mode).toBe("local");
    expect(DEFAULT_CONFIG.grader.model).toBe("qwen3.5:4b");
    expect(DEFAULT_CONFIG.grader.endpoint).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(DEFAULT_CONFIG.display.hideDropped).toBe(false);
    expect(DEFAULT_CONFIG.recorder.enabled).toBe(false);
    expect(mergeConfig({}).tiktok.enabled).toBe(false);
  });

  it("rubric keeps photography, filmmaking, media and climbing", () => {
    const lower = DEFAULT_RUBRIC.toLowerCase();
    for (const topic of ["photography", "filmmaking", "cinematography", "journalism", "outdoor sports"]) {
      expect(lower).toContain(topic);
    }
  });
});
