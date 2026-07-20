// Route generation: build a runnable street graph from OpenStreetMap, mark
// which edges past runs already covered, then search for a loop from the
// start point that maximizes never-run streets at the requested distance.

import polylineDecode from "@mapbox/polyline";

const EARTH_R = 6371000;
export const METERS_PER_MILE = 1609.34;

export function haversine(aLat, aLng, bLat, bLng) {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

/* ── Geocoding (Nominatim search) ─────────────────────────── */

export async function geocodeAddress(query) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
    encodeURIComponent(query);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Address lookup failed — try again in a moment");
  const data = await res.json();
  if (!data.length) {
    throw new Error("Address not found — try adding a city or zip code");
  }
  return { lat: +data[0].lat, lng: +data[0].lon, label: data[0].display_name };
}

/* ── Street network (Overpass API) ────────────────────────── */

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Runnable ways only — no motorways, no parking-lot service roads, and no
// sidewalk footways (they duplicate the street they run beside). Crossings
// stay: they stitch plazas and park paths onto the street grid.
const HIGHWAY_RE =
  "^(residential|unclassified|tertiary|secondary|primary|living_street|pedestrian|footway|path|cycleway|track)$";

export async function fetchRoadGraph(lat, lng, radiusM) {
  const query = `[out:json][timeout:40];
way(around:${Math.round(radiusM)},${lat},${lng})
  ["highway"~"${HIGHWAY_RE}"]
  ["footway"!~"^sidewalk$"]
  ["access"!~"^(private|no)$"];
out geom;`;

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) {
    throw new Error("Street network service is busy — try again in a minute");
  }
  const data = await res.json();

  const nodes = new Map(); // id -> [lat, lng]
  const adj = new Map(); // id -> [{ to, len, key, novel }]

  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const addDirected = (from, to, len, key) => {
    let list = adj.get(from);
    if (!list) adj.set(from, (list = []));
    if (!list.some((e) => e.key === key)) {
      list.push({ to, len, key, novel: true });
    }
  };

  for (const el of data.elements ?? []) {
    if (el.type !== "way" || !el.geometry || !el.nodes) continue;
    for (let i = 0; i < el.nodes.length; i++) {
      const g = el.geometry[i];
      if (g && !nodes.has(el.nodes[i])) nodes.set(el.nodes[i], [g.lat, g.lon]);
    }
    for (let i = 1; i < el.nodes.length; i++) {
      const a = el.nodes[i - 1];
      const b = el.nodes[i];
      const pa = nodes.get(a);
      const pb = nodes.get(b);
      if (!pa || !pb || a === b) continue;
      const len = haversine(pa[0], pa[1], pb[0], pb[1]);
      if (len < 0.5) continue;
      const key = edgeKey(a, b);
      addDirected(a, b, len, key);
      addDirected(b, a, len, key);
    }
  }

  if (!adj.size) {
    throw new Error("No runnable streets found near that address");
  }
  const graph = { nodes, adj };
  connectComponents(graph);
  return graph;
}

// OSM pedestrian data is fragmented: park paths, plazas, and trail networks
// often don't share nodes with the street grid. Attach every fragment that
// sits within a short hop of the main component via a virtual connector
// edge, and drop whatever remains unreachable so routes never start or get
// stuck on an island.
const CONNECT_MAX_M = 80;

function connectComponents(graph) {
  const { nodes, adj } = graph;

  // Label connected components
  const comp = new Map();
  const compSizes = [];
  for (const id of adj.keys()) {
    if (comp.has(id)) continue;
    const idx = compSizes.length;
    let size = 0;
    const stack = [id];
    comp.set(id, idx);
    while (stack.length) {
      const u = stack.pop();
      size++;
      for (const e of adj.get(u) ?? []) {
        if (!comp.has(e.to)) {
          comp.set(e.to, idx);
          stack.push(e.to);
        }
      }
    }
    compSizes.push(size);
  }
  if (compSizes.length <= 1) return;

  const mainIdx = compSizes.indexOf(Math.max(...compSizes));

  // Spatial buckets of main-component nodes for nearest-neighbor lookups
  const BDEG = 0.001; // ~110m
  const buckets = new Map();
  for (const [id, c] of comp) {
    if (c !== mainIdx) continue;
    const [lat, lng] = nodes.get(id);
    const k = `${Math.round(lat / BDEG)},${Math.round(lng / BDEG)}`;
    let arr = buckets.get(k);
    if (!arr) buckets.set(k, (arr = []));
    arr.push(id);
  }

  // For each fragment, find its closest approach to the main component
  const bestByComp = new Map(); // compIdx -> { d, from, to }
  for (const [id, c] of comp) {
    if (c === mainIdx) continue;
    const [lat, lng] = nodes.get(id);
    const ci = Math.round(lat / BDEG);
    const cj = Math.round(lng / BDEG);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const mainId of buckets.get(`${ci + di},${cj + dj}`) ?? []) {
          const [mLat, mLng] = nodes.get(mainId);
          const d = haversine(lat, lng, mLat, mLng);
          const best = bestByComp.get(c);
          if (d <= CONNECT_MAX_M && (!best || d < best.d)) {
            bestByComp.set(c, { d, from: id, to: mainId });
          }
        }
      }
    }
  }

  // Add virtual connector edges (never counted as novel ground)
  for (const { d, from, to } of bestByComp.values()) {
    const key = `x${from}|${to}`;
    const len = Math.max(d, 1);
    adj.get(from).push({ to, len, key, novel: false, connector: true });
    adj.get(to).push({ to: from, len, key, novel: false, connector: true });
  }

  // Keep only what's now reachable from the main component
  const keep = new Set();
  const seedId = comp.keys().next() && [...comp.entries()].find(([, c]) => c === mainIdx)[0];
  const stack = [seedId];
  keep.add(seedId);
  while (stack.length) {
    const u = stack.pop();
    for (const e of adj.get(u) ?? []) {
      if (!keep.has(e.to)) {
        keep.add(e.to);
        stack.push(e.to);
      }
    }
  }
  for (const id of [...adj.keys()]) {
    if (!keep.has(id)) {
      adj.delete(id);
      nodes.delete(id);
    }
  }
}

export function nearestNode(graph, lat, lng) {
  let bestId = null;
  let bestD = Infinity;
  for (const [id, [nLat, nLng]] of graph.nodes) {
    if (!graph.adj.has(id)) continue;
    const d = haversine(lat, lng, nLat, nLng);
    if (d < bestD) {
      bestD = d;
      bestId = id;
    }
  }
  if (bestId === null || bestD > 800) {
    throw new Error("Couldn't find a runnable street near that address");
  }
  return bestId;
}

/* ── Coverage: which streets have past runs already touched ── */

const BUCKET_DEG = 0.0006; // ~60m buckets for the spatial hash
const COVER_DIST_M = 35; // a street point within 35m of a past run counts as run
const SAMPLE_STEP_M = 25;

const bucketOf = (lat, lng) =>
  `${Math.round(lat / BUCKET_DEG)},${Math.round(lng / BUCKET_DEG)}`;

// Spatial hash of every point along every past run (interpolated so sparse
// polyline points still cover the street between them), clipped to bounds.
export function buildCoverage(runs, bounds) {
  const buckets = new Map();
  const add = (lat, lng) => {
    if (
      lat < bounds.minLat || lat > bounds.maxLat ||
      lng < bounds.minLng || lng > bounds.maxLng
    ) {
      return;
    }
    const k = bucketOf(lat, lng);
    let arr = buckets.get(k);
    if (!arr) buckets.set(k, (arr = []));
    arr.push([lat, lng]);
  };

  for (const run of runs) {
    if (!run.polyline) continue;
    let coords;
    try {
      coords = polylineDecode.decode(run.polyline);
    } catch {
      continue;
    }
    for (let i = 0; i < coords.length; i++) {
      const [lat, lng] = coords[i];
      add(lat, lng);
      if (i > 0) {
        const [pLat, pLng] = coords[i - 1];
        const steps = Math.floor(haversine(pLat, pLng, lat, lng) / SAMPLE_STEP_M);
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          add(pLat + (lat - pLat) * t, pLng + (lng - pLng) * t);
        }
      }
    }
  }
  return buckets;
}

function isCovered(buckets, lat, lng) {
  const ci = Math.round(lat / BUCKET_DEG);
  const cj = Math.round(lng / BUCKET_DEG);
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const arr = buckets.get(`${ci + di},${cj + dj}`);
      if (!arr) continue;
      for (const [pLat, pLng] of arr) {
        if (haversine(lat, lng, pLat, pLng) < COVER_DIST_M) return true;
      }
    }
  }
  return false;
}

// Mark every edge novel (never run) or not; returns share of network still new
export function markNovelty(graph, buckets) {
  const novelByKey = new Map();
  let novelLen = 0;
  let totalLen = 0;

  for (const [id, edges] of graph.adj) {
    const pa = graph.nodes.get(id);
    for (const e of edges) {
      if (e.connector) {
        e.novel = false;
        continue;
      }
      let novel = novelByKey.get(e.key);
      if (novel === undefined) {
        const pb = graph.nodes.get(e.to);
        const n = Math.max(2, Math.ceil(e.len / SAMPLE_STEP_M) + 1);
        let covered = 0;
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          if (
            isCovered(
              buckets,
              pa[0] + (pb[0] - pa[0]) * t,
              pa[1] + (pb[1] - pa[1]) * t
            )
          ) {
            covered++;
          }
        }
        novel = covered / n < 0.5;
        novelByKey.set(e.key, novel);
        totalLen += e.len;
        if (novel) novelLen += e.len;
      }
      e.novel = novel;
    }
  }
  return totalLen ? novelLen / totalLen : 1;
}

/* ── Shortest paths home (Dijkstra with a binary heap) ────── */

function dijkstra(graph, source) {
  const dist = new Map([[source, 0]]);
  const prev = new Map();
  const heap = [[0, source]];

  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  while (heap.length) {
    const [d, u] = pop();
    if (d > (dist.get(u) ?? Infinity)) continue;
    for (const e of graph.adj.get(u) ?? []) {
      const nd = d + e.len;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, u);
        push([nd, e.to]);
      }
    }
  }
  return { dist, prev };
}

/* ── Route search ─────────────────────────────────────────── */

function findEdge(graph, from, to) {
  for (const e of graph.adj.get(from) ?? []) {
    if (e.to === to) return e;
  }
  return null;
}

// One biased random walk: wander favoring never-run streets, then take the
// shortest path home once the remaining budget just covers the trip back.
function randomWalkRoute(graph, startId, targetM, distHome, prev) {
  let cur = startId;
  let cameFrom = null;
  let total = 0;
  const path = [startId];
  const useCount = new Map();

  for (let step = 0; step < 5000; step++) {
    if (total + (distHome.get(cur) ?? Infinity) >= targetM) break;

    let cands = (graph.adj.get(cur) ?? []).filter(
      (e) => e.to !== cameFrom && distHome.has(e.to)
    );
    if (!cands.length) {
      cands = (graph.adj.get(cur) ?? []).filter((e) => distHome.has(e.to));
    }
    if (!cands.length) break;

    let sum = 0;
    const weights = cands.map((e) => {
      const used = useCount.get(e.key) ?? 0;
      let w = (e.novel ? 8 : 1) / (1 + 3 * used);
      // discourage wandering past the point of no return
      if (total + e.len + (distHome.get(e.to) ?? Infinity) > targetM * 1.12) {
        w *= 0.05;
      }
      sum += w;
      return w;
    });

    let pick = Math.random() * sum;
    let idx = 0;
    while (idx < weights.length - 1 && pick >= weights[idx]) {
      pick -= weights[idx];
      idx++;
    }

    const e = cands[idx];
    useCount.set(e.key, (useCount.get(e.key) ?? 0) + 1);
    total += e.len;
    cameFrom = cur;
    cur = e.to;
    path.push(cur);
  }

  // Shortest path back to the start
  for (let n = cur; n !== startId; ) {
    const p = prev.get(n);
    if (p === undefined) return null;
    path.push(p);
    n = p;
  }

  // Score: share of unique never-run street length, penalized by distance miss
  const coords = [];
  const segs = [];
  const novelSeen = new Set();
  let novelM = 0;
  let totalM = 0;

  for (let i = 0; i < path.length; i++) {
    const pt = graph.nodes.get(path[i]);
    coords.push(pt);
    if (i === 0) continue;
    const e = findEdge(graph, path[i - 1], path[i]);
    if (!e) return null;
    totalM += e.len;
    if (e.novel && !novelSeen.has(e.key)) {
      novelSeen.add(e.key);
      novelM += e.len;
    }
    const last = segs[segs.length - 1];
    if (last && last.novel === e.novel) {
      last.coords.push(pt);
    } else {
      segs.push({ novel: e.novel, coords: [graph.nodes.get(path[i - 1]), pt] });
    }
  }

  const miss = Math.abs(totalM - targetM) / targetM;
  if (totalM < 100 || miss > 0.25) return null;
  return { coords, segs, totalM, novelM, score: novelM / totalM - miss * 1.2 };
}

export function generateRoute(graph, startId, targetM, timeBudgetMs = 1600) {
  const { dist: distHome, prev } = dijkstra(graph, startId);
  const deadline = Date.now() + timeBudgetMs;
  let best = null;

  do {
    const r = randomWalkRoute(graph, startId, targetM, distHome, prev);
    if (r && (!best || r.score > best.score)) best = r;
  } while (Date.now() < deadline);

  if (!best) {
    throw new Error(
      "Couldn't build a loop of that length from there — try a different distance or start point"
    );
  }
  return best;
}

/* ── GPX export ───────────────────────────────────────────── */

export function toGPX(coords, name = "Generated Run") {
  const pts = coords
    .map(([lat, lng]) => `<trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"/>`)
    .join("\n      ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RunTracker" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
      ${pts}
    </trkseg>
  </trk>
</gpx>`;
}
