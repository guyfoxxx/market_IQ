import type { Candle } from "./data";
import { quickChartUrl, type Zone } from "./chart";

export function normalizeZoneForApi(zones: any): Zone[] {
  if (!Array.isArray(zones)) return [];
  const out: Zone[] = [];
  for (const z of zones) {
    const from = Number(z?.from);
    const to = Number(z?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const typeRaw = String(z?.type ?? "other").toLowerCase();
    const type = (["demand","supply","support","resistance","fvg","ob"].includes(typeRaw) ? typeRaw : "other") as Zone["type"];
    out.push({ type, from, to, label: z?.label ? String(z.label).slice(0, 18) : undefined });
  }
  return out;
}

export function quickChartUrlFromApi(symbol: string, candles: Candle[], zones: Zone[]) {
  return quickChartUrl(symbol, candles, zones);
}
