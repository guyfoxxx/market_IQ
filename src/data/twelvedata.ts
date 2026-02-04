import type { Candle } from './types';

export async function fetchTwelveData(opts: { symbol: string; interval: string; apiKey: string; outputsize?: number }): Promise<Candle[]> {
  const url = new URL('https://api.twelvedata.com/time_series');
  url.searchParams.set('symbol', opts.symbol);
  url.searchParams.set('interval', opts.interval);
  url.searchParams.set('apikey', opts.apiKey);
  url.searchParams.set('outputsize', String(opts.outputsize ?? 120));
  url.searchParams.set('format', 'JSON');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`TwelveData error: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as any;
  if (j.status === 'error') throw new Error(`TwelveData: ${j.message}`);
  const values = j.values || [];
  const out: Candle[] = values
    .map((v: any) => {
      // TwelveData often returns `YYYY-MM-DD HH:mm:ss` (no timezone). We normalize to ISO.
      const raw = String(v.datetime || '');
      let iso = raw;
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(iso)) iso = iso.replace(' ', 'T');
      // If no timezone provided, assume UTC.
      if (!/(Z|[+\-]\d{2}:?\d{2})$/i.test(iso)) iso = iso + 'Z';
      const x = Date.parse(iso);
      return {
        x,
        o: Number(v.open),
        h: Number(v.high),
        l: Number(v.low),
        c: Number(v.close),
      } as Candle;
    })
    .filter((c: Candle) => Number.isFinite(c.x) && [c.o, c.h, c.l, c.c].every(Number.isFinite));
  out.sort((a, b) => a.x - b.x);
  return out;
}
