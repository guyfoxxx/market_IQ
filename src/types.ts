export type Market = 'crypto' | 'forex' | 'metals' | 'stocks';

export type Experience = 'beginner' | 'intermediate' | 'pro';
export type Risk = 'low' | 'medium' | 'high';

export type Style =
  | 'rtm'
  | 'ict'
  | 'deep'
  | 'price_action'
  | 'general_prompt'
  | 'custom_prompt';

export interface UserSettings {
  timeframe: string; // e.g. H1/H4/D1
  risk: Risk;
  style: Style;
  news: boolean;
}

export interface LevelResult {
  level: string;
  summary: string;
  suggestedMarket: Market;
  suggestedSettings: Partial<UserSettings>;
}

export interface UserProfile {
  id: number;
  username?: string;
  firstName?: string;

  name?: string;
  phone?: string;

  experience?: Experience;
  favoriteMarket?: Market;

  settings: UserSettings;

  points: number;
  successfulInvites: number;

  commissionPct: number;
  commissionBalance: number;

  subEnd?: number; // epoch ms
  level?: LevelResult;

  referralCodes: string[];
  referrerId?: number;

  bep20Address?: string;
  balance?: number;

  createdAt: number;
  updatedAt: number;

  customPrompt?: string;
  customPromptReady?: boolean;
}

export interface LimitsConfig {
  freeDaily: number;
  freeMonthly: number;
  subDaily: number;
}

export interface BannerConfig {
  enabled: boolean;
  text: string;
  url: string;
}

export interface PaymentRecord {
  txid: string;
  userId: number;
  amount?: number;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  decidedAt?: number;
  note?: string;
}

export type SessionMode =
  | 'onboarding_name'
  | 'onboarding_contact'
  | 'onboarding_experience'
  | 'onboarding_market'
  | 'onboarding_timeframe'
  | 'onboarding_risk'
  | 'onboarding_style'
  | 'onboarding_news'
  | 'level_q'
  | 'signal_market'
  | 'signal_symbol'
  | 'customprompt_wait_text';

export interface SessionState {
  mode: SessionMode;
  step?: number;
  answers?: string[];
  temp?: Record<string, any>;
}
