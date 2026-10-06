# Geri Clips

An interactive map of memorable clips from AgeriVagyok's streams. The GCLIPS spreadsheet is the source of truth, and its clips are shown on a dark, zoomable map with Twitch playback.

## Open the standalone map

Double-click `open-map.cmd`. It opens the standalone map through a small local web address, which Twitch requires for embedded clip playback. Keep the command window open while using it.

Use the local web address rather than opening `index.html` directly. The bundled map modules and Twitch player require HTTP.

## Keep the app and standalone map aligned

The app reads both GCLIPS tabs at runtime. The standalone page contains a saved snapshot. If a runtime request fails, the app uses that same snapshot and offers a retry.

After source edits, preserve the current data with `node scripts/generate-standalone.mjs --offline`. To deliberately refresh from the Sheet, run it without `--offline`. Both modes update `index.html`, the fallback snapshot and bundled map assets. Keep these outputs together.

Refreshing from the Sheet, and the app's live `/api/places` data, only work while the Sheet is shared as "Anyone with the link can view". Otherwise Google answers with a sign-in page and the generator stops with an error.

The LIVE button needs a hosted copy of `app/api/live/route.ts` with `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`. GitHub Pages cannot run it, so the static page only checks when `LIVE_URL` in `scripts/generate-standalone.mjs` is set to that full URL.

Verify with `node scripts/validate-standalone.mjs`, `node --test --test-isolation=none scripts/clip-data.test.mjs`, `pnpm exec tsc --noEmit --incremental false`, `pnpm lint` and `pnpm build`.

## Local development

```bash
pnpm install
pnpm dev
```
