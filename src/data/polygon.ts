import type { Candle } from './types';

export async function fetchPolygonAggs(opts: { ticker: string; multiplier: number; timespan: string; from: string; to: string; apiKey: string }): Promise<Candle[]> {
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(opts.ticker)}/range/${opts.multiplier}/${opts.timespan}/${opts.from}/${opts.to}?adjusted=true&sort=asc&limit=50000&apiKey=${encodeURIComponent(opts.apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Polygon error: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as any;
  const results = j.results || [];
  return results.map((r: any) => ({
    x: Number(r.t),
    o: Number(r.o),
    h: Number(r.h),
    l: Number(r.l),
    c: Number(r.c),
  })).filter((c: Candle) => [c.o,c.h,c.l,c.c].every(Number.isFinite));
}
