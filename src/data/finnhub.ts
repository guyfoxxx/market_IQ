import { fetchWithTimeout } from '../utils';
import type { Candle } from './types';

export async function fetchFinnhubStock(opts: { symbol: string; resolution: string; apiKey: string; from: number; to: number }): Promise<Candle[]> {
  const url = new URL('https://finnhub.io/api/v1/stock/candle');
  url.searchParams.set('symbol', opts.symbol);
  url.searchParams.set('resolution', opts.resolution);
  url.searchParams.set('from', String(opts.from));
  url.searchParams.set('to', String(opts.to));
  url.searchParams.set('token', opts.apiKey);

  const res = await fetchWithTimeout(url.toString(), 8_000);
  if (!res.ok) throw new Error(`Finnhub error: ${res.status} ${await res.text()}`);
  const j = await res.json() as any;
  if (j.s !== 'ok') throw new Error(`Finnhub: ${j.s}`);
  const out: Candle[] = [];
  for (let i = 0; i < (j.t?.length || 0); i++) {
    out.push({ x: j.t[i]*1000, o: j.o[i], h: j.h[i], l: j.l[i], c: j.c[i] });
  }
  return out;
}
