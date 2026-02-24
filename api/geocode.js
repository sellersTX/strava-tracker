import axios from "axios";

export const config = { maxDuration: 60 };

// Accepts POST { coords: ["40.7,-74.0", "42.4,-71.1", ...] }
// Returns      { "40.7,-74.0": { city, country }, ... }

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
  if (!Array.isArray(coords) || !coords.length) {
    return res.json({});
  }

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

  res.json(result);
}
