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
  // Priority: Binance for crypto, otherwise Yahoo, with fallbacks.
  if (market === "CRYPTO") return fetchBinance(symbol, tf, limit);

  // If user passes like AAPL or XAUUSD, Yahoo format differs. We'll do best effort.
  try {
    return await fetchYahoo(symbol, tf, limit);
  } catch (e) {
    if (env.FINNHUB_API_KEY) {
      try { return await fetchFinnhub(env, market, symbol, tf, limit); } catch {}
    }
    if (env.TWELVEDATA_API_KEY) {
      try { return await fetchTwelveData(env, symbol, tf, limit); } catch {}
    }
    if (env.ALPHAVANTAGE_API_KEY) {
      try { return await fetchAlphaVantage(env, symbol, tf, limit); } catch {}
    }
    if (env.POLYGON_API_KEY) {
      try { return await fetchPolygon(env, symbol, tf, limit); } catch {}
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

function tfToFinnhubResolution(tf: Timeframe): string {
  if (tf === "M15") return "15";
  if (tf === "H1") return "60";
  if (tf === "H4") return "240";
  return "D";
}

async function fetchFinnhub(env: Env, market: Market, symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
  const resolution = tfToFinnhubResolution(tf);
  const now = Math.floor(Date.now() / 1000);
  const secondsPer = tf === "D1" ? 86400 : tf === "H4" ? 14400 : tf === "H1" ? 3600 : 900;
  const from = now - secondsPer * Math.max(10, limit);
  const endpoint = market === "STOCKS" ? "stock/candle" : "forex/candle";
  const url = `https://finnhub.io/api/v1/${endpoint}?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(
    resolution
  )}&from=${from}&to=${now}&token=${encodeURIComponent(env.FINNHUB_API_KEY!)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub error ${res.status}`);
  const data = await res.json() as any;
  if (data?.s !== "ok") throw new Error("Finnhub: no data");
  const out: Candle[] = [];
  for (let i = 0; i < data.t.length; i++) {
    out.push({
      t: Number(data.t[i]) * 1000,
      o: Number(data.o[i]),
      h: Number(data.h[i]),
      l: Number(data.l[i]),
      c: Number(data.c[i]),
      v: data.v ? Number(data.v[i]) : undefined,
    });
  }
  return out.slice(-limit);
}

function tfToPolygon(tf: Timeframe): { multiplier: number; timespan: "minute" | "hour" | "day" } {
  if (tf === "M15") return { multiplier: 15, timespan: "minute" };
  if (tf === "H1") return { multiplier: 1, timespan: "hour" };
  if (tf === "H4") return { multiplier: 4, timespan: "hour" };
  return { multiplier: 1, timespan: "day" };
}

async function fetchPolygon(env: Env, symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
  const { multiplier, timespan } = tfToPolygon(tf);
  const now = Date.now();
  const msPer =
    timespan === "day" ? 86_400_000 : timespan === "hour" ? 3_600_000 * multiplier : 60_000 * multiplier;
  const from = new Date(now - msPer * Math.max(10, limit));
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = new Date(now).toISOString().slice(0, 10);
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(
    symbol
  )}/range/${multiplier}/${timespan}/${fromDate}/${toDate}?adjusted=true&limit=${limit}&sort=asc&apiKey=${encodeURIComponent(
    env.POLYGON_API_KEY!
  )}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Polygon error ${res.status}`);
  const data = await res.json() as any;
  const results = data?.results;
  if (!Array.isArray(results) || results.length === 0) throw new Error("Polygon: no results");
  return results.map((r: any) => ({
    t: Number(r.t),
    o: Number(r.o),
    h: Number(r.h),
    l: Number(r.l),
    c: Number(r.c),
    v: r.v ? Number(r.v) : undefined,
  })).slice(-limit);
}


export async function fetchCandlesWithMeta(
  env: Env,
  market: Market,
  symbol: string,
  tf: Timeframe,
  limit = 200
): Promise<{ candles: Candle[]; source: string; normalizedSymbol: string }> {
  const normalizedSymbol = symbol.trim().toUpperCase();

  if (market === "CRYPTO") {
    const candles = await fetchBinance(normalizedSymbol, tf, limit);
    return { candles, source: "binance", normalizedSymbol };
  }

  try {
    const candles = await fetchYahoo(normalizedSymbol, tf, limit);
    return { candles, source: "yahoo", normalizedSymbol };
  } catch (e) {
    if (env.FINNHUB_API_KEY) {
      try {
        const candles = await fetchFinnhub(env, market, normalizedSymbol, tf, limit);
        return { candles, source: "finnhub", normalizedSymbol };
      } catch {}
    }
    if (env.TWELVEDATA_API_KEY) {
      try {
        const candles = await fetchTwelveData(env, normalizedSymbol, tf, limit);
        return { candles, source: "twelvedata", normalizedSymbol };
      } catch {}
    }
    if (env.ALPHAVANTAGE_API_KEY) {
      try {
        const candles = await fetchAlphaVantage(env, normalizedSymbol, tf, limit);
        return { candles, source: "alphavantage", normalizedSymbol };
      } catch {}
    }
    if (env.POLYGON_API_KEY) {
      try {
        const candles = await fetchPolygon(env, normalizedSymbol, tf, limit);
        return { candles, source: "polygon", normalizedSymbol };
      } catch {}
    }
    throw e;
  }
}
