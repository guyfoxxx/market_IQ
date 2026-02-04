import { fetchWithTimeout } from '../utils';
import type { Candle } from './types';

const TF_MAP: Record<string, string> = {
  M1: '1m',
  M5: '5m',
  M15: '15m',
  M30: '30m',
  H1: '1h',
  H4: '4h',
  D1: '1d',
  W1: '1w',
};

export async function fetchBinanceKlines(symbol: string, timeframe: string, limit = 120): Promise<Candle[]> {
  const interval = TF_MAP[timeframe.toUpperCase()] || '4h';
  const url = new URL('https://api.binance.com/api/v3/klines');
  url.searchParams.set('symbol', symbol.toUpperCase());
  url.searchParams.set('interval', interval);
  url.searchParams.set('limit', String(limit));

  const res = await fetchWithTimeout(url.toString(), 8_000);
  if (!res.ok) throw new Error(`Binance error: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;

  return (data as any[]).map((k: any[]) => ({
    x: Number(k[0]),
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
  }));
}
