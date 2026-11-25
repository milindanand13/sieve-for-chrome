// Taste eval on real posts Milind flagged. Runs only with SIEVE_LIVE=1 and local Ollama.
// SIEVE_MODEL picks the model (default from config).
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
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
  c("x", "bikestory", "storyteller", "Publiqué una bicicleta usada en Marketplace por $180.000. Una chica me ofreció $150.000 y le dije que por $160.000 era suya. Una hora después un tipo me ofreció los $180.000 en efectivo. No lo pensé demasiado. Le dije: \"Dale, ven", "d"),
  c("instagram", "gamma", "slides_guy", "For anyone who hates making slides\n\nComment “gamma” for the setup guide👇\n\n#ai", "d"),
  c("instagram", "cat", "catdaily", "my cat refuses to get off the keyboard during every meeting 😭", "k"),
  c("x", "meme", "memeacct", "me opening the fridge for the 9th time hoping new food appeared", "k"),
  c("instagram", "fight", "kalesh_india", "Two aunties fighting over a parking spot in Delhi 😭 #kalesh", "d"),
];

// Borderline posts where a small model tends to slip. SIEVE_SET=hard runs these instead.
export const HARD: Case[] = [
  c("x", "h1", "founderguy", "10 brutal lessons from 10 years of building startups 🧵👇", "d"),
  c("x", "h2", "newsdesk", "Supreme Court strikes down the state's ban on drag shows, 6-3. Full opinion linked.", "k"),
  c("x", "h3", "angrytakes", "Gen Z will never own a home and boomers are laughing at us. Wake up.", "d"),
  c("x", "h4", "filmtwit", "The opening shot of Children of Men is 4 minutes with no cut. Here's how they rigged the car.", "k"),
  c("x", "h5", "memepage", "POV: you're the main character and everyone else is an NPC 💀", "k"),
  c("x", "h6", "desi_vibes", "Bride walks out of her own wedding after groom's family demands dowry, video goes viral", "d"),
  c("x", "h7", "kitchen_nani", "My nani's dal tadka. Ghee first, then jeera until it crackles, then hing.", "k"),
  c("x", "h8", "ai_hustler", "I made $40k in 30 days with this ChatGPT side hustle. Reply 'AI' and I'll DM you the prompt.", "d"),
  c("x", "h9", "jpegmafia_fan", "Ranking every Radiohead album after a month of relistening", "k"),
  c("youtube", "h10", "Mellow Sharp", "My brother got scammed: a story time", "d"),
  c("youtube", "h11", "Kraftwerk Studio", "Lighting a night portrait with one bulb", "k"),
  c("youtube", "h12", "Daily Dose", "Try not to laugh challenge: funniest fails of the week", "d"),
  c("youtube", "h13", "Magnus Midtbø", "Climbing the hardest boulder in Norway with Will Bosi", "k"),
  c("youtube", "h14", "The Diary Of A CEO", "The Doctor That Proved Everyone Wrong About Sugar!", "d"),
  c("youtube", "h15", "Nerdwriter1", "How Wong Kar-wai uses step printing", "k"),
  c("instagram", "h16", "thegoodquote", "Your vibe attracts your tribe ✨ Follow for daily motivation", "d"),
  c("instagram", "h17", "studio_ana", "Film scans from Varanasi, Portra 800 pushed one stop", "k"),
  c("instagram", "h18", "gossipmill", "She really wore THAT to the reception?? 👀 Thoughts?", "d"),
  c("instagram", "h19", "brooklynclimbs", "New set at Vital Brooklyn this week, the purple V5 is a sandbagged slab", "k"),
  c("instagram", "h20", "factsdaily", "99% of people don't know this about their phone 🤯 #facts #viral", "d"),
];

describe.skipIf(!live)("taste eval", () => {
  it("grades the flagged posts the way Milind would", async () => {
    // SIEVE_MODE=claude reads the key from ANTHROPIC_API_KEY or ~/.config/sieve/anthropic-key.
    const mode = process.env.SIEVE_MODE === "claude" ? ("claude" as const) : ("local" as const);
    const keyFile = `${homedir()}/.config/sieve/anthropic-key`;
    const apiKey =
      mode === "claude" ? (process.env.ANTHROPIC_API_KEY ?? (existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : "")) : "";
    const model = process.env.SIEVE_MODEL ?? (mode === "claude" ? "claude-haiku-5-5" : DEFAULT_CONFIG.grader.model);
    const cfg = { ...DEFAULT_CONFIG, grader: { ...DEFAULT_CONFIG.grader, mode, model, apiKey } };
    const t = Date.now();
    const set = process.env.SIEVE_SET === "hard" ? HARD : CASES;
    const v = await gradeItemsDetailed(set, cfg);
    const ms = Date.now() - t;
    const rows = set.map((x) => ({ id: x.id, want: x.want, got: v.get(x.id)?.verdict ?? "-", why: v.get(x.id)?.why ?? "" }));
    console.table(rows);
    const right = rows.filter((r) => (r.want === "d") === (r.got === "d")).length;
    console.log(`${model}: ${right}/${rows.length} right in ${ms}ms`);
    expect(v.size).toBeGreaterThan(0);
  }, 120000);
});
