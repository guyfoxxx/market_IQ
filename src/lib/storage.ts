import type { Env } from "../env";
import type { UserProfile, PaymentRecord, Role, Settings, Timeframe, Risk, Style } from "../types";
import { monthUtc, nowIso, randomCode, todayUtc } from "./utils";

const USER_KEY = (id: number) => `user:${id}`;
const PHONE_KEY = (phone: string) => `phone:${phone}`;
const REFCODE_KEY = (code: string) => `refcode:${code}`;
const PAYMENT_KEY = (txid: string) => `payment:${txid}`;
const CUSTOMPROMPT_KEY = (userId: number) => `customprompt:${userId}`;

const CONFIG_WALLET = "config:wallet";
const CONFIG_BANNER = "config:banner";
const PROMPT_BASE = "prompt:base";
const PROMPT_VISION = "prompt:vision";
const PROMPT_STYLE = (style: string) => `prompt:style:${style}`;

export async function getUser(env: Env, id: number): Promise<UserProfile | null> {
  const raw = await env.USERS_KV.get(USER_KEY(id));
  return raw ? (JSON.parse(raw) as UserProfile) : null;
}

export async function putUser(env: Env, u: UserProfile) {
  await env.USERS_KV.put(USER_KEY(u.id), JSON.stringify(u));
}

export async function ensureUser(env: Env, partial: {
  id: number;
  username?: string;
  firstName?: string;
}): Promise<UserProfile> {
  const existing = await getUser(env, partial.id);
  if (existing) return existing;

  const defaultSettings: Settings = {
    timeframe: (env.DEFAULT_TIMEFRAME as Timeframe) ?? "H1",
    risk: (env.DEFAULT_RISK as Risk) ?? "MEDIUM",
    style: (env.DEFAULT_STYLE as Style) ?? "PA",
    news: (env.DEFAULT_NEWS as any) ?? "OFF",
  };

  // 5 referral codes
  const refCodes = Array.from({ length: 5 }, () => randomCode(8));

  const role: Role = "USER";
  const u: UserProfile = {
    id: partial.id,
    username: partial.username,
    firstName: partial.firstName,
    createdAt: nowIso(),
    role,
    settings: defaultSettings,
    quota: {
      dailyUsed: 0,
      monthlyUsed: 0,
      lastDailyReset: todayUtc(),
      lastMonthlyReset: monthUtc(),
    },
    points: 0,
    successfulInvites: 0,
    refCodes,
    referralCommissionPct: 0,
    subscription: { active: false },
    wallet: {},
    customPrompt: { ready: false },
  };

  await putUser(env, u);

  // store ref codes mapping
  await Promise.all(refCodes.map((c) => env.USERS_KV.put(REFCODE_KEY(c), String(u.id))));

  return u;
}

export async function setUserPhone(env: Env, userId: number, phone: string): Promise<{ ok: boolean; reason?: string }> {
  const existing = await env.USERS_KV.get(PHONE_KEY(phone));
  if (existing && Number(existing) !== userId) {
    return { ok: false, reason: "این شماره قبلاً ثبت شده است. لطفاً با ادمین تماس بگیرید." };
  }
  await env.USERS_KV.put(PHONE_KEY(phone), String(userId));
  const u = await getUser(env, userId);
  if (!u) return { ok: false, reason: "کاربر یافت نشد" };
  u.phone = phone;
  await putUser(env, u);
  return { ok: true };
}

export async function getReferrerByCode(env: Env, code: string): Promise<number | null> {
  const v = await env.USERS_KV.get(REFCODE_KEY(code));
  return v ? Number(v) : null;
}

export async function putPayment(env: Env, p: PaymentRecord) {
  await env.USERS_KV.put(PAYMENT_KEY(p.txid), JSON.stringify(p));
}

export async function getPayment(env: Env, txid: string): Promise<PaymentRecord | null> {
  const raw = await env.USERS_KV.get(PAYMENT_KEY(txid));
  return raw ? (JSON.parse(raw) as PaymentRecord) : null;
}

export async function listPayments(env: Env, status: PaymentRecord["status"]): Promise<PaymentRecord[]> {
  const list = await env.USERS_KV.list({ prefix: "payment:" });
  const out: PaymentRecord[] = [];
  for (const k of list.keys) {
    const raw = await env.USERS_KV.get(k.name);
    if (!raw) continue;
    const p = JSON.parse(raw) as PaymentRecord;
    if (p.status === status) out.push(p);
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return out;
}

export async function putCustomPromptTask(env: Env, userId: number, dueAtIso: string, promptText: string) {
  await env.USERS_KV.put(CUSTOMPROMPT_KEY(userId), JSON.stringify({ userId, dueAtIso, promptText, sent: false }));
}

export async function listDueCustomPrompts(env: Env): Promise<Array<{ userId: number; dueAtIso: string; promptText: string }>> {
  const list = await env.USERS_KV.list({ prefix: "customprompt:" });
  const out: Array<{ userId: number; dueAtIso: string; promptText: string }> = [];
  const now = Date.now();
  for (const k of list.keys) {
    const raw = await env.USERS_KV.get(k.name);
    if (!raw) continue;
    const t = JSON.parse(raw) as { userId: number; dueAtIso: string; promptText: string; sent?: boolean };
    if (t.sent) continue;
    const due = Date.parse(t.dueAtIso);
    if (Number.isFinite(due) && due <= now) out.push({ userId: t.userId, dueAtIso: t.dueAtIso, promptText: t.promptText });
  }
  return out;
}

export async function markCustomPromptSent(env: Env, userId: number) {
  const raw = await env.USERS_KV.get(CUSTOMPROMPT_KEY(userId));
  if (!raw) return;
  const t = JSON.parse(raw) as any;
  t.sent = true;
  t.sentAtIso = nowIso();
  await env.USERS_KV.put(CUSTOMPROMPT_KEY(userId), JSON.stringify(t));
}

export async function getPublicWallet(env: Env): Promise<string | null> {
  const w = await env.USERS_KV.get(CONFIG_WALLET);
  return (w && w.trim()) || (env.PUBLIC_WALLET_ADDRESS?.trim() ? env.PUBLIC_WALLET_ADDRESS.trim() : null);
}

export async function setPublicWallet(env: Env, addr: string) {
  await env.USERS_KV.put(CONFIG_WALLET, addr.trim());
}

export async function getBanner(env: Env): Promise<{ enabled: boolean; text: string; url: string } | null> {
  const raw = await env.USERS_KV.get(CONFIG_BANNER);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function setBanner(env: Env, banner: { enabled: boolean; text: string; url: string }) {
  await env.USERS_KV.put(CONFIG_BANNER, JSON.stringify(banner));
}

export async function getPromptBase(env: Env): Promise<string> {
  return (await env.USERS_KV.get(PROMPT_BASE)) ?? DEFAULT_BASE_PROMPT;
}
export async function setPromptBase(env: Env, text: string) {
  await env.USERS_KV.put(PROMPT_BASE, text);
}
export async function getPromptVision(env: Env): Promise<string> {
  return (await env.USERS_KV.get(PROMPT_VISION)) ?? DEFAULT_VISION_PROMPT;
}
export async function setPromptVision(env: Env, text: string) {
  await env.USERS_KV.put(PROMPT_VISION, text);
}
export async function getPromptStyle(env: Env, style: string): Promise<string> {
  return (await env.USERS_KV.get(PROMPT_STYLE(style))) ?? DEFAULT_STYLE_PROMPTS[style] ?? DEFAULT_STYLE_PROMPTS["PA"];
}
export async function setPromptStyle(env: Env, style: string, text: string) {
  await env.USERS_KV.put(PROMPT_STYLE(style), text);
}

export const DEFAULT_BASE_PROMPT = `شما یک تحلیل‌گر حرفه‌ای بازار مالی هستید.
خروجی برای کاربر باید «متن معمولی، واضح و اجرایی» و به زبان فارسی باشد (بدون کدنویسی و بدون اشاره به ابزارها).
از اندیکاتورها استفاده نکن مگر وقتی صراحتاً درخواست شده باشد.
همیشه مدیریت ریسک، سناریوی جایگزین و نقطه ابطال (Invalidation) را ذکر کن.
در انتهای پاسخ، فقط برای رسم چارت، دقیقاً یک بلوک \`\`\`json قرار بده که zones و levels را داشته باشد.`;

export const DEFAULT_VISION_PROMPT = `اگر کاربر تصویر/چارت فرستاد:
- ساختار بازار، روند، نواحی عرضه/تقاضا، نقدینگی و نقاط ورود/خروج را شناسایی کن.
- خروجی با همان قالب تحلیلی + بلوک JSON باشد.`;

export const DEFAULT_STYLE_PROMPTS: Record<string, string> = {
  "PA": "You are a professional Price Action trader and market analyst.\n\nAnalyze the given market (Symbol, Timeframe) using pure Price Action concepts only.\nDo NOT use indicators unless explicitly requested.\n\nYour analysis must include:\n\n1. Market Structure\n- Identify the current structure (Uptrend / Downtrend / Range)\n- Mark HH, HL, LH, LL\n- Specify whether structure is intact or broken (BOS / MSS)\n\n2. Key Levels\n- Strong Support & Resistance zones\n- Flip zones (SR \u2192 Resistance / Resistance \u2192 Support)\n- Psychological levels (if relevant)\n\n3. Candlestick Behavior\n- Identify strong rejection candles (Pin bar, Engulfing, Inside bar)\n- Explain what these candles indicate about buyers/sellers\n\n4. Entry Scenarios\nFor each valid setup:\n- Entry zone\n- Stop Loss (logical, structure-based)\n- Take Profit targets (TP1 / TP2)\n- Risk to Reward (minimum 1:2)\n\n5. Bias & Scenarios\n- Main bias (Bullish / Bearish / Neutral)\n- Alternative scenario if price invalidates the setup\n\n6. Execution Plan\n- Is this a continuation or reversal trade?\n- What confirmation is required before entry?\n\nExplain everything step-by-step, clearly and professionally.\nAvoid overtrading. Focus on high-probability setups only.\n",
  "ICT": "You are an ICT (Inner Circle Trader) & Smart Money analyst.\n\nAnalyze the market (Symbol, Timeframe) using ICT & Smart Money Concepts ONLY.\n\nYour analysis must include:\n\n1. Higher Timeframe Bias\n- Determine HTF bias (Daily / H4)\n- Identify Premium & Discount zones\n- Is price in equilibrium or imbalance?\n\n2. Liquidity Mapping\n- Identify:\n  - Equal Highs / Equal Lows\n  - Buy-side liquidity\n  - Sell-side liquidity\n- Mark likely stop-loss pools\n\n3. Market Structure\n- Identify:\n  - BOS (Break of Structure)\n  - MSS (Market Structure Shift)\n- Clarify whether the move is manipulation or expansion\n\n4. PD Arrays\n- Order Blocks (Bullish / Bearish)\n- Fair Value Gaps (FVG)\n- Liquidity Voids\n- Previous High / Low (PDH, PDL, PWH, PWL)\n\n5. Kill Zones (if intraday)\n- London Kill Zone\n- New York Kill Zone\n- Explain timing relevance\n\n6. Entry Model\n- Entry model used (e.g. Liquidity Sweep \u2192 MSS \u2192 FVG entry)\n- Entry price\n- Stop Loss (below/above OB or swing)\n- Take Profits (liquidity targets)\n\n7. Narrative\n- Explain the story:\n  - Who is trapped?\n  - Where did smart money enter?\n  - Where is price likely engineered to go?\n\nProvide a clear bullish/bearish execution plan and an invalidation point.\n",
  "ATR": "You are a quantitative trading assistant specializing in volatility-based strategies.\n\nAnalyze the market (Symbol, Timeframe) using ATR (Average True Range) as the core tool.\n\nYour analysis must include:\n\n1. Volatility State\n- Current ATR value\n- Compare current ATR with historical average\n- Is volatility expanding or contracting?\n\n2. Market Condition\n- Trending or Ranging?\n- Is the market suitable for breakout or mean reversion?\n\n3. Trade Setup\n- Optimal Entry based on price structure\n- ATR-based Stop Loss:\n  - SL = Entry \u00b1 (ATR \u00d7 Multiplier)\n- ATR-based Take Profit:\n  - TP1, TP2 based on ATR expansion\n\n4. Position Sizing\n- Risk per trade (%)\n- Position size calculation based on SL distance\n\n5. Trade Filtering\n- When NOT to trade based on ATR\n- High-risk volatility conditions (news, spikes)\n\n6. Risk Management\n- Max daily loss\n- Max consecutive losses\n- Trailing Stop logic using ATR\n\n7. Summary\n- Is this trade statistically justified?\n- Expected trade duration\n- Risk classification (Low / Medium / High)\n\nKeep the explanation practical and execution-focused.\n",
  "CUSTOM": "Custom prompt (set after generation)"
};
