// Usage: npm run fixtures -- <path-to-sieve-samples.json>
// Splits the options-page export into tests/fixtures/<site>/<n>.json (gitignored).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = process.argv[2];
if (!input) {
  console.error("usage: npm run fixtures -- <path-to-sieve-samples.json>");
  process.exit(1);
}

const rows = JSON.parse(readFileSync(input, "utf8"));
if (!Array.isArray(rows)) throw new Error("expected an array of {site,url,body}");

const counts = {};
const urls = {};
for (const row of rows) {
  if (typeof row?.site !== "string" || typeof row.body !== "string") continue;
  const site = row.site.replace(/[^a-z0-9_-]/gi, "");
  const n = (counts[site] = (counts[site] ?? 0) + 1);
  const dir = path.join(rootDir, "tests", "fixtures", site);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${n}.json`), row.body);
  urls[`${site}/${n}`] = row.url; // lets tests/fixtures.test.ts pick the right endpoint
}
writeFileSync(path.join(rootDir, "tests", "fixtures", "urls.json"), JSON.stringify(urls, null, 1));
console.log(`Wrote ${Object.values(counts).reduce((a, b) => a + b, 0)} fixtures to tests/fixtures/`);
