import { useState, useMemo, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { generateFakeData } from "./data/fakeRuns";
import "./App.css";

const STRAVA_ORANGE = "#FC4C02";
const data = generateFakeData();

function formatMiles(n) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="tooltip">
      <div className="tooltip-date">{d.label}</div>
      <div className="tooltip-row">
        <span className="tooltip-label">This month</span>
        <span className="tooltip-value">{formatMiles(d.monthly)} mi</span>
      </div>
      <div className="tooltip-row">
        <span className="tooltip-label">Total</span>
        <span className="tooltip-value orange">{formatMiles(d.cumulative)} mi</span>
      </div>
    </div>
  );
}

function CustomCursor({ points, height }) {
  if (!points?.length) return null;
  const { x } = points[0];
  return (
    <line
      x1={x} y1={0} x2={x} y2={height}
      stroke={STRAVA_ORANGE}
      strokeWidth={1.5}
      strokeDasharray="4 3"
      opacity={0.7}
    />
  );
}

export default function App() {
  const [hovered, setHovered] = useState(null);

  const totalMiles = data[data.length - 1].cumulative;
  const displayMiles = hovered !== null ? hovered : totalMiles;
  const isHovering = hovered !== null;

  const firstYear = data[0].date.slice(0, 4);
  const lastYear = data[data.length - 1].date.slice(0, 4);
  const yearsRunning = Number(lastYear) - Number(firstYear) + 1;

  const avgMonthly = useMemo(() => {
    const total = data.reduce((s, d) => s + d.monthly, 0);
    return Math.round(total / data.length);
  }, []);

  const bestMonth = useMemo(() => {
    return data.reduce((best, d) => (d.monthly > best.monthly ? d : best), data[0]);
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (e?.activePayload?.length) {
      setHovered(e.activePayload[0].payload.cumulative);
    }
  }, []);

  const handleMouseLeave = useCallback(() => setHovered(null), []);

  const tickFormatter = (val) => {
    if (val.endsWith("-01")) return val.slice(0, 4);
    return "";
  };

  const intPart = Math.floor(displayMiles);
  const decPart = Math.round((displayMiles % 1) * 10);

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <svg width="26" height="26" viewBox="0 0 24 24" fill={STRAVA_ORANGE}>
            <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
          </svg>
          <span>RunTracker</span>
        </div>
        <div className="header-name">Sean Sellers</div>
      </header>

      <main className="main">
        <div className={`hero ${isHovering ? "hero--dim" : ""}`}>
          <div className="hero-number">
            {formatMiles(intPart)}
            <span className="hero-decimal">.{decPart}</span>
          </div>
          <div className="hero-label">
            {isHovering ? "miles at this point" : "lifetime miles"}
          </div>
        </div>

        <div className="stats">
          <div className="stat">
            <div className="stat-value">{yearsRunning}</div>
            <div className="stat-label">years running</div>
          </div>
          <div className="stat">
            <div className="stat-value">{avgMonthly}</div>
            <div className="stat-label">avg mi / month</div>
          </div>
          <div className="stat">
            <div className="stat-value">{Math.round(bestMonth.monthly)}</div>
            <div className="stat-label">best month ({bestMonth.date.slice(0, 7)})</div>
          </div>
          <div className="stat">
            <div className="stat-value">{Math.round(totalMiles / 26.2)}</div>
            <div className="stat-label">marathon equivalents</div>
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-header">
            <div>
              <div className="chart-title">Cumulative Miles</div>
              <div className="chart-hint">Hover to explore your journey</div>
            </div>
            <div className="chart-range">{firstYear} – {lastYear}</div>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart
                data={data}
                margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              >
                <defs>
                  <linearGradient id="milesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={STRAVA_ORANGE} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={STRAVA_ORANGE} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#222" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={tickFormatter}
                  tick={{ fill: "#555", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`}
                  tick={{ fill: "#555", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={42}
                />
                <Tooltip content={<CustomTooltip />} cursor={<CustomCursor />} />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  stroke={STRAVA_ORANGE}
                  strokeWidth={2.5}
                  fill="url(#milesGrad)"
                  dot={false}
                  activeDot={{ r: 5, fill: STRAVA_ORANGE, strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="data-note">
          ⚡ Sample data — connect Strava to see your real miles
        </div>
      </main>
    </div>
  );
}
