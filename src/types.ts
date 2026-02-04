export type Risk = "LOW" | "MEDIUM" | "HIGH";
export type Style = "RTM" | "ICT" | "PA" | "ATR" | "GENERAL" | "CUSTOM";
export type Timeframe = "M15" | "H1" | "H4" | "D1";

export type Market = "CRYPTO" | "FOREX" | "METALS" | "STOCKS";

export type Role = "USER" | "ADMIN" | "OWNER";

export interface Settings {
  timeframe: Timeframe;
  risk: Risk;
  style: Style;
  news: "ON" | "OFF";
  selectedPlanId?: string;
}

export interface Subscription {
  active: boolean;
  expiresAt?: string; // ISO
  planDays?: number;
  lastTxId?: string;
}

export interface QuotaState {
  dailyUsed: number;
  monthlyUsed: number;
  lastDailyReset: string;   // YYYY-MM-DD (UTC)
  lastMonthlyReset: string; // YYYY-MM
}

export interface LevelInfo {
  level: string;
  summary: string;
  suggestedMarket?: string;
  suggestedSettings?: Partial<Settings>;
  updatedAt: string;
}

export interface WalletInfo {
  bep20Address?: string;
  balance?: number;
}

export interface UserProfile {
  id: number;
  username?: string;
  firstName?: string;
  name?: string;
  phone?: string;
  experience?: "BEGINNER" | "INTERMEDIATE" | "PRO";
  favoriteMarket?: Market;
  createdAt: string;

  role: Role;

  settings: Settings;
  quota: QuotaState;

  points: number;
  successfulInvites: number;

  referrerId?: number;
  refCodes: string[]; // 5 codes

  referralCommissionPct: number;

  subscription: Subscription;

  customPrompt?: {
    ready: boolean;
    text?: string;
    generatedAt?: string;
  };

  wallet: WalletInfo;

  offerBannerSeenAt?: string;

  levelInfo?: LevelInfo;
}

export interface PaymentRecord {
  txid: string;
  userId: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  reviewedAt?: string;
  reviewerId?: number;
  amountUsdt?: number;
  planDays?: number;
}
