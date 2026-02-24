import axios from "axios";

// Allow up to 60s — geocoding many unique coordinates takes time
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

// Round to 2 decimal places (~1km grid) to deduplicate nearby runs
const roundCoord = (n) => Math.round(n * 100) / 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reverseGeocode(lat, lng) {
  try {
    const { data } = await axios.get(
      "https://nominatim.openstreetmap.org/reverse",
      {
        params: { lat, lon: lng, format: "json" },
        headers: {
          "User-Agent": "StravaRunTracker/1.0 (seandunbarsellers@gmail.com)",
        },
        timeout: 5000,
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

export default async function handler(req, res) {
  try {
    const accessToken = await getFreshAccessToken();

    // Fetch all activities
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

    // Build unique coordinate keys
    const coordCache = {}; // "lat,lng" -> { city, country }
    for (const run of runs) {
      if (!run.start_latlng?.length) continue;
      const key = `${roundCoord(run.start_latlng[0])},${roundCoord(run.start_latlng[1])}`;
      if (!(key in coordCache)) coordCache[key] = null;
    }

    // Geocode each unique location (1 req per 300ms to respect Nominatim ToS)
    const keys = Object.keys(coordCache);
    for (let i = 0; i < keys.length; i++) {
      const [lat, lng] = keys[i].split(",").map(Number);
      coordCache[keys[i]] = await reverseGeocode(lat, lng);
      if (i < keys.length - 1) await sleep(300);
    }

    // Return location data keyed by activity id
    const result = runs.map((a) => {
      let city = null, country = null;
      if (a.start_latlng?.length) {
        const key = `${roundCoord(a.start_latlng[0])},${roundCoord(a.start_latlng[1])}`;
        city = coordCache[key]?.city ?? null;
        country = coordCache[key]?.country ?? null;
      }
      return { id: a.id, city, country };
    });

    res.json(result);
  } catch (e) {
    console.error("Locations fetch failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
