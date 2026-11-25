import { beforeAll, describe, expect, it } from "vitest";

// No DOM library in devDependencies: tiny fakes for just what shared.ts touches.
type Card = { dataset: Record<string, string>; id: string; contains: () => boolean; getBoundingClientRect: () => object; innerText: string };
const card = (id: string): Card => ({
  dataset: {},
  id,
  contains: () => true,
  getBoundingClientRect: () => ({ left: 0, right: 1, top: 0, bottom: 1 }),
  innerText: "post text",
});

const cards = ["a1", "a2", "kept1", "", "b1"].map(card) as [Card, Card, Card, Card, Card];
const docListeners: Record<string, (ev: unknown) => void> = {};
const msgListeners: Array<(msg: unknown, sender: unknown, send: (r: unknown) => void) => unknown> = [];

class FakeNode {}
let shared: typeof import("../src/content/shared.js");

beforeAll(async () => {
  Object.assign(globalThis, {
    Node: FakeNode,
    window: { addEventListener: () => {} },
    requestAnimationFrame: (cb: () => void) => cb(),
    MutationObserver: class { observe() {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    addEventListener: () => {},
    document: {
      documentElement: { dataset: {}, append: () => {} },
      createElement: () => ({
        style: {},
        attachShadow: () => ({ innerHTML: "", querySelector: () => ({ style: {} }), querySelectorAll: () => [] }),
      }),
      addEventListener: (t: string, fn: (ev: unknown) => void) => (docListeners[t] = fn),
    },
    chrome: {
      runtime: {
        id: "me",
        onMessage: { addListener: (fn: never) => msgListeners.push(fn) },
        sendMessage: () => Promise.resolve({ ok: true }),
      },
      storage: { local: { get: () => Promise.resolve({}) }, onChanged: { addListener: () => {} } },
    },
  });
  shared = await import("../src/content/shared.js");
  shared.installDimMarker({
    cardSelector: "article",
    cards: () => cards as never,
    idsOf: (c) => [(c as unknown as Card).id],
  });
  shared.bootSiteAdapter(() => {}, () => true);
});

describe("dimming", () => {
  it("marks a matching card and leaves others alone", () => {
    shared.registerDimmed([{ id: "a1", reason: "slop", site: "youtube", text: "t" }]);
    expect(cards[0].dataset.sieveDim).toBe("1");
    expect(cards[0].dataset.sieveDimReason).toBe("slop");
    expect(cards[1].dataset.sieveDim).toBeUndefined();
  });

  it("empty ids never match", () => {
    shared.registerDimmed([{ id: "", reason: "bad", site: "youtube", text: "t" }]);
    expect(cards[3].dataset.sieveDim).toBeUndefined();
  });

  it("a kept id is never re-marked", async () => {
    // right-click resolves to the first card whose contains() is true, so point it at kept1
    cards.forEach((c, i) => (c.contains = () => i === 2));
    docListeners.contextmenu?.({ target: new FakeNode(), clientX: 0, clientY: 0 });
    for (const fn of msgListeners) fn({ type: "FEEDBACK", action: "keep" }, { id: "me" }, () => {});
    await new Promise((r) => setTimeout(r, 0));
    shared.registerDimmed([{ id: "kept1", reason: "slop", site: "youtube", text: "t" }]);
    expect(cards[2].dataset.sieveDim).toBeUndefined();
    shared.markCard(cards[2] as never, "direct", true);
    expect(cards[2].dataset.sieveDim).toBeUndefined();
  });
});
