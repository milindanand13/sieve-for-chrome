export interface FeedbackEntry {
  text: string;
  verdict: "keep" | "drop";
}

/** Rubric suffix that shows the grader the user's own corrections; empty when there are none. */
export function feedbackBlock(entries: FeedbackEntry[]): string {
  const section = (title: string, verdict: FeedbackEntry["verdict"]): string => {
    const lines = entries.filter((e) => e.verdict === verdict).map((e) => `- ${e.text}`);
    return lines.length ? `\n${title}:\n${lines.join("\n")}` : "";
  };
  const body = section("Keep", "keep") + section("Drop", "drop");
  return body ? `\n\nThe user corrected earlier verdicts. Judge similar items the same way.${body}` : "";
}
