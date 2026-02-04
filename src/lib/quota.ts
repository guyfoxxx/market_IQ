import type { Env } from "../env";
import type { UserProfile } from "../types";
import { monthUtc, todayUtc } from "./utils";
import { putUser } from "./storage";

export function isAdmin(u: UserProfile, env: Env): boolean {
  const ownerId = env.OWNER_ID ? Number(env.OWNER_ID) : undefined;
  if (ownerId && u.id === ownerId) return true;
  const admins = (env.ADMIN_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean).map(Number);
  return u.role === "ADMIN" || u.role === "OWNER" || admins.includes(u.id);
}

export function isOwner(u: UserProfile, env: Env): boolean {
  const ownerId = env.OWNER_ID ? Number(env.OWNER_ID) : undefined;
  return (ownerId && u.id === ownerId) || u.role === "OWNER";
}

export async function ensureQuotaReset(env: Env, u: UserProfile) {
  // Fully defensive: some old KV records may miss quota or its fields.
  const anyU: any = u as any;
  if (!anyU.quota || typeof anyU.quota !== "object") {
    anyU.quota = { dailyUsed: 0, monthlyUsed: 0, lastDailyReset: todayUtc(), lastMonthlyReset: monthUtc() };
  }
  const q: any = anyU.quota;

  if (q.dailyUsed == null) q.dailyUsed = 0;
  if (q.monthlyUsed == null) q.monthlyUsed = 0;
  if (!q.lastDailyReset) q.lastDailyReset = todayUtc();
  if (!q.lastMonthlyReset) q.lastMonthlyReset = monthUtc();

  const today = todayUtc();
  const month = monthUtc();

  if (q.lastDailyReset !== today) {
    q.lastDailyReset = today;
    q.dailyUsed = 0;
  }
  if (q.lastMonthlyReset !== month) {
    q.lastMonthlyReset = month;
    q.monthlyUsed = 0;
  }

  // Ensure we persist the repaired structure so the next update won't crash
  await putUser(env, anyU as UserProfile);
}


export function getLimits(env: Env, u: UserProfile) {
  if (isAdmin(u, env)) {
    return { daily: Number.POSITIVE_INFINITY, monthly: Number.POSITIVE_INFINITY };
  }
  const freeDaily = Number(env.FREE_DAILY_LIMIT ?? "50");
  const freeMonthly = Number(env.FREE_MONTHLY_LIMIT ?? "500");
  const subDaily = Number(env.SUB_DAILY_LIMIT ?? "50");

  if (u.subscription.active && u.subscription.expiresAt && Date.parse(u.subscription.expiresAt) > Date.now()) {
    return { daily: subDaily, monthly: Number.POSITIVE_INFINITY };
  }
  return { daily: freeDaily, monthly: freeMonthly };
}

export function remaining(env: Env, u: UserProfile) {
  const lim = getLimits(env, u);
  const dailyLeft = Number.isFinite(lim.daily) ? Math.max(0, lim.daily - u.quota.dailyUsed) : Infinity;
  const monthLeft = Number.isFinite(lim.monthly) ? Math.max(0, lim.monthly - u.quota.monthlyUsed) : Infinity;
  return { dailyLeft, monthLeft, limits: lim };
}

export async function consume(env: Env, u: UserProfile, units = 1): Promise<{ ok: boolean; reason?: string }> {
  await ensureQuotaReset(env, u);
  const { dailyLeft, monthLeft } = remaining(env, u);
  if (dailyLeft !== Infinity && dailyLeft < units) return { ok: false, reason: "سهمیه روزانه شما تمام شده است." };
  if (monthLeft !== Infinity && monthLeft < units) return { ok: false, reason: "سهمیه ماهانه شما تمام شده است." };
  u.quota.dailyUsed += units;
  u.quota.monthlyUsed += units;
  await putUser(env, u);
  return { ok: true };
}
