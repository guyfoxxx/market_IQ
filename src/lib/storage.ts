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

export const DEFAULT_BASE_PROMPT = `شما یک تحلیل‌گر حرفه‌ای بازار مالی هستید.
خروجی باید «ساختاریافته» و «قابل اجرا» باشد.
همیشه به مدیریت ریسک و سناریوهای جایگزین اشاره کن.
در انتها یک بلوک JSON تولید کن که شامل zones و سطوح کلیدی باشد.`;

export const DEFAULT_VISION_PROMPT = `اگر کاربر تصویر/چارت فرستاد:
- ساختار بازار، روند، نواحی عرضه/تقاضا، نقدینگی و نقاط ورود/خروج را شناسایی کن.
- خروجی با همان قالب تحلیلی + بلوک JSON باشد.`;

export const DEFAULT_STYLE_PROMPTS: Record<string, string> = {
  "RTM": "سبک RTM: تمرکز روی بیس/انگالف/ترپ، نواحی عرضه/تقاضا، ورود از ریفاین.",
  "ICT": "سبک ICT: تمرکز روی Liquidity, Order Block, FVG, BOS/CHOCH, Premium/Discount.",
  "PA": "پرایس اکشن: ساختار بازار، حمایت/مقاومت، کندل‌خوانی و الگوها.",
  "GENERAL": "تحلیل عمومی: روند، سطوح مهم، سناریوها، ریسک/ریوارد."
};
