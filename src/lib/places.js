// Saved start points for the run generator: favorites the user stars, and
// recents derived from where past Strava runs actually started.

import { haversine } from "./routeGen";

const FAV_KEY = "gen-favorites-v1";
const LABEL_KEY = "gen-place-labels-v1";

/* ── Favorites (localStorage) ─────────────────────────────── */

// Two stars of the same doorstep shouldn't make two entries — coordinates from
// a geocoder wobble a few meters between lookups.
const SAME_PLACE_M = 120;

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode / quota — favorites just don't persist
  }
}

export function loadFavorites() {
  const list = readJSON(FAV_KEY, []);
  return Array.isArray(list) ? list.filter((f) => f?.label && f.lat && f.lng) : [];
}

export function findFavorite(favorites, point) {
  if (!point) return null;
  return (
    favorites.find(
      (f) => haversine(f.lat, f.lng, point.lat, point.lng) < SAME_PLACE_M
    ) ?? null
  );
}

export function addFavorite(favorites, point) {
  if (findFavorite(favorites, point)) return favorites;
  const next = [
    ...favorites,
    { id: `${Date.now()}`, label: point.label, lat: point.lat, lng: point.lng },
  ];
  writeJSON(FAV_KEY, next);
  return next;
}

export function removeFavorite(favorites, id) {
  const next = favorites.filter((f) => f.id !== id);
  writeJSON(FAV_KEY, next);
  return next;
}

export function renameFavorite(favorites, id, label) {
  const next = favorites.map((f) => (f.id === id ? { ...f, label } : f));
  writeJSON(FAV_KEY, next);
  return next;
}

/* ── Recent run starts ────────────────────────────────────── */

// Distinct enough to be a different "place" to start from — a block or two.
const DISTINCT_M = 600;

// Most recent starts from past runs, skipping any that repeat a place already
// picked. Runs arrive oldest-first.
export function recentStarts(runs, count = 2) {
  const out = [];
  for (let i = runs.length - 1; i >= 0 && out.length < count; i--) {
    const run = runs[i];
    if (!run.latlng) continue;
    const [lat, lng] = run.latlng;
    if (out.some((p) => haversine(p.lat, p.lng, lat, lng) < DISTINCT_M)) continue;
    out.push({ lat, lng, date: run.date });
  }
  return out;
}

/* ── Reverse geocoding for labels ─────────────────────────── */

const coordKey = (lat, lng) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

// Photon again (same source as the search-as-you-type suggestions) — it gives
// street-level names, unlike /api/geocode which only resolves city + country.
export async function reverseLabel(lat, lng) {
  const key = coordKey(lat, lng);
  const cache = readJSON(LABEL_KEY, {});
  if (cache[key]) return cache[key];

  let label = null;
  try {
    const res = await fetch(
      `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1`
    );
    if (res.ok) {
      const data = await res.json();
      const p = data.features?.[0]?.properties;
      if (p) {
        const main =
          (p.housenumber && p.street ? `${p.housenumber} ${p.street}` : null) ??
          p.name ??
          p.street ??
          p.district ??
          p.city ??
          "";
        const rest = [p.city, p.state].filter((v) => v && v !== main).join(", ");
        label = [main, rest].filter(Boolean).join(", ") || null;
      }
    }
  } catch {
    // offline or rate-limited — fall through to coordinates
  }

  if (label) writeJSON(LABEL_KEY, { ...cache, [key]: label });
  return label ?? `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
}
