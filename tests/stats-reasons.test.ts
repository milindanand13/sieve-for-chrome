import { describe, expect, it } from "vitest";
import { createStats, LOG_KEY, STATS_KEY, sumStats, type KeyValueStore } from "../src/background/stats.js";
import type { FeedItem } from "../src/types.js";

describe("stats reason keys", () => {
  it("folds grader labels and (cached) into one key, keeping full text in the log", async () => {
    const data: Record<string, unknown> = {};
    const kv: KeyValueStore = { get: async (k) => ({ [k]: data[k] }), set: async (i) => void Object.assign(data, i) };
    const mk = (id: string): FeedItem => ({ platform: "x", id, surface: "timeline", titleOrText: id });
    await createStats(kv).record(
      "d",
      [mk("a"), mk("b"), mk("c")],
      new Map([
        ["a", "grader: outrage bait"],
        ["b", "grader: gossip (cached)"],
        ["c", "slop list (cached)"],
      ]),
    );
    expect(sumStats(data[STATS_KEY] as never).x!.reasons).toEqual({ grader: 2, "slop list": 1 });
    expect((data[LOG_KEY] as Array<{ reason: string }>)[0]!.reason).toBe("grader: outrage bait");
  });
});
