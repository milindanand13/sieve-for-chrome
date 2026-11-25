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
