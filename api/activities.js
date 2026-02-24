import axios from "axios";

async function getFreshAccessToken() {
  const { data } = await axios.post("https://www.strava.com/oauth/token", {
    client_id: process.env.STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    refresh_token: process.env.STRAVA_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  return data.access_token;
}

export default async function handler(req, res) {
  try {
    const accessToken = await getFreshAccessToken();

    const all = [];
    let page = 1;
    while (true) {
      const { data } = await axios.get(
        "https://www.strava.com/api/v3/athlete/activities",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
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
    console.error("Activities fetch failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
