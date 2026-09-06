# Geri Clips

An interactive map of memorable clips from AgeriVagyok's streams. The GCLIPS spreadsheet is the source of truth, and its clips are shown on a dark, zoomable map with Twitch playback.

## Open the standalone map

Double-click `open-map.cmd`. It opens the standalone map through a small local web address, which Twitch requires for embedded clip playback. Keep the command window open while using it.

Opening `index.html` directly still displays the map and pins, but Twitch rejects clip embeds on `file://` pages.

## Local development

```bash
pnpm install
pnpm dev
```
