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

export interface CandleFetchResult {
  candles: Candle[];
  source: "binance" | "twelvedata" | "alphavantage" | "yahoo";
  normalizedSymbol: string;
}

function tfToBinanceInterval(tf: Timeframe): string {
  if (tf === "M15") return "15m";
  if (tf === "H1") return "1h";
  if (tf === "H4") return "4h";
  return "1d";
}

function normalizeSymbolForTwelveData(market: Market, symbol: string): string {
  const s = symbol.trim();

  // Yahoo-style forex symbols: EURUSD=X
  if (market === "FOREX" || market === "METALS") {
    const cleaned = s.replace(/=X$/i, "").replace("-", "").replace("_", "").toUpperCase();
    // EURUSD, XAUUSD
    if (/^[A-Z]{6}$/.test(cleaned)) return `${cleaned.slice(0, 3)}/${cleaned.slice(3)}`;
    // already EUR/USD
    if (s.includes("/")) return s.toUpperCase();
    return cleaned;
  }

  if (market === "CRYPTO") {
    // BTCUSDT -> BTC/USDT (best effort)
    const up = s.replace("-", "").replace("_", "").toUpperCase();
    if (/^[A-Z]{6,12}$/.test(up) && up.endsWith("USDT")) return `${up.slice(0, -4)}/USDT`;
    if (/^[A-Z]{6,12}$/.test(up) && up.endsWith("USD")) return `${up.slice(0, -3)}/USD`;
    if (s.includes("/")) return s.toUpperCase();
    return up;
  }

  return s.toUpperCase();
}

export async function fetchCandles(env: Env, market: Market, symbol: string, tf: Timeframe, limit = 200): Promise<Candle[]> {
  const r = await fetchCandlesWithMeta(env, market, symbol, tf, limit);
  return r.candles;
}

export async function fetchCandlesWithMeta(env: Env, market: Market, symbol: string, tf: Timeframe, limit = 200): Promise<CandleFetchResult> {
  const cryptoOrder = (env.DATA_SOURCES_CRYPTO ?? "binance,twelvedata,alphavantage").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const otherOrder = (env.DATA_SOURCES_OTHER ?? "twelvedata,alphavantage").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

  const order = market === "CRYPTO" ? cryptoOrder : otherOrder;

  const errors: string[] = [];
  for (const src of order) {
    try {
      if (src === "binance") {
        if (market !== "CRYPTO") throw new Error("binance only for crypto");
        const candles = await fetchBinance(symbol, tf, limit);
        return { candles, source: "binance", normalizedSymbol: symbol.toUpperCase() };
      }

      if (src === "twelvedata") {
        if (!env.TWELVEDATA_API_KEY) throw new Error("TWELVEDATA_API_KEY missing");
        const sym = normalizeSymbolForTwelveData(market, symbol);

        // Extra best-effort: if crypto uses USDT, also try USD
        try {
          const candles = await fetchTwelveData(env, sym, tf, limit);
          return { candles, source: "twelvedata", normalizedSymbol: sym };
        } catch (e1: any) {
          if (market === "CRYPTO" && sym.endsWith("/USDT")) {
            const alt = sym.replace("/USDT", "/USD");
            const candles = await fetchTwelveData(env, alt, tf, limit);
            return { candles, source: "twelvedata", normalizedSymbol: alt };
          }
          throw e1;
        }
      }

      if (src === "alphavantage") {
        if (!env.ALPHAVANTAGE_API_KEY) throw new Error("ALPHAVANTAGE_API_KEY missing");
        const candles = await fetchAlphaVantage(env, market, symbol, tf, limit);
        return { candles, source: "alphavantage", normalizedSymbol: symbol.toUpperCase() };
      }

      if (src === "yahoo") {
        const candles = await fetchYahoo(symbol, tf, limit);
        return { candles, source: "yahoo", normalizedSymbol: symbol };
      }
    } catch (e: any) {
      errors.push(`${src}: ${e?.message ?? "error"}`);
    }
  }

  // last resort: Yahoo
  try {
    const candles = await fetchYahoo(symbol, tf, limit);
    return { candles, source: "yahoo", normalizedSymbol: symbol };
  } catch (e: any) {
    errors.push(`yahoo: ${e?.message ?? "error"}`);
  }

  throw new Error("All data sources failed: " + errors.join(" | "));
}

async function fetchBinance(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
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
  if (tf === "H4") return "60m";
  return "1d";
}

function yahooRange(tf: Timeframe) {
  if (tf === "M15") return "7d";
  if (tf === "H1" || tf === "H4") return "30d";
  return "6mo";
}

async function fetchYahoo(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
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
  if (data?.status === "error") throw new Error(data?.message || "TwelveData: error");
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

async function fetchAlphaVantage(env: Env, market: Market, symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
  const key = env.ALPHAVANTAGE_API_KEY!;
  const sym = symbol.trim().toUpperCase();

  // Forex and metals (treat as FX)
  if (market === "FOREX" || market === "METALS") {
    // EURUSD or EUR/USD or EURUSD=X
    const cleaned = sym.replace(/=X$/i, "").replace("/", "");
    if (!/^[A-Z]{6}$/.test(cleaned)) throw new Error("AlphaVantage FX expects 6-letter pair (e.g., EURUSD)");
    const from = cleaned.slice(0, 3);
    const to = cleaned.slice(3);
    if (tf === "D1") {
      const url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${encodeURIComponent(from)}&to_symbol=${encodeURIComponent(to)}&apikey=${encodeURIComponent(key)}`;
      return parseAlphaTimeSeries(url, limit);
    } else {
      const interval = tf === "M15" ? "15min" : "60min";
      const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${encodeURIComponent(from)}&to_symbol=${encodeURIComponent(to)}&interval=${interval}&outputsize=compact&apikey=${encodeURIComponent(key)}`;
      return parseAlphaTimeSeries(url, limit);
    }
  }

  // Stocks
  if (tf === "D1") {
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(key)}`;
    return parseAlphaTimeSeries(url, limit);
  } else {
    const interval = tf === "M15" ? "15min" : "60min";
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${encodeURIComponent(sym)}&interval=${interval}&outputsize=compact&apikey=${encodeURIComponent(key)}`;
    return parseAlphaTimeSeries(url, limit);
  }
}

async function parseAlphaTimeSeries(url: string, limit: number): Promise<Candle[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`AlphaVantage error ${res.status}`);
  const data = await res.json() as any;
  if (data?.Note) throw new Error("AlphaVantage rate limit");
  if (data?.Error_Message) throw new Error(data.Error_Message);
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
