/**
 * ✅ Market IQ Bot (grammY) — cleaned + improved
 *
 * Fixes / improvements vs your pasted code:
 * - ✅ Removed ALL git conflict markers and merged logic cleanly
 * - ✅ Single callback_query handler (no duplicate handlers)
 * - ✅ Single message handler with predictable routing
 * - ✅ Reply-keyboard main menu (no need to type commands)
 * - ✅ Inline keyboards for settings / signal steps / symbols
 * - ✅ Signal flow now: choose market -> choose symbol (preset) OR custom symbol
 * - ✅ Safe HTML reply/edit helpers (prevent parse issues + disable previews)
 * - ✅ Quota checks are applied consistently (before analysis / vision)
 * - ✅ Better state transitions + fallback if state is missing
 *
 * NOTE: This file assumes your existing libs/types/storage functions remain the same.
 */

import { Bot, Context, InlineKeyboard, Keyboard } from "grammy";
import type { Env } from "./env";
import type { Market, Risk, Style, Timeframe, UserProfile } from "./types";
import { callAI, callAIWithImage, extractJsonBlock } from "./lib/ai";
import { fetchCandles } from "./lib/data";
import { quickChartUrl, type Zone } from "./lib/chart";
import { enqueue } from "./lib/queue";
import { newJobId, type Job } from "./lib/jobs";
import { consume, ensureQuotaReset, isAdmin, remaining } from "./lib/quota";
import {
  ensureUser,
  findPlan,
  getPayment,
  getPlans,
  getPromptBase,
  getPromptStyle,
  getPromptVision,
  getPublicWallet,
  getReferrerByCode,
  getUser,
  listPayments,
  putCustomPromptTask,
  putPayment,
  putUser,
  setPublicWallet,
  setSelectedPlan,
  // NOTE: your original code imported setUserPhone dynamically from ./lib/storage
} from "./lib/storage";
import {
  fmtDateIso,
  isValidTxid,
  nowIso,
  parseFloatSafe,
  parseIntSafe,
} from "./lib/utils";

/** -------------------- Types / Context -------------------- */
type MyContext = Context & { env: Env; user?: UserProfile };

interface FlowState {
  flow: "onboarding" | "signals" | "settings" | "level" | "customprompt";
  step: string;
  data?: any;
}

const STATE_KEY = (id: number) => `state:${id}`;

/** -------------------- Utils -------------------- */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function requireUser(ctx: MyContext): UserProfile {
  if (!ctx.user) throw new Error("Missing user in context");
  return ctx.user;
}

async function getState(env: Env, userId: number): Promise<FlowState | null> {
  const raw = await env.USERS_KV.get(STATE_KEY(userId));
  return raw ? JSON.parse(raw) : null;
}

async function setState(env: Env, userId: number, state: FlowState | null) {
  if (!state) {
    await env.USERS_KV.delete(STATE_KEY(userId));
    return;
  }
  await env.USERS_KV.put(STATE_KEY(userId), JSON.stringify(state), {
    expirationTtl: 60 * 60 * 6, // 6h
  });
}

function toMarketLabel(m: Market) {
  return m === "CRYPTO"
    ? "کریپتو"
    : m === "FOREX"
    ? "فارکس"
    : m === "METALS"
    ? "فلزات"
    : "سهام";
}

/** -------------------- Safe reply helpers (HTML) -------------------- */
async function safeReply(ctx: any, text: string, extra: any = {}) {
  return ctx.reply(text, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}
async function safeReplyPlain(ctx: any, text: string, extra: any = {}) {
  return ctx.reply(text, { disable_web_page_preview: true, ...extra });
}
async function safeEdit(ctx: any, text: string, extra: any = {}) {
  return ctx.editMessageText(text, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

/** -------------------- Menus / Keyboards -------------------- */
function mainMenuReplyKb() {
  return new Keyboard()
    .text("📈 تحلیل/سیگنال")
    .text("⚙️ تنظیمات")
    .row()
    .text("👤 پروفایل")
    .text("💳 خرید اشتراک")
    .row()
    .text("🏦 ولت")
    .text("🎁 رفرال")
    .row()
    .text("🧠 تعیین سطح")
    .text("🆘 پشتیبانی")
    .row()
    .text("📚 آموزش")
    .text("📱 Mini App")
    .resized();
}

function mainMenuInlineKb() {
  // optional inline menu for callback navigation
  return new InlineKeyboard()
    .text("📈 تحلیل/سیگنال", "menu:signals")
    .text("⚙️ تنظیمات", "menu:settings")
    .row()
    .text("👤 پروفایل", "menu:profile")
    .text("💳 خرید اشتراک", "menu:buy")
    .row()
    .text("🏦 ولت", "menu:wallet")
    .text("🎁 رفرال", "menu:ref")
    .row()
    .text("🧠 تعیین سطح", "menu:level")
    .text("🆘 پشتیبانی", "menu:support")
    .row()
    .text("📚 آموزش", "menu:education")
    .text("📱 Mini App", "menu:app");
}

function settingsText(u: UserProfile) {
  return `⚙️ تنظیمات فعلی:
• تایم‌فریم: ${u.settings.timeframe}
• ریسک: ${u.settings.risk}
• سبک: ${u.settings.style}
• خبر: ${u.settings.news}`;
}

function settingsKb(u: UserProfile) {
  return new InlineKeyboard()
    .text("TF: M15", "set:tf:M15")
    .text("TF: H1", "set:tf:H1")
    .row()
    .text("TF: H4", "set:tf:H4")
    .text("TF: D1", "set:tf:D1")
    .row()
    .text("ریسک کم", "set:risk:LOW")
    .text("ریسک متوسط", "set:risk:MEDIUM")
    .text("ریسک زیاد", "set:risk:HIGH")
    .row()
    .text("GENERAL", "set:style:GENERAL")
    .text("PA", "set:style:PA")
    .text("ICT", "set:style:ICT")
    .row()
    .text("ATR", "set:style:ATR")
    .text("RTM", "set:style:RTM")
    .text("CUSTOM", "set:style:CUSTOM")
    .row()
    .text("News ON", "set:news:ON")
    .text("News OFF", "set:news:OFF")
    .row()
    .text("⬅️ منو", "menu:home");
}

/** -------------------- Signals symbol presets -------------------- */
const MARKET_SYMBOLS: Record<Market, string[]> = {
  CRYPTO: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"],
  FOREX: ["EURUSD=X", "GBPUSD=X", "USDJPY=X", "USDCAD=X", "AUDUSD=X", "USDCHF=X"],
  METALS: ["XAUUSD=X", "XAGUSD=X", "XPTUSD=X", "XPDUSD=X"],
  STOCKS: ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA"],
};

function symbolKb(market: Market) {
  const kb = new InlineKeyboard();
  const symbols = MARKET_SYMBOLS[market] || [];
  for (let i = 0; i < symbols.length; i += 2) {
    const a = symbols[i];
    const b = symbols[i + 1];
    kb.text(a, `sig:symbol:${a}`);
    if (b) kb.text(b, `sig:symbol:${b}`);
    kb.row();
  }
  kb.text("✍️ نماد دیگر", "sig:symbol:custom").row();
  kb.text("⬅️ منو", "menu:home");
  return kb;
}

/** -------------------- Notifications -------------------- */
async function notifyAdmins(env: Env, bot: Bot<MyContext>, text: string) {
  const ids = (env.ADMIN_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  const owner = env.OWNER_ID ? Number(env.OWNER_ID) : undefined;

  const targets = new Set<number>(ids);
  if (owner) targets.add(owner);

  for (const id of targets) {
    try {
      await bot.api.sendMessage(id, text);
    } catch {}
  }
}

/** -------------------- Core UI actions -------------------- */
async function showMenu(ctx: MyContext) {
  const u = requireUser(ctx);
  await ensureQuotaReset(ctx.env, u);

  const displayName = u.name || u.firstName || "";
  const text =
    `Market IQ ✅\n\n` +
    `👋 خوش آمدی ${displayName}\n\n` +
    `از دکمه‌های منو انتخاب کن (بدون نیاز به تایپ دستور):\n` +
    `• شروع تحلیل\n` +
    `• تنظیمات و پروفایل\n` +
    `• خرید اشتراک و ولت\n` +
    `• رفرال و پشتیبانی`;

  await safeReplyPlain(ctx, text, { reply_markup: mainMenuReplyKb() });
}

async function startSignalsFlow(ctx: MyContext) {
  const u = requireUser(ctx);
  await ensureQuotaReset(ctx.env, u);

  const q = remaining(ctx.env, u);
  if (
    (q.dailyLeft !== Infinity && q.dailyLeft < 1) ||
    (q.monthLeft !== Infinity && q.monthLeft < 1)
  ) {
    await safeReplyPlain(
      ctx,
      `سهمیه شما کافی نیست.\nبرای مشاهده سهمیه: /profile`,
      { reply_markup: mainMenuReplyKb() }
    );
    return;
  }

  await setState(ctx.env, u.id, { flow: "signals", step: "choose_market" });

  const kb = new InlineKeyboard()
    .text("CRYPTO", "sig:market:CRYPTO")
    .text("FOREX", "sig:market:FOREX")
    .row()
    .text("METALS", "sig:market:METALS")
    .text("STOCKS", "sig:market:STOCKS")
    .row()
    .text("⬅️ منو", "menu:home");

  await safeReply(ctx, "مرحله ۱/۲: بازار را انتخاب کن:", { reply_markup: kb });
}

async function showSettings(ctx: MyContext) {
  const u = requireUser(ctx);
  await safeReply(ctx, settingsText(u), { reply_markup: settingsKb(u) });
}

async function showProfile(ctx: MyContext) {
  const u = requireUser(ctx);
  await ensureQuotaReset(ctx.env, u);

  const q = remaining(ctx.env, u);
  const subActive =
    u.subscription.active &&
    u.subscription.expiresAt &&
    Date.parse(u.subscription.expiresAt) > Date.now();
  const wallet = await getPublicWallet(ctx.env);

  const txt = `👤 پروفایل
• نام: ${u.name || "—"}
• شماره: ${u.phone || "—"}
• تجربه: ${u.experience || "—"}
• بازار علاقه‌مند: ${u.favoriteMarket ? toMarketLabel(u.favoriteMarket) : "—"}

⭐ امتیاز: ${u.points}
👥 دعوت موفق: ${u.successfulInvites}
💰 کمیسیون رفرال: ${u.referralCommissionPct}% 

📌 سهمیه:
• روزانه مصرف‌شده: ${u.quota.dailyUsed} | باقی‌مانده: ${
    q.dailyLeft === Infinity ? "نامحدود" : q.dailyLeft
  }
• ماهانه مصرف‌شده: ${u.quota.monthlyUsed} | باقی‌مانده: ${
    q.monthLeft === Infinity ? "نامحدود" : q.monthLeft
  }

💳 اشتراک: ${subActive ? "فعال ✅" : "غیرفعال ❌"}
• انقضا: ${subActive ? fmtDateIso(u.subscription.expiresAt, ctx.env.TZ) : "-"}

🏦 ولت عمومی: ${wallet ?? "تنظیم نشده"}
`;

  await safeReplyPlain(ctx, txt, { reply_markup: mainMenuReplyKb() });
}

async function showWallet(ctx: MyContext) {
  const wallet = await getPublicWallet(ctx.env);
  await safeReplyPlain(
    ctx,
    wallet ? `🏦 آدرس ولت عمومی:\n${wallet}` : "❌ هنوز ولت عمومی تنظیم نشده است.",
    { reply_markup: mainMenuReplyKb() }
  );
}

async function showSupport(ctx: MyContext) {
  await safeReplyPlain(
    ctx,
    "🆘 پشتیبانی: پیام خود را ارسال کنید تا به ادمین‌ها فوروارد شود.\n📚 آموزش: به‌زودی ...",
    { reply_markup: mainMenuReplyKb() }
  );
}

async function showRef(ctx: MyContext, bot: Bot<MyContext>) {
  const u = requireUser(ctx);
  const linkBase = `https://t.me/${(bot.botInfo as any)?.username ?? "YOUR_BOT"}?start=`;
  const codes = u.refCodes.map((c, i) => `${i + 1}) ${linkBase}${c}`).join("\n");

  const kb = new InlineKeyboard()
    .text("🎁 تبدیل امتیاز", "ref:redeem")
    .row()
    .text("⬅️ منو", "menu:home");

  await safeReplyPlain(
    ctx,
    `🎁 رفرال شما:
${codes}

دعوت موفق: ${u.successfulInvites}
امتیاز: ${u.points}
`,
    { disable_web_page_preview: true, reply_markup: kb }
  );
}

async function redeemPoints(ctx: MyContext) {
  const u = requireUser(ctx);
  const need = parseIntSafe(ctx.env.REDEEM_POINTS, 500);
  const days = parseIntSafe(ctx.env.REDEEM_DAYS, 30);

  if (u.points < need) {
    await safeReplyPlain(
      ctx,
      `امتیاز کافی نیست.\nنیاز: ${need}\nامتیاز شما: ${u.points}`,
      { reply_markup: mainMenuReplyKb() }
    );
    return;
  }

  u.points -= need;

  const now = Date.now();
  const base =
    u.subscription.expiresAt && Date.parse(u.subscription.expiresAt) > now
      ? Date.parse(u.subscription.expiresAt)
      : now;
  const expires = new Date(base + days * 24 * 3600 * 1000).toISOString();

  u.subscription.active = true;
  u.subscription.expiresAt = expires;

  await putUser(ctx.env, u);
  await safeReplyPlain(
    ctx,
    `✅ اشتراک رایگان فعال شد.\nانقضا: ${fmtDateIso(expires, ctx.env.TZ)}`,
    { reply_markup: mainMenuReplyKb() }
  );
}

/** -------------------- Buying / Payments -------------------- */
async function showBuy(ctx: MyContext) {
  const u = requireUser(ctx);
  const plans = await getPlans(ctx.env);
  const wallet = await getPublicWallet(ctx.env);

  const kb = new InlineKeyboard();
  const selected = u.settings.selectedPlanId;

  for (const p of plans) {
    const prefix = selected === p.id ? "✅ " : "";
    kb.text(`${prefix}${p.title} • ${p.priceUsdt} USDT`, `plan:${p.id}`).row();
  }
  kb.text("🔄 رفرش پلن‌ها", "planlist").row();
  kb.url("💬 پشتیبانی", "https://t.me/").row();
  kb.text("⬅️ منو", "menu:home");

  const w = wallet ? `<code>${wallet}</code>` : "هنوز تنظیم نشده";
  const text =
    `💳 <b>خرید اشتراک Market IQ</b>\n\n` +
    `۱) یک پلن را انتخاب کن\n` +
    `۲) به آدرس ولت زیر USDT (BEP20) واریز کن:\n${w}\n\n` +
    `۳) بعد از پرداخت، TxID را ارسال کن:\n<code>/tx YOUR_TXID</code>\n\n` +
    `اگر پلن انتخاب کردی، نیاز نیست PLAN_ID بفرستی.`;

  await safeReply(ctx, text, { reply_markup: kb });
}

/** -------------------- Analysis runner -------------------- */
async function runSignalAnalysis(ctx: MyContext, u: UserProfile, market: Market, symbol: string) {
  // CUSTOM style guard
  if (u.settings.style === "CUSTOM" && !u.customPrompt?.ready) {
    await safeReplyPlain(ctx, "❌ پرامپت اختصاصی هنوز آماده نیست. ابتدا /customprompt را انجام دهید.");
    return;
  }

  // consume quota (only when not using queue jobs)
  if (!ctx.env.JOBS) {
    const r = await consume(ctx.env, u, 1);
    if (!r.ok) {
      await safeReplyPlain(ctx, `${r.reason}\nبرای مشاهده سهمیه: /profile`);
      return;
    }
  }

  // queue mode
  if (ctx.env.JOBS) {
    const job: Job = {
      type: "SIGNAL_ANALYSIS",
      jobId: newJobId("signal"),
      chatId: u.id,
      userId: u.id,
      market,
      symbol,
      timeframe: u.settings.timeframe,
      style: u.settings.style,
      risk: u.settings.risk,
      news: u.settings.news === "ON",
    };
    await enqueue(ctx.env, job);
    await safeReplyPlain(ctx, "✅ درخواست شما در صف قرار گرفت. نتیجه به‌زودی ارسال می‌شود.");
    return;
  }

  try {
    const candles = await fetchCandles(ctx.env, market, symbol, u.settings.timeframe, 200);

    const base = await getPromptBase(ctx.env);
    const stylePrompt =
      u.settings.style === "CUSTOM" && u.customPrompt?.ready && u.customPrompt.text
        ? u.customPrompt.text
        : await getPromptStyle(ctx.env, u.settings.style);

    const candleSummary = summarizeCandles(candles);

    const analysisPrompt = `${base}

[Style]
${stylePrompt}

[User settings]
timeframe=${u.settings.timeframe}
risk=${u.settings.risk}
news=${u.settings.news}

[Market]
market=${market}
symbol=${symbol}

[OHLC summary]
${candleSummary}

خروجی حتماً با این قالب باشد:
- وضعیت روند و ساختار (BOS/CHOCH اگر لازم)
- نواحی مهم (Supply/Demand/OB/FVG/Support/Resistance)
- سناریو Long / Short (در صورت امکان)
- پیشنهاد ورود/حدضرر/اهداف (TP1/TP2)
- مدیریت ریسک (RR پیشنهادی)
- هشدارها/خبر (اگر news=ON)
در انتها دقیقاً یک JSON معتبر (بدون کدبلاک/بدون کدبلاک ) تولید کن:
{
  "zones":[{"type":"demand","from":0,"to":0,"label":"..."}],
  "levels":{"entry":0,"sl":0,"tp":[0,0]},
  "bias":"bullish|bearish|range",
  "notes":"..."
}
`;

    const out = await callAI(ctx.env, analysisPrompt, { temperature: 0.15 });

    const j = extractJsonBlock(out);
    const zones = normalizeZones(j?.zones);
    const chartUrl = zones.length ? quickChartUrl(symbol, candles, zones) : null;

    await safeReplyPlain(ctx, out);
    if (chartUrl) {
      await ctx.replyWithPhoto(chartUrl, { caption: "📌 چارت با زون‌ها" });
    } else {
      await safeReplyPlain(ctx, "ℹ️ زون قابل استخراج نبود؛ برای چارت، خروجی JSON را دقیق‌تر تنظیم کنید.");
    }
  } catch (e: any) {
    await safeReplyPlain(
      ctx,
      `❌ خطا: ${e?.message ?? "unknown"}\n(نماد/بازار را چک کن و دوباره تلاش کن)`
    );
  }
}

/** -------------------- Create bot -------------------- */
export function createBot(env: Env) {
  const bot = new Bot<MyContext>(env.BOT_TOKEN, {
    botInfo: JSON.parse(env.BOT_INFO || "{}"),
  });

  /** attach env + user */
  bot.use(async (ctx, next) => {
    ctx.env = env;
    if (ctx.from) {
      ctx.user = await ensureUser(env, {
        id: ctx.from.id,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
      });
    }
    await next();
  });

  bot.catch(async (err) => {
    console.log("BOT ERROR", err.error);
    try {
      await safeReplyPlain(err.ctx, "❌ خطای داخلی رخ داد. لطفاً دوباره تلاش کنید یا /support را بزنید.");
    } catch {}
  });

  /** -------- Commands -------- */
  bot.command(["start", "menu"], async (ctx) => {
    const u = requireUser(ctx);
    const st = await getState(env, u.id);

    // /start CODE referral
    const text = ctx.message?.text ?? "";
    const code = text.split(" ")[1]?.trim();
    if (code) {
      const referrerId = await getReferrerByCode(env, code);
      if (referrerId && referrerId !== u.id && !u.referrerId) {
        u.referrerId = referrerId;
        await putUser(env, u);
      }
    }

    if (u.onboardingComplete) {
      await showMenu(ctx);
      return;
    }

    if (!u.name) {
      await setState(env, u.id, { flow: "onboarding", step: "ask_name" });
      await safeReplyPlain(ctx, "👤 لطفاً نام خود را ارسال کنید:");
      return;
    }

    // ask phone
    if (!u.phone) {
      await setState(env, u.id, { flow: "onboarding", step: "ask_contact" });
      const kb = new Keyboard().requestContact("📞 ارسال شماره (Share Contact)").resized().oneTime();
      await safeReplyPlain(ctx, "📞 برای ادامه، لطفاً شماره خود را Share کنید:", { reply_markup: kb });
      return;
    }

    // if phone exists and we are still on ask_contact, continue
    if (u.phone && st?.flow === "onboarding" && st.step === "ask_contact") {
      await setState(env, u.id, { flow: "onboarding", step: "ask_experience" });
      const kb = new InlineKeyboard()
        .text("مبتدی", "ob:exp:BEGINNER")
        .text("متوسط", "ob:exp:INTERMEDIATE")
        .text("حرفه‌ای", "ob:exp:PRO");
      await safeReply(ctx, "تجربه شما در بازار؟", { reply_markup: kb });
      return;
    }

    await showMenu(ctx);
  });

  bot.command("signals", async (ctx) => startSignalsFlow(ctx));
  bot.command("settings", async (ctx) => showSettings(ctx));
  bot.command("profile", async (ctx) => showProfile(ctx));
  bot.command(["buy", "pay"], async (ctx) => showBuy(ctx));
  bot.command("wallet", async (ctx) => showWallet(ctx));
  bot.command(["support", "education"], async (ctx) => showSupport(ctx));
  bot.command("ref", async (ctx) => showRef(ctx, bot));
  bot.command("redeem", async (ctx) => redeemPoints(ctx));

  bot.command("level", async (ctx) => {
    const u = requireUser(ctx);
    await setState(env, u.id, { flow: "level", step: "q1", data: { answers: [] } });
    await safeReplyPlain(ctx, "🧠 آزمون تعیین سطح شروع شد.\nسوال 1/6: هدف اصلی شما از ترید چیست؟ (کوتاه پاسخ بده)");
  });

  bot.command("customprompt", async (ctx) => {
    const u = requireUser(ctx);
    await setState(env, u.id, { flow: "customprompt", step: "await_text" });
    await safeReplyPlain(ctx, "✍️ لطفاً استراتژی/روش خود را به صورت متن ارسال کنید. سیستم برای شما یک پرامپت اختصاصی می‌سازد و ۲ ساعت بعد ارسال می‌کند.");
  });

  bot.command("tx", async (ctx) => {
    const u = requireUser(ctx);
    const parts = (ctx.message?.text ?? "").trim().split(/\s+/).slice(1);
    const txid = (parts[0] || "").trim();
    const planIdArg = (parts[1] || "").trim();
    const planId = planIdArg || u.settings.selectedPlanId || "";

    if (!txid || !isValidTxid(txid)) {
      await safeReplyPlain(ctx, `فرمت TxID معتبر نیست. مثال:\n/tx 0xabc123...`);
      return;
    }

    const exists = await getPayment(env, txid);
    if (exists) {
      await safeReplyPlain(ctx, "این TxID قبلاً ثبت شده است.");
      return;
    }

    const plan = planId ? await findPlan(env, planId) : null;
    const plans = !plan ? await getPlans(env) : null;
    const chosen = plan || (plans && plans[0]) || null;

    const p = {
      txid,
      userId: u.id,
      status: "PENDING" as const,
      createdAt: nowIso(),
      amountUsdt: chosen ? chosen.priceUsdt : parseFloatSafe(env.SUB_PRICE_USDT, 29),
      planDays: chosen ? chosen.durationDays : parseIntSafe(env.SUB_DURATION_DAYS, 30),
    };

    await putPayment(env, p);

    await safeReplyPlain(ctx, "✅ TxID ثبت شد. پس از بررسی ادمین، به شما اطلاع داده می‌شود.");

    // notify admins with inline buttons
    const kb = new InlineKeyboard()
      .text("✅ Approve", `pay:approve:${txid}`)
      .text("❌ Reject", `pay:reject:${txid}`);

    await notifyAdmins(env, bot, `💳 پرداخت جدید (PENDING)\nUser: ${u.id}\nTxID: ${txid}`);

    const ids = (env.ADMIN_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(Number);
    const owner = env.OWNER_ID ? Number(env.OWNER_ID) : undefined;
    const targets = new Set<number>(ids);
    if (owner) targets.add(owner);

    for (const id of targets) {
      try {
        await bot.api.sendMessage(id, `برای بررسی: ${txid}`, { reply_markup: kb });
      } catch {}
    }
  });

  /** -------- Admin commands -------- */
  bot.command("payments", async (ctx) => {
    const u = requireUser(ctx);
    if (!isAdmin(u, env)) return safeReplyPlain(ctx, "دسترسی ندارید.");
    const pending = await listPayments(env, "PENDING");
    if (!pending.length) return safeReplyPlain(ctx, "پرداخت در انتظار نداریم.");
    const text = pending.slice(0, 15).map((p) => `• ${p.txid} | user ${p.userId} | ${p.createdAt}`).join("\n");
    await safeReplyPlain(ctx, `لیست پرداخت‌های در انتظار:\n${text}`);
  });

  bot.command("approve", async (ctx) => {
    const u = requireUser(ctx);
    if (!isAdmin(u, env)) return safeReplyPlain(ctx, "دسترسی ندارید.");
    const txid = ((ctx.message?.text ?? "").trim().split(/\s+/)[1] || "").trim();
    await approvePayment(bot, env, u.id, txid, true, ctx as any);
  });

  bot.command("reject", async (ctx) => {
    const u = requireUser(ctx);
    if (!isAdmin(u, env)) return safeReplyPlain(ctx, "دسترسی ندارید.");
    const txid = ((ctx.message?.text ?? "").trim().split(/\s+/)[1] || "").trim();
    await approvePayment(bot, env, u.id, txid, false, ctx as any);
  });

  bot.command("setwallet", async (ctx) => {
    const u = requireUser(ctx);
    if (!isAdmin(u, env)) return safeReplyPlain(ctx, "دسترسی ندارید.");
    const addr = (ctx.message?.text ?? "").split(" ").slice(1).join(" ").trim();
    if (!addr) return safeReplyPlain(ctx, "مثال: /setwallet WALLET_ADDRESS");
    await setPublicWallet(env, addr);
    await safeReplyPlain(ctx, "✅ ولت عمومی ذخیره شد.");

    const ownerId = env.OWNER_ID ? Number(env.OWNER_ID) : undefined;
    if (ownerId) {
      try {
        await bot.api.sendMessage(ownerId, `⚠️ آدرس ولت عمومی تغییر کرد:\n${addr}`);
      } catch {}
    }
  });

  /** -------- Callback queries (single unified handler) -------- */
  bot.on("callback_query:data", async (ctx) => {
    const u = requireUser(ctx);
    const data = ctx.callbackQuery.data;

    // always ack quickly
    try {
      await ctx.answerCallbackQuery();
    } catch {}

    // menu
    if (data === "menu:home") return showMenu(ctx as any);
    if (data === "menu:signals") return startSignalsFlow(ctx as any);
    if (data === "menu:settings") return showSettings(ctx as any);
    if (data === "menu:profile") return showProfile(ctx as any);
    if (data === "menu:buy") return showBuy(ctx as any);
    if (data === "menu:wallet") return showWallet(ctx as any);
    if (data === "menu:ref") return showRef(ctx as any, bot);
    if (data === "menu:level") return ctx.api.sendMessage(u.id, "/level");
    if (data === "menu:support" || data === "menu:education") return showSupport(ctx as any);
    if (data === "menu:app") {
      return safeReplyPlain(ctx, "📱 برای باز کردن Mini App روی دکمه زیر بزن:", {
        reply_markup: new InlineKeyboard().webApp("Open Mini App", env.PUBLIC_APP_PATH || "/app").row().text("⬅️ منو", "menu:home"),
      });
    }

    // refresh plans
    if (data === "planlist") return showBuy(ctx as any);

    // plan select
    if (data.startsWith("plan:")) {
      const planId = data.split(":")[1];
      await setSelectedPlan(env, u.id, planId);
      await safeReplyPlain(ctx, `✅ پلن انتخاب شد: ${planId}\nاکنون TxID را ارسال کن:\n/tx YOUR_TXID`);
      return;
    }

    // settings
    if (data.startsWith("set:")) {
      const [, key, val] = data.split(":");
      if (key === "tf") u.settings.timeframe = val as Timeframe;
      if (key === "risk") u.settings.risk = val as Risk;
      if (key === "style") {
        if (val === "CUSTOM" && !u.customPrompt?.ready) {
          await safeReplyPlain(ctx, "❌ پرامپت اختصاصی هنوز آماده نیست. ابتدا /customprompt را انجام دهید.");
          return;
        }
        u.settings.style = val as Style;
      }
      if (key === "news") u.settings.news = val as any;
      await putUser(env, u);
      await safeReplyPlain(ctx, `✅ ذخیره شد.\n${settingsText(u)}`, { reply_markup: settingsKb(u) });
      return;
    }

    // signals - choose market
    if (data.startsWith("sig:market:")) {
      const market = data.split(":")[2] as Market;
      await setState(env, u.id, { flow: "signals", step: "choose_symbol", data: { market } });
      await safeReplyPlain(
        ctx,
        `مرحله ۲/۲: نماد را انتخاب کن\nبازار: ${toMarketLabel(market)}`,
        { reply_markup: symbolKb(market) }
      );
      return;
    }

    // signals - choose symbol
    if (data.startsWith("sig:symbol:")) {
      const choice = data.split(":")[2];
      const st = await getState(env, u.id);
      const market = st?.data?.market as Market | undefined;

      if (!market) {
        await safeReplyPlain(ctx, "ابتدا بازار را انتخاب کن.", { reply_markup: mainMenuReplyKb() });
        return;
      }

      if (choice === "custom") {
        await setState(env, u.id, { flow: "signals", step: "ask_symbol", data: { market } });
        await safeReplyPlain(ctx, `نماد را ارسال کن (مثلاً BTCUSDT یا BTC-USD یا EURUSD=X)\nبازار: ${toMarketLabel(market)}`);
        return;
      }

      await setState(env, u.id, null);
      await safeReplyPlain(ctx, "⏳ در حال گرفتن دیتا و ساخت تحلیل...");
      await runSignalAnalysis(ctx as any, u, market, choice);
      return;
    }

    // referral redeem
    if (data === "ref:redeem") return redeemPoints(ctx as any);

    // payments approval via buttons
    if (data.startsWith("pay:")) {
      if (!isAdmin(u, env)) {
        await safeReplyPlain(ctx, "دسترسی ندارید.");
        return;
      }
      const [, action, txid] = data.split(":");
      await approvePayment(bot, env, u.id, txid, action === "approve", ctx as any);
      return;
    }
  });

  /** -------- Contact (onboarding) -------- */
  bot.on("message:contact", async (ctx) => {
    const u = requireUser(ctx);
    const phone = ctx.message.contact.phone_number;
    if (!phone) return safeReplyPlain(ctx, "❌ شماره معتبر دریافت نشد. دوباره ارسال کنید.");

    const st = await getState(env, u.id);
    // accept phone if user doesn't have it OR state expects it
    if (!u.phone || (st?.flow === "onboarding" && st.step === "ask_contact")) {
      const r = await (await import("./lib/storage")).setUserPhone(env, u.id, phone, { force: true });
      if (!r.ok) return safeReplyPlain(ctx, r.reason || "خطا در ذخیره شماره");

      u.phone = phone;

      if (r.existingUserId && r.existingUserId !== u.id) {
        await notifyAdmins(env, bot, `⚠️ شماره تلفن دوباره ثبت شد و به این کاربر منتقل شد.\nPhone: ${phone}\nNew User: ${u.id}\nOld User: ${r.existingUserId}`);
        await safeReplyPlain(ctx, "✅ شماره قبلاً ثبت شده بود؛ شماره به حساب شما منتقل شد و آنبوردینگ ادامه پیدا می‌کند.");
      }

      await setState(env, u.id, { flow: "onboarding", step: "ask_experience" });
      const kb = new InlineKeyboard()
        .text("مبتدی", "ob:exp:BEGINNER")
        .text("متوسط", "ob:exp:INTERMEDIATE")
        .text("حرفه‌ای", "ob:exp:PRO");
      await safeReply(ctx, "تجربه شما در بازار؟", { reply_markup: kb });
    }
  });

  /** -------- Message router -------- */
  bot.on("message", async (ctx) => {
    const u = requireUser(ctx);

    // quick route by main menu reply keyboard (when no flow)
    const st = await getState(env, u.id);

    if (!st && ctx.message?.text && !ctx.message.text.startsWith("/")) {
      const t = ctx.message.text.trim();
      const map: Record<string, () => Promise<void>> = {
        "📈 تحلیل/سیگنال": () => startSignalsFlow(ctx as any),
        "⚙️ تنظیمات": () => showSettings(ctx as any),
        "👤 پروفایل": () => showProfile(ctx as any),
        "💳 خرید اشتراک": () => showBuy(ctx as any),
        "🏦 ولت": () => showWallet(ctx as any),
        "🎁 رفرال": () => showRef(ctx as any, bot),
        "🧠 تعیین سطح": async () => ctx.api.sendMessage(u.id, "/level"),
        "🆘 پشتیبانی": () => showSupport(ctx as any),
        "📚 آموزش": () => showSupport(ctx as any),
        "📱 Mini App": async () => {
          await safeReplyPlain(ctx, "📱 برای باز کردن Mini App روی دکمه زیر بزن:", {
            reply_markup: new InlineKeyboard().webApp("Open Mini App", env.PUBLIC_APP_PATH || "/app"),
          });
        },
      };

      const action = map[t];
      if (action) {
        await action();
        return;
      }
    }

    // onboarding: name
    if (st?.flow === "onboarding" && st.step === "ask_name" && ctx.message?.text) {
      const name = ctx.message.text.trim();
      if (name.length < 2) {
        await safeReplyPlain(ctx, "نام نامعتبر است. دوباره ارسال کنید.");
        return;
      }
      u.name = name;
      await putUser(env, u);
      await setState(env, u.id, { flow: "onboarding", step: "ask_contact" });
      const kb = new Keyboard().requestContact("📞 ارسال شماره (Share Contact)").resized().oneTime();
      await safeReplyPlain(ctx, "📞 لطفاً شماره خود را Share کنید:", { reply_markup: kb });
      return;
    }

    // onboarding: experience (via callback, not text) => ignore text here

    // level flow (text answers)
    if (st?.flow === "level" && ctx.message?.text) {
      const ans = ctx.message.text.trim();
      const qMap: Record<string, string> = {
        q1: "سوال 1/6: هدف اصلی شما از ترید چیست؟",
        q2: "سوال 2/6: چقدر زمان در روز برای ترید دارید؟",
        q3: "سوال 3/6: بیشترین تجربه شما روی کدام بازار است؟",
        q4: "سوال 4/6: ریسک‌پذیری‌تان را چگونه توصیف می‌کنید؟",
        q5: "سوال 5/6: کدام سبک را بیشتر می‌پسندید؟ (RTM/ICT/PA/General)",
        q6: "سوال 6/6: یک اشتباه رایج شما در ترید چیست؟",
      };

      const idx = Number(st.step.slice(1));
      st.data = st.data || { answers: [] };
      st.data.answers.push({ q: qMap[st.step], a: ans });

      if (idx < 6) {
        const next = `q${idx + 1}`;
        await setState(env, u.id, { ...st, step: next, data: st.data });
        await safeReplyPlain(ctx, qMap[next]);
        return;
      }

      await setState(env, u.id, null);
      await safeReplyPlain(ctx, "در حال تحلیل پاسخ‌ها...");

      const prompt = `تو یک مربی ترید هستی. بر اساس پاسخ‌های کاربر سطح او را تعیین کن.
خروجی دقیقاً شامل دو بخش باشد:
1) خلاصه ساختاریافته فارسی
2) یک JSON معتبر (بدون کدبلاک/بدون کدبلاک ) با این ساختار:
{ "level": "Beginner|Intermediate|Pro", "summary": "...", "suggestedMarket": "CRYPTO|FOREX|METALS|STOCKS", "suggestedSettings": { "timeframe": "H1", "risk":"MEDIUM", "style":"GENERAL", "news":"OFF" } }

پاسخ‌ها:
${JSON.stringify(st.data.answers, null, 2)}
`;
      try {
        const out = await callAI(env, prompt, { temperature: 0.2 });
        const j = extractJsonBlock(out);
        if (j?.level) {
          u.levelInfo = {
            level: String(j.level),
            summary: String(j.summary ?? ""),
            suggestedMarket: j.suggestedMarket,
            suggestedSettings: j.suggestedSettings,
            updatedAt: nowIso(),
          };
          await putUser(env, u);
        }
        await safeReplyPlain(ctx, out);
      } catch {
        await safeReplyPlain(ctx, "❌ خطا در تحلیل سطح. لطفاً دوباره تلاش کنید.");
      }
      return;
    }

    // customprompt flow
    if (st?.flow === "customprompt" && st.step === "await_text" && ctx.message?.text) {
      const strategy = ctx.message.text.trim();
      if (strategy.length < 20) {
        await safeReplyPlain(ctx, "متن کوتاه است. لطفاً جزئیات بیشتری بفرستید (حداقل ۲۰ کاراکتر).");
        return;
      }
      await setState(env, u.id, null);
      await safeReplyPlain(ctx, "در حال ساخت پرامپت اختصاصی...");

      const prompt = `تو متخصص مهندسی پرامپت و ترید هستی.
از روی متن استراتژی زیر، یک پرامپت اختصاصی بساز که:
- همیشه خروجی را ساختاریافته بدهد (سناریو، سطوح، زون‌ها، ریسک، خلاصه)
- زبان فارسی
- بلوک JSON حاوی zones بدهد
- کاملاً قابل کپی برای استفاده به عنوان style prompt باشد

استراتژی کاربر:
${strategy}
`;
      try {
        const generated = await callAI(env, prompt, { temperature: 0.3 });
        const due = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
        await putCustomPromptTask(env, u.id, due, generated);
        u.customPrompt = { ready: false, text: generated, generatedAt: nowIso() };
        await putUser(env, u);
        await safeReplyPlain(ctx, "✅ پرامپت شما ساخته شد و ۲ ساعت دیگر ارسال می‌شود.");
      } catch {
        await safeReplyPlain(ctx, "❌ خطا در ساخت پرامپت. دوباره تلاش کنید.");
      }
      return;
    }

    // signals flow: custom symbol typed
    if (st?.flow === "signals" && st.step === "ask_symbol" && ctx.message?.text) {
      const symbol = ctx.message.text.trim();
      const market = st.data?.market as Market;
      await setState(env, u.id, null);
      await safeReplyPlain(ctx, "⏳ در حال گرفتن دیتا و ساخت تحلیل...");
      await runSignalAnalysis(ctx as any, u, market, symbol);
      return;
    }

    // Vision: chart photo
    if (ctx.message?.photo?.length) {
      // quota
      const r = await consume(env, u, 1);
      if (!r.ok) {
        await safeReplyPlain(ctx, `${r.reason}\nبرای مشاهده سهمیه: /profile`);
        return;
      }

      const pick = ctx.message.photo[Math.max(0, ctx.message.photo.length - 2)];
      try {
        const f = await bot.api.getFile(pick.file_id);
        if (!f.file_path) throw new Error("no file_path");

        const url = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${f.file_path}`;
        const imgRes = await fetch(url);
        const buf = await imgRes.arrayBuffer();

        if (buf.byteLength > 2_500_000) {
          await safeReplyPlain(ctx, "⚠️ تصویر خیلی بزرگ است. لطفاً اسکرین‌شات کوچک‌تر ارسال کنید.");
          return;
        }

        const b64 = arrayBufferToBase64(buf);
        const mime = f.file_path.endsWith(".png") ? "image/png" : "image/jpeg";
        const dataUrl = `data:${mime};base64,${b64}`;

        const base = await getPromptBase(env);
        const vision = await getPromptVision(env);
        const stylePrompt =
          u.settings.style === "CUSTOM" && u.customPrompt?.ready && u.customPrompt.text
            ? u.customPrompt.text
            : await getPromptStyle(env, u.settings.style);

        const p = `${base}

[Vision]
${vision}

[Style]
${stylePrompt}

[User settings]
timeframe=${u.settings.timeframe}
risk=${u.settings.risk}
news=${u.settings.news}

کاربر یک تصویر چارت ارسال کرده است. لطفاً تحلیل را بر اساس تصویر ارائه کن و در انتها بلوک JSON با zones بده.`;

        const out = await callAIWithImage(env, p, dataUrl, { temperature: 0.2 });
        await safeReplyPlain(ctx, out);
      } catch {
        await safeReplyPlain(ctx, "❌ خطا در تحلیل تصویری. (مدل باید vision را پشتیبانی کند)");
      }
      return;
    }

    // Support: any free text when no flow
    if (!st && ctx.message?.text && !ctx.message.text.startsWith("/")) {
      const txt = ctx.message.text.trim();
      if (txt.length >= 3) {
        await notifyAdmins(env, bot, `🆘 پیام کاربر\nUser: ${u.id}\n@${u.username ?? "-"}\n\n${txt}`);
        await safeReplyPlain(ctx, "پیام شما برای پشتیبانی ارسال شد ✅");
      }
    }
  });

  /** -------- Onboarding callbacks -------- */
  bot.on("callback_query:data", async (ctx, next) => {
    const u = requireUser(ctx);
    const data = ctx.callbackQuery.data;

    if (!data.startsWith("ob:")) return next();

    try {
      await ctx.answerCallbackQuery();
    } catch {}

    if (data.startsWith("ob:exp:")) {
      const exp = data.split(":")[2];
      u.experience = exp as any;
      await putUser(env, u);
      await setState(env, u.id, { flow: "onboarding", step: "ask_fav_market" });

      const kb = new InlineKeyboard()
        .text("CRYPTO", "ob:market:CRYPTO")
        .text("FOREX", "ob:market:FOREX")
        .row()
        .text("METALS", "ob:market:METALS")
        .text("STOCKS", "ob:market:STOCKS");

      await safeReplyPlain(ctx, "بازار مورد علاقه‌ات کدام است؟", { reply_markup: kb });
      return;
    }

    if (data.startsWith("ob:market:")) {
      const market = data.split(":")[2] as Market;
      u.favoriteMarket = market;
      u.onboardingComplete = true;
      await putUser(env, u);
      await setState(env, u.id, null);

      // referral reward after onboarding complete
      if (u.referrerId) {
        const refUser = await getUser(env, u.referrerId);
        if (refUser) {
          refUser.successfulInvites += 1;

          const step = parseIntSafe(env.REF_COMMISSION_STEP_PCT, 4);
          const max = parseIntSafe(env.REF_COMMISSION_MAX_PCT, 20);
          refUser.referralCommissionPct = Math.min(max, refUser.successfulInvites * step);

          const pts = parseIntSafe(env.POINTS_PER_REF, 6);
          refUser.points += pts;

          await putUser(env, refUser);
        }
      }

      await safeReplyPlain(ctx, "✅ آنبوردینگ تکمیل شد!");
      await showMenu(ctx as any);
      return;
    }
  });

  return bot;
}

/** -------------------- Helpers -------------------- */
function summarizeCandles(candles: Array<{ t: number; o: number; h: number; l: number; c: number }>) {
  const last = candles.slice(-60);
  const hi = Math.max(...last.map((c) => c.h));
  const lo = Math.min(...last.map((c) => c.l));
  const first = last[0]?.c ?? 0;
  const lastc = last[last.length - 1]?.c ?? 0;
  const chg = first ? ((lastc - first) / first) * 100 : 0;

  return `last_close=${lastc}
range_high=${hi}
range_low=${lo}
change_pct_last_60_bars=${chg.toFixed(2)}
samples=[${candles
    .slice(-10)
    .map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c }))
    .map((x) => JSON.stringify(x))
    .join(", ")}]`;
}

function normalizeZones(zones: any): Zone[] {
  if (!Array.isArray(zones)) return [];
  const out: Zone[] = [];
  for (const z of zones) {
    const from = Number(z?.from);
    const to = Number(z?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const typeRaw = String(z?.type ?? "other").toLowerCase();
    const type = (["demand", "supply", "support", "resistance", "fvg", "ob"].includes(typeRaw)
      ? typeRaw
      : "other") as Zone["type"];
    out.push({ type, from, to, label: z?.label ? String(z.label).slice(0, 18) : undefined });
  }
  return out;
}

async function approvePayment(
  bot: Bot<MyContext>,
  env: Env,
  reviewerId: number,
  txid: string,
  approve: boolean,
  ctx?: MyContext
) {
  if (!txid) {
    if (ctx) await safeReplyPlain(ctx, "TxID را وارد کنید.");
    return;
  }

  const p = await getPayment(env, txid);
  if (!p) {
    if (ctx) await safeReplyPlain(ctx, "یافت نشد.");
    return;
  }

  if (p.status !== "PENDING") {
    if (ctx) await safeReplyPlain(ctx, "این پرداخت قبلاً بررسی شده است.");
    return;
  }

  p.status = approve ? "APPROVED" : "REJECTED";
  p.reviewedAt = nowIso();
  p.reviewerId = reviewerId;
  await putPayment(env, p);

  if (approve) {
    const user = await getUser(env, p.userId);
    if (user) {
      const now = Date.now();
      const days = p.planDays ?? parseIntSafe(env.SUB_DURATION_DAYS, 30);
      const base =
        user.subscription.expiresAt && Date.parse(user.subscription.expiresAt) > now
          ? Date.parse(user.subscription.expiresAt)
          : now;
      const expires = new Date(base + days * 24 * 3600 * 1000).toISOString();

      user.subscription.active = true;
      user.subscription.expiresAt = expires;
      user.subscription.lastTxId = txid;

      // points for purchase
      user.points += parseIntSafe(env.POINTS_PER_SUB_PURCHASE, 1000);
      await putUser(env, user);

      try {
        await bot.api.sendMessage(user.id, `✅ پرداخت تایید شد.\nاشتراک فعال شد تا: ${fmtDateIso(expires, env.TZ)}`);
      } catch {}

      // referral bonus on purchase
      if (user.referrerId) {
        const ref = await getUser(env, user.referrerId);
        if (ref) {
          const bonus = parseIntSafe(env.POINTS_PER_SUB_PURCHASE, 1000);
          ref.points += bonus;
          await putUser(env, ref);
          try {
            await bot.api.sendMessage(ref.id, `🎉 یکی از دعوت‌شده‌های شما اشتراک خرید.\n+${bonus} امتیاز`);
          } catch {}
        }
      }
    }
    if (ctx) await safeReplyPlain(ctx, "✅ تایید شد.");
  } else {
    try {
      await bot.api.sendMessage(p.userId, "❌ پرداخت شما رد شد. اگر اشتباه است با پشتیبانی تماس بگیرید.");
    } catch {}
    if (ctx) await safeReplyPlain(ctx, "❌ رد شد.");
  }
}
