import type { BannerConfig, LimitsConfig, PaymentRecord, SessionState, UserProfile } from './types';
import { asBool, asInt, nowMs, stableHash } from './utils';

export interface Env {
  DB: KVNamespace;

  OWNER_ID?: string;
  ADMIN_IDS?: string;

  // defaults
  FREE_DAILY_LIMIT?: string;
  FREE_MONTHLY_LIMIT?: string;
  SUB_DAILY_LIMIT?: string;

  REF_POINTS_PER_INVITE?: string;
  REF_POINTS_PER_SUB_PURCHASE?: string;
  REF_REDEEM_POINTS?: string;

  REF_COMMISSION_STEP_PCT?: string;
  REF_COMMISSION_MAX_PCT?: string;

  SUB_PRICE?: string;
  SUB_DAYS?: string;

  TIMEZONE?: string;
  PUBLIC_BASE_URL?: string;
}

const DEFAULT_SETTINGS = {
  timeframe: 'H4',
  risk: 'medium' as const,
  style: 'ict' as const,
  news: false,
};

export class Storage {
  constructor(private env: Env) {}

  get tz() {
    return this.env.TIMEZONE || 'Europe/Berlin';
  }

  isOwner(userId: number) {
    return String(userId) === String(this.env.OWNER_ID || '');
  }

  isAdmin(userId: number) {
    const admins = (this.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    return this.isOwner(userId) || admins.includes(String(userId));
  }

  async getUser(userId: number): Promise<UserProfile | null> {
    return await this.env.DB.get(`user:${userId}`, { type: 'json' });
  }

  async putUser(user: UserProfile): Promise<void> {
    user.updatedAt = nowMs();
    await this.env.DB.put(`user:${user.id}`, JSON.stringify(user));
  }

  async ensureUser(userId: number, meta?: { username?: string; firstName?: string }): Promise<UserProfile> {
    const existing = await this.getUser(userId);
    if (existing) {
      if (meta?.username && !existing.username) existing.username = meta.username;
      if (meta?.firstName && !existing.firstName) existing.firstName = meta.firstName;
      existing.updatedAt = nowMs();
      await this.putUser(existing);
      return existing;
    }

    const codes = this.makeReferralCodes(userId);
    for (const c of codes) {
      // store mapping once
      await this.env.DB.put(`ref:${c}`, String(userId));
    }

    const user: UserProfile = {
      id: userId,
      username: meta?.username,
      firstName: meta?.firstName,
      settings: { ...DEFAULT_SETTINGS },
      points: 0,
      successfulInvites: 0,
      commissionPct: 0,
      commissionBalance: 0,
      referralCodes: codes,
      createdAt: nowMs(),
      updatedAt: nowMs(),
    };
    await this.putUser(user);
    return user;
  }

  private makeReferralCodes(userId: number) {
    const base = stableHash(String(userId));
    return Array.from({ length: 5 }).map((_, i) => `r${base}${i + 1}`);
  }

  async setPhoneUnique(userId: number, phoneE164: string): Promise<{ ok: boolean; existingUserId?: number }> {
    const key = `phone:${phoneE164}`;
    const existing = await this.env.DB.get(key);
    if (existing && String(existing) !== String(userId)) {
      return { ok: false, existingUserId: Number(existing) };
    }
    await this.env.DB.put(key, String(userId));
    return { ok: true };
  }

  async setSession(userId: number, session: SessionState | null) {
    const key = `session:${userId}`;
    if (!session) {
      await this.env.DB.delete(key);
      return;
    }
    await this.env.DB.put(key, JSON.stringify(session), { expirationTtl: 60 * 60 * 24 }); // 1 day
  }

  async getSession(userId: number): Promise<SessionState | null> {
    return await this.env.DB.get(`session:${userId}`, { type: 'json' });
  }

  // ---- config ----
  async getLimits(): Promise<LimitsConfig> {
    const stored = await this.env.DB.get('cfg:limits', { type: 'json' });
    if (stored) return stored as LimitsConfig;
    return {
      freeDaily: asInt(this.env.FREE_DAILY_LIMIT, 50),
      freeMonthly: asInt(this.env.FREE_MONTHLY_LIMIT, 500),
      subDaily: asInt(this.env.SUB_DAILY_LIMIT, 50),
    };
  }

  async setLimits(limits: LimitsConfig) {
    await this.env.DB.put('cfg:limits', JSON.stringify(limits));
  }

  async getWalletPublic(): Promise<string> {
    return (await this.env.DB.get('cfg:walletPublic')) || '';
  }

  async setWalletPublic(value: string) {
    await this.env.DB.put('cfg:walletPublic', value);
  }

  async getBanner(): Promise<BannerConfig> {
    const stored = await this.env.DB.get('cfg:banner', { type: 'json' });
    if (stored) return stored as BannerConfig;
    return { enabled: false, text: '', url: '' };
  }

  async setBanner(b: BannerConfig) {
    await this.env.DB.put('cfg:banner', JSON.stringify(b));
  }

  async getBotUsername(): Promise<string | null> {
    return await this.env.DB.get('cfg:botUsername');
  }
  async setBotUsername(username: string) {
    await this.env.DB.put('cfg:botUsername', username);
  }

  async getPrompt(key: 'base' | 'vision' | string): Promise<string | null> {
    return await this.env.DB.get(`prompt:${key}`);
  }
  async setPrompt(key: 'base' | 'vision' | string, value: string) {
    await this.env.DB.put(`prompt:${key}`, value);
  }

  // ---- payments ----
  async putPayment(p: PaymentRecord) {
    await this.env.DB.put(`pay:${p.txid}`, JSON.stringify(p));
  }
  async getPayment(txid: string): Promise<PaymentRecord | null> {
    return await this.env.DB.get(`pay:${txid}`, { type: 'json' });
  }
  async listPendingPayments(limit = 50) {
    const keys = await this.env.DB.list({ prefix: 'pay:' });
    const out: PaymentRecord[] = [];
    for (const k of keys.keys.slice(0, limit)) {
      const p = await this.getPayment(k.name.replace('pay:', ''));
      if (p?.status === 'pending') out.push(p);
    }
    out.sort((a, b) => a.createdAt - b.createdAt);
    return out;
  }

  // ---- custom prompt jobs ----
  async addCustomPromptJob(job: any) {
    await this.env.DB.put(`job:customprompt:${job.id}`, JSON.stringify(job));
  }
  async listCustomPromptJobs(limit = 1000) {
    return await this.env.DB.list({ prefix: 'job:customprompt:', limit });
  }
  async getCustomPromptJob(id: string) {
    return await this.env.DB.get(`job:customprompt:${id}`, { type: 'json' });
  }
  async deleteCustomPromptJob(id: string) {
    await this.env.DB.delete(`job:customprompt:${id}`);
  }


  // ---- generic cache helpers (KV) ----
  async cacheGet<T>(key: string): Promise<T | null> {
    const v = await this.env.DB.get(key, { type: 'json' });
    return (v as any) ?? null;
  }

  async cachePut(key: string, value: any, ttlSec: number) {
    await this.env.DB.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, ttlSec) });
  }

  // ---- points/config helpers ----
  get refPointsPerInvite() {
    return asInt(this.env.REF_POINTS_PER_INVITE, 6);
  }
  get refPointsPerSubPurchase() {
    return asInt(this.env.REF_POINTS_PER_SUB_PURCHASE, 1000);
  }
  get refRedeemPoints() {
    return asInt(this.env.REF_REDEEM_POINTS, 500);
  }
  get refCommissionStepPct() {
    return asInt(this.env.REF_COMMISSION_STEP_PCT, 4);
  }
  get refCommissionMaxPct() {
    return asInt(this.env.REF_COMMISSION_MAX_PCT, 20);
  }
  get subPrice() {
    return asInt(this.env.SUB_PRICE, 10);
  }
  get subDays() {
    return asInt(this.env.SUB_DAYS, 30);
  }
}
