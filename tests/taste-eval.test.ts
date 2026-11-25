// Taste eval on real posts Milind flagged. Runs only with SIEVE_LIVE=1 and local Ollama.
// SIEVE_MODEL picks the model (default from config).
import { describe, expect, it } from "vitest";
import { gradeItemsDetailed } from "../src/core/llm.js";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import type { FeedItem } from "../src/types.js";

const live = process.env.SIEVE_LIVE === "1";
type Case = FeedItem & { want: "k" | "d" };
const c = (platform: FeedItem["platform"], id: string, by: string, text: string, want: "k" | "d"): Case => ({
  platform, id, creatorHandle: by, surface: "home", titleOrText: text, want,
});
export const CASES: Case[] = [
  c("youtube", "fred", "Fred again..", "Fred again.. - One Day in Tokyo with Chihei Hatakeyama (Japan, 30th July 2025)", "k"),
  c("youtube", "climb", "Kage Hansen", "I Tried Bouldering for 30 Days, this is what happened...", "k"),
  c("youtube", "panch", "Prime Video India", "Panchayat Season 5 - Official Trailer | Jitendra Kumar, Raghubir Yadav, Neena Gupta, Sanvikaa", "k"),
  c("youtube", "nfl", "NFL", "Tennessee Titans at Jacksonville Jaguars - NFL Sunday Ticket, Try now", "d"),
  c("youtube", "pocock", "The Hype Kevin", "Ship like the best engineers: Matt Pocock's AI workflow", "k"),
  c("x", "date", "dating_rants", "she cancelled an hour before our date and i was already out the door. am i overreacting or is this crazy [screenshot of her text]", "d"),
  c("x", "snake", "viral_kalesh", "A snake appeared at the wedding tent during Anant Singh's daughter's wedding, and look a guy picked it up with his bare hands and threw it off😭😭", "d"),
  c("x", "eng", "someengineer", "We cut our Postgres p99 from 800ms to 40ms by adding a partial index on status. Writeup with query plans:", "k"),
  c("x", "photo", "filmshooter", "Shot this on Portra 400 at golden hour in Red Hook. Metered for the shadows.", "k"),
  c("x", "rage", "dunkdaily", "This is the dumbest take I've ever seen. Ratio this clown.", "d"),
  c("instagram", "reelbait", "viralclips", "Wait till the end 😱😱 #viral #fyp #reels", "d"),
  c("youtube", "standup", "Gaurav Kapoor", "Kalesh kapoor | Gaurav Kapoor | Stand Up Comedy", "k"),
  c("youtube", "mkbhd", "Marques Brownlee", "Best Gifts Under $50 | MKBHD Holiday Gift Guide", "k"),
  c("x", "dashcam", "clipdump", "Watch this SHOCKING dash-cam video recorded from my brother's car", "d"),
  c("instagram", "friend", "a_friend", "Sunday hike with the crew, finally made it to the top", "k"),
  c("instagram", "fight", "kalesh_india", "Two aunties fighting over a parking spot in Delhi 😭 #kalesh", "d"),
];

describe.skipIf(!live)("taste eval", () => {
  it("grades the flagged posts the way Milind would", async () => {
    const model = process.env.SIEVE_MODEL ?? DEFAULT_CONFIG.grader.model;
    const cfg = { ...DEFAULT_CONFIG, grader: { ...DEFAULT_CONFIG.grader, mode: "local" as const, model } };
    const t = Date.now();
    const v = await gradeItemsDetailed(CASES, cfg);
    const ms = Date.now() - t;
    const rows = CASES.map((x) => ({ id: x.id, want: x.want, got: v.get(x.id)?.verdict ?? "-", why: v.get(x.id)?.why ?? "" }));
    console.table(rows);
    const right = rows.filter((r) => (r.want === "d") === (r.got === "d")).length;
    console.log(`${model}: ${right}/${rows.length} right in ${ms}ms`);
    expect(v.size).toBeGreaterThan(0);
  }, 120000);
});
