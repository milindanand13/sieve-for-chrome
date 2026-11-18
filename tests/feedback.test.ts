import { describe, expect, it } from "vitest";
import { feedbackBlock } from "../src/core/feedback.js";

describe("feedbackBlock", () => {
  it("is empty without feedback", () => {
    expect(feedbackBlock([])).toBe("");
  });

  it("lists keep and drop sections, omitting empty ones", () => {
    expect(feedbackBlock([{ text: "a", verdict: "keep" }, { text: "b", verdict: "drop" }])).toBe(
      "\n\nThe user corrected earlier verdicts. Judge similar items the same way.\nKeep:\n- a\nDrop:\n- b",
    );
    expect(feedbackBlock([{ text: "b", verdict: "drop" }])).not.toContain("Keep:");
  });
});
