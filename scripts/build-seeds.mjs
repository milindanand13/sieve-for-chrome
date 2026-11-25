// @ts-check
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seedsDir = path.join(rootDir, "extension", "assets", "seeds");
const submoduleAisList = path.join(rootDir, "vendor", "AiSList", "AiSList", "aislist_blocklist.txt");
const submoduleAisWarn = path.join(rootDir, "vendor", "AiSList", "AiSList", "aislist_warnlist.txt");
// Kagi Small Web's hand-reviewed small YouTube channels, seeded from Hacker News threads (MIT).
const KAGI_SMALLYT_URL = "https://raw.githubusercontent.com/kagisearch/smallweb/main/smallyt.txt";
// Wikidata (CC0): YouTube channel IDs (P2397) of people whose occupation is photographer, filmmaker,
// animator, film director, painter, sculptor, graphic designer or architect.
const WIKIDATA_QUERY = `SELECT ?yt WHERE { VALUES ?occ {wd:Q33231 wd:Q1414443 wd:Q266569 wd:Q2526255 wd:Q1028181 wd:Q1281618 wd:Q627325 wd:Q42973} ?p wdt:P106 ?occ; wdt:P2397 ?yt }`;
const WIKIDATA_URL = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(WIKIDATA_QUERY)}`;

const HACKERTUBE_VIDEOS_URL = "https://hackertube.org/download/videos.jsonl";
const AISLIST_FALLBACK_URL =
  "https://raw.githubusercontent.com/Override92/AiSList/main/AiSList/aislist_blocklist.txt";

/** @param {unknown} raw */
function normKey(raw) {
  if (!raw || typeof raw !== "string") return "";
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

/** @param {string} url */
async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "SieveSeedBuilder/1.0" } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

async function main() {
  await mkdir(seedsDir, { recursive: true });

  const [videosJsonl, aislistRaw, aiswarnRaw, kagiRaw, wikidataRaw] = await Promise.all([
    fetchText(HACKERTUBE_VIDEOS_URL),
    existsSync(submoduleAisList)
      ? readFile(submoduleAisList, "utf8")
      : fetchText(AISLIST_FALLBACK_URL),
    existsSync(submoduleAisWarn) ? readFile(submoduleAisWarn, "utf8") : Promise.resolve(""),
    fetchText(KAGI_SMALLYT_URL),
    fetchText(WIKIDATA_URL),
  ]);

  /** @type {Set<string>} */
  const hnVideos = new Set();
  /** @type {Set<string>} */
  const hnChannels = new Set();

  for (const line of videosJsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    /** @type {Record<string, unknown>} */
    const row = JSON.parse(trimmed);
    const vid = row.vid || row.video_id || row.id;
    if (typeof vid === "string" && vid.length >= 8) {
      hnVideos.add(vid.trim());
    }
    for (const candidate of [row.channel, row.channel_id, row.channel_handle]) {
      const key = normKey(candidate);
      if (key.length >= 2) hnChannels.add(key);
    }
  }

  let kagiCount = 0;
  for (const m of kagiRaw.matchAll(/channel_id=(UC[\w-]{22})/g)) {
    const key = normKey(m[1]);
    if (!hnChannels.has(key)) kagiCount++;
    hnChannels.add(key);
  }

  let wikidataCount = 0;
  for (const m of wikidataRaw.matchAll(/"value"\s*:\s*"(UC[\w-]{22})"/g)) {
    const key = normKey(m[1]);
    if (!hnChannels.has(key)) wikidataCount++;
    hnChannels.add(key);
  }

  /** @type {Set<string>} */
  const slopChannels = new Set();
  for (const line of aislistRaw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("!") || trimmed.startsWith("#")) continue;
    const key = normKey(trimmed);
    if (key.length >= 2 && !hnChannels.has(key)) {
      slopChannels.add(key);
    }
  }

  // Channels that only partly use AI: not dimmed, the grader is told.
  /** @type {Set<string>} */
  const warnChannels = new Set();
  for (const line of aiswarnRaw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("!") || trimmed.startsWith("#")) continue;
    const key = normKey(trimmed);
    if (key.length >= 2 && !hnChannels.has(key) && !slopChannels.has(key)) warnChannels.add(key);
  }

  const sortedVideos = [...hnVideos].sort();
  const sortedHnChannels = [...hnChannels].sort();
  const sortedSlop = [...slopChannels].sort();

  await Promise.all([
    writeFile(path.join(seedsDir, "hn-videos.txt"), sortedVideos.join("\n") + "\n", "utf8"),
    writeFile(path.join(seedsDir, "hn-channels.txt"), sortedHnChannels.join("\n") + "\n", "utf8"),
    writeFile(path.join(seedsDir, "slop-channels.txt"), sortedSlop.join("\n") + "\n", "utf8"),
    writeFile(path.join(seedsDir, "slop-warn-channels.txt"), [...warnChannels].sort().join("\n") + "\n", "utf8"),
  ]);

  console.log(
    `Built seeds: ${sortedVideos.length} HN videos, ${sortedHnChannels.length} HN channels (${kagiCount} from Kagi, ${wikidataCount} from Wikidata), ${sortedSlop.length} slop channels, ${warnChannels.size} partly-AI channels`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
