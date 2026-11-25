import { describe, expect, it } from "vitest";
import { dislikeHint } from "../src/core/dislikes.js";

describe("dislikeHint", () => {
  it("flags a high dislike share only with enough votes", () => {
    expect(dislikeHint(600, 400)).toBe("40% of votes are dislikes");
    expect(dislikeHint(800, 200)).toBe("20% of votes are dislikes");
    expect(dislikeHint(900, 100)).toBe("");
    expect(dislikeHint(50, 100)).toBe(""); // too few votes to mean anything
  });
});
