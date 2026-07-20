import axios from "axios";

export const config = { maxDuration: 60 };

// Nominatim's usage policy is max 1 request/second — parallel batches get
// rate-limited into silent failures, so requests must be strictly sequential.
const REQUEST_SPACING_MS = 1100;
// Return before Vercel's 60s maxDuration kills the function; unfinished
// coords are simply omitted and the frontend asks again.
const TIME_BUDGET_MS = 45000;

// v2: the v1 cache was poisoned with null results from rate-limited lookups,
// and mixed local-language country names (e.g. "España") before accept-language.
const CACHE_PREFIX = "geo2:";

async function getKV() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  try {
    const { kv } = await import("@vercel/kv");
    return kv;
  } catch {
    return null;
  }
}

async function reverseGeocode(lat, lng) {
  try {
    const { data } = await axios.get(
      "https://nominatim.openstreetmap.org/reverse",
      {
        params: { lat, lon: lng, format: "json", "accept-language": "en" },
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocodeSequential(coords, deadline) {
  const result = {};
  for (const key of coords) {
    if (Date.now() > deadline) break;
    const started = Date.now();
    const [lat, lng] = key.split(",").map(Number);
    const geo = await reverseGeocode(lat, lng);
    // A null country means the lookup failed (rate limit, timeout) — leave it
    // out of the result so it's never cached and gets retried later.
    if (geo.country) result[key] = geo;
    const elapsed = Date.now() - started;
    if (elapsed < REQUEST_SPACING_MS) await sleep(REQUEST_SPACING_MS - elapsed);
  }
  return result;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { coords } = req.body ?? {};
  if (!Array.isArray(coords) || !coords.length) return res.json({});

  const deadline = Date.now() + TIME_BUDGET_MS;
  const kv = await getKV();
  const result = {};
  let toGeocode = coords;

  if (kv) {
    const cached = await kv.mget(...coords.map((c) => `${CACHE_PREFIX}${c}`));
    toGeocode = [];
    coords.forEach((coord, i) => {
      if (cached[i]?.country) result[coord] = cached[i];
      else toGeocode.push(coord);
    });
  }

  const fresh = await geocodeSequential(toGeocode, deadline);

  if (kv && Object.keys(fresh).length) {
    // No TTL — locations don't change (and failures are never cached)
    await Promise.all(
      Object.entries(fresh).map(([key, geo]) =>
        kv.set(`${CACHE_PREFIX}${key}`, geo)
      )
    );
  }

  Object.assign(result, fresh);
  return res.json(result);
}
