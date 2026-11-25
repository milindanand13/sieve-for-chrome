import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { DEFAULT_RUBRIC, mergeConfig } from "../src/defaults.js";

describe("rubric upgrade", () => {
  it("replaces a stored copy of an old default rubric and keeps edited ones", () => {
    const old = execSync("git show ce551ab:src/defaults.ts", { encoding: "utf8" });
    const oldRubric = old.slice(old.indexOf("DEFAULT_RUBRIC = `") + 18, old.indexOf("`;", old.indexOf("DEFAULT_RUBRIC")));
    expect(mergeConfig({ grader: { rubric: oldRubric } }).grader.rubric).toBe(DEFAULT_RUBRIC);
    expect(mergeConfig({ grader: { rubric: "my own rubric" } }).grader.rubric).toBe("my own rubric");
  });
});

describe("about-you upgrade", () => {
  it("moves the owner description from an old built-in rubric into aboutMe", () => {
    const sha = execSync('git log --format=%h -S"Cats always stay" -- src/defaults.ts', { encoding: "utf8" }).trim().split("\n").pop()!;
    const src = execSync(`git show ${sha}:src/defaults.ts`, { encoding: "utf8" });
    const start = src.indexOf("DEFAULT_RUBRIC = `") + 18;
    const old = src.slice(start, src.indexOf("`;", start));
    const merged = mergeConfig({ grader: { rubric: old } });
    expect(merged.grader.rubric).toBe(DEFAULT_RUBRIC);
    expect(merged.grader.aboutMe).toMatch(/^[A-Z].+\. Cats always stay\.$/);
    expect(DEFAULT_RUBRIC).not.toContain("Brooklyn");
    // An edited rubric and an existing aboutMe are left alone.
    expect(mergeConfig({ grader: { rubric: old, aboutMe: "mine" } }).grader.aboutMe).toBe("mine");
  });
});
