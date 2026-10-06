import assert from "node:assert/strict";
import { test } from "node:test";
import { getClipId, normalizeClipDate, parseCoordinates, parseSheetPlaces, parseSheetResponse } from "../lib/clip-data.mjs";
import { createTilePrefetcher, tileRingUrls } from "../lib/tile-prefetch.mjs";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { GET } from "../app/api/live/route.ts";

test("coordinates reject missing halves and out-of-range values", () => {
  for (const value of ["", "?", ",", "47,", ",19", "91,19", "47,181", "47,19,3", "NaN,19"]) {
    assert.equal(parseCoordinates(value), null, value);
  }
  assert.deepEqual(parseCoordinates(" 47.5, 19.2 "), [47.5, 19.2]);
  assert.deepEqual(parseCoordinates("0,0"), [0, 0]);
});

test("empty standalone searches do not move the camera", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const fit = html.split(/\r?\n/).find((line) => line.trim().startsWith("function fitVisible("));
  let movements = 0;
  runInNewContext(`${fit};fitVisible([], ["no-match"]);`, {
    clearTimeout() {}, fitTimer: 0, searchOrigin: { center: [19, 47], zoom: 10 },
    map: { stop() {}, easeTo() { movements++; } },
  });
  assert.equal(movements, 0);
});

test("standalone playback replaces the previous iframe", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const open = html.split(/\r?\n/).find((line) => line.trim().startsWith("function openClip("));
  let frames = [];
  runInNewContext(`${open};openClip(place);openClip(place);`, {
    clipId: () => "test", clipName: {}, topBadge: {}, clipSourceKeywords: {},
    document: { createElement: () => ({}), querySelector() {}, body: { classList: { add() {} } } },
    location: { hostname: "localhost" }, backdrop: { classList: { add() {} }, setAttribute() {} },
    player: { replaceChildren(frame) { frames = [frame]; } },
    releaseModalFocus: null, manageModalFocus: () => () => {}, closeModal() {},
    place: { name: "test", clipUrl: "https://clips.twitch.tv/test" },
  });
  assert.equal(frames.length, 1);
});

test("LIVE distinguishes failed checks and retries rejected tokens once", async () => {
  const originalFetch = globalThis.fetch;
  const originalId = process.env.TWITCH_CLIENT_ID;
  const originalSecret = process.env.TWITCH_CLIENT_SECRET;
  const request = new Request("http://localhost/api/live");
  try {
    delete process.env.TWITCH_CLIENT_ID;
    delete process.env.TWITCH_CLIENT_SECRET;
    let response = await GET(request);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    process.env.TWITCH_CLIENT_ID = "test-client";
    process.env.TWITCH_CLIENT_SECRET = "test-secret";
    const sequence = [
      Response.json({ access_token: "test-token", expires_in: 3600 }),
      new Response("", { status: 401 }),
      Response.json({ access_token: "new-test-token", expires_in: 3600 }),
      Response.json({ data: [{ id: "stream" }] }),
    ];
    let calls = 0;
    globalThis.fetch = async () => { calls++; return sequence.shift(); };
    response = await GET(request);
    assert.deepEqual(await response.json(), { online: true });
    assert.equal(calls, 4);
    globalThis.fetch = async () => new Response("", { status: 500 });
    response = await GET(request);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal((await response.json()).online, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalId === undefined) delete process.env.TWITCH_CLIENT_ID; else process.env.TWITCH_CLIENT_ID = originalId;
    if (originalSecret === undefined) delete process.env.TWITCH_CLIENT_SECRET; else process.env.TWITCH_CLIENT_SECRET = originalSecret;
  }
});

test("Sheet rows become places with stable ids and ISO dates", () => {
  const row = (...values) => ({ c: values.map((v) => (v === null ? null : { v })) });
  const tables = [
    { zedSource: false, rows: [
      row("Clip name", "Clip URL", "Category", "", "", "Coordinates", "", "Country", "Date", "Top"),
      row(" Balaton ", "https://clips.twitch.tv/Test-1", "Kör", "a, b", "c", "46.9, 17.9", "Twitch title", "Hungary", "Date(2025,11,2)", "top"),
      row("No coordinates", "", "", "", "", "", "", "", "", ""),
    ] },
    { zedSource: true, rows: [row("Zed", "", "Zed kör", "", "", "47,19", "", "Hungary", "2025-01-05", null)] },
  ];
  const places = parseSheetPlaces(tables, { "Test-1": { category: "Just Chatting" } });
  assert.equal(places.length, 2);
  assert.deepEqual(places.map((place) => [place.id, place.name, place.clipDate, place.top, place.zedSource]),
    [[2, "Balaton", "2025-12-02", true, false], [1_000_001, "Zed", "2025-01-05", false, true]]);
  assert.equal(places[0].twitchCategory, "Just Chatting");
  assert.equal("twitchKeywords" in places[0], false);
  assert.equal(normalizeClipDate("Date(2024,0,31)"), "2024-01-31");
  assert.deepEqual(parseSheetResponse('/*O_o*/\ngoogle.visualization.Query.setResponse({"table":{"rows":[]}});'), []);
  assert.throws(() => parseSheetResponse("<html>Sign in</html>"));
});

test("tile ring skips visible tiles and wraps around the date line", () => {
  const urls = tileRingUrls({ west: -1, east: 1, south: -1, north: 1 }, 2, "{z}/{x}/{y}");
  assert.equal(urls.length, 12);
  assert.ok(!urls.includes("2/1/1") && !urls.includes("2/2/2"));
  assert.ok(urls.includes("2/0/1") && urls.includes("2/3/2"));
});

test("tile prefetcher cancels requests the current view no longer needs", async () => {
  const signals = new Map();
  const prefetcher = createTilePrefetcher((url, { signal }) => {
    signals.set(url, signal);
    return new Promise(() => {});
  });
  prefetcher.update(["a", "b"]);
  await Promise.resolve();
  prefetcher.update(["b", "c"]);
  assert.equal(signals.get("a").aborted, true);
  assert.equal(signals.get("b").aborted, false);
  prefetcher.dispose();
  assert.equal(signals.get("b").aborted, true);
});

test("both Twitch clip URL forms work without trusting other hosts", () => {
  assert.equal(getClipId("https://www.twitch.tv/agerivagyok/clip/Test-123?foo=bar"), "Test-123");
  assert.equal(getClipId("https://clips.twitch.tv/Test-123?foo=bar"), "Test-123");
  for (const value of ["", "https://example.com/agerivagyok/clip/Test", "https://clips.twitch.tv/embed", "javascript:alert(1)"]) {
    assert.equal(getClipId(value), "");
  }
});
