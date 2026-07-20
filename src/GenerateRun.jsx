import { useEffect, useRef, useState } from "react";
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

export default function GenerateRun({ runs }) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [miles, setMiles] = useState("4");
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const cacheRef = useRef(null); // reuse graph/coverage between shuffles

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
        setStatus("Finding address…");
        await paint();
        const loc = await geocodeAddress(address);

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
                <input
                  className="gen-input gen-input--address"
                  placeholder="Start address (e.g. 411 Main St, Houston TX)"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
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
