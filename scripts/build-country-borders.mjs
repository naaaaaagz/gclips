import { readFileSync, writeFileSync } from "node:fs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("Usage: node scripts/build-country-borders.mjs <input.geojson> <output.geojson>");
}

// The clip archive currently covers central and northern Europe. Keep a generous
// surrounding area so the default map view still has complete, high-resolution
// country borders without downloading the full global Natural Earth dataset.
const bounds = { west: -8, south: 37, east: 30, north: 65 };
const source = JSON.parse(readFileSync(inputPath, "utf8"));

const segmentTouchesBounds = ([ax, ay], [bx, by]) => (
  Math.max(ax, bx) >= bounds.west
  && Math.min(ax, bx) <= bounds.east
  && Math.max(ay, by) >= bounds.south
  && Math.min(ay, by) <= bounds.north
);

function clipLine(coordinates) {
  const lines = [];
  let current = [];
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    if (!segmentTouchesBounds(start, end)) {
      if (current.length > 1) lines.push(current);
      current = [];
      continue;
    }
    if (!current.length) current.push(start);
    current.push(end);
  }
  if (current.length > 1) lines.push(current);
  return lines;
}

const features = source.features.flatMap((feature) => {
  const sourceLines = feature.geometry?.type === "LineString"
    ? [feature.geometry.coordinates]
    : feature.geometry?.type === "MultiLineString"
      ? feature.geometry.coordinates
      : [];
  const lines = sourceLines.flatMap(clipLine);
  if (!lines.length) return [];
  return [{
    type: "Feature",
    properties: {},
    geometry: lines.length === 1
      ? { type: "LineString", coordinates: lines[0] }
      : { type: "MultiLineString", coordinates: lines },
  }];
});

writeFileSync(outputPath, JSON.stringify({ type: "FeatureCollection", features }), "utf8");
console.log(`Wrote ${features.length} border features to ${outputPath}`);
