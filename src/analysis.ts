import type { Market, Style, UserProfile } from './types';
import { generateText } from './ai';
import type { Storage } from './storage';

export interface Zone {
  kind: 'demand' | 'supply';
  from: number; // price
  to: number; // price
  label?: string;
}

export interface AnalysisResult {
  text: string;
  zones: Zone[];
  meta?: any;
}

function defaultBasePrompt() {
  return `شما یک تحلیل‌گر حرفه‌ای بازار هستید. خروجی باید دقیق، ساختاریافته و کوتاه باشد.
قوانین:
- هیچ توصیه قطعی مالی نده. صرفاً تحلیل آموزشی.
- همیشه حد ضرر (SL) و سناریوی باطل شدن را مشخص کن.
- خروجی را به فارسی بنویس.
- در پایان پیام، **آخرین بخش** حتماً یک بلاک \`\`\`json\`\`\` بده که فقط شامل یک JSON معتبر باشد (بدون کامنت/Trailing comma/متن اضافه).
- JSON باید دقیقاً مطابق اسکیمای زیر باشد (Zones Schema v1):

{
  "schema_version": "zones_v1",
  "symbol": "BTCUSDT",
  "market": "crypto",
  "timeframe": "H4",
  "generated_at": "2026-02-04T00:00:00Z",
  "zones": [
    {
      "id": "Z1",
      "kind": "demand",
      "price_from": 0,
      "price_to": 0,
      "timeframe": "H4",
      "rationale": "علت/منطق خیلی کوتاه",
      "invalidation": "شرط باطل شدن سناریو",
      "confidence": 0.0
    }
  ]
}

قوانین سختگیرانه زون‌ها:
- zones باید بین 1 تا 8 آیتم باشد.
- kind فقط "demand" یا "supply".
- price_from و price_to باید عدد (float) و مثبت باشد.
- price_from < price_to (اگر برعکس بود خودت اصلاح کن).
- confidence عدد بین 0 و 1.
- rationale حداکثر 120 کاراکتر.
- invalidation یک جمله کوتاه و قابل اجرا باشد.

قالب متن خروجی (قبل از JSON):
1) خلاصه (۳-۵ خط)
2) بایاس (Bullish/Bearish/Neutral)
3) سناریوها (سناریوی اصلی + آلترناتیو)
4) پلن معاملاتی پیشنهادی (Entry/SL/TP) با اشاره به ریسک کاربر
5) نکات و هشدارها
`;
}

function stylePrompt(style: Style) {
  switch (style) {
    case 'rtm':
      return `تمرکز روی RTM: زون‌های عرضه/تقاضا، QM، FTR، پایه رنج‌ها، اعتبار زون‌ها.`;
    case 'ict':
      return `تمرکز روی ICT: Liquidity, PD Arrays, FVG, Order Block, MSS/BOS, Premium/Discount.`;
    case 'price_action':
      return `تمرکز روی پرایس‌اکشن کلاسیک: حمایت/مقاومت، روند، شکست‌ها، کندل‌پترن‌ها.`;
    case 'general_prompt':
      return `از پرامپت عمومی کاربر هم استفاده کن (در صورت وجود).`;
    case 'custom_prompt':
      return `از پرامپت اختصاصی کاربر استفاده کن (اگر آماده است).`;
    default:
      return '';
  }
}

export async function runAnalysis(opts: {
  env: any;
  storage: Storage;
  user: UserProfile;
  market: Market;
  symbol: string;
  timeframe: string;
  candlesSummary: string;
  newsDigest?: string;
}): Promise<AnalysisResult> {
  const base = (await opts.storage.getPrompt('base')) || defaultBasePrompt();
  const style = opts.user.settings.style;
  const perStyle = (await opts.storage.getPrompt(`style:${style}`)) || stylePrompt(style);

  const userPromptPieces: string[] = [];
  if (style === 'general_prompt') {
    const gp = await opts.storage.getPrompt(`generalPrompt:${opts.user.id}`);
    if (gp) userPromptPieces.push(`پرامپت عمومی کاربر:\n${gp}`);
  }
  if (style === 'custom_prompt') {
    if (!opts.user.customPromptReady || !opts.user.customPrompt) {
      userPromptPieces.push('پرامپت اختصاصی هنوز آماده نیست، پس تحلیل را با سبک عمومی ICT انجام بده.');
    } else {
      userPromptPieces.push(`پرامپت اختصاصی کاربر:\n${opts.user.customPrompt}`);
    }
  }

  const newsPart =
    opts.user.settings.news && opts.newsDigest
      ? `

خبرهای مرتبط (برای زمینه، نه سیگنال قطعی):
${opts.newsDigest}`
      : '';

  const userText = `نماد: ${opts.symbol}
بازار: ${opts.market}
تایم‌فریم: ${opts.timeframe}
ریسک کاربر: ${opts.user.settings.risk}
خلاصه دیتا (OHLC): ${opts.candlesSummary}${newsPart}

${userPromptPieces.join('\n\n')}

الان تحلیل را طبق قالب بده و در انتها JSON سختگیرانه zones را قرار بده.`;
  const system = `${base}\n\n---\nسبک/استراتژی:\n${perStyle}`;
  const text = await generateText(opts.env, { system, user: userText, temperature: 0.3 });

  let extracted = extractZonesDetailed(text);
  let zones = extracted.zones;

  // اگر JSON وجود داشت ولی قابل parse/اعتبارسنجی نبود، یک‌بار تلاش کن JSON را ترمیم کنی
  if ((!zones.length) && extracted.hadJson) {
    const repairSystem =
      'You are a strict JSON repair tool. Output ONLY valid JSON. No markdown, no extra text.';
    const repairUser = `Fix/repair the zones JSON for the following analysis text.
Requirements:
- Must be valid JSON.
- Must follow schema zones_v1 exactly (schema_version, symbol, market, timeframe, generated_at, zones[]).
- zones length 1..8
- kind in ["demand","supply"]
- price_from and price_to are positive numbers and price_from < price_to
- confidence 0..1

symbol=${opts.symbol}
market=${opts.market}
timeframe=${opts.timeframe}

ANALYSIS_TEXT:
${text}`;
    const repaired = await generateText(opts.env, { system: repairSystem, user: repairUser, temperature: 0 });
    extracted = extractZonesDetailed(repaired);
    zones = extracted.zones;
  }

  return { text, zones, meta: { zonesParse: extracted } };
}

export function extractZones(text: string): Zone[] {
  return extractZonesDetailed(text).zones;
}

export function extractZonesDetailed(text: string): { zones: Zone[]; hadJson: boolean; parseOk: boolean; schemaOk: boolean } {
  const jsonCandidate = findLastJsonCandidate(text);
  if (!jsonCandidate) return { zones: [], hadJson: false, parseOk: false, schemaOk: false };

  const hadJson = true;

  let obj: any;
  try {
    obj = JSON.parse(jsonCandidate);
  } catch {
    return { zones: [], hadJson, parseOk: false, schemaOk: false };
  }

  const schemaOk = obj?.schema_version === 'zones_v1';
  const zonesRaw = Array.isArray(obj?.zones) ? obj.zones : [];

  const zones: Zone[] = zonesRaw
    .slice(0, 12)
    .map((z: any, i: number) => {
      const kind = z?.kind === 'supply' ? 'supply' : z?.kind === 'demand' ? 'demand' : null;
      const from = Number(z?.price_from ?? z?.from);
      const to = Number(z?.price_to ?? z?.to);
      const conf = z?.confidence;
      if (!kind || !Number.isFinite(from) || !Number.isFinite(to)) return null;

      let a = from;
      let b = to;
      if (a === b) return null;
      if (a > b) [a, b] = [b, a];

      if (a <= 0 || b <= 0) return null;

      // confidence optional but if provided must be 0..1
      if (conf !== undefined) {
        const c = Number(conf);
        if (!Number.isFinite(c) || c < 0 || c > 1) return null;
      }

      const labelBase =
        typeof z?.id === 'string'
          ? z.id
          : typeof z?.label === 'string'
            ? z.label
            : typeof z?.rationale === 'string'
              ? z.rationale
              : `Z${i + 1}`;

      return {
        kind,
        from: a,
        to: b,
        label: String(labelBase).slice(0, 80),
      } as Zone;
    })
    .filter(Boolean) as Zone[];

  // سختگیرانه: 1..8 زون
  const finalZones = zones.slice(0, 8);
  const strictOk = schemaOk && finalZones.length >= 1 && finalZones.length <= 8;

  return { zones: finalZones, hadJson, parseOk: true, schemaOk: strictOk };
}

function findLastJsonCandidate(text: string): string | null {
  const blocks = Array.from(text.matchAll(/```json\s*([\s\S]*?)```/gi));
  if (blocks.length) {
    return (blocks[blocks.length - 1][1] || '').trim();
  }
  // fallback: اگر مدل فقط JSON خام برگرداند
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  return null;
}

