import type { Market, Timeframe, RiskLevel } from "../types";
import type { Candle } from "./data";

export function buildAnalysisPrompt(args: {
  basePrompt: string;
  stylePrompt: string;
  market: Market;
  symbol: string;
  normalizedSymbol: string;
  dataSource: string;
  timeframe: Timeframe;
  risk: RiskLevel;
  news: boolean;
  candles: Candle[];
}) {
  const ohlc = args.candles.map((c) => [c.t, c.o, c.h, c.l, c.c]);

  return [
    args.basePrompt,
    "",
    "[Style Prompt]",
    args.stylePrompt,
    "",
    "[Market]",
    `market=${args.market}`,
    `symbol=${args.symbol}`,
    `normalized_symbol=${args.normalizedSymbol}`,
    `data_source=${args.dataSource}`,
    `timeframe=${args.timeframe}`,
    `risk=${args.risk}`,
    `news=${args.news ? "ON" : "OFF"}`,
    "",
    "[Data: OHLC]",
    JSON.stringify({ ohlc }),
    "",
    "Output rules:",
    "- پاسخ را به صورت متن معمولی و حرفه‌ای بده.",
    "- در انتها فقط یک JSON معتبر (بدون کدبلاک) بده که حداقل شامل zones باشد.",
    "- zones آرایه‌ای از آبجکت‌ها با {type: 'SUPPLY'|'DEMAND', priceLow, priceHigh, label}.",
  ].join("\n");
}
