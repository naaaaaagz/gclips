import twitchMetadata from "../../../data/twitch-meta.json";
import { parseSheetPlaces, parseSheetResponse } from "../../../lib/clip-data.mjs";
const metadata: Record<string, { category?: string }> = twitchMetadata;

const SOURCE = "1rmCpUX9JnmWHKrqDtfjcjkf0eb1I5lQlg22QJc0d60w";

const SOURCE_TABS = [
  { gid: "0", zedSource: false },
  { gid: "20260907", zedSource: true },
] as const;

export async function GET() {
  try {
    const tables = await Promise.all(SOURCE_TABS.map(async (tab) => {
      const endpoint = `https://docs.google.com/spreadsheets/d/${SOURCE}/gviz/tq?tqx=out:json&gid=${tab.gid}`;
      const response = await fetch(endpoint, { next: { revalidate: 300 }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Source returned ${response.status}`);
      return { rows: parseSheetResponse(await response.text()), zedSource: tab.zedSource };
    }));

    return Response.json(parseSheetPlaces(tables, metadata), {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
    });
  } catch {
    return Response.json({ error: "Map data is temporarily unavailable." }, { status: 502 });
  }
}
