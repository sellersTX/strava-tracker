// Fake running data simulating Sean's progression from 2019 → 2026
// Monthly mileage with realistic progression and seasonality

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

export function generateFakeData() {
  const rand = seededRandom(42); // deterministic so numbers don't jump on re-render
  const data = [];
  let totalMiles = 0;

  const start = new Date(2019, 0, 1);
  const end = new Date(2026, 1, 1); // Feb 2026

  const current = new Date(start);

  while (current <= end) {
    const year = current.getFullYear();
    const month = current.getMonth(); // 0-11
    const yearProgress = (year - 2019) + month / 12;

    // Base monthly mileage ramps up over the years
    let base;
    if (yearProgress < 0.5)      base = 8;
    else if (yearProgress < 1.5) base = 15;
    else if (yearProgress < 2.5) base = 25;
    else if (yearProgress < 3.5) base = 40;
    else if (yearProgress < 4.5) base = 55;
    else if (yearProgress < 5.5) base = 65;
    else if (yearProgress < 6.5) base = 72;
    else                          base = 68;

    // Seasonality: peak in spring/fall (marathon season), dip in winter/summer
    const seasonality = 1 + 0.25 * Math.sin(((month - 2) * Math.PI) / 5);

    // Random ±30%
    const noise = 0.7 + 0.6 * rand();

    const monthMiles = Math.round(base * seasonality * noise * 10) / 10;
    totalMiles = Math.round((totalMiles + monthMiles) * 10) / 10;

    data.push({
      date: new Date(year, month, 1).toISOString().slice(0, 7), // "YYYY-MM"
      label: current.toLocaleString("default", { month: "short", year: "2-digit" }),
      monthly: monthMiles,
      cumulative: totalMiles,
    });

    current.setMonth(current.getMonth() + 1);
  }

  return data;
}
