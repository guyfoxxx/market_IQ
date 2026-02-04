import type { Candle } from './types';
import type { Market } from '../types';
import { fetchBinanceKlines } from './binance';
import { fetchYahooChart } from './yahoo';
import { fetchAlphaVantageFX } from './alphavantage';
import { fetchTwelveData } from './twelvedata';
import { fetchFinnhubStock } from './finnhub';
import { fetchPolygonAggs } from './polygon';

export interface DataEnv {
  ALPHAVANTAGE_API_KEY?: string;
  FINNHUB_API_KEY?: string;
  TWELVEDATA_API_KEY?: string;
  POLYGON_API_KEY?: string;
}

function mapTimeframeToTwelveInterval(timeframe: string) {
  const tf = (timeframe || '').toUpperCase();
  if (tf === 'H1') return '1h';
  if (tf === 'H4') return '4h';
  if (tf === 'D1') return '1day';
  if (tf === 'W1') return '1week';
  if (tf.startsWith('H')) return '1h';
  if (tf.startsWith('D')) return '1day';
  if (tf.startsWith('W')) return '1week';
  return '1day';
}

export async function fetchCandles(env: DataEnv, market: Market, symbol: string, timeframe: string): Promise<Candle[]> {
  // Priority / fallback chain:
  // crypto: Binance -> Yahoo
  // forex: TwelveData -> AlphaVantage -> Yahoo
  // metals: TwelveData -> Yahoo
  // stocks: Finnhub -> Polygon -> Yahoo

  if (market === 'crypto') {
    try {
      return await fetchBinanceKlines(symbol, timeframe);
    } catch (_) {
      // fallback to yahoo (BTC-USD like)
      return await fetchYahooChart(symbol, timeframe);
    }
  }

  if (market === 'forex') {
    if (env.TWELVEDATA_API_KEY) {
      const interval = mapTimeframeToTwelveInterval(timeframe);
      return await fetchTwelveData({ symbol, interval, apiKey: env.TWELVEDATA_API_KEY });
    }
    if (env.ALPHAVANTAGE_API_KEY) {
      // expects symbol like EUR/USD
      const [from, to] = symbol.split(/[\/\-]/).map(s => s.trim());
      return await fetchAlphaVantageFX({ from, to, apiKey: env.ALPHAVANTAGE_API_KEY });
    }
    return await fetchYahooChart(symbol, timeframe);
  }

  if (market === 'metals') {
    if (env.TWELVEDATA_API_KEY) {
      const interval = mapTimeframeToTwelveInterval(timeframe);
      return await fetchTwelveData({ symbol, interval, apiKey: env.TWELVEDATA_API_KEY });
    }
    return await fetchYahooChart(symbol, timeframe);
  }

  // stocks
  const now = Math.floor(Date.now() / 1000);
  const from = now - 60 * 60 * 24 * 180;
  if (env.FINNHUB_API_KEY) {
    const resolution = timeframe.toUpperCase().startsWith('D') ? 'D' : '60';
    return await fetchFinnhubStock({ symbol, resolution, apiKey: env.FINNHUB_API_KEY, from, to: now });
  }
  if (env.POLYGON_API_KEY) {
    const toDate = new Date().toISOString().slice(0, 10);
    const fromDate = new Date(Date.now() - 1000*60*60*24*180).toISOString().slice(0, 10);
    return await fetchPolygonAggs({ ticker: symbol, multiplier: 1, timespan: 'day', from: fromDate, to: toDate, apiKey: env.POLYGON_API_KEY });
  }
  return await fetchYahooChart(symbol, timeframe);
}
