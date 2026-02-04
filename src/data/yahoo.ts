import { fetchWithTimeout } from '../utils';
import type { Candle } from './types';

export async function fetchYahooChart(ticker: string, timeframe: string, range?: string): Promise<Candle[]> {
  // Yahoo chart endpoint
  // timeframe -> interval mapping
  const interval = ({ M1:'1m', M5:'5m', M15:'15m', M30:'30m', H1:'60m', H4:'60m', D1:'1d', W1:'1wk' } as any)[timeframe.toUpperCase()] || '1d';
  const r = range || (timeframe.toUpperCase().startsWith('M') ? '1d' : timeframe.toUpperCase().startsWith('H') ? '7d' : '6mo');
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(r)}`;

  const res = await fetchWithTimeout(url, 8_000);
  if (!res.ok) throw new Error(`Yahoo error: ${res.status} ${await res.text()}`);
  const j = await res.json() as any;
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error('Yahoo: empty result');

  const ts: number[] = result.timestamp || [];
  const q = result.indicators?.quote?.[0];
  const open = q?.open || [];
  const high = q?.high || [];
  const low = q?.low || [];
  const close = q?.close || [];

  const out: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = Number(open[i]); const h = Number(high[i]); const l = Number(low[i]); const c = Number(close[i]);
    if (![o,h,l,c].every(Number.isFinite)) continue;
    out.push({ x: ts[i] * 1000, o, h, l, c });
  }
  return out;
}
