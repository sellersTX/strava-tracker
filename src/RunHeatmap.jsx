import { useEffect, useRef, useMemo } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import polylineDecode from "@mapbox/polyline";
import "leaflet/dist/leaflet.css";

// Decode all route polylines and sample every 4th point for performance
function buildHeatPoints(runs) {
  const pts = [];
  for (const run of runs) {
    if (!run.polyline) continue;
    try {
      const coords = polylineDecode.decode(run.polyline);
      for (let i = 0; i < coords.length; i += 4) {
        pts.push(coords[i]); // [lat, lng]
      }
    } catch {
      // skip malformed polylines
    }
  }
  return pts;
}

function HeatLayer({ points }) {
  const map = useMap();
  const heatRef = useRef(null);

  useEffect(() => {
    if (!points.length) return;

    let cancelled = false;
    Promise.all([
      import("leaflet"),
      import("leaflet.heat"),
    ]).then(([{ default: L }]) => {
      if (cancelled) return;
      if (heatRef.current) {
        heatRef.current.remove();
      }
      heatRef.current = L.heatLayer(points, {
        radius: 6,
        blur: 10,
        maxZoom: 18,
        max: 1,
        gradient: { 0.3: "#FC4C02", 0.7: "#FF8C00", 1.0: "#FFE0CC" },
      }).addTo(map);
    });

    return () => {
      cancelled = true;
      if (heatRef.current) {
        heatRef.current.remove();
        heatRef.current = null;
      }
    };
  }, [map, points]);

  return null;
}

export default function RunHeatmap({ runs }) {
  const points = useMemo(() => buildHeatPoints(runs), [runs]);

  // Compute a sensible initial center from the most recent run
  const center = useMemo(() => {
    for (let i = runs.length - 1; i >= 0; i--) {
      if (runs[i].latlng) return runs[i].latlng;
    }
    return [20, 0];
  }, [runs]);

  return (
    <div className="chart-card">
      <div className="chart-header">
        <div>
          <div className="chart-title">Run Heatmap</div>
          <div className="chart-hint">Every route you've ever run · scroll to zoom</div>
        </div>
        <div className="chart-range">{points.toLocaleString()} points</div>
      </div>
      <div className="map-wrap">
        <MapContainer
          center={center}
          zoom={11}
          scrollWheelZoom={true}
          style={{ height: "100%", width: "100%", background: "#0d0d0d" }}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>'
            subdomains="abcd"
            maxZoom={19}
          />
          <HeatLayer points={points} />
        </MapContainer>
      </div>
    </div>
  );
}
