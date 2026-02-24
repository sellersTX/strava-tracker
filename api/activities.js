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

async function fetchPage(token, page) {
  const { data } = await axios.get(
    "https://www.strava.com/api/v3/athlete/activities",
    {
      headers: { Authorization: `Bearer ${token}` },
      params: { per_page: 200, page },
    }
  );
  return data;
}

// Fetch all pages in parallel batches of 5 instead of one-by-one
async function fetchAllActivities(token) {
  const all = [];
  let page = 1;

  while (true) {
    // Fire up to 5 pages at once
    const batch = await Promise.all(
      Array.from({ length: 5 }, (_, i) => fetchPage(token, page + i))
    );

    for (const results of batch) {
      all.push(...results);
      if (results.length < 200) return all; // hit the last page
    }

    page += 5;
  }
}

export default async function handler(req, res) {
  try {
    const accessToken = await getFreshAccessToken();
    const all = await fetchAllActivities(accessToken);

    const runs = all
      .filter((a) => a.type === "Run" || a.sport_type === "Run")
      .map((a) => ({
        id: a.id,
        name: a.name,
        date: a.start_date_local.slice(0, 10),
        distance_miles: Math.round((a.distance / 1609.34) * 100) / 100,
        moving_time: a.moving_time,
        latlng: a.start_latlng?.length === 2 ? a.start_latlng : null,
        polyline: a.map?.summary_polyline ?? null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json(runs);
  } catch (e) {
    console.error("Activities fetch failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
