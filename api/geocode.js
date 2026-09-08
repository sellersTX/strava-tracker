import axios from "axios";
import { getCache } from "./_cache.js";

export const config = { maxDuration: 60 };

// Nominatim's usage policy is max 1 request/second — parallel batches get
// rate-limited into silent failures, so requests must be strictly sequential.
const REQUEST_SPACING_MS = 1100;
// Return before Vercel's 60s maxDuration kills the function; unfinished
// coords are simply omitted and the frontend asks again.
const TIME_BUDGET_MS = 45000;

// v2: the v1 cache was poisoned with null results from rate-limited lookups,
// and mixed local-language country names (e.g. "España") before accept-language.
// v3: cityFromAddress below picks and cleans a different field, so v2 entries
// hold the old admin-unit names and have to be re-resolved.
const CACHE_PREFIX = "geo3:";

// Nominatim's address fields vary a lot by country, and the one literally
// called "city" is often an administrative unit rather than a place anyone
// would name: "Greater London", "Shella ward", "Zvezdara Urban Municipality".
// So try a wider list in rough smallest-meaningful-place order, strip the
// administrative noise, and take the first survivor.
const CITY_FIELDS = [
  "city", "town", "village", "city_district", "hamlet",
  "suburb", "municipality", "county", "province",
];

const ADMIN_NOISE = [
  /^(Greater|Grand)\s+/i, /^City of\s+/i, /^Municipality of\s+/i, /^County\s+/i,
  /\s+(Urban|Rural)?\s*Municipal(ity)?\s*(District)?$/i,
  /\s+Capital City$/i, /\s+ward$/i, /\s+mahalla$/i, /\s+Tehsil$/i,
  /\s+District$/i, /\s+County$/i, /\s+Region$/i, /\s+Province$/i,
  /\s+governorate$/i, /\s+D?ED$/i, /\s+Rural$/i, /\s+Village$/i, /\s+Commune$/i,
];

// We ask Nominatim for English, but some places have no English name and come
// back in the local script. A later field often does have one, so prefer a
// Latin-script candidate and fall back to the first of any script.
const isLatin = (s) => /^[\p{Script=Latin}\p{Script=Common}\p{Mark}]+$/u.test(s);

function cleanPlaceName(value) {
  let name = String(value).trim();
  // Repeat: names like "Tullamore Rural ED" carry two suffixes.
  for (let pass = 0; pass < 3; pass++) {
    for (const re of ADMIN_NOISE) name = name.replace(re, "").trim();
  }
  // Digits mean a survey code, not a place ("Templeogue-Kimmage Manor DED 1986").
  if (name.length < 2 || /\d/.test(name)) return null;
  return name;
}

function cityFromAddress(address) {
  const names = [];
  for (const field of CITY_FIELDS) {
    if (!address[field]) continue;
    const name = cleanPlaceName(address[field]);
    if (name) names.push(name);
  }
  return names.find(isLatin) ?? names[0] ?? null;
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
      city: cityFromAddress(a),
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
  const cache = await getCache();
  const result = {};
  let toGeocode = coords;

  if (cache) {
    const cached = await cache.mget(coords.map((c) => `${CACHE_PREFIX}${c}`));
    toGeocode = [];
    coords.forEach((coord, i) => {
      if (cached[i]?.country) result[coord] = cached[i];
      else toGeocode.push(coord);
    });
  }

  const fresh = await geocodeSequential(toGeocode, deadline);

  if (cache && Object.keys(fresh).length) {
    // No TTL — locations don't change (and failures are never cached)
    await Promise.all(
      Object.entries(fresh).map(([key, geo]) =>
        cache.set(`${CACHE_PREFIX}${key}`, geo)
      )
    );
  }

  Object.assign(result, fresh);
  return res.json(result);
}
