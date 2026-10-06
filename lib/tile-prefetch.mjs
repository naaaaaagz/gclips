// Shared by the React site and the standalone page (inlined with toString, so
// each function must stay self-contained).

// Tile URLs for the one-tile ring just outside the visible bounds.
export function tileRingUrls(bounds, zoom, template) {
  const urls = [];
  const tileCount = 2 ** zoom;
  const longitudeToX = (longitude) => Math.floor(((longitude + 180) / 360) * tileCount);
  const latitudeToY = (latitude) => {
    const clamped = Math.max(-85.05112878, Math.min(85.05112878, latitude));
    const radians = clamped * Math.PI / 180;
    return Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * tileCount);
  };
  let east = bounds.east;
  while (east < bounds.west) east += 360;
  const minX = longitudeToX(bounds.west);
  const maxX = longitudeToX(east);
  const minY = latitudeToY(bounds.north);
  const maxY = latitudeToY(bounds.south);
  for (let y = minY - 1; y <= maxY + 1; y += 1) {
    if (y < 0 || y >= tileCount) continue;
    for (let x = minX - 1; x <= maxX + 1; x += 1) {
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) continue;
      const wrappedX = ((x % tileCount) + tileCount) % tileCount;
      urls.push(template.replace("{z}", String(zoom)).replace("{x}", String(wrappedX)).replace("{y}", String(y)));
    }
  }
  return urls;
}

// Fetches at most 4 tiles at a time and cancels requests the latest view no longer needs.
export function createTilePrefetcher(fetcher = globalThis.fetch) {
  const completed = new Set();
  const running = new Map();
  let queue = [];
  let desired = new Set();
  let disposed = false;
  function drain() {
    while (!disposed && running.size < 4 && queue.length) {
      const url = queue.shift();
      if (completed.has(url) || running.has(url)) continue;
      const controller = new AbortController();
      running.set(url, controller);
      const timeout = setTimeout(() => controller.abort(), 8000);
      Promise.resolve().then(() => fetcher(url, {
        cache: "force-cache", mode: "cors", signal: controller.signal,
      })).then((response) => {
        if (!response.ok) throw new Error("Tile request failed");
        return response.arrayBuffer();
      }).then(() => {
        if (controller.signal.aborted) return;
        completed.add(url);
        if (completed.size > 1600) completed.delete(completed.values().next().value);
      }).catch(() => {}).finally(() => {
        clearTimeout(timeout);
        running.delete(url);
        drain();
      });
    }
  }
  return {
    update(urls) {
      if (disposed) return;
      desired = new Set(urls.slice(0, 96));
      queue = [...desired].filter((url) => !completed.has(url) && !running.has(url));
      for (const [url, controller] of running) if (!desired.has(url)) controller.abort();
      drain();
    },
    dispose() {
      disposed = true;
      queue = [];
      for (const controller of running.values()) controller.abort();
    },
  };
}
