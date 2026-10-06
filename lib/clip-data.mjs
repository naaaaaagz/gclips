export function getClipId(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.hostname === "clips.twitch.tv") {
      const id = url.pathname.match(/^\/([A-Za-z0-9_-]+)\/?$/)?.[1] ?? "";
      return id === "embed" ? "" : id;
    }
    if (url.hostname === "www.twitch.tv" || url.hostname === "twitch.tv") {
      return url.pathname.match(/^\/[^/]+\/clip\/([A-Za-z0-9_-]+)\/?$/)?.[1] ?? "";
    }
  } catch { /* Invalid or missing URL. */ }
  return "";
}

export function parseCoordinates(value) {
  const parts = String(value).split(",").map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => !part)) return null;
  const [latitude, longitude] = parts.map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return [latitude, longitude];
}
