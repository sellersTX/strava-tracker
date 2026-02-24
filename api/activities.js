import axios from "axios";

function parseTokenCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/strava_token=([^;]+)/);
  if (!match) return null;
  try {
    return JSON.parse(Buffer.from(match[1], "base64").toString("utf-8"));
  } catch {
    return null;
  }
}

async function ensureFreshToken(tokens, res) {
  if (Date.now() / 1000 <= tokens.expires_at - 300) return tokens;

  const { data } = await axios.post("https://www.strava.com/oauth/token", {
    client_id: process.env.STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    refresh_token: tokens.refresh_token,
    grant_type: "refresh_token",
  });

  const fresh = { ...tokens, ...data };
  const encoded = Buffer.from(JSON.stringify(fresh)).toString("base64");
  const year = 60 * 60 * 24 * 365;
  res.setHeader(
    "Set-Cookie",
    `strava_token=${encoded}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${year}`
  );
  return fresh;
}

export default async function handler(req, res) {
  let tokens = parseTokenCookie(req.headers.cookie);
  if (!tokens) return res.status(401).json({ error: "Not authenticated" });

  try {
    tokens = await ensureFreshToken(tokens, res);
  } catch {
    return res.status(401).json({ error: "Token refresh failed" });
  }

  try {
    const all = [];
    let page = 1;
    while (true) {
      const { data } = await axios.get(
        "https://www.strava.com/api/v3/athlete/activities",
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
          params: { per_page: 200, page },
        }
      );
      if (!data.length) break;
      all.push(...data);
      if (data.length < 200) break;
      page++;
    }

    const runs = all
      .filter((a) => a.type === "Run" || a.sport_type === "Run")
      .map((a) => ({
        id: a.id,
        name: a.name,
        date: a.start_date_local.slice(0, 10),
        distance_miles: Math.round((a.distance / 1609.34) * 100) / 100,
        moving_time: a.moving_time,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json(runs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
