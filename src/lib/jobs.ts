<<<<<<< HEAD
import type { Market, Timeframe, TradeStyle, RiskLevel } from "../types";
=======
import type { Market, Timeframe, Style, Risk } from "../types";
>>>>>>> e15cf79 (first commit)

export type Job =
  | {
      type: "SIGNAL_ANALYSIS";
      jobId: string;
      chatId: number;
      userId: number;
      market: Market;
      symbol: string;
      timeframe: Timeframe;
<<<<<<< HEAD
      style: TradeStyle;
      risk: RiskLevel;
      news: boolean;
=======
      style: Style;
      risk: Risk;
      news: "ON" | "OFF";
>>>>>>> e15cf79 (first commit)
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
