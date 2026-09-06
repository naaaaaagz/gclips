import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const scriptStart = html.indexOf('<script type="module">') + '<script type="module">'.length;
const scriptEnd = html.indexOf("</script>", scriptStart);
if (scriptStart < '<script type="module">'.length || scriptEnd < 0) throw new Error("Standalone module script not found");

const code = html.slice(scriptStart, scriptEnd).replace(/^\s*import[^;]+;\s*/, "");
new Function(code);

const expectedDescription = "AgeriVagyok streamjeinek emlékezetes klipjei térképen.";
const requiredText = [
  `content="${expectedDescription}"`,
  "clip-source-keywords",
  "cluster-count",
  "active-cluster",
  "clip-hit-area",
  "title-label-background",
  "list-play-button",
  "vibecoded with love :: powered by",
  'href="https://nagz.space"',
  "title-toggle",
  "country-borders-europe.geojson",
  "list-tab-wiggle",
  "maplibre-gl-shared.mjs",
];
for (const value of requiredText) {
  if (!html.includes(value)) throw new Error(`Missing standalone output: ${value}`);
}
if (html.includes('"icon-offset":[0,-13]')) {
  throw new Error("Title label background must follow the text offset instead of receiving a second offset");
}
if (html.includes("setMissingStyleImageResolver")) {
  throw new Error("Raster-generated cluster icons must not be reintroduced");
}

console.log("Static HTML syntax and feature checks passed.");
