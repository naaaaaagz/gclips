import { createReadStream, readdirSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowedFiles = new Set([
  "index.html", "maplibre-gl.mjs", "maplibre-gl-shared.mjs", "maplibre-gl-worker.mjs", "maplibre-gl.css",
  ...readdirSync(new URL("../public/", import.meta.url)).filter((name) => /\.(png|ico|webmanifest|xml|geojson)$/.test(name)),
]);
const port = 4173;
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".geojson": "application/geo+json",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".xml": "application/xml",
};

const server = createServer(async (request, response) => {
  let relative;
  try {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  if (!allowedFiles.has(relative)) {
    response.writeHead(404).end("Not found");
    return;
  }
  const target = normalize(join(root, relative));

  try {
    const details = await stat(target);
    if (!details.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": types[extname(target)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Geri Clips is running at http://localhost:${port}`);
  console.log("Keep this window open while using the map. Press Ctrl+C to stop.");
});
