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
const CONFIG_PLANS = "config:plans";
const PROMPT_BASE = "prompt:base";
const PROMPT_VISION = "prompt:vision";
const PROMPT_STYLE = (style: string) => `prompt:style:${style}`;


function hydrateUser(env: Env, u: any): { u: UserProfile; changed: boolean } {
  let changed = false;

  const defaultSettings: Settings = {
    timeframe: (env.DEFAULT_TIMEFRAME as Timeframe) ?? "H1",
    risk: (env.DEFAULT_RISK as Risk) ?? "MEDIUM",
    style: (env.DEFAULT_STYLE as Style) ?? "GENERAL",
    news: (env.DEFAULT_NEWS as any) ?? "OFF",
  };

  if (!u || typeof u !== "object") {
    return { u: u as UserProfile, changed: false };
  }
  if (u.id == null) {
    return { u: u as UserProfile, changed: false };
  }

  if (!u.createdAt) { u.createdAt = nowIso(); changed = true; }
  if (!u.role) { u.role = "USER"; changed = true; }

  // Settings
  if (!u.settings) { u.settings = { ...defaultSettings }; changed = true; }
  else {
    const before = JSON.stringify(u.settings);
    u.settings = { ...defaultSettings, ...u.settings };
    if (JSON.stringify(u.settings) !== before) changed = true;
  }

  // Quota (backward compatible)
  if (!u.quota) { u.quota = { dailyUsed: 0, monthlyUsed: 0, lastDailyReset: todayUtc(), lastMonthlyReset: monthUtc() }; changed = true; }
  if (u.quota.dailyUsed == null) { u.quota.dailyUsed = 0; changed = true; }
  if (u.quota.monthlyUsed == null) { u.quota.monthlyUsed = 0; changed = true; }
  if (!u.quota.lastDailyReset) { u.quota.lastDailyReset = todayUtc(); changed = true; }
  if (!u.quota.lastMonthlyReset) { u.quota.lastMonthlyReset = monthUtc(); changed = true; }

  // Points / referral
  if (u.points == null) { u.points = 0; changed = true; }
  if (u.successfulInvites == null) { u.successfulInvites = 0; changed = true; }
  if (!Array.isArray(u.refCodes) || u.refCodes.length !== 5) {
    u.refCodes = Array.from({ length: 5 }, () => randomCode(8));
    changed = true;
  }
  if (u.referralCommissionPct == null) { u.referralCommissionPct = 0; changed = true; }

  // Subscription / wallet / custom prompt
  if (!u.subscription) { u.subscription = { active: false }; changed = true; }
  if (!u.wallet) { u.wallet = {}; changed = true; }
  if (!u.customPrompt) { u.customPrompt = { ready: false }; changed = true; }

  return { u: u as UserProfile, changed };
}

export async function getUser(env: Env, id: number): Promise<UserProfile | null> {
  const raw = await env.USERS_KV.get(USER_KEY(id));
  if (!raw) return null;
  const parsed = JSON.parse(raw) as any;
  const { u, changed } = hydrateUser(env, parsed);
  if (changed) await putUser(env, u);
  return u;
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
    style: (env.DEFAULT_STYLE as Style) ?? "GENERAL",
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


export interface SubscriptionPlan {
  id: string;        // e.g. "m1"
  title: string;     // display
  priceUsdt: number; // expected payment
  durationDays: number;
}

export async function getPlans(env: Env): Promise<SubscriptionPlan[]> {
  const raw = (await env.USERS_KV.get(CONFIG_PLANS, "json").catch(() => null)) as any;
  if (Array.isArray(raw) && raw.length) {
    return raw
      .map((p: any) => ({
        id: String(p.id || "").trim(),
        title: String(p.title || "").trim() || String(p.id || "").trim(),
        priceUsdt: Number(p.priceUsdt ?? p.price_usdt ?? p.price ?? 0),
        durationDays: Number(p.durationDays ?? p.duration_days ?? p.days ?? 0),
      }))
      .filter((p: any) => p.id && p.priceUsdt > 0 && p.durationDays > 0);
  }

  const price = Number((env as any).SUB_PRICE_USDT || 29);
  const days = Number((env as any).SUB_DURATION_DAYS || 30);
  return [{ id: "m1", title: `Monthly (${days}d)`, priceUsdt: price, durationDays: days }];
}

export async function setPlans(env: Env, plans: SubscriptionPlan[]) {
  await env.USERS_KV.put(CONFIG_PLANS, JSON.stringify(plans));
}

export async function findPlan(env: Env, id: string): Promise<SubscriptionPlan | null> {
  const plans = await getPlans(env);
  return plans.find((p) => p.id === id) || null;
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
  return (await env.USERS_KV.get(PROMPT_STYLE(style))) ?? DEFAULT_STYLE_PROMPTS[style] ?? DEFAULT_STYLE_PROMPTS["GENERAL"];
}
export async function setPromptStyle(env: Env, style: string, text: string) {
  await env.USERS_KV.put(PROMPT_STYLE(style), text);
}

export async function getPromptBaseRaw(env: Env): Promise<{ text: string; source: "override" | "default" }> {
  const v = await env.USERS_KV.get(PROMPT_BASE);
  return { text: v ?? DEFAULT_BASE_PROMPT, source: v == null ? "default" : "override" };
}
export async function resetPromptBase(env: Env) {
  await env.USERS_KV.delete(PROMPT_BASE);
}

export async function getPromptVisionRaw(env: Env): Promise<{ text: string; source: "override" | "default" }> {
  const v = await env.USERS_KV.get(PROMPT_VISION);
  return { text: v ?? DEFAULT_VISION_PROMPT, source: v == null ? "default" : "override" };
}
export async function resetPromptVision(env: Env) {
  await env.USERS_KV.delete(PROMPT_VISION);
}

export async function getPromptStyleRaw(env: Env, style: string): Promise<{ text: string; source: "override" | "default" }> {
  const key = PROMPT_STYLE(style);
  const v = await env.USERS_KV.get(key);
  const def = DEFAULT_STYLE_PROMPTS[style] ?? DEFAULT_STYLE_PROMPTS["GENERAL"];
  return { text: v ?? def, source: v == null ? "default" : "override" };
}
export async function resetPromptStyle(env: Env, style: string) {
  await env.USERS_KV.delete(PROMPT_STYLE(style));
}

export const DEFAULT_BASE_PROMPT = `شما یک تحلیل‌گر حرفه‌ای بازار مالی هستید.
خروجی باید «ساختاریافته» و «قابل اجرا» باشد.
همیشه به مدیریت ریسک و سناریوهای جایگزین اشاره کن.
در انتها یک JSON معتبر تولید کن که شامل zones و سطوح کلیدی باشد (بدون کدبلاک).`;

export const DEFAULT_VISION_PROMPT = `اگر کاربر تصویر/چارت فرستاد:
- ساختار بازار، روند، نواحی عرضه/تقاضا، نقدینگی و نقاط ورود/خروج را شناسایی کن.
- خروجی با همان قالب تحلیلی + بلوک JSON باشد.`;

export const DEFAULT_STYLE_PROMPTS: Record<string, string> = {
  "PA": `Ali Flah:
You are a professional Price Action trader and market analyst.

Analyze the given market (Symbol, Timeframe) using pure Price Action concepts only.
Do NOT use indicators unless explicitly requested.

Your analysis must include:

1. Market Structure
- Identify the current structure (Uptrend / Downtrend / Range)
- Mark HH, HL, LH, LL
- Specify whether structure is intact or broken (BOS / MSS)

2. Key Levels
- Strong Support & Resistance zones
- Flip zones (SR → Resistance / Resistance → Support)
- Psychological levels (if relevant)

3. Candlestick Behavior
- Identify strong rejection candles (Pin bar, Engulfing, Inside bar)
- Explain what these candles indicate about buyers/sellers

4. Entry Scenarios
For each valid setup:
- Entry zone
- Stop Loss (logical, structure-based)
- Take Profit targets (TP1 / TP2)
- Risk to Reward (minimum 1:2)

5. Bias & Scenarios
- Main bias (Bullish / Bearish / Neutral)
- Alternative scenario if price invalidates the setup

6. Execution Plan
- Is this a continuation or reversal trade?
- What confirmation is required before entry?

Explain everything step-by-step, clearly and professionally.
Avoid overtrading. Focus on high-probability setups only.`,

  "ICT": `You are an ICT (Inner Circle Trader) & Smart Money analyst.

Analyze the market (Symbol, Timeframe) using ICT & Smart Money Concepts ONLY.

Your analysis must include:

1. Higher Timeframe Bias
- Determine HTF bias (Daily / H4)
- Identify Premium & Discount zones
- Is price in equilibrium or imbalance?

2. Liquidity Mapping
- Identify:
  - Equal Highs / Equal Lows
  - Buy-side liquidity
  - Sell-side liquidity
- Mark likely stop-loss pools

3. Market Structure
- Identify:
  - BOS (Break of Structure)
  - MSS (Market Structure Shift)
- Clarify whether the move is manipulation or expansion

4. PD Arrays
- Order Blocks (Bullish / Bearish)
- Fair Value Gaps (FVG)
- Liquidity Voids
- Previous High / Low (PDH, PDL, PWH, PWL)

5. Kill Zones (if intraday)
- London Kill Zone
- New York Kill Zone
- Explain timing relevance

6. Entry Model
- Entry model used (e.g. Liquidity Sweep → MSS → FVG entry)
- Entry price
- Stop Loss (below/above OB or swing)
- Take Profits (liquidity targets)

7. Narrative
- Explain the story:
  - Who is trapped?
  - Where did smart money enter?
  - Where is price likely engineered to go?

Provide a clear bullish/bearish execution plan and an invalidation point.`,

  "ATR": `You are a quantitative trading assistant specializing in volatility-based strategies.

Analyze the market (Symbol, Timeframe) using ATR (Average True Range) as the core tool.

Your analysis must include:

1. Volatility State
- Current ATR value
- Compare current ATR with historical average
- Is volatility expanding or contracting?

2. Market Condition
- Trending or Ranging?
- Is the market suitable for breakout or mean reversion?

3. Trade Setup
- Optimal Entry based on price structure
- ATR-based Stop Loss:
  - SL = Entry ± (ATR × Multiplier)
- ATR-based Take Profit:
  - TP1, TP2 based on ATR expansion

4. Position Sizing
- Risk per trade (%)
- Position size calculation based on SL distance

5. Trade Filtering
- When NOT to trade based on ATR
- High-risk volatility conditions (news, spikes)

6. Risk Management
- Max daily loss
- Max consecutive losses
- Trailing Stop logic using ATR

7. Summary
- Is this trade statistically justified?
- Expected trade duration
- Risk classification (Low / Medium / High)

Keep the explanation practical and execution-focused.`,

  "RTM": "سبک RTM: تمرکز روی بیس/انگالف/ترپ، نواحی عرضه/تقاضا، ورود از ریفاین.",
  "GENERAL": "تحلیل عمومی: روند، سطوح مهم، سناریوها، ریسک/ریوارد."
};


export async function setSelectedPlan(env: Env, userId: number, planId: string) {
  const u = await getUser(env, userId);
  if (!u) return;
  u.settings.selectedPlanId = planId;
  await putUser(env, u);
}
