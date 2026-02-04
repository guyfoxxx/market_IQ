import { fetchWithTimeout } from './utils';
import type { Candle } from './data/types';
import type { Zone } from './analysis';
import { clamp } from './utils';

export async function renderChartPng(opts: {
  symbol: string;
  candles: Candle[];
  zones: Zone[];
}): Promise<ArrayBuffer> {
  const candles = opts.candles.slice(-120);
  if (candles.length < 10) throw new Error('Not enough candles');

  const minY = Math.min(...candles.map(c => c.l));
  const maxY = Math.max(...candles.map(c => c.h));

  // QuickChart (Chart.js + annotation + financial)
  // https://quickchart.io/documentation/reference/chartjs-plugins/
  const annotations: Record<string, any> = {};
  opts.zones.slice(0, 8).forEach((z, idx) => {
    const yMin = clamp(Math.min(z.from, z.to), minY, maxY);
    const yMax = clamp(Math.max(z.from, z.to), minY, maxY);
    annotations[`zone_${idx}`] = {
      type: 'box',
      xMin: candles[0].x,
      xMax: candles[candles.length - 1].x,
      yMin,
      yMax,
      borderWidth: 1,
      backgroundColor: z.kind === 'demand' ? 'rgba(46, 204, 113, 0.20)' : 'rgba(231, 76, 60, 0.20)',
      borderColor: z.kind === 'demand' ? 'rgba(46, 204, 113, 0.60)' : 'rgba(231, 76, 60, 0.60)',
      label: z.label ? { enabled: true, content: z.label, position: 'center' } : undefined,
    };
  });

  const config = {
    type: 'candlestick',
    data: {
      datasets: [
        {
          label: opts.symbol,
          data: candles,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        annotation: { annotations },
        title: { display: true, text: `Chart: ${opts.symbol}` },
      },
      scales: {
        x: { type: 'time', time: { tooltipFormat: 'yyyy-MM-dd HH:mm' } },
        y: { beginAtZero: false },
      },
    },
  };

  const payload = {
    version: '4',
    width: 900,
    height: 520,
    format: 'png',
    backgroundColor: 'white',
    chart: config,
  };

  const res = await fetchWithTimeout('https://quickchart.io/chart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 12_000);
  if (!res.ok) throw new Error(`QuickChart error: ${res.status} ${await res.text()}`);
  return await res.arrayBuffer();
}
