Sieve for Chrome (Teddy Warner's feed filter ported to Chrome) is on main of Milind's fork (milindanand13/sieve). It has a right-click Sieve menu (keep, dim, always keep/dim creator). User calls beat every rule and never expire, and the grader sees the 30 most similar of up to 500 corrections. The Google Doc "Sieve for Chrome" is current.
2026-11-18 audit-fixes PR fixed all 20 ponytail-audit findings:
- "Clear verdict cache" now keeps right-click post calls (it resets learned creator counts), and grader verdicts never overwrite them.
- Dim CSS only applies while Sieve is on for that site.
- Options/popup saves re-read storage, so they no longer clobber each other.
- The XHR wrapper ignores a stale response after open() is called again.
- REWRITE_RESPONSE checks the request host against the sender tab.
- The grader runs one chunk at a time; X cadence drops respect the toggle.
- Expired IndexedDB rows are deleted.
- TikTok code and the activeTab/tabs permissions are removed.
Verified: 94 tests pass, typecheck clean, and the build is rebuilt. Playwright (scratchpad pw/t2.mjs) passed right-click dim, undo, scroll-between and off-card clicks on live YouTube.
Next: Milind reloads Sieve at chrome://extensions; `npm run fixtures` needs a sieve-samples.json export from the Options page. Open: a real single-transaction recordVerdicts; YouTube feedback text starts with the duration and "Now playing" overlay text.
Risks:
- X "!!" and "??" are no longer calmed, because calming them would shift the link/mention positions.
- Instagram graphql is still intercepted broadly.
- No test covers background/index.ts message handlers or the fetch wrapper.
- The tiktok type and config keys remain.
- X and Instagram internals change often, and fixtures are gitignored.
