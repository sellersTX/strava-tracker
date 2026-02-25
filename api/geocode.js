import axios from "axios";
import { kv } from "@vercel/kv";

export const config = { maxDuration: 60 };

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { coords } = req.body ?? {};
  if (!Array.isArray(coords) || !coords.length) return res.json({});

  // Batch-read all coords from cache in one round-trip
  const cacheKeys = coords.map((c) => `geo:${c}`);
  const cached = await kv.mget(...cacheKeys);

  const result = {};
  const toGeocode = [];

  coords.forEach((coord, i) => {
    if (cached[i]) {
      result[coord] = cached[i]; // cache hit
    } else {
      toGeocode.push(coord);     // needs geocoding
    }
  });

  // Geocode only the uncached coords in parallel batches
  const BATCH = 5;
  for (let i = 0; i < toGeocode.length; i += BATCH) {
    const batch = toGeocode.slice(i, i + BATCH);
    const settled = await Promise.all(
      batch.map(async (key) => {
        const [lat, lng] = key.split(",").map(Number);
        return { key, geo: await reverseGeocode(lat, lng) };
      })
    );

    // Store new results in cache (no TTL — locations don't change)
    await Promise.all(
      settled.map(({ key, geo }) => kv.set(`geo:${key}`, geo))
    );
    settled.forEach(({ key, geo }) => { result[key] = geo; });

    if (i + BATCH < toGeocode.length) await sleep(500);
  }

  res.json(result);
}
