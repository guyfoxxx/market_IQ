import type { UserProfile } from './types';
import type { Env, Storage } from './storage';
import { asInt, getTZDateKeys } from './utils';

export interface QuotaResult {
  allowed: boolean;
  reason?: string;
  remainingDaily?: number;
  remainingMonthly?: number;
  usedDaily?: number;
  usedMonthly?: number;
  limitDaily?: number;
  limitMonthly?: number;
}

async function incCounter(DB: KVNamespace, key: string, by = 1): Promise<number> {
  const cur = Number(await DB.get(key) || '0');
  const next = cur + by;
  await DB.put(key, String(next), { expirationTtl: 60 * 60 * 24 * 40 }); // keep for a bit
  return next;
}

async function getCounter(DB: KVNamespace, key: string): Promise<number> {
  return Number(await DB.get(key) || '0');
}

export async function checkAndConsume(storage: Storage, env: Env, user: UserProfile, consume = true): Promise<QuotaResult> {
  if (storage.isAdmin(user.id)) {
    return { allowed: true, remainingDaily: Infinity, remainingMonthly: Infinity, usedDaily: 0, usedMonthly: 0, limitDaily: Infinity, limitMonthly: Infinity };
  }

  const tz = env.TIMEZONE || 'Europe/Berlin';
  const { ymd, ym } = getTZDateKeys(tz);

  const isSub = (user.subEnd || 0) > Date.now();
  const freeDaily = asInt(env.FREE_DAILY_LIMIT, 50);
  const freeMonthly = asInt(env.FREE_MONTHLY_LIMIT, 500);
  const subDaily = asInt(env.SUB_DAILY_LIMIT, 50);

  const limitDaily = isSub ? subDaily : freeDaily;
  const limitMonthly = freeMonthly;

  const dailyKey = `quota:daily:${user.id}:${ymd}`;
  const monthlyKey = `quota:monthly:${user.id}:${ym}`;

  const usedDaily = await getCounter(env.DB, dailyKey);
  const usedMonthly = await getCounter(env.DB, monthlyKey);

  if (usedDaily >= limitDaily) {
    return { allowed: false, reason: 'سقف مصرف روزانه شما تمام شده است.', usedDaily, usedMonthly, limitDaily, limitMonthly, remainingDaily: 0, remainingMonthly: Math.max(0, limitMonthly - usedMonthly) };
  }
  if (usedMonthly >= limitMonthly) {
    return { allowed: false, reason: 'سقف مصرف ماهانه شما تمام شده است.', usedDaily, usedMonthly, limitDaily, limitMonthly, remainingDaily: Math.max(0, limitDaily - usedDaily), remainingMonthly: 0 };
  }

  if (!consume) {
    return {
      allowed: true,
      usedDaily,
      usedMonthly,
      limitDaily,
      limitMonthly,
      remainingDaily: Math.max(0, limitDaily - usedDaily),
      remainingMonthly: Math.max(0, limitMonthly - usedMonthly),
    };
  }

  const newDaily = await incCounter(env.DB, dailyKey, 1);
  const newMonthly = await incCounter(env.DB, monthlyKey, 1);

  return {
    allowed: true,
    usedDaily: newDaily,
    usedMonthly: newMonthly,
    limitDaily,
    limitMonthly,
    remainingDaily: Math.max(0, limitDaily - newDaily),
    remainingMonthly: Math.max(0, limitMonthly - newMonthly),
  };
}
