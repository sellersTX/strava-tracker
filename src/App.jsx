import { useState, useEffect, useMemo, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import "./App.css";

const STRAVA_ORANGE = "#FC4C02";

function processRuns(runs) {
  const monthMap = {};
  for (const run of runs) {
    const month = run.date.slice(0, 7);
    monthMap[month] = (monthMap[month] ?? 0) + run.distance_miles;
  }
  const months = Object.keys(monthMap).sort();
  let cumulative = 0;
  return months.map((month) => {
    const monthly = Math.round(monthMap[month] * 10) / 10;
    cumulative = Math.round((cumulative + monthly) * 10) / 10;
    const [y, m] = month.split("-");
    return {
      date: month,
      label: new Date(Number(y), Number(m) - 1, 1).toLocaleString("default", {
        month: "short",
        year: "2-digit",
      }),
      monthly,
      cumulative,
    };
  });
}

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
      stroke={STRAVA_ORANGE} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7}
    />
  );
}

function LoadingScreen() {
  return (
    <div className="connect-screen">
      <div className="connect-card">
        <div className="spinner" />
        <p>Loading runs…</p>
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/activities")
      .then((r) => r.json())
      .then((runs) => {
        if (runs.error) throw new Error(runs.error);
        setData(processRuns(runs));
      })
      .catch((e) => setError(e.message));
  }, []);

  const chartData = data ?? [];
  const totalMiles = chartData.length ? chartData[chartData.length - 1].cumulative : 0;
  const displayMiles = hovered !== null ? hovered : totalMiles;
  const isHovering = hovered !== null;

  const firstYear = chartData[0]?.date.slice(0, 4) ?? "";
  const lastYear = chartData[chartData.length - 1]?.date.slice(0, 4) ?? "";
  const yearsRunning = firstYear && lastYear ? Number(lastYear) - Number(firstYear) + 1 : 0;

  const avgMonthly = useMemo(() => {
    if (!chartData.length) return 0;
    return Math.round(chartData.reduce((s, d) => s + d.monthly, 0) / chartData.length);
  }, [chartData]);

  const bestMonth = useMemo(() => {
    return chartData.reduce((best, d) => (d.monthly > (best?.monthly ?? 0) ? d : best), null);
  }, [chartData]);

  const handleMouseMove = useCallback((e) => {
    if (e?.activePayload?.length) setHovered(e.activePayload[0].payload.cumulative);
  }, []);
  const handleMouseLeave = useCallback(() => setHovered(null), []);

  const tickFormatter = (val) => (val.endsWith("-01") ? val.slice(0, 4) : "");
  const intPart = Math.floor(displayMiles);
  const decPart = Math.round((displayMiles % 1) * 10);

  if (!data && !error) return <LoadingScreen />;

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
        <div className="header-right">
          <span className="badge badge--live">● Live</span>
        </div>
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
            <div className="stat-value">{bestMonth ? Math.round(bestMonth.monthly) : 0}</div>
            <div className="stat-label">best month {bestMonth ? `(${bestMonth.date})` : ""}</div>
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
                data={chartData}
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
                <XAxis dataKey="date" tickFormatter={tickFormatter} tick={{ fill: "#555", fontSize: 12 }} axisLine={false} tickLine={false} interval={0} />
                <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} tick={{ fill: "#555", fontSize: 12 }} axisLine={false} tickLine={false} width={42} />
                <Tooltip content={<CustomTooltip />} cursor={<CustomCursor />} />
                <Area type="monotone" dataKey="cumulative" stroke={STRAVA_ORANGE} strokeWidth={2.5} fill="url(#milesGrad)" dot={false} activeDot={{ r: 5, fill: STRAVA_ORANGE, strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </main>
    </div>
  );
}
