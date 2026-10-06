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

// Date-typed Sheet cells arrive as "Date(2025,11,22)" with a zero-based month.
// Return YYYY-MM-DD so sorting by text stays chronological.
export function normalizeClipDate(value) {
  const text = String(value ?? "").trim();
  const sheetDate = text.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})/);
  if (sheetDate) {
    const [, year, month, day] = sheetDate;
    return `${year}-${String(Number(month) + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return text;
}

// Shared by the API route and the standalone generator.
// `tables` holds one { rows, zedSource } entry per Sheet tab, in tab order.
export function parseSheetPlaces(tables, metadata = {}) {
  const cell = (row, index) => row.c?.[index]?.v ?? "";
  return tables.flatMap((table, tableIndex) => {
    if (!Array.isArray(table.rows)) throw new Error("Invalid Sheet response");
    return table.rows.flatMap((row, index) => {
      const coordinates = parseCoordinates(cell(row, 5));
      const name = String(cell(row, 0)).trim();
      if (!coordinates || !name || name === "Clip name") return [];
      const clipUrl = String(cell(row, 1)).trim();
      const twitch = metadata[getClipId(clipUrl)] ?? {};
      return [{
        id: tableIndex * 1_000_000 + index + 1,
        name,
        clipUrl,
        category: String(cell(row, 2)).trim(),
        sourceKeywords: String(cell(row, 3)),
        keywords: String(cell(row, 4)),
        latitude: coordinates[0],
        longitude: coordinates[1],
        twitchTitle: String(cell(row, 6)),
        country: String(cell(row, 7)).trim(),
        clipDate: normalizeClipDate(cell(row, 8)),
        top: String(cell(row, 9)).trim().toUpperCase() === "TOP",
        zedSource: table.zedSource,
        twitchCategory: twitch.category ?? "",
      }];
    });
  });
}

export function parseSheetResponse(body) {
  const payload = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1));
  if (!Array.isArray(payload?.table?.rows)) throw new Error("Invalid Sheet response");
  return payload.table.rows;
}
