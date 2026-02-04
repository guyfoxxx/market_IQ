import type { Env } from "../env";
import type { Market, Timeframe } from "../types";

export interface Candle {
  t: number; // ms
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

function tfToBinanceInterval(tf: Timeframe): string {
  if (tf === "M15") return "15m";
  if (tf === "H1") return "1h";
  if (tf === "H4") return "4h";
  return "1d";
}

export async function fetchCandles(env: Env, market: Market, symbol: string, tf: Timeframe, limit = 200): Promise<Candle[]> {
  // Priority: Binance for crypto, otherwise Yahoo, fallback to AlphaVantage/TwelveData if keys exist.
  if (market === "CRYPTO") return fetchBinance(symbol, tf, limit);

  // If user passes like AAPL or XAUUSD, Yahoo format differs. We'll do best effort.
  try {
    return await fetchYahoo(symbol, tf, limit);
  } catch (e) {
    // fallbacks
    if (env.TWELVEDATA_API_KEY) {
      try { return await fetchTwelveData(env, symbol, tf, limit); } catch {}
    }
    if (env.ALPHAVANTAGE_API_KEY) {
      try { return await fetchAlphaVantage(env, symbol, tf, limit); } catch {}
    }
    throw e;
  }
}

async function fetchBinance(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
  // Expect symbol like BTCUSDT, ETHUSDT
  const interval = tfToBinanceInterval(tf);
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol.toUpperCase())}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance error ${res.status}`);
  const data = await res.json() as any[];
  return data.map((k) => ({
    t: Number(k[0]),
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
  }));
}

function tfToYahooInterval(tf: Timeframe) {
  if (tf === "M15") return "15m";
  if (tf === "H1") return "60m";
  if (tf === "H4") return "60m"; // Yahoo doesn't have 4h directly; we'll sample every 60m and later downsample if needed.
  return "1d";
}

function yahooRange(tf: Timeframe) {
  if (tf === "M15") return "7d";
  if (tf === "H1" || tf === "H4") return "30d";
  return "6mo";
}

async function fetchYahoo(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
  // Accept BTC-USD, EURUSD=X, XAUUSD=X, AAPL, etc.
  const interval = tfToYahooInterval(tf);
  const range = yahooRange(tf);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo error ${res.status}`);
  const data = await res.json() as any;
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error("Yahoo: no data");
  const ts: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0];
  if (!q) throw new Error("Yahoo: missing quote");
  const out: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i] * 1000;
    const o = q.open?.[i]; const h = q.high?.[i]; const l = q.low?.[i]; const c = q.close?.[i];
    if ([o, h, l, c].some((x) => x == null)) continue;
    out.push({ t, o, h, l, c, v: q.volume?.[i] });
  }
  // downsample for H4
  if (tf === "H4") return downsample(out, 4).slice(-limit);
  return out.slice(-limit);
}

function downsample(candles: Candle[], n: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += n) {
    const chunk = candles.slice(i, i + n);
    if (chunk.length === 0) continue;
    const o = chunk[0].o;
    const c = chunk[chunk.length - 1].c;
    const h = Math.max(...chunk.map(x => x.h));
    const l = Math.min(...chunk.map(x => x.l));
    out.push({ t: chunk[0].t, o, h, l, c });
  }
  return out;
}

async function fetchTwelveData(env: Env, symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
  const intervalMap: Record<Timeframe, string> = { M15: "15min", H1: "1h", H4: "4h", D1: "1day" };
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${intervalMap[tf]}&outputsize=${limit}&format=JSON&apikey=${encodeURIComponent(env.TWELVEDATA_API_KEY!)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TwelveData error ${res.status}`);
  const data = await res.json() as any;
  const values = data?.values;
  if (!Array.isArray(values)) throw new Error("TwelveData: no values");
  return values.reverse().map((v: any) => ({
    t: Date.parse(v.datetime),
    o: Number(v.open),
    h: Number(v.high),
    l: Number(v.low),
    c: Number(v.close),
    v: v.volume ? Number(v.volume) : undefined,
  }));
}

async function fetchAlphaVantage(env: Env, symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
  // Simplified: intraday for M15/H1, daily for D1
  const key = env.ALPHAVANTAGE_API_KEY!;
  let url: string;
  if (tf === "D1") {
    url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`;
  } else {
    const interval = tf === "M15" ? "15min" : "60min";
    url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=compact&apikey=${encodeURIComponent(key)}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`AlphaVantage error ${res.status}`);
  const data = await res.json() as any;
  const seriesKey = Object.keys(data).find((k) => k.toLowerCase().includes("time series"));
  const series = seriesKey ? data[seriesKey] : null;
  if (!series) throw new Error("AlphaVantage: no time series");
  const keys = Object.keys(series).sort();
  const sliced = keys.slice(-limit);
  return sliced.map((ts) => {
    const row = series[ts];
    return {
      t: Date.parse(ts),
      o: Number(row["1. open"]),
      h: Number(row["2. high"]),
      l: Number(row["3. low"]),
      c: Number(row["4. close"]),
      v: row["5. volume"] ? Number(row["5. volume"]) : undefined,
    };
  });
}
