import axios from "axios";
import { kv } from "@vercel/kv";

const RUNS_KEY = "runs:v1";
const RUNS_TS_KEY = "runs:last_ts";

async function getFreshAccessToken() {
  const { data } = await axios.post("https://www.strava.com/oauth/token", {
    client_id: process.env.STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    refresh_token: process.env.STRAVA_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  return data.access_token;
}

async function fetchPage(token, page, after = 0) {
  const { data } = await axios.get(
    "https://www.strava.com/api/v3/athlete/activities",
    {
      headers: { Authorization: `Bearer ${token}` },
      params: { per_page: 200, page, ...(after ? { after } : {}) },
    }
  );
  return data;
}

// Parallel batch fetch — used for the first full load
async function fetchAllPages(token) {
  const all = [];
  let page = 1;
  while (true) {
    const batch = await Promise.all(
      Array.from({ length: 5 }, (_, i) => fetchPage(token, page + i))
    );
    for (const results of batch) {
      all.push(...results);
      if (results.length < 200) return all;
    }
    page += 5;
  }
}

// Sequential fetch — used for incremental updates (usually just 1–2 pages)
async function fetchNewPages(token, after) {
  const all = [];
  let page = 1;
  while (true) {
    const results = await fetchPage(token, page, after);
    if (!results.length) break;
    all.push(...results);
    if (results.length < 200) break;
    page++;
  }
  return all;
}

function mapActivity(a) {
  return {
    id: a.id,
    name: a.name,
    date: a.start_date_local.slice(0, 10),
    ts: Math.floor(new Date(a.start_date).getTime() / 1000),
    distance_miles: Math.round((a.distance / 1609.34) * 100) / 100,
    moving_time: a.moving_time,
    latlng: a.start_latlng?.length === 2 ? a.start_latlng : null,
    polyline: a.map?.summary_polyline ?? null,
  };
}

export default async function handler(req, res) {
  try {
    // Read cache and last timestamp in parallel
    const [cachedRuns, lastTs] = await Promise.all([
      kv.get(RUNS_KEY),
      kv.get(RUNS_TS_KEY),
    ]);

    const token = await getFreshAccessToken();

    if (cachedRuns?.length) {
      // Cache hit — only fetch activities newer than last cached run
      const newActivities = await fetchNewPages(token, lastTs ?? 0);
      const newRuns = newActivities
        .filter((a) => a.type === "Run" || a.sport_type === "Run")
        .map(mapActivity);

      if (newRuns.length > 0) {
        const merged = [...cachedRuns, ...newRuns]
          .sort((a, b) => a.date.localeCompare(b.date));
        const newLastTs = Math.max(...newRuns.map((r) => r.ts));
        // Update cache in background — don't make user wait
        kv.set(RUNS_KEY, merged);
        kv.set(RUNS_TS_KEY, newLastTs);
        return res.json(merged);
      }

      // Nothing new — return cache instantly
      return res.json(cachedRuns);
    }

    // Cache miss — full fetch, then store
    const all = await fetchAllPages(token);
    const runs = all
      .filter((a) => a.type === "Run" || a.sport_type === "Run")
      .map(mapActivity)
      .sort((a, b) => a.date.localeCompare(b.date));

    const newLastTs = runs.length ? Math.max(...runs.map((r) => r.ts)) : 0;
    await Promise.all([
      kv.set(RUNS_KEY, runs),
      kv.set(RUNS_TS_KEY, newLastTs),
    ]);

    res.json(runs);
  } catch (e) {
    console.error("Activities failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
