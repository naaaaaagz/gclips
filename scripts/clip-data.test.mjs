import assert from "node:assert/strict";
import { test } from "node:test";
import { getClipId, parseCoordinates } from "../lib/clip-data.mjs";
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

test("both Twitch clip URL forms work without trusting other hosts", () => {
  assert.equal(getClipId("https://www.twitch.tv/agerivagyok/clip/Test-123?foo=bar"), "Test-123");
  assert.equal(getClipId("https://clips.twitch.tv/Test-123?foo=bar"), "Test-123");
  for (const value of ["", "https://example.com/agerivagyok/clip/Test", "https://clips.twitch.tv/embed", "javascript:alert(1)"]) {
    assert.equal(getClipId(value), "");
  }
});
