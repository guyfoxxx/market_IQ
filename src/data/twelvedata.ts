import { fetchWithTimeout } from '../utils';
import type { Candle } from './types';

export async function fetchTwelveData(opts: { symbol: string; interval: string; apiKey: string; outputsize?: number }): Promise<Candle[]> {
  const url = new URL('https://api.twelvedata.com/time_series');
  url.searchParams.set('symbol', opts.symbol);
  url.searchParams.set('interval', opts.interval);
  url.searchParams.set('apikey', opts.apiKey);
  url.searchParams.set('outputsize', String(opts.outputsize ?? 120));
  url.searchParams.set('format', 'JSON');

  const res = await fetchWithTimeout(url.toString(), 8_000);
  if (!res.ok) throw new Error(`TwelveData error: ${res.status} ${await res.text()}`);
  const j = await res.json() as any;
  if (j.status === 'error') throw new Error(`TwelveData: ${j.message}`);
  const values = j.values || [];
  const out: Candle[] = values.map((v: any) => ({
    x: Date.parse(v.datetime.endsWith('Z') ? v.datetime : v.datetime + 'Z'),
    o: Number(v.open),
    h: Number(v.high),
    l: Number(v.low),
    c: Number(v.close),
  })).filter((c: Candle) => [c.o,c.h,c.l,c.c].every(Number.isFinite));
  out.sort((a, b) => a.x - b.x);
  return out;
}
