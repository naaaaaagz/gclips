import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getClipId, parseSheetResponse } from "../lib/clip-data.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(ROOT, "data", "twitch-meta.json");
const SOURCE = "1rmCpUX9JnmWHKrqDtfjcjkf0eb1I5lQlg22QJc0d60w";
const SOURCE_GIDS = ["0", "20260907"];
const clientId = process.env.TWITCH_CLIENT_ID ?? "";
const clientSecret = process.env.TWITCH_CLIENT_SECRET ?? "";

if (!clientId || !clientSecret) throw new Error("TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are required");

// Send the secret in the request body, never in the URL.
const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
  method: "POST",
  body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
});
if (!tokenResponse.ok) throw new Error(`Twitch token request returned ${tokenResponse.status}`);
const { access_token: token } = await tokenResponse.json();

const clipIds = new Set();
for (const gid of SOURCE_GIDS) {
  const sheetResponse = await fetch(`https://docs.google.com/spreadsheets/d/${SOURCE}/gviz/tq?tqx=out:json&gid=${gid}`);
  if (!sheetResponse.ok) throw new Error(`Sheet tab ${gid} returned ${sheetResponse.status}`);
  for (const row of parseSheetResponse(await sheetResponse.text())) {
    const id = getClipId(String(row.c?.[1]?.v ?? ""));
    if (id) clipIds.add(id);
  }
}
const ids = [...clipIds];

const twitchHeaders = { Authorization: `Bearer ${token}`, "Client-Id": clientId };
const clips = [];
for (let offset = 0; offset < ids.length; offset += 100) {
  const url = new URL("https://api.twitch.tv/helix/clips");
  for (const id of ids.slice(offset, offset + 100)) url.searchParams.append("id", id);
  const response = await fetch(url, { headers: twitchHeaders });
  if (!response.ok) throw new Error(`Twitch clips request returned ${response.status}`);
  const batch = await response.json();
  clips.push(...batch.data);
  console.log(`Twitch clips: ${Math.min(offset + 100, ids.length)}/${ids.length}`);
}

const gameIds = [...new Set(clips.map((clip) => clip.game_id).filter(Boolean))];
const games = {};
for (let offset = 0; offset < gameIds.length; offset += 100) {
  const url = new URL("https://api.twitch.tv/helix/games");
  for (const id of gameIds.slice(offset, offset + 100)) url.searchParams.append("id", id);
  const response = await fetch(url, { headers: twitchHeaders });
  if (!response.ok) throw new Error(`Twitch games request returned ${response.status}`);
  const batch = await response.json();
  for (const game of batch.data) games[game.id] = game.name;
}

const metadata = Object.fromEntries(clips.map((clip) => [clip.id, {
  category: games[clip.game_id] ?? "",
  title: clip.title ?? "",
}]));

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
console.log(`Wrote metadata for ${Object.keys(metadata).length} clips to ${OUTPUT}`);
