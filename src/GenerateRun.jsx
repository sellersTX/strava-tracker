import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import polylineDecode from "@mapbox/polyline";
import {
  METERS_PER_MILE,
  geocodeAddress,
  fetchRoadGraph,
  buildCoverage,
  markNovelty,
  nearestNode,
  generateRoute,
  toGPX,
} from "./lib/routeGen";

const ORANGE = "#FC4C02";
const BLUE = "#4FA3FF";

function FitRoute({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (coords?.length) {
      map.invalidateSize();
      map.fitBounds(coords, { padding: [30, 30] });
    }
  }, [map, coords]);
  return null;
}

// Past runs near the generated route, for visual context
function pastRunsInBounds(runs, bounds) {
  const lines = [];
  for (const run of runs) {
    if (!run.polyline) continue;
    try {
      const coords = polylineDecode.decode(run.polyline);
      const hit = coords.some(
        ([lat, lng]) =>
          lat > bounds.minLat && lat < bounds.maxLat &&
          lng > bounds.minLng && lng < bounds.maxLng
      );
      if (hit) lines.push(coords);
    } catch {
      continue;
    }
  }
  return lines;
}

const paint = () => new Promise((r) => setTimeout(r, 30));

// Photon (OSM-based, built for search-as-you-type; Nominatim forbids autocomplete)
async function fetchSuggestions(query, bias, signal) {
  const biasParam = bias ? `&lat=${bias[0]}&lon=${bias[1]}` : "";
  const res = await fetch(
    `https://photon.komoot.io/api/?limit=5&q=${encodeURIComponent(query)}${biasParam}`,
    { signal }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const seen = new Set();
  const items = [];
  for (const f of data.features ?? []) {
    const p = f.properties ?? {};
    const main =
      (p.housenumber && p.street ? `${p.housenumber} ${p.street}` : null) ??
      p.name ??
      p.street ??
      "";
    const rest = [p.city, p.state, p.country]
      .filter((v) => v && v !== main)
      .join(", ");
    const label = [main, rest].filter(Boolean).join(", ");
    if (!label || seen.has(label)) continue;
    seen.add(label);
    items.push({
      main: main || rest,
      rest: main ? rest : "",
      label,
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
    });
  }
  return items;
}

export default function GenerateRun({ runs }) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [miles, setMiles] = useState("4");
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const cacheRef = useRef(null); // reuse graph/coverage between shuffles

  const [sugs, setSugs] = useState([]);
  const [sugOpen, setSugOpen] = useState(false);
  const [sugIdx, setSugIdx] = useState(-1);
  const pickedRef = useRef(null); // { text, lat, lng } from a chosen suggestion
  const debounceRef = useRef(null);
  const abortRef = useRef(null);

  // Bias suggestions toward the most recent run's start point
  const biasLatLng = useMemo(() => {
    for (let i = runs.length - 1; i >= 0; i--) {
      if (runs[i].latlng) return runs[i].latlng;
    }
    return null;
  }, [runs]);

  function closeSugs() {
    setSugOpen(false);
    setSugIdx(-1);
  }

  function onAddressChange(e) {
    const value = e.target.value;
    setAddress(value);
    pickedRef.current = null;
    clearTimeout(debounceRef.current);
    if (value.trim().length < 3) {
      setSugs([]);
      closeSugs();
      return;
    }
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const items = await fetchSuggestions(value, biasLatLng, ctrl.signal);
        setSugs(items);
        setSugOpen(items.length > 0);
        setSugIdx(-1);
      } catch {
        // aborted by newer keystroke, or offline — just skip suggestions
      }
    }, 300);
  }

  function pickSug(s) {
    setAddress(s.label);
    pickedRef.current = { text: s.label, lat: s.lat, lng: s.lng };
    setSugs([]);
    closeSugs();
  }

  function onAddressKeyDown(e) {
    if (!sugOpen || !sugs.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSugIdx((i) => (i + 1) % sugs.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSugIdx((i) => (i <= 0 ? sugs.length - 1 : i - 1));
    } else if (e.key === "Enter" && sugIdx >= 0) {
      e.preventDefault();
      pickSug(sugs[sugIdx]);
    } else if (e.key === "Escape") {
      // just dismiss the dropdown — don't let the drawer's handler close it
      e.stopPropagation();
      closeSugs();
    }
  }

  // Lock page scroll and close on Escape while the panel is open
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleGenerate(shuffle) {
    const milesNum = Number(miles);
    if (!address.trim()) {
      setError("Enter a start address");
      return;
    }
    if (!(milesNum >= 1 && milesNum <= 20)) {
      setError("Distance must be between 1 and 20 miles");
      return;
    }
    setError(null);

    const targetM = milesNum * METERS_PER_MILE;
    const cacheKey = `${address.trim().toLowerCase()}|${milesNum}`;

    try {
      let ctx = cacheRef.current;
      if (!shuffle || ctx?.key !== cacheKey) {
        // A chosen suggestion already carries coordinates — no geocode needed
        const picked = pickedRef.current;
        let loc;
        if (picked && picked.text === address) {
          loc = { lat: picked.lat, lng: picked.lng };
        } else {
          setStatus("Finding address…");
          await paint();
          loc = await geocodeAddress(address);
        }

        setStatus("Loading nearby streets…");
        await paint();
        const radiusM = Math.min(4000, Math.max(900, targetM * 0.4));
        const graph = await fetchRoadGraph(loc.lat, loc.lng, radiusM);

        setStatus("Checking which streets you've already run…");
        await paint();
        const latPad = (radiusM * 1.2) / 111000;
        const lngPad = latPad / Math.cos((loc.lat * Math.PI) / 180);
        const bounds = {
          minLat: loc.lat - latPad,
          maxLat: loc.lat + latPad,
          minLng: loc.lng - lngPad,
          maxLng: loc.lng + lngPad,
        };
        const coverage = buildCoverage(runs, bounds);
        const newShare = markNovelty(graph, coverage);
        const startId = nearestNode(graph, loc.lat, loc.lng);
        ctx = { key: cacheKey, graph, startId, loc, bounds, newShare };
        cacheRef.current = ctx;
      }

      setStatus("Building your route…");
      await paint();
      const route = generateRoute(ctx.graph, ctx.startId, targetM);
      setResult({
        route,
        loc: ctx.loc,
        newShare: ctx.newShare,
        past: pastRunsInBounds(runs, ctx.bounds),
      });
      setStatus(null);
    } catch (e) {
      setStatus(null);
      setResult(null);
      setError(e.message);
    }
  }

  function downloadGPX() {
    if (!result) return;
    const totalMi = (result.route.totalM / METERS_PER_MILE).toFixed(1);
    const gpx = toGPX(result.route.coords, `Generated run — ${totalMi} mi`);
    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `generated-run-${totalMi}mi.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const route = result?.route;
  const totalMi = route ? route.totalM / METERS_PER_MILE : 0;
  const novelMi = route ? route.novelM / METERS_PER_MILE : 0;
  const pctNew = route ? Math.round((route.novelM / route.totalM) * 100) : 0;
  const novelSegs = route ? route.segs.filter((s) => s.novel).map((s) => s.coords) : [];
  const repeatSegs = route ? route.segs.filter((s) => !s.novel).map((s) => s.coords) : [];

  return (
    <>
      {!open && (
        <button
          className="gen-tab"
          onClick={() => setOpen(true)}
          aria-label="Open the run generator"
        >
          Generate a Run
        </button>
      )}

      {open && (
        <>
          <div className="gen-backdrop" onClick={() => setOpen(false)} />
          <aside className="gen-drawer">
            <div className="gen-drawer-head">
              <div>
                <div className="chart-title">Generate a Run</div>
                <div className="chart-hint">
                  Routes that favor streets you've never run &nbsp;·&nbsp;
                  <span style={{ color: ORANGE }}>■</span> new ground&nbsp;
                  <span style={{ color: BLUE }}>■</span> already run
                </div>
              </div>
              <button
                className="gen-close"
                onClick={() => setOpen(false)}
                aria-label="Close the run generator"
              >
                ×
              </button>
            </div>

            <div className="gen-drawer-body">
              <form
                className="gen-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleGenerate(false);
                }}
              >
                <div className="gen-addr">
                  <input
                    className="gen-input gen-input--address"
                    placeholder="Start address (e.g. 411 Main St, Houston TX)"
                    value={address}
                    onChange={onAddressChange}
                    onKeyDown={onAddressKeyDown}
                    onBlur={() => setTimeout(closeSugs, 150)}
                    autoComplete="off"
                  />
                  {sugOpen && sugs.length > 0 && (
                    <div className="gen-sug">
                      {sugs.map((s, i) => (
                        <div
                          key={s.label}
                          className={`gen-sug-item ${i === sugIdx ? "gen-sug-item--active" : ""}`}
                          onMouseDown={(e) => {
                            e.preventDefault(); // keep input focus so blur doesn't race the pick
                            pickSug(s);
                          }}
                          onMouseEnter={() => setSugIdx(i)}
                        >
                          <div className="gen-sug-main">{s.main}</div>
                          {s.rest && <div className="gen-sug-rest">{s.rest}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="gen-miles">
                  <input
                    className="gen-input gen-input--miles"
                    type="number"
                    min="1"
                    max="20"
                    step="0.5"
                    value={miles}
                    onChange={(e) => setMiles(e.target.value)}
                  />
                  <span className="gen-unit">mi</span>
                </div>
                <button className="gen-btn" type="submit" disabled={!!status}>
                  Generate
                </button>
              </form>

              {status && (
                <div className="gen-status">
                  <div className="spinner spinner--sm" />
                  {status}
                </div>
              )}
              {error && <div className="gen-error">{error}</div>}

              {result && (
                <>
                  <div className="gen-stats">
                    <div className="gen-stat">
                      <div className="gen-stat-value">{totalMi.toFixed(1)}</div>
                      <div className="gen-stat-label">total miles</div>
                    </div>
                    <div className="gen-stat">
                      <div className="gen-stat-value">{novelMi.toFixed(1)}</div>
                      <div className="gen-stat-label">new-street miles</div>
                    </div>
                    <div className="gen-stat">
                      <div className="gen-stat-value">{pctNew}%</div>
                      <div className="gen-stat-label">new ground</div>
                    </div>
                  </div>

                  <div className="map-wrap map-wrap--drawer">
                    <MapContainer
                      preferCanvas
                      center={[result.loc.lat, result.loc.lng]}
                      zoom={14}
                      scrollWheelZoom={true}
                      style={{ height: "100%", width: "100%", background: "#0d0d0d" }}
                    >
                      <TileLayer
                        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                        attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>'
                        subdomains="abcd"
                        maxZoom={19}
                      />
                      {result.past.length > 0 && (
                        <Polyline
                          positions={result.past}
                          pathOptions={{ color: "#555", weight: 1.4, opacity: 0.45 }}
                        />
                      )}
                      {repeatSegs.length > 0 && (
                        <Polyline
                          positions={repeatSegs}
                          pathOptions={{ color: BLUE, weight: 4, opacity: 0.9 }}
                        />
                      )}
                      {novelSegs.length > 0 && (
                        <Polyline
                          positions={novelSegs}
                          pathOptions={{ color: ORANGE, weight: 4, opacity: 0.95 }}
                        />
                      )}
                      <CircleMarker
                        center={[result.loc.lat, result.loc.lng]}
                        radius={7}
                        pathOptions={{ color: "#fff", weight: 2, fillColor: "#4caf50", fillOpacity: 1 }}
                      />
                      <FitRoute coords={route.coords} />
                    </MapContainer>
                  </div>

                  <div className="gen-actions">
                    <button
                      className="gen-btn gen-btn--ghost"
                      onClick={() => handleGenerate(true)}
                      disabled={!!status}
                    >
                      ↻ Shuffle
                    </button>
                    <button className="gen-btn gen-btn--ghost" onClick={downloadGPX}>
                      ⤓ Download GPX
                    </button>
                  </div>
                  <div className="gen-note">
                    {Math.round(result.newShare * 100)}% of streets in this area
                    are still unexplored
                  </div>
                </>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
