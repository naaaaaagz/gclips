const TWITCH_CHANNEL = "agerivagyok";

let cachedToken = "";
let tokenExpiresAt = 0;

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") ?? "";
  const allowedOrigin = origin === "https://naaaaaagz.github.io" ? origin : "";
  return {
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    "Cache-Control": "public, max-age=60, s-maxage=60",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

async function getAppToken(clientId: string, clientSecret: string) {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  const tokenUrl = new URL("https://id.twitch.tv/oauth2/token");
  tokenUrl.searchParams.set("client_id", clientId);
  tokenUrl.searchParams.set("client_secret", clientSecret);
  tokenUrl.searchParams.set("grant_type", "client_credentials");

  const response = await fetch(tokenUrl, { method: "POST" });
  if (!response.ok) throw new Error(`Twitch token request returned ${response.status}`);
  const payload = await response.json() as { access_token: string; expires_in: number };
  cachedToken = payload.access_token;
  tokenExpiresAt = Date.now() + payload.expires_in * 1000;
  return cachedToken;
}

export async function GET(request: Request) {
  const headers = corsHeaders(request);
  const clientId = process.env.TWITCH_CLIENT_ID ?? "";
  const clientSecret = process.env.TWITCH_CLIENT_SECRET ?? "";

  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ online: false }), { status: 200, headers });
  }

  try {
    const token = await getAppToken(clientId, clientSecret);
    const streamsUrl = new URL("https://api.twitch.tv/helix/streams");
    streamsUrl.searchParams.set("user_login", TWITCH_CHANNEL);
    const response = await fetch(streamsUrl, {
      headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId },
    });
    if (!response.ok) throw new Error(`Twitch streams request returned ${response.status}`);
    const payload = await response.json() as { data?: unknown[] };
    return new Response(JSON.stringify({ online: Boolean(payload.data?.length) }), { headers });
  } catch {
    return new Response(JSON.stringify({ online: false }), { status: 200, headers });
  }
}
