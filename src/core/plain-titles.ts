import { isRecord, type SieveConfig } from "../types.js";
import { chatJson, extractJsonObject } from "./llm.js";

// Writing takes longer than a keep/drop label; the swap lands whenever it is ready.
const WRITE_TIMEOUT_MS = 20000;
const DESC_CHARS = 900;

const PLAIN_TITLE_INSTRUCTIONS = `You rewrite YouTube titles that bait the viewer into ones that say what the video is actually about.
For each item you get its title, channel, and the creator's description. Write one plain title that names the real subject and what the video covers, using only facts from the title and description. Ignore sponsor and link lines.
Rules: at most 100 characters, no questions, no hype words, no ALL CAPS, no emoji, no "you". If it is a song, music video, trailer or a title that already says what the video is, or the description does not say what the video covers, return the original title unchanged.
Return ONLY a JSON object mapping each index to its new title, like {"0":"How L.L. Bean boots are made and how the company has changed"}.`;

/** The creator's description from a watch page, or "" when the page has none. */
export function extractShortDescription(html: string): string {
  const m = /"shortDescription":("(?:[^"\\]|\\.)*")/.exec(html);
  if (!m?.[1]) return "";
  try {
    const parsed: unknown = JSON.parse(m[1]);
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return "";
  }
}

export interface TitleJob {
  id: string;
  title: string;
  desc: string;
}

/** Plain titles from the grader model: id -> new title. Titles it left unchanged are omitted. */
export async function writePlainTitles(
  jobs: TitleJob[],
  config: SieveConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const usable = jobs.filter((j) => j.desc.trim().length >= 40);
  if (config.grader.mode === "off" || usable.length === 0) return out;
  const reply = await chatJson(
    config,
    PLAIN_TITLE_INSTRUCTIONS,
    JSON.stringify(usable.map((j, i) => ({ i: String(i), title: j.title, desc: j.desc.slice(0, DESC_CHARS) }))),
    WRITE_TIMEOUT_MS,
    fetchImpl,
  );
  const parsed = extractJsonObject(reply);
  if (!isRecord(parsed)) return out;
  usable.forEach((job, i) => {
    const t = parsed[String(i)];
    if (typeof t !== "string") return;
    const clean = t.replace(/\s+/g, " ").trim().slice(0, 120);
    const bare = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (clean.length >= 8 && bare(clean) !== bare(job.title)) out.set(job.id, clean);
  });
  return out;
}
