import axios from "axios";

export const config = { maxDuration: 60 };

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocodeBatch(coords) {
  const result = {};
  const BATCH = 5;
  for (let i = 0; i < coords.length; i += BATCH) {
    const batch = coords.slice(i, i + BATCH);
    const settled = await Promise.all(
      batch.map(async (key) => {
        const [lat, lng] = key.split(",").map(Number);
        return { key, geo: await reverseGeocode(lat, lng) };
      })
    );
    settled.forEach(({ key, geo }) => { result[key] = geo; });
    if (i + BATCH < coords.length) await sleep(500);
  }
  return result;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { coords } = req.body ?? {};
  if (!Array.isArray(coords) || !coords.length) return res.json({});

  const kv = await getKV();

  if (kv) {
    // Check cache for all coords in one round-trip
    const cached = await kv.mget(...coords.map((c) => `geo:${c}`));
    const result = {};
    const toGeocode = [];

    coords.forEach((coord, i) => {
      if (cached[i]) result[coord] = cached[i];
      else toGeocode.push(coord);
    });

    if (toGeocode.length) {
      const fresh = await geocodeBatch(toGeocode);
      // Cache new results (no TTL — locations don't change)
      await Promise.all(
        Object.entries(fresh).map(([key, geo]) => kv.set(`geo:${key}`, geo))
      );
      Object.assign(result, fresh);
    }

    return res.json(result);
  }

  // No KV — geocode everything directly
  res.json(await geocodeBatch(coords));
}
