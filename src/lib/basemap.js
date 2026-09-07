// Dark basemap config, shared by the heatmap and the run generator.
//
// CARTO began enforcing API keys on basemaps.cartocdn.com in Aug 2026 —
// unkeyed tiles still return 200 but come back stamped "API KEY REQUIRED".
// Keys are free (carto.com/basemaps/apikey, no account, 5M tiles/month) and
// are meant to be public, so the build inlines VITE_CARTO_KEY.
//
// Without a key we fall back to plain OSM tiles, which are keyless and
// unwatermarked but light; `className` inverts them in CSS so the routes
// drawn on top still read against a dark map.

const cartoKey = import.meta.env.VITE_CARTO_KEY;

export const basemap = cartoKey
  ? {
      url: `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=${cartoKey}`,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>',
      maxZoom: 19,
      className: "",
    }
  : {
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      className: "basemap-tiles--inverted",
    };
