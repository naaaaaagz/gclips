import twitchMetadata from "../../../data/twitch-meta.json";

const SOURCE_PARTS = [
  "MXJtQ3BV",
  "WDlKbm1X",
  "SEtycUR0",
  "Zmpjamtm",
  "MGViMUk1",
  "bFFsZzIy",
  "UUpjMGQ2",
  "MHc=",
];

type Cell = { v?: string | number | null } | null;

const SOURCE_TABS = [
  { gid: "0", zedSource: false },
  { gid: "20260907", zedSource: true },
] as const;

function decodeSource() {
  return atob(SOURCE_PARTS.join(""));
}

function cell(row: { c?: Cell[] }, index: number) {
  return row.c?.[index]?.v ?? "";
}

function getClipId(url: string) {
  return url.match(/\/clip\/([^/?#]+)/)?.[1] ?? "";
}

export async function GET() {
  const source = decodeSource();

  try {
    const tables = await Promise.all(SOURCE_TABS.map(async (tab) => {
      const endpoint = `https://docs.google.com/spreadsheets/d/${source}/gviz/tq?tqx=out:json&gid=${tab.gid}`;
      const response = await fetch(endpoint, { next: { revalidate: 300 } });
      if (!response.ok) throw new Error(`Source returned ${response.status}`);
      const body = await response.text();
      const start = body.indexOf("{");
      const end = body.lastIndexOf("}");
      const payload = JSON.parse(body.slice(start, end + 1));
      return { rows: payload.table.rows as { c?: Cell[] }[], zedSource: tab.zedSource };
    }));

    const places = tables.flatMap((table, tableIndex) => table.rows
      .map((row, index) => {
        const coordinates = String(cell(row, 5))
          .split(",")
          .map((value) => Number(value.trim()));
        const clipUrl = String(cell(row, 1));
        const clipId = getClipId(clipUrl);
        const twitch = twitchMetadata[clipId as keyof typeof twitchMetadata];

        return {
          id: tableIndex * 1_000_000 + index + 1,
          name: String(cell(row, 0)),
          clipUrl,
          category: String(cell(row, 2)),
          sourceKeywords: String(cell(row, 3)),
          keywords: String(cell(row, 4)),
          latitude: coordinates[0],
          longitude: coordinates[1],
          twitchTitle: String(cell(row, 6)),
          country: String(cell(row, 7)),
          clipDate: String(cell(row, 8)),
          top: String(cell(row, 9)).trim().toUpperCase() === "TOP",
          zedSource: table.zedSource,
          twitchCategory: twitch?.category ?? "",
          twitchKeywords: twitch?.language ?? "",
        };
      })
      .filter(
        (place) =>
          place.name &&
          Number.isFinite(place.latitude) &&
          Number.isFinite(place.longitude),
      ));

    return Response.json(places, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
    });
  } catch {
    return Response.json({ error: "Map data is temporarily unavailable." }, { status: 502 });
  }
}
