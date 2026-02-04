import {
  Bot, Context, InlineKeyboard, Keyboard } from "grammy";
import type { Env } from "./env";
import type { Market, Risk, Style, Timeframe, UserProfile } from "./types";
import { callAI, callAIWithImage, extractJsonBlock } from "./lib/ai";
import { fetchCandles } from "./lib/data";
import { quickChartUrl, type Zone } from "./lib/chart";
import { enqueue } from "./lib/queue";
import { newJobId, type Job } from "./lib/jobs";
import { consume, ensureQuotaReset, isAdmin, isOwner, remaining } from "./lib/quota";
import {
  ensureUser,
  getPayment,
  getPromptBase,
  getPromptStyle,
  getPublicWallet,
  getPlans,
  findPlan,
  getReferrerByCode,
  getUser,
  listPayments,
  putCustomPromptTask,
  putPayment,
  putUser,
  setBanner,
  setPromptBase,
  setPromptStyle,
  setPromptVision,
  setPublicWallet,
  setSelectedPlan,
} from "./lib/storage";
import { fmtDateIso, isValidTxid, nowIso, parseFloatSafe, parseIntSafe,
  escapeHtml
} from "./lib/utils";



type MyContext = Context & {
  env: Env;
  user?: UserProfile;
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const STATE_KEY = (id: number) => `state:${id}`;

interface FlowState {
  flow: "onboarding" | "signals" | "settings" | "level" | "customprompt";
  step: string;
  data?: any;
}

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

async function getState(env: Env, userId: number): Promise<FlowState | null> {
  const raw = await env.USERS_KV.get(STATE_KEY(userId));
  return raw ? JSON.parse(raw) : null;
}
async function setState(env: Env, userId: number, state: FlowState | null) {
  if (!state) {
    await env.USERS_KV.delete(STATE_KEY(userId));
    return;
  }
  await env.USERS_KV.put(STATE_KEY(userId), JSON.stringify(state), { expirationTtl: 60 * 60 * 6 }); // 6h
}

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

function toMarketLabel(m: Market) {
  return m === "CRYPTO" ? "کریپتو" : m === "FOREX" ? "فارکس" : m === "METALS" ? "فلزات" : "سهام";
}

function settingsText(u: UserProfile) {
  return `⚙️ تنظیمات فعلی:
• تایم‌فریم: ${u.settings.timeframe}
• ریسک: ${u.settings.risk}
• سبک: ${u.settings.style}
• خبر: ${u.settings.news}`;
}

function settingsKb(u: UserProfile) {
  const kb = new InlineKeyboard()
    .text("TF: M15", "set:tf:M15").text("TF: H1", "set:tf:H1").row()
    .text("TF: H4", "set:tf:H4").text("TF: D1", "set:tf:D1").row()
    .text("ریسک کم", "set:risk:LOW").text("ریسک متوسط", "set:risk:MEDIUM").text("ریسک زیاد", "set:risk:HIGH").row()
    .text("GENERAL", "set:style:GENERAL").text("PA", "set:style:PA").text("ICT", "set:style:ICT").row()
    .text("ATR", "set:style:ATR").text("RTM", "set:style:RTM").text("DEEP", "set:style:DEEP").row()
    .text("CUSTOM", "set:style:CUSTOM").row()
    .text("News ON", "set:news:ON").text("News OFF", "set:news:OFF").row()
    .text("⬅️ منو", "menu:home");
  return kb;
}

function requireUser(ctx: MyContext): UserProfile {
  if (!ctx.user) throw new Error("Missing user in context");
  return ctx.user;
}

async function notifyAdmins(env: Env, bot: Bot<MyContext>, text: string) {
  const ids = (env.ADMIN_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean).map(Number);
  const owner = env.OWNER_ID ? Number(env.OWNER_ID) : undefined;
  const targets = new Set<number>(ids);
  if (owner) targets.add(owner);
  for (const id of targets) {
    try { await bot.api.sendMessage(id, text); } catch {}
  }
}


async function safeReplyPlain(ctx: any, text: string, extra: any = {}) {
  return ctx.reply(text, { disable_web_page_preview: true, ...extra });
}

async function safeReply(ctx: any, text: string, extra: any = {}) {
  return ctx.reply(text, { parse_mode: "HTML", disable_web_page_preview: true, ...extra });
}
async function safeEdit(ctx: any, text: string, extra: any = {}) {
  return ctx.editMessageText(text, { parse_mode: "HTML", disable_web_page_preview: true, ...extra });
}

async function showMenu(ctx: any, env: Env) {
  const u = await ensureUser(env, {
    id: ctx.from!.id,
    username: ctx.from!.username,
    firstName: ctx.from!.first_name,
  });

  await ensureQuotaReset(env, u);

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

export function createBot(env: Env) {
  const bot = new Bot<MyContext>(env.BOT_TOKEN, { botInfo: JSON.parse(env.BOT_INFO || "{}") });

  async function startSignalsFlow(ctx: MyContext) {
    const u = requireUser(ctx);
    await setState(env, u.id, { flow: "signals", step: "choose_market" });
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
    await ensureQuotaReset(env, u);
    const q = remaining(env, u);
    const subActive = u.subscription.active && u.subscription.expiresAt && Date.parse(u.subscription.expiresAt) > Date.now();
    const wallet = await getPublicWallet(env);

    const txt = `👤 پروفایل
• نام: ${u.name || "—"}
• شماره: ${u.phone || "—"}
• تجربه: ${u.experience || "—"}
• بازار علاقه‌مند: ${u.favoriteMarket ? toMarketLabel(u.favoriteMarket) : "—"}

⭐ امتیاز: ${u.points}
👥 دعوت موفق: ${u.successfulInvites}
💰 کمیسیون رفرال: ${u.referralCommissionPct}% 

📌 سهمیه:
• روزانه مصرف‌شده: ${u.quota.dailyUsed} | باقی‌مانده: ${q.dailyLeft === Infinity ? "نامحدود" : q.dailyLeft}
• ماهانه مصرف‌شده: ${u.quota.monthlyUsed} | باقی‌مانده: ${q.monthLeft === Infinity ? "نامحدود" : q.monthLeft}

💳 اشتراک: ${subActive ? "فعال ✅" : "غیرفعال ❌"}
• انقضا: ${subActive ? fmtDateIso(u.subscription.expiresAt, env.TZ) : "-"}

🏦 ولت عمومی: ${wallet ?? "تنظیم نشده"}
`;
    await safeReply(ctx, txt, { reply_markup: mainMenuReplyKb() });
  }

  async function showSupport(ctx: MyContext) {
    await safeReply(ctx,
      "🆘 پشتیبانی: پیام خود را ارسال کنید تا به ادمین‌ها فوروارد شود.\n📚 آموزش: به‌زودی ...",
      { reply_markup: mainMenuReplyKb() }
    );
  }

  async function redeemPoints(ctx: MyContext) {
    const u = requireUser(ctx);
    const need = parseIntSafe(env.REDEEM_POINTS, 500);
    const days = parseIntSafe(env.REDEEM_DAYS, 30);
    if (u.points < need) {
      await safeReply(ctx, `امتیاز کافی نیست.
نیاز: ${need}
امتیاز شما: ${u.points}`, { reply_markup: mainMenuReplyKb() });
      return;
    }
    u.points -= need;
    const now = Date.now();
    const base = u.subscription.expiresAt && Date.parse(u.subscription.expiresAt) > now ? Date.parse(u.subscription.expiresAt) : now;
    const expires = new Date(base + days * 24 * 3600 * 1000).toISOString();
    u.subscription.active = true;
    u.subscription.expiresAt = expires;
    await putUser(env, u);
    await safeReply(ctx, `✅ اشتراک رایگان فعال شد.
انقضا: ${fmtDateIso(expires, env.TZ)}`, { reply_markup: mainMenuReplyKb() });
  }

  async function showWallet(ctx: MyContext) {
    const wallet = await getPublicWallet(env);
    await safeReply(ctx, wallet ? `🏦 آدرس ولت عمومی:\n${wallet}` : "❌ هنوز ولت عمومی تنظیم نشده است.", {
      reply_markup: mainMenuReplyKb(),
    });
  }

  async function showRef(ctx: MyContext) {
    const u = requireUser(ctx);
    const linkBase = `https://t.me/${(bot.botInfo as any)?.username ?? "YOUR_BOT"}?start=`;
    const codes = u.refCodes.map((c, i) => `${i + 1}) ${linkBase}${c}`).join("\n");
    const kb = new InlineKeyboard()
      .text("🎁 تبدیل امتیاز", "ref:redeem")
      .row()
      .text("⬅️ منو", "menu:home");
    await safeReply(ctx, `🎁 رفرال شما:
${codes}

دعوت موفق: ${u.successfulInvites}
امتیاز: ${u.points}

برای تبدیل امتیاز، از دکمه زیر استفاده کن.`, { disable_web_page_preview: true, reply_markup: kb });
  }

  async function startLevelFlow(ctx: MyContext) {
    const u = requireUser(ctx);
    await setState(env, u.id, { flow: "level", step: "q1", data: { answers: [] } });
    await safeReply(ctx, "🧠 آزمون تعیین سطح شروع شد.\nسوال 1/6: هدف اصلی شما از ترید چیست؟ (کوتاه پاسخ بده)");
  }

  async function runSignalAnalysis(ctx: MyContext, u: UserProfile, market: Market, symbol: string) {
    try {
      const candles = await fetchCandles(env, market, symbol, u.settings.timeframe, 200);

      const base = await getPromptBase(env);
      const stylePrompt = u.settings.style === "CUSTOM" && u.customPrompt?.ready && u.customPrompt.text
        ? u.customPrompt.text
        : await getPromptStyle(env, u.settings.style);

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

      const out = await callAI(env, analysisPrompt, { temperature: 0.15 });
      const j = extractJsonBlock(out);
      const zones = normalizeZones(j?.zones);
      const chartUrl = zones.length ? quickChartUrl(symbol, candles, zones) : null;

      await safeReply(ctx, out, { disable_web_page_preview: true });
      if (chartUrl) {
        await ctx.replyWithPhoto(chartUrl, { caption: "📌 چارت با زون‌ها" });
      } else {
        await safeReply(ctx, "ℹ️ زون قابل استخراج نبود؛ برای چارت، خروجی JSON را دقیق‌تر تنظیم کنید.");
      }
    } catch (e: any) {
      await safeReply(ctx, `❌ خطا: ${e?.message ?? "unknown"}
(نماد/بازار را چک کن و دوباره تلاش کن)`);
    }
  }

  async function continueOnboardingAfterPhone(ctx: MyContext, u: UserProfile) {
    await setState(env, u.id, { flow: "onboarding", step: "ask_experience" });
    const kb = new InlineKeyboard()
      .text("مبتدی", "ob:exp:BEGINNER")
      .text("متوسط", "ob:exp:INTERMEDIATE")
      .text("حرفه‌ای", "ob:exp:PRO");
    await safeReply(ctx, "تجربه شما در بازار؟", { reply_markup: kb });
  }

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
      await safeReply(err.ctx, "❌ خطای داخلی رخ داد. لطفاً دوباره تلاش کنید یا /support را بزنید.");
    } catch {}
  });

  // Commands
  bot.command(["start", "menu"], async (ctx) => {
    const u = requireUser(ctx);
    // referral: /start CODE
    const text = ctx.message?.text ?? "";
    const code = text.split(" ")[1]?.trim();
    if (code) {
      const referrerId = await getReferrerByCode(env, code);
      if (referrerId && referrerId !== u.id && !u.referrerId) {
        u.referrerId = referrerId;
        await putUser(env, u);
      }
    }

    if (!u.name) {
      await setState(env, u.id, { flow: "onboarding", step: "ask_name" });
      await safeReply(ctx, "👤 لطفاً نام خود را ارسال کنید:");
      return;
    }
    if (!u.phone) {
      await setState(env, u.id, { flow: "onboarding", step: "ask_contact" });
      const kb = new Keyboard().requestContact("📞 ارسال شماره (Share Contact)").resized().oneTime();
      await safeReply(ctx, "📞 برای ادامه، لطفاً شماره خود را Share کنید:", { reply_markup: kb });
      return;
    }
    await showMenu(ctx, env);
  });

  bot.command("signals", async (ctx) => {
    await startSignalsFlow(ctx);
  });

  bot.command("settings", async (ctx) => {
    await showSettings(ctx);
  });

  bot.command("profile", async (ctx) => {
    await showProfile(ctx);
  });

  

async function showBuy(ctx: any, env: Env) {
  const plans = await getPlans(env);
  const wallet = await getPublicWallet(env);

  const kb = new InlineKeyboard();
  for (const p of plans) {
    kb.text(`${p.title} • ${p.priceUsdt} USDT`, `plan:${p.id}`).row();
  }
  kb.url("💬 پشتیبانی", "https://t.me/").row();
  kb.text("🔄 رفرش پلن‌ها", "planlist");

  const w = wallet ? `<code>${wallet}</code>` : "هنوز تنظیم نشده";
  const text =
    `💳 <b>خرید اشتراک Market IQ</b>\n\n` +
    `۱) یک پلن را انتخاب کن:\n` +
    `۲) به آدرس ولت زیر USDT (BEP20) واریز کن:\n${w}\n\n` +
    `۳) بعد از پرداخت، TxID را ارسال کن:\n<code>/tx YOUR_TXID</code>\n\n` +
    `اگر پلن انتخاب کردی، نیاز نیست PLAN_ID بفرستی.`;

  await safeReply(ctx, text, { parse_mode: "HTML", reply_markup: kb, disable_web_page_preview: true });
}

bot.command("buy", async (ctx) => showBuy(ctx, env));
bot.command("pay", async (ctx) => showBuy(ctx, env));

bot.command("tx", async (ctx) => {
    const u = requireUser(ctx);
    const parts = (ctx.message?.text ?? "").trim().split(/\s+/).slice(1);
    const txid = (parts[0] || "").trim();
    const planId = (parts[1] || "").trim();
    if (!txid || !isValidTxid(txid)) {
      await safeReply(ctx, `فرمت TxID معتبر نیست. مثال:
/tx 0xabc123...`);
      return;
    }
    const exists = await getPayment(env, txid);
    if (exists) {
      await safeReply(ctx, "این TxID قبلاً ثبت شده است.");
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

    await safeReply(ctx, "✅ TxID ثبت شد. پس از بررسی ادمین، به شما اطلاع داده می‌شود.");

    // notify admins with inline buttons
    const kb = new InlineKeyboard()
      .text("✅ Approve", `pay:approve:${txid}`)
      .text("❌ Reject", `pay:reject:${txid}`);
    await notifyAdmins(env, bot, `💳 پرداخت جدید (PENDING)
User: ${u.id}
TxID: ${txid}`);
    // also send interactive to owner only? We'll just to admins with callback: easiest is to send message with keyboard to each admin
    const ids = (env.ADMIN_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean).map(Number);
    const owner = env.OWNER_ID ? Number(env.OWNER_ID) : undefined;
    const targets = new Set<number>(ids);
    if (owner) targets.add(owner);
    for (const id of targets) {
      try { await bot.api.sendMessage(id, `برای بررسی: ${txid}`, { reply_markup: kb }); } catch {}
    }
  });

  bot.command("wallet", async (ctx) => {
    await showWallet(ctx);
  });

  bot.command("level", async (ctx) => {
    await startLevelFlow(ctx);
  });

  bot.command("customprompt", async (ctx) => {
    const u = requireUser(ctx);
    await setState(env, u.id, { flow: "customprompt", step: "await_text" });
    await safeReply(ctx, "✍️ لطفاً استراتژی/روش خود را به صورت متن ارسال کنید. سیستم برای شما یک پرامپت اختصاصی می‌سازد و ۲ ساعت بعد ارسال می‌کند.");
  });

  bot.command("ref", async (ctx) => {
    await showRef(ctx);
  });

  bot.command("redeem", async (ctx) => {
    await redeemPoints(ctx);
  });

  bot.command(["support", "education"], async (ctx) => {
    await showSupport(ctx);
  });

  bot.command("payments", async (ctx) => {
    const u = requireUser(ctx);
    if (!isAdmin(u, env)) return safeReply(ctx, "دسترسی ندارید.");
    const pending = await listPayments(env, "PENDING");
    if (!pending.length) return safeReply(ctx, "پرداخت در انتظار نداریم.");
    const text = pending.slice(0, 15).map((p) => `• ${p.txid} | user ${p.userId} | ${p.createdAt}`).join("\n");
    await safeReply(ctx, `لیست پرداخت‌های در انتظار:\n${text}`);
  });

  bot.command("approve", async (ctx) => {
    const u = requireUser(ctx);
    if (!isAdmin(u, env)) return safeReply(ctx, "دسترسی ندارید.");
    const parts = (ctx.message?.text ?? "").trim().split(/\s+/).slice(1);
    const txid = (parts[0] || "").trim();
    const planId = (parts[1] || "").trim();
    await approvePayment(bot, env, u.id, txid, true, ctx);
  });

  bot.command("reject", async (ctx) => {
    const u = requireUser(ctx);
    if (!isAdmin(u, env)) return safeReply(ctx, "دسترسی ندارید.");
    const parts = (ctx.message?.text ?? "").trim().split(/\s+/).slice(1);
    const txid = (parts[0] || "").trim();
    const planId = (parts[1] || "").trim();
    await approvePayment(bot, env, u.id, txid, false, ctx);
  });

  bot.command("setwallet", async (ctx) => {
    const u = requireUser(ctx);
    if (!isAdmin(u, env)) return safeReply(ctx, "دسترسی ندارید.");
    const addr = (ctx.message?.text ?? "").split(" ").slice(1).join(" ").trim();
    if (!addr) return safeReply(ctx, "مثال: /setwallet WALLET_ADDRESS");
    await setPublicWallet(env, addr);
    await safeReply(ctx, "✅ ولت عمومی ذخیره شد.");
    // alert owner
    const ownerId = env.OWNER_ID ? Number(env.OWNER_ID) : undefined;
    if (ownerId) {
      try { await bot.api.sendMessage(ownerId, `⚠️ آدرس ولت عمومی تغییر کرد:
${addr}`); } catch {}
    }
  });

  bot.command("setfreelimit", async (ctx) => {
    const u = requireUser(ctx);
    if (!isAdmin(u, env)) return safeReply(ctx, "دسترسی ندارید.");
    const n = Number((ctx.message?.text ?? "").split(" ")[1]);
    if (!Number.isFinite(n) || n <= 0) return safeReply(ctx, "مثال: /setfreelimit 50");
    await env.USERS_KV.put("config:free_daily_limit", String(n));
    await safeReply(ctx, "✅ ثبت شد (برای اعمال کامل، این نسخه نیاز دارد شما مقدار env را نیز sync کنید).");
  });

  bot.command("setsublimit", async (ctx) => {
    const u = requireUser(ctx);
    if (!isAdmin(u, env)) return safeReply(ctx, "دسترسی ندارید.");
    const n = Number((ctx.message?.text ?? "").split(" ")[1]);
    if (!Number.isFinite(n) || n <= 0) return safeReply(ctx, "مثال: /setsublimit 50");
    await env.USERS_KV.put("config:sub_daily_limit", String(n));
    await safeReply(ctx, "✅ ثبت شد (برای اعمال کامل، این نسخه نیاز دارد شما مقدار env را نیز sync کنید).");
  });

  bot.command("admin", async (ctx) => {
    const u = requireUser(ctx);
    if (!isAdmin(u, env)) return safeReply(ctx, "دسترسی ندارید.");
    await safeReply(ctx, `🔧 Admin Panel:
${ctx.me.username ? `https://<YOUR_WORKER_URL>/admin` : "/admin"}
توکن: ${env.ADMIN_PANEL_TOKEN}`);
  });

  // Callback queries (menus/actions)
  bot.on("callback_query:data", async (ctx) => {
    const u = requireUser(ctx);
    const data = ctx.callbackQuery.data;

// Inline plan selection (modern UX)
if (data.startsWith("plan:")) {
  const planId = data.slice("plan:".length);
  await setSelectedPlan(env, ctx.from!.id, planId);
  await ctx.answerCallbackQuery({ text: "✅ پلن انتخاب شد" });

  const wallet = await getPublicWallet(env);
  const w = wallet ? `<code>${wallet}</code>` : "هنوز تنظیم نشده";

  const kb = new InlineKeyboard()
    .text("✅ پرداخت کردم", "paydone").row()
    .text("🔙 برگشت به پلن‌ها", "planlist");

  await safeEdit(ctx, 
    `✅ پلن انتخاب شد: <code>${planId}</code>\n\n` +
      `۱) به آدرس ولت زیر USDT (BEP20) واریز کن:\n${w}\n\n` +
      `۲) بعد از پرداخت روی «پرداخت کردم» بزن یا TxID را ارسال کن:\n<code>/tx YOUR_TXID</code>`,
    { parse_mode: "HTML", reply_markup: kb, disable_web_page_preview: true }
  );
  return;
}

if (data === "paydone") {
  await ctx.answerCallbackQuery({ text: "TxID را ارسال کن" });
  await safeReply(ctx, 
    `✅ عالی! حالا TxID پرداخت را ارسال کن:\n<code>/tx YOUR_TXID</code>\n\n` +
      `اگر TxID را کپی کردی، فقط جایگزین کن و بفرست.`,
    { parse_mode: "HTML" }
  );
  return;
}

if (data === "planlist") {
  await ctx.answerCallbackQuery();
  await showBuy(ctx, env);
  return;
}


    // Menu
    if (data === "menu:home") {
      await ctx.answerCallbackQuery();
      await showMenu(ctx, env);
      return;
    }
    if (data === "menu:signals") {
      await ctx.answerCallbackQuery();
      await startSignalsFlow(ctx);
      return;
    }
    if (data === "menu:settings") {
      await ctx.answerCallbackQuery();
      await showSettings(ctx);
      return;
    }
    if (data === "menu:profile") {
      await ctx.answerCallbackQuery();
      await showProfile(ctx);
      return;
    }
    if (data === "menu:buy") {
      await ctx.answerCallbackQuery();
      await showBuy(ctx, env);
      return;
    }
    if (data === "menu:wallet") {
      await ctx.answerCallbackQuery();
      await showWallet(ctx);
      return;
    }
    if (data === "menu:ref") {
      await ctx.answerCallbackQuery();
      await showRef(ctx);
      return;
    }
    if (data === "menu:level") {
      await ctx.answerCallbackQuery();
      await startLevelFlow(ctx);
      return;
    }
    if (data === "menu:support") {
      await ctx.answerCallbackQuery();
      await showSupport(ctx);
      return;
    }
    if (data === "menu:education") {
      await ctx.answerCallbackQuery();
      await showSupport(ctx);
      return;
    }
    if (data === "menu:app") {
      await ctx.answerCallbackQuery();
      const appUrl = `${ctx.update.callback_query?.message?.chat?.type ? "" : ""}`; // ignored
      await safeReply(ctx, "📱 برای باز کردن Mini App روی دکمه زیر بزن:", {
        reply_markup: new InlineKeyboard().webApp("Open Mini App", env.PUBLIC_APP_PATH || "/app").row().text("⬅️ منو", "menu:home"),
      });
      return;
    }

    // Settings
    if (data.startsWith("set:")) {
      await ctx.answerCallbackQuery();
      const [, key, val] = data.split(":");
      if (key === "tf") u.settings.timeframe = val as Timeframe;
      if (key === "risk") u.settings.risk = val as Risk;
      if (key === "style") {
        if (val === "CUSTOM" && !u.customPrompt?.ready) {
          await safeReply(ctx, "❌ پرامپت اختصاصی هنوز آماده نیست. ابتدا /customprompt را انجام دهید.");
          return;
        }
        u.settings.style = val as Style;
      }
      if (key === "news") u.settings.news = val as any;
      await putUser(env, u);
      await safeReply(ctx, `✅ ذخیره شد.\n${settingsText(u)}`, { reply_markup: settingsKb(u) });
      return;
    }

    // Signals
    if (data.startsWith("sig:market:")) {
      await ctx.answerCallbackQuery();
      const market = data.split(":")[2] as Market;
      await setState(env, u.id, { flow: "signals", step: "choose_symbol", data: { market } });
      await safeReply(ctx, `مرحله ۲/۲: نماد را انتخاب کن
بازار: ${toMarketLabel(market)}`, { reply_markup: symbolKb(market) });
      return;
    }

    if (data.startsWith("sig:symbol:")) {
      await ctx.answerCallbackQuery();
      const choice = data.split(":")[2];
      const st = await getState(env, u.id);
      const market = st?.data?.market as Market | undefined;
      if (!market) {
        await safeReply(ctx, "ابتدا بازار را انتخاب کن.", { reply_markup: mainMenuReplyKb() });
        return;
      }
      if (choice === "custom") {
        await setState(env, u.id, { flow: "signals", step: "ask_symbol", data: { market } });
        await safeReply(ctx, `مرحله ۲/۲: نماد را ارسال کن (مثلاً BTCUSDT یا BTC-USD یا EURUSD=X)
بازار: ${toMarketLabel(market)}`);
        return;
      }
      await setState(env, u.id, null);
      await safeReply(ctx, "⏳ در حال گرفتن دیتا و ساخت تحلیل...");
      await runSignalAnalysis(ctx, u, market, choice);
      return;
    }

    // Payments approval via buttons
    if (data.startsWith("pay:")) {
      await ctx.answerCallbackQuery();
      if (!isAdmin(u, env)) return safeReply(ctx, "دسترسی ندارید.");
      const [, action, txid] = data.split(":");
      await approvePayment(bot, env, u.id, txid, action === "approve", ctx);
      return;
    }

    if (data === "ref:redeem") {
      await ctx.answerCallbackQuery();
      await redeemPoints(ctx);
      return;
    }
  });

  // Contact handler (onboarding)
  bot.on("message:contact", async (ctx) => {
    const u = requireUser(ctx);
    const phone = ctx.message.contact.phone_number;
    if (!phone) {
      await safeReply(ctx, "❌ شماره معتبر دریافت نشد. دوباره ارسال کنید.");
      return;
    }
    const st = await getState(env, u.id);
    if (!u.phone && !(st?.flow === "onboarding" && st.step === "ask_contact")) {
      await setState(env, u.id, { flow: "onboarding", step: "ask_contact" });
    }
    const r = await (await import("./lib/storage")).setUserPhone(env, u.id, phone);
    if (!r.ok) {
      await safeReply(ctx, r.reason || "خطا در ذخیره شماره");
      return;
    }
    await continueOnboardingAfterPhone(ctx, u);
  });

  // Messages: onboarding, flows
  bot.on("message", async (ctx) => {
    const u = requireUser(ctx);

    const st = await getState(env, u.id);

    if (!st && ctx.message?.text && !ctx.message.text.startsWith("/")) {
      const t = ctx.message.text.trim();
      const map: Record<string, () => Promise<void>> = {
        "📈 تحلیل/سیگنال": () => startSignalsFlow(ctx),
        "⚙️ تنظیمات": () => showSettings(ctx),
        "👤 پروفایل": () => showProfile(ctx),
        "💳 خرید اشتراک": () => showBuy(ctx, env),
        "🏦 ولت": () => showWallet(ctx),
        "🎁 رفرال": () => showRef(ctx),
        "🧠 تعیین سطح": () => startLevelFlow(ctx),
        "🆘 پشتیبانی": () => showSupport(ctx),
        "📚 آموزش": () => showSupport(ctx),
        "📱 Mini App": async () => {
          await safeReply(ctx, "📱 برای باز کردن Mini App روی دکمه زیر بزن:", {
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

    // Onboarding steps expecting text
    if (st?.flow === "onboarding" && st.step === "ask_name") {
      const name = (ctx.message?.text ?? "").trim();
      if (name.length < 2) return safeReply(ctx, "نام نامعتبر است. دوباره ارسال کنید.");
      u.name = name;
      await putUser(env, u);
      await setState(env, u.id, { flow: "onboarding", step: "ask_contact" });
      const kb = new Keyboard().requestContact("📞 ارسال شماره (Share Contact)").resized().oneTime();
      await safeReply(ctx, "📞 لطفاً شماره خود را Share کنید:", { reply_markup: kb });
      return;
    }

    // Leveling flow
    if (st?.flow === "level" && ctx.message?.text) {
      const ans = ctx.message.text.trim();
      const qMap: Record<string, string> = {
        q1: "سوال 1/6: هدف اصلی شما از ترید چیست؟",
        q2: "سوال 2/6: چقدر زمان در روز برای ترید دارید؟",
        q3: "سوال 3/6: بیشترین تجربه شما روی کدام بازار است؟",
        q4: "سوال 4/6: ریسک‌پذیری‌تان را چگونه توصیف می‌کنید؟",
        q5: "سوال 5/6: کدام سبک را بیشتر می‌پسندید؟ (RTM/ICT/PA/General)",
        q6: "سوال 6/6: یک اشتباه رایج شما در ترید چیست؟"
      };
      const idx = Number(st.step.slice(1));
      st.data = st.data || { answers: [] };
      st.data.answers.push({ q: qMap[st.step], a: ans });

      if (idx < 6) {
        const next = `q${idx + 1}`;
        await setState(env, u.id, { ...st, step: next, data: st.data });
        await safeReply(ctx, qMap[next]);
        return;
      }

      // analyze result with AI
      await setState(env, u.id, null);
      await safeReply(ctx, "در حال تحلیل پاسخ‌ها...");

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
          u.levelInfo = { level: String(j.level), summary: String(j.summary ?? ""), suggestedMarket: j.suggestedMarket, suggestedSettings: j.suggestedSettings, updatedAt: nowIso() };
          await putUser(env, u);
        }
        await safeReply(ctx, out);
      } catch (e: any) {
        await safeReply(ctx, "❌ خطا در تحلیل سطح. لطفاً دوباره تلاش کنید.");
      }
      return;
    }

    // Custom prompt flow
    if (st?.flow === "customprompt" && st.step === "await_text" && ctx.message?.text) {
      const strategy = ctx.message.text.trim();
      if (strategy.length < 20) return safeReply(ctx, "متن کوتاه است. لطفاً جزئیات بیشتری بفرستید (حداقل ۲۰ کاراکتر).");
      await setState(env, u.id, null);
      await safeReply(ctx, "در حال ساخت پرامپت اختصاصی...");

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
        // schedule after 2h
        const due = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
        await putCustomPromptTask(env, u.id, due, generated);
        u.customPrompt = { ready: false, text: generated, generatedAt: nowIso() };
        await putUser(env, u);

        await safeReply(ctx, "✅ پرامپت شما ساخته شد و ۲ ساعت دیگر ارسال می‌شود.");
      } catch {
        await safeReply(ctx, "❌ خطا در ساخت پرامپت. دوباره تلاش کنید.");
      }
      return;
    }

    // Signals flow: ask symbol
    if (st?.flow === "signals" && st.step === "ask_symbol" && ctx.message?.text) {
      const symbol = ctx.message.text.trim();
      const market = st.data?.market as Market;
      await setState(env, u.id, null);
      await safeReply(ctx, "⏳ در حال گرفتن دیتا و ساخت تحلیل...");
      await runSignalAnalysis(ctx, u, market, symbol);
      return;
    }

    
    // Vision: اگر کاربر عکس/چارت ارسال کند (بهترین تلاش)
    if (ctx.message?.photo?.length) {
      const r = await consume(env, u, 1);
      if (!r.ok) {
        await safeReply(ctx, `${r.reason}\nبرای مشاهده سهمیه: /profile`);
        return;
      }

      // choose a medium size to reduce payload
      const photos = ctx.message.photo;
      const pick = photos[Math.max(0, photos.length - 2)];
      try {
        const file = await ctx.getFile();
        // ctx.getFile() returns best size; we instead use pick.file_id
        const f = await bot.api.getFile(pick.file_id);
        if (!f.file_path) throw new Error("no file_path");
        const url = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${f.file_path}`;
        const imgRes = await fetch(url);
        const buf = await imgRes.arrayBuffer();
        // limit to 2.5MB
        if (buf.byteLength > 2_500_000) {
          await safeReply(ctx, "⚠️ تصویر خیلی بزرگ است. لطفاً اسکرین‌شات کوچک‌تر ارسال کنید.");
          return;
        }
        const b64 = arrayBufferToBase64(buf);
        const mime = f.file_path.endsWith(".png") ? "image/png" : "image/jpeg";
        const dataUrl = `data:${mime};base64,${b64}`;

        const base = await getPromptBase(env);
        const vision = await (await import("./lib/storage")).getPromptVision(env);
        const stylePrompt = u.settings.style === "CUSTOM" && u.customPrompt?.ready && u.customPrompt.text
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
        await safeReply(ctx, out, { disable_web_page_preview: true });
      } catch (e: any) {
        await safeReply(ctx, "❌ خطا در تحلیل تصویری. (اگر از OpenAI استفاده می‌کنید، مدل باید vision را پشتیبانی کند)");
      }
      return;
    }

// Support: forward to admins
    if (ctx.message?.text?.startsWith("/")) return; // ignore other commands
    if (ctx.message?.text) {
      // If user sends text and no flow, treat as support
      const txt = ctx.message.text.trim();
      if (txt.length >= 3) {
        await notifyAdmins(env, bot, `🆘 پیام کاربر
User: ${u.id}
@${u.username ?? "-"}

${txt}`);
        await safeReply(ctx, "پیام شما برای پشتیبانی ارسال شد ✅");
      }
    }
  });

  // onboarding callback queries
  bot.on("callback_query:data", async (ctx, next) => {
    const u = requireUser(ctx);
    const data = ctx.callbackQuery.data;

    if (data.startsWith("ob:exp:")) {
      await ctx.answerCallbackQuery();
      const exp = data.split(":")[2];
      u.experience = exp as any;
      await putUser(env, u);
      await setState(env, u.id, { flow: "onboarding", step: "ask_fav_market" });
      const kb = new InlineKeyboard()
        .text("CRYPTO", "ob:market:CRYPTO").text("FOREX", "ob:market:FOREX").row()
        .text("METALS", "ob:market:METALS").text("STOCKS", "ob:market:STOCKS");
      await safeReply(ctx, "بازار مورد علاقه‌ات کدام است؟", { reply_markup: kb });
      return;
    }

    if (data.startsWith("ob:market:")) {
      await ctx.answerCallbackQuery();
      const market = data.split(":")[2] as Market;
      u.favoriteMarket = market;
      await putUser(env, u);
      await setState(env, u.id, null);

      // Referral acceptance rule: only count referral when contact is shared AND phone is new (already enforced).
      if (u.referrerId) {
        const refUser = await getUser(env, u.referrerId);
        if (refUser) {
          refUser.successfulInvites += 1;
          // commission tier
          const step = parseIntSafe(env.REF_COMMISSION_STEP_PCT, 4);
          const max = parseIntSafe(env.REF_COMMISSION_MAX_PCT, 20);
          refUser.referralCommissionPct = Math.min(max, refUser.successfulInvites * step);

          // points for referral
          const pts = parseIntSafe(env.POINTS_PER_REF, 6);
          refUser.points += pts;

          await putUser(env, refUser);
        }
      }

      await safeReply(ctx, "✅ آنبوردینگ تکمیل شد!");
      await showMenu(ctx, env);
      return;
    }

    await next();
  });

  return bot;
}

function summarizeCandles(candles: Array<{ t: number; o: number; h: number; l: number; c: number }>) {
  const last = candles.slice(-60);
  const closes = last.map(c => c.c);
  const hi = Math.max(...last.map(c => c.h));
  const lo = Math.min(...last.map(c => c.l));
  const first = last[0]?.c ?? 0;
  const lastc = last[last.length - 1]?.c ?? 0;
  const chg = first ? ((lastc - first) / first) * 100 : 0;
  return `last_close=${lastc}
range_high=${hi}
range_low=${lo}
change_pct_last_60_bars=${chg.toFixed(2)}
samples=[${candles.slice(-10).map(c => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c })).map(x => JSON.stringify(x)).join(", ")}]`;
}

function normalizeZones(zones: any): Zone[] {
  if (!Array.isArray(zones)) return [];
  const out: Zone[] = [];
  for (const z of zones) {
    const from = Number(z?.from);
    const to = Number(z?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const typeRaw = String(z?.type ?? "other").toLowerCase();
    const type = (["demand","supply","support","resistance","fvg","ob"].includes(typeRaw) ? typeRaw : "other") as Zone["type"];
    out.push({ type, from, to, label: z?.label ? String(z.label).slice(0, 18) : undefined });
  }
  return out;
}

async function approvePayment(bot: Bot<MyContext>, env: Env, reviewerId: number, txid: string, approve: boolean, ctx?: MyContext) {
  if (!txid) { if (ctx) await safeReply(ctx, "TxID را وارد کنید."); return; }
  const p = await getPayment(env, txid);
  if (!p) { if (ctx) await safeReply(ctx, "یافت نشد."); return; }
  if (p.status !== "PENDING") { if (ctx) await safeReply(ctx, "این پرداخت قبلاً بررسی شده است."); return; }

  p.status = approve ? "APPROVED" : "REJECTED";
  p.reviewedAt = nowIso();
  p.reviewerId = reviewerId;
  await putPayment(env, p);

  if (approve) {
    const user = await getUser(env, p.userId);
    if (user) {
      // activate subscription
      const now = Date.now();
      const days = p.planDays ?? parseIntSafe(env.SUB_DURATION_DAYS, 30);
      const base = user.subscription.expiresAt && Date.parse(user.subscription.expiresAt) > now ? Date.parse(user.subscription.expiresAt) : now;
      const expires = new Date(base + days * 24 * 3600 * 1000).toISOString();
      user.subscription.active = true;
      user.subscription.expiresAt = expires;
      user.subscription.lastTxId = txid;

      // points for purchase
      user.points += parseIntSafe(env.POINTS_PER_SUB_PURCHASE, 1000);

      await putUser(env, user);
      try { await bot.api.sendMessage(user.id, `✅ پرداخت تایید شد.
اشتراک فعال شد تا: ${fmtDateIso(expires, env.TZ)}`); } catch {}

      // referral commission/points for referrer on purchase
      if (user.referrerId) {
        const ref = await getUser(env, user.referrerId);
        if (ref) {
          // commission can be computed externally; we just notify + add points.
          const bonus = parseIntSafe(env.POINTS_PER_SUB_PURCHASE, 1000);
          ref.points += bonus;
          await putUser(env, ref);
          try { await bot.api.sendMessage(ref.id, `🎉 یکی از دعوت‌شده‌های شما اشتراک خرید.
+${bonus} امتیاز`); } catch {}
        }
      }
    }
    if (ctx) await safeReply(ctx, "✅ تایید شد.");
  } else {
    try { await bot.api.sendMessage(p.userId, "❌ پرداخت شما رد شد. اگر اشتباه است با پشتیبانی تماس بگیرید."); } catch {}
    if (ctx) await safeReply(ctx, "❌ رد شد.");
  }
}
