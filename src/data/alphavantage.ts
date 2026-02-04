import { fetchWithTimeout } from '../utils';
import type { Candle } from './types';

export async function fetchAlphaVantageFX(opts: { from: string; to: string; apiKey: string }): Promise<Candle[]> {
  const url = new URL('https://www.alphavantage.co/query');
  url.searchParams.set('function', 'FX_DAILY');
  url.searchParams.set('from_symbol', opts.from.toUpperCase());
  url.searchParams.set('to_symbol', opts.to.toUpperCase());
  url.searchParams.set('outputsize', 'compact');
  url.searchParams.set('apikey', opts.apiKey);

  const res = await fetchWithTimeout(url.toString(), 8_000);
  if (!res.ok) throw new Error(`AlphaVantage error: ${res.status} ${await res.text()}`);
  const j = await res.json() as any;
  const series = j['Time Series FX (Daily)'];
  if (!series) throw new Error(`AlphaVantage: no series (check key / limits)`);
  const out: Candle[] = [];
  for (const [date, v] of Object.entries<any>(series)) {
    const x = Date.parse(date + 'T00:00:00Z');
    out.push({
      x,
      o: Number(v['1. open']),
      h: Number(v['2. high']),
      l: Number(v['3. low']),
      c: Number(v['4. close']),
    });
  }
  out.sort((a, b) => a.x - b.x);
  return out;
}
