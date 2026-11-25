import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { DEFAULT_RUBRIC, aboutFromOldRubric, mergeConfig } from "../src/defaults.js";

describe("rubric upgrade", () => {
  it("replaces a stored copy of an old default rubric and keeps edited ones", () => {
    const old = execSync("git show ce551ab:src/defaults.ts", { encoding: "utf8" });
    const oldRubric = old.slice(old.indexOf("DEFAULT_RUBRIC = `") + 18, old.indexOf("`;", old.indexOf("DEFAULT_RUBRIC")));
    expect(mergeConfig({ grader: { rubric: oldRubric } }).grader.rubric).toBe(DEFAULT_RUBRIC);
    expect(mergeConfig({ grader: { rubric: "my own rubric" } }).grader.rubric).toBe("my own rubric");
  });
});

describe("about-you upgrade", () => {
  it("moves the owner description out of an old built-in rubric", () => {
    const old = "You filter a feed for one person: a baker in Lisbon who skis. The point is taste. Cats always stay.";
    expect(aboutFromOldRubric(old)).toBe("Baker in Lisbon who skis. Cats always stay.");
    expect(aboutFromOldRubric("Evaluate each item across four axes.")).toBe("");
    expect(DEFAULT_RUBRIC).not.toContain("Brooklyn");
    expect(mergeConfig({ grader: { rubric: "my own rubric" } }).grader.aboutMe).toBe("");
  });
});
