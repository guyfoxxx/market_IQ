export interface Env {
  // Cloudflare Workers AI binding (set in wrangler.toml: [ai] binding = "AI")
  AI: any;
  BOT_TOKEN: string;
  BOT_INFO: string;

  WEBHOOK_SECRET: string;

  USERS_KV: KVNamespace;

  // Optional secrets
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;

  ALPHAVANTAGE_API_KEY?: string;
  TWELVEDATA_API_KEY?: string;
  FINNHUB_API_KEY?: string;
  POLYGON_API_KEY?: string;

  // Payment verification
  BSCSCAN_API_KEY?: string;


  // Vars
  FREE_DAILY_LIMIT: string;
  FREE_MONTHLY_LIMIT: string;
  SUB_DAILY_LIMIT: string;

  POINTS_PER_REF: string;
  POINTS_PER_SUB_PURCHASE: string;
  REDEEM_POINTS: string;
  REDEEM_DAYS: string;

  REF_COMMISSION_STEP_PCT: string;
  REF_COMMISSION_MAX_PCT: string;

  SUB_PRICE_USDT: string;
  SUB_DURATION_DAYS: string;

  DEFAULT_TIMEFRAME: string;
  DEFAULT_RISK: string;
  DEFAULT_STYLE: string;
  DEFAULT_NEWS: string;

  PUBLIC_APP_PATH: string;
  PUBLIC_WALLET_ADDRESS: string;

  ADMIN_PANEL_TOKEN: string;

  ADMIN_IDS?: string;
  OWNER_ID?: string;

  AI_PROVIDER: string;
  OPENAI_MODEL: string;
  GEMINI_MODEL: string;

  TZ: string;

  PAYMENT_NETWORK: string;
  PAYMENT_TOKEN_CONTRACT: string;
  AUTO_VERIFY_PAYMENTS: string;
  MIN_CONFIRMATIONS: string;

  DATA_SOURCES_OTHER?: string;

  DATA_SOURCES_CRYPTO?: string;

  CLOUDFLARE_AI_MODEL?: string;

  AI_CHAIN?: string;
}
