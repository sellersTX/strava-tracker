import axios from "axios";

export const config = { maxDuration: 60 };

async function getFreshAccessToken() {
  const { data } = await axios.post("https://www.strava.com/oauth/token", {
    client_id: process.env.STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    refresh_token: process.env.STRAVA_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  return data.access_token;
}

// 1 decimal place ≈ 11km grid — plenty of precision for city/country
const roundCoord = (n) => Math.round(n * 10) / 10;

async function reverseGeocode(lat, lng) {
  try {
    const { data } = await axios.get(
      "https://nominatim.openstreetmap.org/reverse",
      {
        params: { lat, lon: lng, format: "json" },
        headers: {
          "User-Agent": "StravaRunTracker/1.0 (seandunbarsellers@gmail.com)",
        },
        timeout: 8000,
      }
    );
    const a = data.address ?? {};
    return {
      city: a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb ?? null,
      country: a.country ?? null,
    };
  } catch {
    return { city: null, country: null };
  }
}

// Geocode in small parallel batches
async function geocodeAll(keys) {
  const results = {};
  const BATCH = 5;
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    const settled = await Promise.all(
      batch.map(async (key) => {
        const [lat, lng] = key.split(",").map(Number);
        const geo = await reverseGeocode(lat, lng);
        return { key, geo };
      })
    );
    settled.forEach(({ key, geo }) => { results[key] = geo; });
    // Small pause between batches to be polite to Nominatim
    if (i + BATCH < keys.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return results;
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

    const runs = all.filter((a) => a.type === "Run" || a.sport_type === "Run");

    // Collect unique rounded coordinates
    const coordCache = {};
    for (const run of runs) {
      if (!run.start_latlng?.length) continue;
      const key = `${roundCoord(run.start_latlng[0])},${roundCoord(run.start_latlng[1])}`;
      coordCache[key] = null;
    }

    const geocoded = await geocodeAll(Object.keys(coordCache));

    const result = runs.map((a) => {
      let city = null, country = null;
      if (a.start_latlng?.length) {
        const key = `${roundCoord(a.start_latlng[0])},${roundCoord(a.start_latlng[1])}`;
        city = geocoded[key]?.city ?? null;
        country = geocoded[key]?.country ?? null;
      }
      return { id: a.id, city, country };
    });

    res.json(result);
  } catch (e) {
    console.error("Locations failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
