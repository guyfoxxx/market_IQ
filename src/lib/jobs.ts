import type { Market, Timeframe, Style, Risk } from "../types";

export type Job =
  | {
      type: "SIGNAL_ANALYSIS";
      jobId: string;
      chatId: number;
      userId: number;
      market: Market;
      symbol: string;
      timeframe: Timeframe;
      style: TradeStyle;
      risk: RiskLevel;
      news: boolean;
    }
  | {
      type: "CUSTOM_PROMPT_DELIVER";
      jobId: string;
      userId: number;
      chatId: number;
    };

export function newJobId(prefix = "job") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
