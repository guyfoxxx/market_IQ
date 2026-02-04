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

function mainMenuKb() {
  return new InlineKeyboard()
    .text("📊 تحلیل / سیگنال", "go:signals").row()
    .text("⚙️ تنظیمات", "go:settings").text("👤 پروفایل", "go:profile").row()
    .text("💳 خرید اشتراک", "go:buy").text("🎁 رفرال", "go:ref").row()
    .text("🏦 کیف پول", "go:wallet").text("🆘 پشتیبانی", "go:support");
}

function settingsKb(current: { tf: Timeframe; risk: Risk; style: Style; news: "ON" | "OFF" }) {
  const kb = new InlineKeyboard()
    .text(`⏱ TF: ${current.tf}`, "set:tf").row()
    .text(`⚖️ ریسک: ${current.risk}`, "set:risk").row()
    .text(`🎯 سبک: ${current.style}`, "set:style").row()
    .text(`📰 خبر: ${current.news}`, "set:news").row()
    .text("🔙 منو", "go:menu");
  return kb;
}

function tfKb() {
  const tfs: Timeframe[] = ["M15", "H1", "H4", "D1"];
  const kb = new InlineKeyboard();
  for (const tf of tfs) kb.text(tf, `tf:${tf}`);
  kb.row().text("🔙 برگشت", "set:back");
  return kb;
}
function riskKb() {
  const risks: Risk[] = ["LOW", "MEDIUM", "HIGH"];
  const kb = new InlineKeyboard();
  for (const r of risks) kb.text(r, `risk:${r}`);
  kb.row().text("🔙 برگشت", "set:back");
  return kb;
}
function styleKb(u: UserProfile) {
  const styles: Style[] = ["PRICE_ACTION", "ICT", "ATR"];
  const kb = new InlineKeyboard();
  kb.text("پرایس اکشن", "style:PRICE_ACTION").row();
  kb.text("ICT (Smart Money)", "style:ICT").row();
  kb.text("ATR Quant", "style:ATR").row();
  if (u.customPrompt?.ready) kb.text("پرامپت اختصاصی", "style:CUSTOM").row();
  kb.row().text("🔙 برگشت", "set:back");
  return kb;
}

function marketKb() {
  const kb = new InlineKeyboard()
    .text("🪙 Crypto", "mkt:CRYPTO").text("💱 Forex", "mkt:FOREX").row()
    .text("🥇 Metals", "mkt:METALS").text("📈 Stocks", "mkt:STOCKS").row()
    .text("🔙 منو", "go:menu");
  return kb;
}

function onboardingContactKb() {
  return new Keyboard()
    .requestContact("📱 Share Contact")
    .resized()
    .oneTime();
}

function stripDangerousTags(html: string) {
  // whitelist tags: b, i, u, code, pre, a
  // But safest is to escape everything for dynamic content. This helper is minimal.
  return html;
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
  const u = await ensureUser(env, ctx.from!);
  await ensureQuotaReset(env, u);

  const text =
    `Market IQ ✅\n\n` +
    `👋 خوش آمدی ${u.profile?.name ? u.profile.name : ""}\n\n` +
    `📌 دستورات اصلی:\n` +
    `• /signals  تحلیل و سیگنال\n` +
    `• /settings  تنظیمات\n` +
    `• /profile  پروفایل و سهمیه\n` +
    `• /buy  خرید اشتراک\n` +
    `• /wallet  آدرس ولت\n` +
    `• /ref  رفرال و امتیاز\n` +
    `• /support  پشتیبانی\n\n` +
    `💡 برای شروع تحلیل: /signals`;

  try {
    await safeReplyPlain(ctx, text, { reply_markup: mainMenuKb() });
  } catch {
    await safeReplyPlain(ctx, text);
  }
}

async function showProfile(ctx: any, env: Env) {
  const u = await ensureUser(env, ctx.from!);
  await ensureQuotaReset(env, u);
  const rem = await remaining(env, u);
  const sub = u.subscription?.active ? `✅ فعال تا ${u.subscription.expiresAt}` : "❌ غیرفعال";
  const points = u.points ?? 0;
  const invites = u.referrals?.successCount ?? 0;
  const msg =
    `<b>👤 پروفایل Market IQ</b>\n\n` +
    `• نام: <code>${escapeHtml(u.profile?.name ?? "-")}</code>\n` +
    `• شماره: <code>${escapeHtml(u.profile?.phone ?? "-")}</code>\n` +
    `• اشتراک: ${sub}\n\n` +
    `<b>⚡ سهمیه</b>\n` +
    `• روزانه: <code>${rem.dailyLeft}</code>\n` +
    `• ماهانه: <code>${rem.monthlyLeft}</code>\n\n` +
    `<b>🎁 امتیاز و دعوت</b>\n` +
    `• امتیاز: <code>${points}</code>\n` +
    `• دعوت موفق: <code>${invites}</code>\n`;
  await safeReply(ctx, msg, { reply_markup: mainMenuKb() });
}

async function showWallet(ctx: any, env: Env) {
  const w = await getPublicWallet(env);
  const msg = `<b>🏦 آدرس ولت عمومی</b>\n\n<code>${escapeHtml(w ?? "تنظیم نشده")}</code>`;
  await safeReply(ctx, msg, { reply_markup: mainMenuKb() });
}

async function showSupport(ctx: any) {
  const msg =
    `<b>🆘 پشتیبانی</b>\n\n` +
    `برای تماس با پشتیبانی پیام خود را ارسال کنید.\n` +
    `در صورت نیاز ادمین به شما پاسخ می‌دهد.`;
  await safeReply(ctx, msg, { reply_markup: mainMenuKb() });
}

async function showRef(ctx: any, env: Env) {
  const u = await ensureUser(env, ctx.from!);
  const codes = u.referrals?.codes ?? [];
  const msg =
    `<b>🎁 رفرال</b>\n\n` +
    `کدهای شما:\n` +
    codes.map((c) => `• <code>${escapeHtml(c)}</code>`).join("\n") +
    `\n\nدعوت موفق: <code>${u.referrals?.successCount ?? 0}</code>\n` +
    `امتیاز: <code>${u.points ?? 0}</code>\n\n` +
    `برای استفاده از رفرال، لینک/کد را به دوست‌تان بدهید تا وارد ربات شود و Share Contact بزند.`;
  await safeReply(ctx, msg, { reply_markup: mainMenuKb() });
}

async function showSettings(ctx: any, env: Env) {
  const u = await ensureUser(env, ctx.from!);
  const msg =
    `<b>⚙️ تنظیمات</b>\n\n` +
    `• TF: <code>${u.settings.timeframe}</code>\n` +
    `• ریسک: <code>${u.settings.risk}</code>\n` +
    `• سبک: <code>${u.settings.style}</code>\n` +
    `• خبر: <code>${u.settings.news}</code>\n`;
  await safeReply(ctx, msg, { reply_markup: settingsKb(u.settings) });
}

async function startSignalsFlow(ctx: any, env: Env) {
  const u = await ensureUser(env, ctx.from!);
  await ensureQuotaReset(env, u);
  await setState(env, u.userId, { flow: "signals", step: "pick_market" });
  await safeReply(ctx, `<b>📊 تحلیل / سیگنال</b>\n\nبازار را انتخاب کنید:`, { reply_markup: marketKb() });
}

async function handleSignalsText(ctx: any, env: Env, text: string) {
  const u = await ensureUser(env, ctx.from!);
  const st = await getState(env, u.userId);
  if (!st || st.flow !== "signals") return;

  if (st.step === "ask_symbol") {
    const symbol = text.trim().toUpperCase();
    st.data = { ...(st.data ?? {}), symbol };
    st.step = "confirm";
    await setState(env, u.userId, st);
    await safeReply(ctx,
      `<b>✅ تایید</b>\n\n` +
      `بازار: <code>${escapeHtml(st.data.market)}</code>\n` +
      `نماد: <code>${escapeHtml(symbol)}</code>\n` +
      `تایم‌فریم: <code>${u.settings.timeframe}</code>\n\n` +
      `برای شروع تحلیل روی دکمه زیر بزنید.`,
      { reply_markup: new InlineKeyboard().text("🚀 شروع تحلیل", "sig:run").row().text("🔙 منو", "go:menu") }
    );
    return;
  }
}

async function showBuy(ctx: any, env: Env) {
  const plans = await getPlans(env);
  if (!plans?.length) {
    await safeReply(ctx, "❌ هیچ پلنی تعریف نشده است. با ادمین تماس بگیرید.", { reply_markup: mainMenuKb() });
    return;
  }
  const kb = new InlineKeyboard();
  for (const p of plans) {
    kb.text(`${p.title} — ${p.price} ${p.currency}`, `plan:${p.id}`).row();
  }
  kb.text("🔙 منو", "go:menu");
  await safeReply(ctx, `<b>💳 خرید اشتراک</b>\n\nیک پلن را انتخاب کنید:`, { reply_markup: kb });
}

async function handlePlanSelected(ctx: any, env: Env, planId: string) {
  const u = await ensureUser(env, ctx.from!);
  const p = await findPlan(env, planId);
  if (!p) {
    await safeReply(ctx, "❌ پلن نامعتبر است.", { reply_markup: mainMenuKb() });
    return;
  }
  await setSelectedPlan(env, u.userId, planId);
  const w = await getPublicWallet(env);
  const msg =
    `<b>✅ پلن انتخاب شد</b>\n\n` +
    `پلن: <code>${escapeHtml(p.title)}</code>\n` +
    `قیمت: <code>${escapeHtml(String(p.price))} ${escapeHtml(p.currency)}</code>\n` +
    `مدت: <code>${escapeHtml(String(p.days))} روز</code>\n\n` +
    `<b>🏦 آدرس پرداخت</b>\n<code>${escapeHtml(w ?? "تنظیم نشده")}</code>\n\n` +
    `بعد از پرداخت روی دکمه زیر بزنید:`;
  const kb = new InlineKeyboard()
    .text("✅ پرداخت کردم", "paydone").row()
    .text("🔙 برگشت به پلن‌ها", "planlist").row()
    .text("🔙 منو", "go:menu");
  await safeEdit(ctx, msg, { reply_markup: kb });
}

async function handlePayDone(ctx: any) {
  const msg =
    `<b>✅ عالی!</b>\n\n` +
    `حالا TxID پرداخت را ارسال کنید:\n` +
    `<code>/tx YOUR_TXID</code>\n\n` +
    `مثال:\n<code>/tx 0xabc123...</code>`;
  await safeEdit(ctx, msg, { reply_markup: new InlineKeyboard().text("🔙 منو", "go:menu") });
}

async function handleTx(ctx: any, env: Env, txid: string) {
  const u = await ensureUser(env, ctx.from!);
  if (!isValidTxid(txid)) {
    await safeReply(ctx, "❌ TxID معتبر نیست. مثال: /tx 0xabc...", { reply_markup: mainMenuKb() });
    return;
  }
  const sel = u.selectedPlanId;
  if (!sel) {
    await safeReply(ctx, "❌ ابتدا یک پلن را از /buy انتخاب کنید.", { reply_markup: mainMenuKb() });
    return;
  }
  const p = await findPlan(env, sel);
  if (!p) {
    await safeReply(ctx, "❌ پلن انتخاب‌شده یافت نشد. دوباره /buy را بزنید.", { reply_markup: mainMenuKb() });
    return;
  }

  await putPayment(env, {
    txid,
    userId: u.userId,
    planId: sel,
    status: "PENDING",
    createdAt: nowIso(),
  });

  const msg =
    `<b>✅ ثبت شد</b>\n\n` +
    `TxID: <code>${escapeHtml(txid)}</code>\n` +
    `وضعیت: <b>PENDING</b>\n\n` +
    `بعد از تایید ادمین، اشتراک شما فعال می‌شود.`;
  await safeReply(ctx, msg, { reply_markup: mainMenuKb() });

  // notify admins/owner
  const notify =
    `💳 درخواست پرداخت جدید\n` +
    `کاربر: ${u.userId}\n` +
    `پلن: ${p.title}\n` +
    `TxID: ${txid}\n\n` +
    `برای تایید: /approve ${txid}\n` +
    `برای رد: /reject ${txid}`;
  for (const id of env.ADMIN_IDS?.split(",").map((x) => parseIntSafe(x)).filter(Boolean) ?? []) {
    try {
      await ctx.api.sendMessage(id as any, notify);
    } catch {}
  }
  if (env.OWNER_ID) {
    try {
      await ctx.api.sendMessage(parseIntSafe(env.OWNER_ID) as any, notify);
    } catch {}
  }
}

async function adminPayments(ctx: any, env: Env) {
  const u = await ensureUser(env, ctx.from!);
  if (!isAdmin(env, u.userId) && !isOwner(env, u.userId)) {
    await safeReply(ctx, "⛔ دسترسی ندارید.");
    return;
  }
  const pay = await listPayments(env, "PENDING", 25);
  if (!pay.length) {
    await safeReply(ctx, "✅ هیچ پرداخت در انتظار وجود ندارد.");
    return;
  }
  const msg =
    `<b>📋 پرداخت‌های در انتظار</b>\n\n` +
    pay.map((p) => `• <code>${escapeHtml(p.txid)}</code> — user <code>${p.userId}</code> — plan <code>${escapeHtml(p.planId)}</code>`).join("\n") +
    `\n\nبرای تایید: <code>/approve TXID</code>\nبرای رد: <code>/reject TXID</code>`;
  await safeReply(ctx, msg);
}

async function adminApprove(ctx: any, env: Env, txid: string) {
  const u = await ensureUser(env, ctx.from!);
  if (!isAdmin(env, u.userId) && !isOwner(env, u.userId)) {
    await safeReply(ctx, "⛔ دسترسی ندارید.");
    return;
  }
  const pay = await getPayment(env, txid);
  if (!pay || pay.status !== "PENDING") {
    await safeReply(ctx, "❌ پرداخت پیدا نشد یا در انتظار نیست.");
    return;
  }
  pay.status = "APPROVED";
  pay.approvedAt = nowIso();
  await putPayment(env, pay);

  const user = await getUser(env, pay.userId);
  if (user) {
    const plan = await findPlan(env, pay.planId);
    const days = plan?.days ?? 30;
    const exp = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    user.subscription = {
      active: true,
      planId: pay.planId,
      startedAt: nowIso(),
      expiresAt: fmtDateIso(exp),
    };
    await putUser(env, user);
    try {
      await ctx.api.sendMessage(user.userId, `✅ اشتراک شما فعال شد تا ${user.subscription.expiresAt}`);
    } catch {}
  }
  await safeReply(ctx, "✅ تایید شد.");
}

async function adminReject(ctx: any, env: Env, txid: string) {
  const u = await ensureUser(env, ctx.from!);
  if (!isAdmin(env, u.userId) && !isOwner(env, u.userId)) {
    await safeReply(ctx, "⛔ دسترسی ندارید.");
    return;
  }
  const pay = await getPayment(env, txid);
  if (!pay || pay.status !== "PENDING") {
    await safeReply(ctx, "❌ پرداخت پیدا نشد یا در انتظار نیست.");
    return;
  }
  pay.status = "REJECTED";
  pay.rejectedAt = nowIso();
  await putPayment(env, pay);

  try {
    await ctx.api.sendMessage(pay.userId, `❌ پرداخت شما رد شد. TxID: ${txid}`);
  } catch {}
  await safeReply(ctx, "✅ رد شد.");
}

async function handleGo(ctx: any, env: Env, target: string) {
  if (target === "menu") return showMenu(ctx, env);
  if (target === "signals") return startSignalsFlow(ctx, env);
  if (target === "settings") return showSettings(ctx, env);
  if (target === "profile") return showProfile(ctx, env);
  if (target === "buy") return showBuy(ctx, env);
  if (target === "wallet") return showWallet(ctx, env);
  if (target === "ref") return showRef(ctx, env);
  if (target === "support") return showSupport(ctx);
}

export function createBot(env: Env) {
  const bot = new Bot<MyContext>(env.BOT_TOKEN);

  bot.use(async (ctx, next) => {
    (ctx as any).env = env;
    if (ctx.from) {
      (ctx as any).user = await ensureUser(env, ctx.from);
    }
    return next();
  });

  bot.command("start", async (ctx) => showMenu(ctx, env));
  bot.command("menu", async (ctx) => showMenu(ctx, env));
  bot.command("signals", async (ctx) => startSignalsFlow(ctx, env));
  bot.command("settings", async (ctx) => showSettings(ctx, env));
  bot.command("profile", async (ctx) => showProfile(ctx, env));
  bot.command("wallet", async (ctx) => showWallet(ctx, env));
  bot.command("ref", async (ctx) => showRef(ctx, env));
  bot.command("buy", async (ctx) => showBuy(ctx, env));
  bot.command("pay", async (ctx) => showBuy(ctx, env));
  bot.command("support", async (ctx) => showSupport(ctx));
  bot.command("payments", async (ctx) => adminPayments(ctx, env));

  bot.command("approve", async (ctx) => {
    const parts = (ctx.message?.text ?? "").split(/\s+/);
    const txid = parts[1];
    if (!txid) return safeReply(ctx, "Usage: /approve TXID");
    await adminApprove(ctx, env, txid);
  });

  bot.command("reject", async (ctx) => {
    const parts = (ctx.message?.text ?? "").split(/\s+/);
    const txid = parts[1];
    if (!txid) return safeReply(ctx, "Usage: /reject TXID");
    await adminReject(ctx, env, txid);
  });

  bot.command("tx", async (ctx) => {
    const parts = (ctx.message?.text ?? "").split(/\s+/);
    const txid = parts[1];
    if (!txid) return safeReply(ctx, "Usage: /tx YOUR_TXID");
    await handleTx(ctx, env, txid.trim());
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data.startsWith("go:")) {
      await ctx.answerCallbackQuery();
      return handleGo(ctx, env, data.slice(3));
    }

    if (data === "set:tf") {
      await ctx.answerCallbackQuery();
      return safeEdit(ctx, `<b>⏱ تایم‌فریم را انتخاب کنید:</b>`, { reply_markup: tfKb() });
    }
    if (data === "set:risk") {
      await ctx.answerCallbackQuery();
      return safeEdit(ctx, `<b>⚖️ سطح ریسک را انتخاب کنید:</b>`, { reply_markup: riskKb() });
    }
    if (data === "set:style") {
      await ctx.answerCallbackQuery();
      const u = await ensureUser(env, ctx.from!);
      return safeEdit(ctx, `<b>🎯 سبک معامله را انتخاب کنید:</b>`, { reply_markup: styleKb(u) });
    }
    if (data === "set:news") {
      await ctx.answerCallbackQuery();
      const u = await ensureUser(env, ctx.from!);
      u.settings.news = u.settings.news === "ON" ? "OFF" : "ON";
      await putUser(env, u);
      return showSettings(ctx, env);
    }
    if (data === "set:back") {
      await ctx.answerCallbackQuery();
      return showSettings(ctx, env);
    }

    if (data.startsWith("tf:")) {
      await ctx.answerCallbackQuery();
      const tf = data.slice(3) as Timeframe;
      const u = await ensureUser(env, ctx.from!);
      u.settings.timeframe = tf;
      await putUser(env, u);
      return showSettings(ctx, env);
    }
    if (data.startsWith("risk:")) {
      await ctx.answerCallbackQuery();
      const risk = data.slice(5) as Risk;
      const u = await ensureUser(env, ctx.from!);
      u.settings.risk = risk;
      await putUser(env, u);
      return showSettings(ctx, env);
    }
    if (data.startsWith("style:")) {
      await ctx.answerCallbackQuery();
      const style = data.slice(6) as Style;
      const u = await ensureUser(env, ctx.from!);
      u.settings.style = style;
      await putUser(env, u);
      return showSettings(ctx, env);
    }

    if (data.startsWith("mkt:")) {
      await ctx.answerCallbackQuery();
      const mkt = data.slice(4) as Market;
      const u = await ensureUser(env, ctx.from!);
      const st = await getState(env, u.userId);
      if (!st || st.flow !== "signals") {
        await setState(env, u.userId, { flow: "signals", step: "pick_market" });
      }
      const s2 = (await getState(env, u.userId))!;
      s2.data = { ...(s2.data ?? {}), market: mkt };
      s2.step = "ask_symbol";
      await setState(env, u.userId, s2);
      return safeEdit(ctx, `<b>✅ بازار انتخاب شد</b>\n\nنماد را ارسال کنید (مثال: BTCUSDT یا XAUUSD):`, { reply_markup: new InlineKeyboard().text("🔙 منو", "go:menu") });
    }

    if (data === "sig:run") {
      await ctx.answerCallbackQuery();
      const u = await ensureUser(env, ctx.from!);
      const st = await getState(env, u.userId);
      if (!st || st.flow !== "signals" || !st.data?.market || !st.data?.symbol) {
        return safeEdit(ctx, "❌ اطلاعات کافی نیست. دوباره /signals را بزنید.", { reply_markup: mainMenuKb() });
      }

      // quota check/consume
      const ok = await consume(env, u, 1);
      if (!ok.ok) {
        return safeEdit(ctx, `⚡ سهمیه کافی نیست.\nباقی‌مانده روزانه: ${ok.dailyLeft}\nباقی‌مانده ماهانه: ${ok.monthlyLeft}`, { reply_markup: mainMenuKb() });
      }

      const job: Job = {
        kind: "signal",
        jobId: newJobId(),
        chatId: ctx.chat!.id,
        userId: u.userId,
        symbol: st.data.symbol,
        market: st.data.market,
        timeframe: u.settings.timeframe,
        style: u.settings.style,
        risk: u.settings.risk,
        news: u.settings.news,
        createdAt: nowIso(),
      };
      await setState(env, u.userId, null);

      await enqueue(env, job);
      return safeEdit(ctx, `⏳ درخواست شما ثبت شد و در صف پردازش قرار گرفت.\n\nنماد: ${escapeHtml(job.symbol)}\nTF: ${job.timeframe}\nسبک: ${job.style}`, { reply_markup: mainMenuKb() });
    }

    if (data.startsWith("plan:")) {
      await ctx.answerCallbackQuery();
      return handlePlanSelected(ctx, env, data.slice(5));
    }
    if (data === "paydone") {
      await ctx.answerCallbackQuery();
      return handlePayDone(ctx);
    }
    if (data === "planlist") {
      await ctx.answerCallbackQuery();
      return showBuy(ctx, env);
    }

    await ctx.answerCallbackQuery();
  });

  bot.on("message:text", async (ctx) => {
    const txt = ctx.message.text;

    // flow handlers
    await handleSignalsText(ctx, env, txt);

    // fallback: help
    if (txt.startsWith("/")) return;
  });

  bot.on("message:contact", async (ctx) => {
    // onboarding path could be here (kept minimal)
    const u = await ensureUser(env, ctx.from!);
    const phone = ctx.message.contact?.phone_number;
    if (!phone) return;
    u.profile = u.profile ?? {};
    u.profile.phone = phone;
    await putUser(env, u);
    await safeReply(ctx, "✅ شماره شما ثبت شد.", { reply_markup: mainMenuKb() });
  });

  return bot;
}
