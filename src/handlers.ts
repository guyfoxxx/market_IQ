import type { Env, Storage } from './storage';
import type { Market, SessionState, Style, UserProfile } from './types';
import { checkAndConsume } from './quota';
import { parseCommand, formatDateTime, nowMs } from './utils';
import { fetchCandles } from './data';
import { renderChartPng } from './chart';
import { runAnalysis } from './analysis';
import { getNewsDigest } from './news';
import { generateText } from './ai';


function getBotName(env: any) { return (env?.BOT_NAME || 'Market IQ').trim(); }
const WELCOME = `سلام! 👋
به ربات تحلیل/سیگنال خوش اومدی.
برای شروع چند سوال کوتاه داریم تا پروفایل و تنظیماتت کامل بشه.`;

function mainMenu(baseUrl?: string) {
  const keyboard: any[][] = [
    [{ text: '📈 تحلیل/سیگنال' }, { text: '⚙️ تنظیمات' }],
    [{ text: '👤 پروفایل' }, { text: '💳 خرید اشتراک' }],
    [{ text: '🎁 رفرال' }, { text: '🧠 تعیین سطح' }],
    [{ text: '🆘 پشتیبانی' }, { text: '📚 آموزش' }],
  ];
  if (baseUrl) {
    keyboard.push([{ text: '🧩 Mini App', web_app: { url: `${baseUrl.replace(/\/$/, '')}/miniapp` } }]);
  } else {
    keyboard.push([{ text: '🧩 Mini App' }]);
  }
  return {
    keyboard,
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'یکی از گزینه‌های منو را انتخاب کن…',
  };
}

function mapMenuTextToCommand(t?: string): string | null {
  const s = (t || '').trim();
  const m: Record<string, string> = {
    '⬅️ منو': '/menu',
    '📈 تحلیل/سیگنال': '/signals',
    '⚙️ تنظیمات': '/settings',
    '👤 پروفایل': '/profile',
    '💳 خرید اشتراک': '/buy',
    '🎁 رفرال': '/ref',
    '🧠 تعیین سطح': '/level',
    '🆘 پشتیبانی': '/support',
    '📚 آموزش': '/education',
  };
  return m[s] || null;
}

function settingsKeyboard(user: UserProfile) {
  return {
    inline_keyboard: [
      [
        { text: `TF: ${user.settings.timeframe}`, callback_data: 'set:tf' },
        { text: `Risk: ${user.settings.risk}`, callback_data: 'set:risk' },
      ],
      [{ text: `Style: ${user.settings.style}`, callback_data: 'set:style' }],
      [{ text: `News: ${user.settings.news ? 'ON' : 'OFF'}`, callback_data: 'set:news' }],
      [{ text: '⬅️ بازگشت', callback_data: 'go:menu' }],
    ],
  };
}

function experienceKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'مبتدی', callback_data: 'on:exp:beginner' }],
      [{ text: 'متوسط', callback_data: 'on:exp:intermediate' }],
      [{ text: 'حرفه‌ای', callback_data: 'on:exp:pro' }],
    ],
  };
}

function marketKeyboard(prefix: string) {
  return {
    inline_keyboard: [
      [{ text: 'کریپتو', callback_data: `${prefix}:crypto` }, { text: 'فارکس', callback_data: `${prefix}:forex` }],
      [{ text: 'فلزات', callback_data: `${prefix}:metals` }, { text: 'سهام', callback_data: `${prefix}:stocks` }],
      [{ text: '⬅️ بازگشت', callback_data: 'go:menu' }],
    ],
  };
}

function signalMarketReplyKeyboard() {
  return {
    keyboard: [
      [{ text: 'CRYPTO' }, { text: 'FOREX' }],
      [{ text: 'METALS' }, { text: 'STOCKS' }],
      [{ text: '⬅️ منو' }],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder: 'بازار را انتخاب کن…',
  };
}

function signalSymbolsReplyKeyboard(market: Market) {
  const rows: any[][] = [];
  if (market === 'crypto') {
    rows.push([{ text: 'BTCUSDT' }, { text: 'ETHUSDT' }]);
    rows.push([{ text: 'SOLUSDT' }, { text: 'BNBUSDT' }]);
    rows.push([{ text: 'XRPUSDT' }, { text: 'DOGEUSDT' }]);
    rows.push([{ text: 'TONUSDT' }, { text: 'ADAUSDT' }]);
  } else if (market === 'forex') {
    rows.push([{ text: 'EUR/USD' }, { text: 'GBP/USD' }]);
    rows.push([{ text: 'USD/JPY' }, { text: 'USD/CHF' }]);
    rows.push([{ text: 'AUD/USD' }, { text: 'USD/CAD' }]);
    rows.push([{ text: 'NZD/USD' }, { text: 'EUR/JPY' }]);
  } else if (market === 'metals') {
    rows.push([{ text: 'XAUUSD' }, { text: 'XAGUSD' }]);
    rows.push([{ text: 'XAU/EUR' }, { text: 'XAG/EUR' }]);
  } else {
    rows.push([{ text: 'AAPL' }, { text: 'TSLA' }]);
    rows.push([{ text: 'NVDA' }, { text: 'MSFT' }]);
    rows.push([{ text: 'AMZN' }, { text: 'META' }]);
    rows.push([{ text: 'GOOGL' }, { text: 'NFLX' }]);
  }
  rows.push([{ text: '🔎 نماد دلخواه (تایپ کن)' }]);
  rows.push([{ text: '⬅️ منو' }]);
  return {
    keyboard: rows,
    resize_keyboard: true,
    one_time_keyboard: false,
    input_field_placeholder: 'نماد را انتخاب کن یا تایپ کن…',
  };
}

function parseMarketFromText(t: string): Market | null {
  const s = (t || '').trim().toLowerCase();
  if (s === 'crypto' || s === 'کریپتو') return 'crypto';
  if (s === 'forex' || s === 'فارکس') return 'forex';
  if (s === 'metals' || s === 'فلزات') return 'metals';
  if (s === 'stocks' || s === 'سهام') return 'stocks';
  return null;
}

async function safeEditOrSend(tg: any, chatId: number, messageId: number | undefined, text: string) {
  if (!messageId) {
    await tg.sendMessage(chatId, text);
    return;
  }
  try {
    await tg.editMessageText(chatId, messageId, text);
  } catch {
    await tg.sendMessage(chatId, text);
  }
}

function timeframeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'H1', callback_data: 'on:tf:H1' }, { text: 'H4', callback_data: 'on:tf:H4' }, { text: 'D1', callback_data: 'on:tf:D1' }],
      [{ text: 'W1', callback_data: 'on:tf:W1' }],
    ],
  };
}

function riskKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'کم', callback_data: 'on:risk:low' }, { text: 'متوسط', callback_data: 'on:risk:medium' }, { text: 'زیاد', callback_data: 'on:risk:high' }],
    ],
  };
}

function styleKeyboard(user: UserProfile) {
  const allowCustom = !!user.customPromptReady;
  const rows: any[] = [
    [{ text: 'ICT', callback_data: 'on:style:ict' }, { text: 'RTM', callback_data: 'on:style:rtm' }],
    [{ text: 'پرایس اکشن', callback_data: 'on:style:price_action' }],
    [{ text: 'پرامپت عمومی', callback_data: 'on:style:general_prompt' }],
    [{ text: allowCustom ? 'پرامپت اختصاصی ✅' : 'پرامپت اختصاصی 🔒', callback_data: allowCustom ? 'on:style:custom_prompt' : 'noop' }],
  ];
  return { inline_keyboard: rows };
}

function newsKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'خاموش', callback_data: 'on:news:false' }, { text: 'روشن', callback_data: 'on:news:true' }],
    ],
  };
}

function contactKeyboard() {
  // ReplyKeyboardMarkup with request_contact
  return {
    keyboard: [[{ text: '📲 ارسال شماره (Share Contact)', request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function removeKeyboard() {
  return { remove_keyboard: true };
}

function parseStartRef(args: string[]) {
  const p = args?.[0] || '';
  if (p.startsWith('ref_')) return p.slice(4);
  if (p.startsWith('ref-')) return p.slice(4);
  return null;
}

function shortHtml(s: string) {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function handleUpdate(deps: { tg: any; storage: Storage; env: Env }, update: any) {
  const tg = deps.tg;
  const storage = deps.storage;
  const env = deps.env;

  const msg = update.message;
  const cb = update.callback_query;

  if (msg) {
    const userId = msg.from?.id;
    const chatId = msg.chat?.id;
    if (!userId || !chatId) return;

    const user = await storage.ensureUser(userId, { username: msg.from?.username, firstName: msg.from?.first_name });

    // Contact shared
    if (msg.contact?.phone_number) {
      await onContact({ tg, storage, env, user, chatId, phone: msg.contact.phone_number });
      return;
    }

    const cmd = parseCommand(msg.text);

    // ReplyKeyboard menu taps
    const mapped = mapMenuTextToCommand(msg.text);
    if (!cmd && mapped) {
      await storage.setSession(userId, null);
      await onCommand({ tg, storage, env, user, chatId, cmd: mapped, args: [], raw: mapped });
      return;
    }

    if (cmd) {
      await onCommand({ tg, storage, env, user, chatId, cmd: cmd.cmd, args: cmd.args, raw: msg.text });
      return;
    }

    const session = await storage.getSession(userId);
    if (session) {
      await onSessionText({ tg, storage, env, user, chatId, session, text: msg.text || '' });
      return;
    }

    // fallback
    await tg.sendMessage(chatId, 'از منو استفاده کن یا /menu بزن 🙂', { reply_markup: mainMenu(env.PUBLIC_BASE_URL) });
    return;
  }

  if (cb) {
    const userId = cb.from?.id;
    const chatId = cb.message?.chat?.id;
    const msgId = cb.message?.message_id;
    if (!userId || !chatId) return;

    const user = await storage.ensureUser(userId, { username: cb.from?.username, firstName: cb.from?.first_name });
    await tg.answerCallbackQuery(cb.id);

    const data: string = cb.data || '';
    await onCallback({ tg, storage, env, user, chatId, msgId, data });
    return;
  }
}

async function onCommand(ctx: { tg: any; storage: Storage; env: Env; user: UserProfile; chatId: number; cmd: string; args: string[]; raw: string }) {
  const { tg, storage, env, user, chatId, cmd, args } = ctx;

  if (cmd === '/start') {
  const botName = getBotName(env);
  await tg.sendMessage(
    chatId,
    `👋 سلام ${shortHtml((user.first_name || user.username || ''))}\nبه ربات <b>${shortHtml(botName)}</b> خوش آمدی.\nاز منوی زیر انتخاب کن:`,
    { reply_markup: mainMenu(env.PUBLIC_BASE_URL) }
  );
  return;
}

    await tg.sendMessage(chatId, `خوش اومدی ${shortHtml(user.name)} 👋\n\nمنوی اصلی:`, { reply_markup: mainMenu(env.PUBLIC_BASE_URL) });
    return;
  }

  if (cmd === '/profile') {
    await sendProfile(ctx);
    return;
  }

  if (cmd === '/settings') {
    await tg.sendMessage(chatId, 'تنظیمات فعلی:', { reply_markup: settingsKeyboard(user) });
    return;
  }

  if (cmd === '/signals') {
    await storage.setSession(user.id, { mode: 'signal_market' });
    await tg.sendMessage(chatId, 'بازار را انتخاب کن:', { reply_markup: signalMarketReplyKeyboard() });
    return;
  }

  if (cmd === '/buy' || cmd === '/pay') {
    await tg.sendMessage(chatId, `برای خرید اشتراک:\n\n1) مبلغ <b>${storage.subPrice}</b> USDT ارسال کن\n2) سپس دستور زیر را بزن:\n<code>/tx YOUR_TXID</code>\n\nمدت اشتراک: <b>${storage.subDays}</b> روز`, { reply_markup: mainMenu(env.PUBLIC_BASE_URL) });
    return;
  }

  if (cmd === '/tx') {
    const txid = (args[0] || '').trim();
    if (!txid) {
      await tg.sendMessage(chatId, 'فرمت صحیح: <code>/tx YOUR_TXID</code>');
      return;
    }
    await storage.putPayment({ txid, userId: user.id, status: 'pending', createdAt: nowMs() });
    await tg.sendMessage(chatId, `TxID ثبت شد ✅\nدر انتظار تایید ادمین: <code>${shortHtml(txid)}</code>`);
    // notify admins
    await notifyAdmins(storage, tg, `💳 پرداخت جدید\nUser: ${user.id}\nTxID: ${txid}`);
    return;
  }

  if (cmd === '/wallet') {
    const w = await storage.getWalletPublic();
    await tg.sendMessage(chatId, w ? `آدرس ولت عمومی:\n<code>${shortHtml(w)}</code>` : 'ولت عمومی هنوز تنظیم نشده.');
    return;

if (cmd === '/news') {
  // /news [market] [symbol]
  // examples:
  // /news crypto BTCUSDT
  // /news forex EUR/USD
  const a0 = (args?.[0] || '').toLowerCase();
  const a1 = (args?.[1] || '').toUpperCase();
  let market = (['crypto','forex','metals','stocks'].includes(a0) ? (a0 as any) : null) as any;
  let symbol = market ? a1 : (args?.[0] || '').toUpperCase();

  if (!symbol) {
    await tg.sendMessage(chatId, 'فرمت: /news [crypto|forex|metals|stocks] SYMBOL\nمثال: /news crypto BTCUSDT');
    return;
  }

  if (!market) {
    market = guessMarketFromSymbol(symbol);
  }

  const nd = await getNewsDigest({ storage, env, market, symbol, maxItems: 8, cacheTtlSec: 600, summarize: true });
  await tg.sendMessage(chatId, nd.text);
  return;
}


  }

  if (cmd === '/customprompt') {
    await storage.setSession(user.id, { mode: 'customprompt_wait_text' });
    await tg.sendMessage(chatId, 'متن استراتژی‌ات را همینجا ارسال کن. (بعد از تولید، ۲ ساعت بعد برایت ارسال می‌شود)');
    return;
  }

  if (cmd === '/ref') {
    await sendRefInfo(ctx);
    return;
  }

  if (cmd === '/redeem') {
    await redeem(ctx);
    return;
  }

  if (cmd === '/level') {
    await startLeveling(ctx);
    return;
  }

  if (cmd === '/support') {
    await tg.sendMessage(chatId, 'برای پشتیبانی پیام بده: @YourSupportUsername (قابل تغییر در کد)');
    return;
  }

  if (cmd === '/education') {
    await tg.sendMessage(chatId, 'آموزش‌ها: (اینجا لینک‌ها/کانال‌ها را قرار بدهید)');
    return;
  }

  // admin commands
  if (cmd === '/payments' || cmd === '/approve' || cmd === '/reject' || cmd === '/setwallet' || cmd === '/setfreelimit' || cmd === '/setsublimit' || cmd === '/admin') {
    await adminCommands(ctx);
    return;
  }

  await tg.sendMessage(chatId, 'دستور ناشناخته. /menu');
}

async function onCallback(ctx: { tg: any; storage: Storage; env: Env; user: UserProfile; chatId: number; msgId?: number; data: string }) {
  const { tg, storage, env, user, chatId, msgId, data } = ctx;

  if (data === 'go:menu') {
    await tg.sendMessage(chatId, 'منوی اصلی:', { reply_markup: mainMenu(env.PUBLIC_BASE_URL) });
    return;
  }
  if (data === 'go:profile') {
    await sendProfile({ tg, storage, env, user, chatId, cmd: '/profile', args: [], raw: '/profile' } as any);
    return;
  }
  if (data === 'go:settings') {
    await tg.editMessageText(chatId, msgId!, 'تنظیمات فعلی:', { reply_markup: settingsKeyboard(user) });
    return;
  }
  if (data === 'go:signals') {
    await storage.setSession(user.id, { mode: 'signal_market' });
    await tg.sendMessage(chatId, 'بازار را انتخاب کن:', { reply_markup: signalMarketReplyKeyboard() });
    return;
  }
  if (data === 'go:buy') {
    await tg.sendMessage(chatId, `برای خرید اشتراک:\n\n1) مبلغ <b>${storage.subPrice}</b> USDT ارسال کن\n2) سپس <code>/tx YOUR_TXID</code>\n\nمدت اشتراک: <b>${storage.subDays}</b> روز`, { reply_markup: mainMenu(env.PUBLIC_BASE_URL) });
    return;
  }
  if (data === 'go:ref') {
    await sendRefInfo({ tg, storage, env, user, chatId, cmd: '/ref', args: [], raw: '/ref' } as any);
    return;
  }
  if (data.startsWith('noop')) return;

  // onboarding flow callbacks
  if (data.startsWith('on:exp:')) {
    user.experience = data.split(':')[2] as any;
    await storage.putUser(user);
    await storage.setSession(user.id, { mode: 'onboarding_market' });
    await tg.editMessageText(chatId, msgId!, 'بازار مورد علاقه‌ات کدام است؟', { reply_markup: marketKeyboard('on:mkt') });
    return;
  }
  if (data.startsWith('on:mkt:')) {
    user.favoriteMarket = data.split(':')[2] as any;
    await storage.putUser(user);
    await storage.setSession(user.id, { mode: 'onboarding_timeframe' });
    await tg.editMessageText(chatId, msgId!, 'تایم‌فریم پیش‌فرض:', { reply_markup: timeframeKeyboard() });
    return;
  }
  if (data.startsWith('on:tf:')) {
    user.settings.timeframe = data.split(':')[2];
    await storage.putUser(user);
    await storage.setSession(user.id, { mode: 'onboarding_risk' });
    await tg.editMessageText(chatId, msgId!, 'ریسک پیش‌فرض:', { reply_markup: riskKeyboard() });
    return;
  }
  if (data.startsWith('on:risk:')) {
    user.settings.risk = data.split(':')[2] as any;
    await storage.putUser(user);
    await storage.setSession(user.id, { mode: 'onboarding_style' });
    await tg.editMessageText(chatId, msgId!, 'سبک معامله:', { reply_markup: styleKeyboard(user) });
    return;
  }
  if (data.startsWith('on:style:')) {
    user.settings.style = data.split(':')[2] as any;
    await storage.putUser(user);
    await storage.setSession(user.id, { mode: 'onboarding_news' });
    await tg.editMessageText(chatId, msgId!, 'بخش خبر فعال باشد؟', { reply_markup: newsKeyboard() });
    return;
  }
  if (data.startsWith('on:news:')) {
    user.settings.news = data.split(':')[2] === 'true';
    await storage.putUser(user);
    await storage.setSession(user.id, null);
    await tg.editMessageText(chatId, msgId!, 'پروفایل شما کامل شد ✅\n\nمنوی اصلی:', { reply_markup: mainMenu(env.PUBLIC_BASE_URL) });
    return;
  }

  // settings
  if (data === 'set:tf') {
    await tg.editMessageText(chatId, msgId!, 'تایم‌فریم را انتخاب کن:', { reply_markup: timeframeKeyboard() });
    await storage.setSession(user.id, { mode: 'onboarding_timeframe' }); // reuse
    return;
  }
  if (data === 'set:risk') {
    await tg.editMessageText(chatId, msgId!, 'ریسک را انتخاب کن:', { reply_markup: riskKeyboard() });
    await storage.setSession(user.id, { mode: 'onboarding_risk' });
    return;
  }
  if (data === 'set:style') {
    await tg.editMessageText(chatId, msgId!, 'سبک را انتخاب کن:', { reply_markup: styleKeyboard(user) });
    await storage.setSession(user.id, { mode: 'onboarding_style' });
    return;
  }
  if (data === 'set:news') {
    await tg.editMessageText(chatId, msgId!, 'خبر را روشن/خاموش کن:', { reply_markup: newsKeyboard() });
    await storage.setSession(user.id, { mode: 'onboarding_news' });
    return;
  }

  // signals
  if (data.startsWith('sig:mkt:')) {
    const market = data.split(':')[2] as Market;
    await storage.setSession(user.id, { mode: 'signal_symbol', temp: { market } });
    await tg.sendMessage(chatId, `بازار انتخاب شد: ${market.toUpperCase()}\nنماد را انتخاب کن یا تایپ کن:`, { reply_markup: signalSymbolsReplyKeyboard(market) });
    return;
  }
}

async function onSessionText(ctx: { tg: any; storage: Storage; env: Env; user: UserProfile; chatId: number; session: SessionState; text: string }) {
  const { tg, storage, env, user, chatId, session, text } = ctx;

  if (session.mode === 'onboarding_name') {
    user.name = text.trim().slice(0, 50);
    await storage.putUser(user);
    await storage.setSession(user.id, { mode: 'onboarding_contact' });
    await tg.sendMessage(chatId, 'عالی! حالا شماره‌ات را Share Contact کن:', { reply_markup: contactKeyboard() });
    return;
  }

if (session.mode === 'signal_market') {
  if ((text || '').trim() === '⬅️ منو') {
    await storage.setSession(user.id, null);
    await tg.sendMessage(chatId, 'منوی اصلی:', { reply_markup: mainMenu(env.PUBLIC_BASE_URL) });
    return;
  }
  const market = parseMarketFromText(text);
  if (!market) {
    await tg.sendMessage(chatId, 'بازار نامعتبر است. یکی از گزینه‌ها را انتخاب کن:', { reply_markup: signalMarketReplyKeyboard() });
    return;
  }
  await storage.setSession(user.id, { mode: 'signal_symbol', temp: { market } });
  await tg.sendMessage(chatId, `بازار انتخاب شد: ${market.toUpperCase()}\nحالا نماد را انتخاب کن یا تایپ کن:`, { reply_markup: signalSymbolsReplyKeyboard(market) });
  return;
}

  if (session.mode === 'signal_symbol') {
  const market: Market = session.temp?.market;
  const raw = (text || '').trim();

  if (raw === '⬅️ منو') {
    await storage.setSession(user.id, null);
    await tg.sendMessage(chatId, 'منوی اصلی:', { reply_markup: mainMenu(env.PUBLIC_BASE_URL) });
    return;
  }

  if (raw.startsWith('🔎')) {
    await tg.sendMessage(chatId, 'نماد دلخواه را تایپ کن (مثال: BTCUSDT یا EUR/USD یا XAUUSD یا AAPL).', { reply_markup: signalSymbolsReplyKeyboard(market) });
    return;
  }

  const symbol = raw.toUpperCase();
  await storage.setSession(user.id, null);

  const quota = await checkAndConsume(storage as any, env, user, true);
  if (!quota.allowed) {
    await tg.sendMessage(chatId, `${quota.reason}\nباقی‌مانده امروز: ${quota.remainingDaily} | این ماه: ${quota.remainingMonthly}`, { reply_markup: mainMenu(env.PUBLIC_BASE_URL) });
    return;
  }

  // پیام اولیه و گرفتن message_id برای edit
  const m0 = await tg.sendMessage(chatId, `⏳ 1/3 دریافت دیتا برای <b>${symbol}</b> ...`, { reply_markup: signalSymbolsReplyKeyboard(market) });
  const progressMsgId = m0?.message_id;

  try {
    const tf = user.settings.timeframe;

    // 1/3 دریافت دیتا
    const candles = await fetchCandles(env as any, market, symbol, tf);

    await safeEditOrSend(tg, chatId, progressMsgId, `🤖 2/3 تحلیل ${symbol} ...`);

    // 2/3 تحلیل
    const last = candles.slice(-20);
    const candlesSummary = last.map(c => `${new Date(c.x).toISOString().slice(0,16)} o:${c.o} h:${c.h} l:${c.l} c:${c.c}`).join(' | ');
    const analysis = await runAnalysis({ env, storage, user, market, symbol, timeframe: tf, candlesSummary });

    await safeEditOrSend(tg, chatId, progressMsgId, `🖼️ 3/3 رسم چارت و زون‌ها ...`);

    // 3/3 چارت
    const png = await renderChartPng({ symbol, candles, zones: analysis.zones });

    await tg.sendMessage(chatId, analysis.text, { reply_markup: mainMenu(env.PUBLIC_BASE_URL) });
    await tg.sendPhoto(chatId, png, `چارت ${symbol} با زون‌ها`, { reply_markup: mainMenu(env.PUBLIC_BASE_URL) });

    await safeEditOrSend(tg, chatId, progressMsgId, `✅ انجام شد: ${symbol}`);
  } catch (e: any) {
    await safeEditOrSend(tg, chatId, progressMsgId, `❌ خطا: ${shortHtml(e?.message || String(e))}`);
  }
  return;
}

    await tg.sendMessage(chatId, `در حال دریافت دیتا و تحلیل ${symbol} ... ⏳`);

    try {
      const tf = user.settings.timeframe;
      const candles = await fetchCandles(env as any, market, symbol, tf);
      const last = candles.slice(-20);
      const candlesSummary = last.map(c => `${new Date(c.x).toISOString().slice(0,16)} o:${c.o} h:${c.h} l:${c.l} c:${c.c}`).join(' | ');

      let newsDigest: string | undefined;
      if (user.settings.news) {
        const nd = await getNewsDigest({ storage, env, market, symbol, maxItems: 5, cacheTtlSec: 600 });
        newsDigest = nd.text;
      }

      const analysis = await runAnalysis({ env, storage, user, market, symbol, timeframe: tf, candlesSummary, newsDigest });
      const png = await renderChartPng({ symbol, candles, zones: analysis.zones });

      await tg.sendMessage(chatId, analysis.text);
      if (newsDigest) await tg.sendMessage(chatId, newsDigest);
      await tg.sendPhoto(chatId, png, `چارت ${symbol} با زون‌ها`);
    } catch (e: any) {
      await tg.sendMessage(chatId, `خطا در تحلیل: ${shortHtml(e?.message || String(e))}`);
    }
    return;
  }

  if (session.mode === 'customprompt_wait_text') {
    const strategy = text.trim();
    if (strategy.length < 20) {
      await tg.sendMessage(chatId, 'متن خیلی کوتاهه. لطفاً توضیح کامل‌تری بده.');
      return;
    }
    const jobId = `${user.id}_${Date.now()}`;
    const dueAt = Date.now() + 2 * 60 * 60 * 1000; // 2h
    await storage.addCustomPromptJob({ id: jobId, userId: user.id, createdAt: Date.now(), dueAt, strategy });
    await storage.setSession(user.id, null);
    await tg.sendMessage(chatId, 'درخواست ثبت شد ✅\nپرامپت اختصاصی حدود ۲ ساعت دیگر برایت ارسال می‌شود.');
    return;
  }

  if (session.mode === 'level_q') {
    const step = session.step || 0;
    const answers = session.answers || [];
    answers.push(text.trim());
    await storage.setSession(user.id, { ...session, answers, step: step + 1 });
    await askLevelQuestion({ env, tg, storage, user, chatId });
    return;
  }
}

async function onContact(ctx: { tg: any; storage: Storage; env: Env; user: UserProfile; chatId: number; phone: string }) {
  const { tg, storage, env, user, chatId, phone } = ctx;

  const phoneE164 = phone.replace(/\s+/g, '');
  const unique = await storage.setPhoneUnique(user.id, phoneE164);
  if (!unique.ok) {
    await tg.sendMessage(chatId, 'این شماره قبلاً ثبت شده است. لطفاً با یک شماره جدید وارد شوید.');
    return;
  }

  user.phone = phoneE164;
  await storage.putUser(user);

  // accept referral if pending and contact shared and phone unique
  const pendingRef = (user as any).tempPendingRef;
  if (pendingRef) {
    const referrerIdStr = await env.DB.get(`ref:${pendingRef}`);
    const referrerId = referrerIdStr ? Number(referrerIdStr) : null;
    if (referrerId && referrerId !== user.id) {
      // only if user had no referrer yet
      if (!user.referrerId) {
        user.referrerId = referrerId;
        await storage.putUser(user);

        // award referrer points, increment invites, update commission pct
        const refUser = await storage.ensureUser(referrerId);
        refUser.successfulInvites += 1;
        refUser.points += storage.refPointsPerInvite;
        refUser.commissionPct = Math.min(storage.refCommissionMaxPct, refUser.successfulInvites * storage.refCommissionStepPct);
        await storage.putUser(refUser);

        await tg.sendMessage(chatId, 'رفرال ثبت شد ✅');
        await tg.sendMessage(referrerId, `🎉 یک دعوت موفق ثبت شد!\nامتیاز +${storage.refPointsPerInvite}\nدرصد کمیسیون فعلی: ${refUser.commissionPct}%`);
      }
    }
    delete (user as any).tempPendingRef;
    await storage.putUser(user);
  }

  await storage.setSession(user.id, { mode: 'onboarding_experience' });
  await tg.sendMessage(chatId, 'شماره ذخیره شد ✅\nسطح تجربه‌ات در بازار؟', { reply_markup: experienceKeyboard() });
  await tg.sendMessage(chatId, 'منو:', { reply_markup: mainMenu(env.PUBLIC_BASE_URL) });
}

async function sendProfile(ctx: { tg: any; storage: Storage; env: Env; user: UserProfile; chatId: number }) {
  const { tg, storage, env, user, chatId } = ctx;
  const q = await checkAndConsume(storage as any, env, user, false);

  const subActive = (user.subEnd || 0) > Date.now();
  const subText = subActive ? `فعال تا ${formatDateTime(user.subEnd!, storage.tz)}` : 'غیرفعال';

  const botUsername = await storage.getBotUsername();
  const miniUrl = env.PUBLIC_BASE_URL ? `${env.PUBLIC_BASE_URL.replace(/\/$/,'')}/miniapp` : '';

  const txt = `<b>پروفایل</b>
نام: <b>${shortHtml(user.name || '-')}</b>
شماره: <code>${shortHtml(user.phone || '-')}</code>
تجربه: <b>${shortHtml(user.experience || '-')}</b>
بازار علاقه: <b>${shortHtml(user.favoriteMarket || '-')}</b>

<b>تنظیمات</b>
TF: <code>${shortHtml(user.settings.timeframe)}</code>
Risk: <code>${shortHtml(user.settings.risk)}</code>
Style: <code>${shortHtml(user.settings.style)}</code>
News: <code>${user.settings.news ? 'ON' : 'OFF'}</code>

<b>اشتراک</b>: ${subText}

<b>سهمیه</b>
روزانه: ${q.remainingDaily}/${q.limitDaily}
ماهانه: ${q.remainingMonthly}/${q.limitMonthly}

<b>امتیاز</b>: ${user.points}
<b>دعوت موفق</b>: ${user.successfulInvites}
<b>کمیسیون</b>: ${user.commissionPct}% | موجودی کمیسیون: ${user.commissionBalance}

${miniUrl ? `\n🧩 <a href="${miniUrl}">Mini App</a>` : ''}`;

  await tg.sendMessage(chatId, txt, { reply_markup: mainMenu(env.PUBLIC_BASE_URL) });
}

async function sendRefInfo(ctx: { tg: any; storage: Storage; env: Env; user: UserProfile; chatId: number }) {
  const { tg, storage, env, user, chatId } = ctx;
  const botUsername = await storage.getBotUsername();
  const base = botUsername ? `https://t.me/${botUsername}?start=ref_` : '(بعد از اولین پیام، یوزرنیم بات اتومات ذخیره می‌شود)';
  const links = user.referralCodes.map(c => botUsername ? `${base}${c}` : c).join('\n');

  const txt = `<b>رفرال</b>
امتیاز: <b>${user.points}</b>
دعوت موفق: <b>${user.successfulInvites}</b>
درصد کمیسیون: <b>${user.commissionPct}%</b>
موجودی کمیسیون: <b>${user.commissionBalance}</b>

کد/لینک‌ها (۵ عدد):
<code>${shortHtml(links)}</code>

هر دعوت موفق: +${storage.refPointsPerInvite} امتیاز
هر خرید اشتراک (بعد از تایید): +${storage.refPointsPerSubPurchase} امتیاز برای معرف
تبدیل امتیاز: هر ${storage.refRedeemPoints} امتیاز = ۱ اشتراک رایگان (/redeem)`;
  await tg.sendMessage(chatId, txt, { reply_markup: mainMenu(env.PUBLIC_BASE_URL) });
}

async function redeem(ctx: { tg: any; storage: Storage; env: Env; user: UserProfile; chatId: number }) {
  const { tg, storage, env, user, chatId } = ctx;
  if (user.points < storage.refRedeemPoints) {
    await tg.sendMessage(chatId, `امتیاز کافی نیست. امتیاز فعلی: ${user.points} (نیاز: ${storage.refRedeemPoints})`);
    return;
  }
  user.points -= storage.refRedeemPoints;
  const addMs = storage.subDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  user.subEnd = Math.max(user.subEnd || 0, now) + addMs;
  await storage.putUser(user);
  await tg.sendMessage(chatId, `✅ اشتراک رایگان فعال شد!\nتا: ${formatDateTime(user.subEnd, storage.tz)}`);
}

async function startLeveling(ctx: { tg: any; storage: Storage; env: Env; user: UserProfile; chatId: number }) {
  const { env, tg, storage, user, chatId } = ctx;
  await storage.setSession(user.id, { mode: 'level_q', step: 0, answers: [] });
  await tg.sendMessage(chatId, 'آزمون تعیین سطح شروع شد. سوال ۱ را جواب بده:');
  await askLevelQuestion({ env, tg, storage, user, chatId });
}

const LEVEL_QUESTIONS = [
  '۱) چند وقت است معامله می‌کنی؟',
  '۲) بیشتر کدام بازار را معامله می‌کنی؟ (کریپتو/فارکس/سهام/فلزات)',
  '۳) سبک شما چیست؟ (ICT/RTM/PA/...)',
  '۴) مدیریت ریسک شما چگونه است؟ (حد ضرر، درصد ریسک هر معامله)',
  '۵) تایم‌فریم مورد علاقه؟',
  '۶) بزرگ‌ترین چالش شما در معامله‌گری چیست؟',
];

async function askLevelQuestion(ctx: { env: any; tg: any; storage: Storage; user: UserProfile; chatId: number }) {
  const { env, tg, storage, user, chatId } = ctx;
  const session = await storage.getSession(user.id);
  if (!session || session.mode !== 'level_q') return;

  const step = session.step || 0;
  if (step >= LEVEL_QUESTIONS.length) {
    // analyze via AI
    await storage.setSession(user.id, null);
    await tg.sendMessage(chatId, 'در حال تحلیل نتیجه آزمون... ⏳');
    try {
      const answers = session.answers || [];
      const prompt = `پاسخ‌های کاربر به آزمون تعیین سطح:
${answers.map((a, i) => `${i + 1}) ${a}`).join('\n')}

خروجی را به صورت JSON در بلاک json بده:
{
 "level": "beginner|intermediate|pro",
 "summary": "...",
 "suggestedMarket": "crypto|forex|metals|stocks",
 "suggestedSettings": {"timeframe":"H4","risk":"medium","style":"ict","news":false}
}`;
      const out = await generateText(env, { user: prompt, temperature: 0.2 });
      const m = out.match(/```json\s*([\s\S]*?)```/i);
      const obj = m ? JSON.parse(m[1]) : null;
      if (obj) {
        user.level = obj;
        await storage.putUser(user);
      }
      await tg.sendMessage(chatId, `✅ نتیجه تعیین سطح:\n${out}`);
    } catch (e: any) {
      await tg.sendMessage(chatId, `خطا در تعیین سطح: ${shortHtml(e?.message || String(e))}`);
    }
    return;
  }

  await tg.sendMessage(chatId, LEVEL_QUESTIONS[step]);
}

async function adminCommands(ctx: { tg: any; storage: Storage; env: Env; user: UserProfile; chatId: number; cmd: string; args: string[]; raw: string }) {
  const { tg, storage, env, user, chatId, cmd, args } = ctx;
  if (!storage.isAdmin(user.id)) {
    await tg.sendMessage(chatId, 'دسترسی ادمین ندارید.');
    return;
  }

  if (cmd === '/admin') {
    const base = env.PUBLIC_BASE_URL?.replace(/\/$/, '') || '(PUBLIC_BASE_URL را تنظیم کنید)';
    await tg.sendMessage(chatId, `پنل ادمین:\n${base}/admin\n\nدر مرورگر، توکن را وارد کنید.`);
    return;
  }

  if (cmd === '/payments') {
    const pending = await storage.listPendingPayments(50);
    if (!pending.length) {
      await tg.sendMessage(chatId, 'پرداخت در انتظار نداریم.');
      return;
    }
    const text = pending.map(p => `• <code>${p.txid}</code> | user: ${p.userId} | at: ${formatDateTime(p.createdAt, storage.tz)}`).join('\n');
    await tg.sendMessage(chatId, `<b>پرداخت‌های در انتظار</b>\n${text}`);
    return;
  }

  if (cmd === '/approve') {
    const txid = (args[0] || '').trim();
    const p = await storage.getPayment(txid);
    if (!p || p.status !== 'pending') {
      await tg.sendMessage(chatId, 'TxID معتبر/در انتظار نیست.');
      return;
    }
    p.status = 'approved';
    p.decidedAt = nowMs();
    await storage.putPayment(p);

    const target = await storage.ensureUser(p.userId);
    const addMs = storage.subDays * 24 * 60 * 60 * 1000;
    target.subEnd = Math.max(target.subEnd || 0, Date.now()) + addMs;

    // referral rewards & commission
    if (target.referrerId) {
      const ref = await storage.ensureUser(target.referrerId);
      ref.points += storage.refPointsPerSubPurchase;
      const commission = storage.subPrice * (ref.commissionPct / 100);
      ref.commissionBalance += commission;
      await storage.putUser(ref);
      await tg.sendMessage(ref.id, `💰 خرید اشتراک توسط زیرمجموعه شما تایید شد.\nامتیاز +${storage.refPointsPerSubPurchase}\nکمیسیون +${commission}`);
    }

    await storage.putUser(target);
    await tg.sendMessage(p.userId, `✅ پرداخت تایید شد. اشتراک فعال شد تا: ${formatDateTime(target.subEnd!, storage.tz)}`);
    await tg.sendMessage(chatId, 'تایید شد ✅');
    return;
  }

  if (cmd === '/reject') {
    const txid = (args[0] || '').trim();
    const p = await storage.getPayment(txid);
    if (!p || p.status !== 'pending') {
      await tg.sendMessage(chatId, 'TxID معتبر/در انتظار نیست.');
      return;
    }
    p.status = 'rejected';
    p.decidedAt = nowMs();
    await storage.putPayment(p);
    await tg.sendMessage(p.userId, `❌ پرداخت رد شد. TxID: <code>${shortHtml(txid)}</code>`);
    await tg.sendMessage(chatId, 'رد شد ✅');
    return;
  }

  if (cmd === '/setwallet') {
    const addr = args.join(' ').trim();
    await storage.setWalletPublic(addr);
    await tg.sendMessage(chatId, 'ولت عمومی ذخیره شد ✅');
    // owner alert
    if (!storage.isOwner(user.id) && env.OWNER_ID) {
      await tg.sendMessage(Number(env.OWNER_ID), `⚠️ آدرس ولت عمومی تغییر کرد توسط admin ${user.id}\nNew: <code>${shortHtml(addr)}</code>`);
    }
    return;
  }

  if (cmd === '/setfreelimit') {
    const n = Number(args[0]);
    const limits = await storage.getLimits();
    limits.freeDaily = Number.isFinite(n) ? n : limits.freeDaily;
    await storage.setLimits(limits);
    await tg.sendMessage(chatId, `Free daily limit = ${limits.freeDaily}`);
    return;
  }

  if (cmd === '/setsublimit') {
    const n = Number(args[0]);
    const limits = await storage.getLimits();
    limits.subDaily = Number.isFinite(n) ? n : limits.subDaily;
    await storage.setLimits(limits);
    await tg.sendMessage(chatId, `Sub daily limit = ${limits.subDaily}`);
    return;
  }
}

async function notifyAdmins(storage: Storage, tg: any, text: string) {
  const admins = (storage as any).env?.ADMIN_IDS || '';
  const ids = admins.split(',').map((s: string) => s.trim()).filter(Boolean).map((s: string) => Number(s));
  const owner = (storage as any).env?.OWNER_ID ? Number((storage as any).env.OWNER_ID) : null;
  const targets = new Set<number>([...(owner ? [owner] : []), ...ids]);
  for (const id of targets) {
    try { await tg.sendMessage(id, text); } catch {}
  }
}


function guessMarketFromSymbol(symbol: string): any {
  const s = String(symbol || '').toUpperCase();
  if (s.includes('USDT') || s.includes('USDC') || s.includes('-USD')) return 'crypto';
  if (s.includes('/') || /^[A-Z]{6}(=X)?$/.test(s)) return 'forex';
  if (s.startsWith('XAU') || s.startsWith('XAG')) return 'metals';
  return 'stocks';
}
