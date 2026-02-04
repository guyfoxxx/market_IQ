import type { Candle } from "./data";

export interface Zone {
  type: "demand" | "supply" | "support" | "resistance" | "fvg" | "ob" | "other";
  from: number;
  to: number;
  label?: string;
}

export function quickChartUrl(symbol: string, candles: Candle[], zones: Zone[]) {
  // QuickChart candlestick chart (chartjs-chart-financial) + annotation boxes
  // We build a config and URL-encode it.
  const data = candles.map((c) => ({
    x: c.t,
    o: c.o,
    h: c.h,
    l: c.l,
    c: c.c,
  }));

  const annotations: Record<string, any> = {};
  zones.slice(0, 8).forEach((z, i) => {
    const low = Math.min(z.from, z.to);
    const high = Math.max(z.from, z.to);
    annotations[`box${i}`] = {
      type: "box",
      yMin: low,
      yMax: high,
      backgroundColor: "rgba(255, 206, 86, 0.12)",
      borderColor: "rgba(255, 206, 86, 0.65)",
      borderWidth: 1,
      label: {
        display: true,
        content: z.label || z.type,
        position: "start",
      },
    };
  });

  const cfg = {
    type: "candlestick",
    data: {
      datasets: [
        {
          label: symbol,
          data,
        },
      ],
    },
    options: {
      parsing: false,
      scales: {
        x: {
          type: "time",
          time: { unit: "day" },
          ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }
        },
        y: { position: "right" }
      },
      plugins: {
        legend: { display: false },
        annotation: { annotations },
        title: { display: true, text: `${symbol} (zones)` },
      },
    },
  };

  const encoded = encodeURIComponent(JSON.stringify(cfg));
  return `https://quickchart.io/chart?width=1000&height=600&format=png&version=4&c=${encoded}`;
}
