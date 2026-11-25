// Fetches public text for the IDs collected from Milind's feeds: YouTube watch pages (logged out,
// same request plainTitlesFor makes) and X posts via the public embed endpoint. Writes bench/data/raw-*.json.
import { readFileSync, writeFileSync } from "node:fs";

const lines = (f) => readFileSync(f, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);

async function pool(xs, n, fn) {
  const out = [];
  for (let i = 0; i < xs.length; i += n) out.push(...(await Promise.all(xs.slice(i, i + n).map(fn))));
  return out;
}

const yt = await pool(lines("bench/data/yt-ids.txt"), 6, async (id) => {
  try {
    const html = await (await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: { "Accept-Language": "en-US" } })).text();
    const m = /var ytInitialPlayerResponse = (\{.*?\});(?:var|<\/script>)/s.exec(html);
    const vd = m ? JSON.parse(m[1]).videoDetails : null;
    if (!vd) return { id, error: "no videoDetails" };
    return { id, title: vd.title, channel: vd.author, channelId: vd.channelId, dur: Number(vd.lengthSeconds) || 0, desc: vd.shortDescription ?? "" };
  } catch (e) {
    return { id, error: String(e) };
  }
});
writeFileSync("bench/data/raw-yt.json", JSON.stringify(yt, null, 1));
console.log("yt", yt.length, "errors", yt.filter((x) => x.error).length);

const token = (id) => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
const x = await pool(lines("bench/data/x-ids.txt"), 6, async (id) => {
  try {
    const j = await (await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token(id)}`)).json();
    const range = j.display_text_range;
    const text = (range ? [...j.text].slice(range[0], range[1]).join("") : j.text) ?? "";
    const quoted = j.quoted_tweet ? `${j.quoted_tweet.user?.screen_name}: ${j.quoted_tweet.text}` : "";
    const media = j.video ? "video" : j.photos?.length ? "photo" : "";
    return { id, by: j.user?.screen_name, text, quoted, media, error: j.text === undefined ? "no text" : undefined };
  } catch (e) {
    return { id, error: String(e) };
  }
});
writeFileSync("bench/data/raw-x.json", JSON.stringify(x, null, 1));
console.log("x", x.length, "errors", x.filter((v) => v.error).length);
