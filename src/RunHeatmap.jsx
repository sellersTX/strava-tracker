import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import polylineDecode from "@mapbox/polyline";
import "leaflet/dist/leaflet.css";

// 3 decimal places ≈ 111m — good precision for "same street"
const snap = (n) => Math.round(n * 1000);

// Count how many unique runs pass through each snapped coordinate
function buildFrequencyMap(runs) {
  const freq = {};
  for (const run of runs) {
    if (!run.polyline) continue;
    try {
      const coords = polylineDecode.decode(run.polyline);
      const seen = new Set();
      for (const [lat, lng] of coords) {
        const key = `${snap(lat)},${snap(lng)}`;
        if (!seen.has(key)) {
          freq[key] = (freq[key] || 0) + 1;
          seen.add(key);
        }
      }
    } catch {}
  }
  return freq;
}

function getColor(f) {
  if (f >= 20) return "red";
  if (f >= 5)  return "orange";
  return "yellow";
}

// Split a single run's decoded coords into contiguous segments by color
function toColoredSegments(coords, freq) {
  const yellow = [], orange = [], red = [];

  const push = (color, seg) => {
    if (seg.length < 2) return;
    if (color === "red")    red.push(seg);
    else if (color === "orange") orange.push(seg);
    else yellow.push(seg);
  };

  let currentColor = null;
  let currentSeg = [];

  for (let i = 0; i < coords.length; i++) {
    const [lat, lng] = coords[i];
    const key = `${snap(lat)},${snap(lng)}`;
    const color = getColor(freq[key] || 1);

    if (i === 0) {
      currentColor = color;
      currentSeg = [[lat, lng]];
    } else if (color !== currentColor) {
      currentSeg.push([lat, lng]); // overlap point for continuity
      push(currentColor, currentSeg);
      currentSeg = [[lat, lng]];   // new segment starts from same point
      currentColor = color;
    } else {
      currentSeg.push([lat, lng]);
    }
  }
  push(currentColor, currentSeg);

  return { yellow, orange, red };
}

function RouteLayer({ runs }) {
  const map = useMap();

  useEffect(() => {
    let mounted = true;

    import("leaflet").then(({ default: L }) => {
      if (!mounted) return;

      const freq = buildFrequencyMap(runs);

      const allYellow = [], allOrange = [], allRed = [];

      for (const run of runs) {
        if (!run.polyline) continue;
        try {
          const coords = polylineDecode.decode(run.polyline);
          const { yellow, orange, red } = toColoredSegments(coords, freq);
          allYellow.push(...yellow);
          allOrange.push(...orange);
          allRed.push(...red);
        } catch {}
      }

      // One canvas renderer for all layers = maximum performance
      const renderer = L.canvas({ padding: 0.5 });

      // Draw yellow first, orange on top, red on top of that
      const layers = [
        L.polyline(allYellow, { renderer, color: "#FFD700", weight: 1.8, opacity: 0.75 }),
        L.polyline(allOrange, { renderer, color: "#FF8C00", weight: 2.2, opacity: 0.9 }),
        L.polyline(allRed,    { renderer, color: "#FF2200", weight: 2.8, opacity: 1.0 }),
      ].map((l) => l.addTo(map));

      return () => layers.forEach((l) => l.remove());
    });

    return () => { mounted = false; };
  }, [map, runs]);

  return null;
}

export default function RunHeatmap({ runs }) {
  const center = useMemo(() => {
    for (let i = runs.length - 1; i >= 0; i--) {
      if (runs[i].latlng) return runs[i].latlng;
    }
    return [20, 0];
  }, [runs]);

  const routeCount = runs.filter((r) => r.polyline).length;

  return (
    <div className="chart-card">
      <div className="chart-header">
        <div>
          <div className="chart-title">Run Map</div>
          <div className="chart-hint">
            Every route you've ever run &nbsp;·&nbsp;
            <span style={{ color: "#FFD700" }}>■</span> 1–4×&nbsp;
            <span style={{ color: "#FF8C00" }}>■</span> 5–19×&nbsp;
            <span style={{ color: "#FF2200" }}>■</span> 20×+
          </div>
        </div>
        <div className="chart-range">{routeCount} routes</div>
      </div>
      <div className="map-wrap">
        <MapContainer
          center={center}
          zoom={12}
          scrollWheelZoom={true}
          style={{ height: "100%", width: "100%", background: "#0d0d0d" }}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>'
            subdomains="abcd"
            maxZoom={19}
          />
          <RouteLayer runs={runs} />
        </MapContainer>
      </div>
    </div>
  );
}
