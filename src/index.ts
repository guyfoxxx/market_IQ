import { Telegram } from './telegram';
import { Storage } from './storage';
import { handleUpdate } from './handlers';
import { html, json, text } from './utils';
import { adminHtml } from './admin/html';
import { handleAdminApi } from './admin/api';
import { verifyWebAppInitData } from './telegram_webapp';
import { fetchCandles } from './data';
import { runAnalysis } from './analysis';
import { getNewsDigest } from './news';
import { renderChartPng } from './chart';
import { checkAndConsume } from './quota';

export interface Env {
  DB: KVNamespace;

  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;

  PUBLIC_BASE_URL?: string;

  OWNER_ID?: string;
  ADMIN_IDS?: string;
  ADMIN_PANEL_TOKEN?: string;

  // limits / pricing / referral
  FREE_DAILY_LIMIT?: string;
  FREE_MONTHLY_LIMIT?: string;
  SUB_DAILY_LIMIT?: string;
  SUB_PRICE?: string;
  SUB_DAYS?: string;

  REF_POINTS_PER_INVITE?: string;
  REF_POINTS_PER_SUB_PURCHASE?: string;
  REF_REDEEM_POINTS?: string;
  REF_COMMISSION_STEP_PCT?: string;
  REF_COMMISSION_MAX_PCT?: string;

  // AI
  AI_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_BASE_URL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  AI_COMPAT_BASE_URL?: string;
  AI_COMPAT_API_KEY?: string;
  AI_COMPAT_MODEL?: string;

  // market data
  ALPHAVANTAGE_API_KEY?: string;
  FINNHUB_API_KEY?: string;
  TWELVEDATA_API_KEY?: string;
  POLYGON_API_KEY?: string;

  TIMEZONE?: string;
}

function badRequest(msg: string) {
  return json({ ok: false, error: msg }, { status: 400 });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const storage = new Storage(env);
    const tg = new Telegram(env.TELEGRAM_BOT_TOKEN);

    // cache bot username
    ctx.waitUntil((async () => {
      try {
        const existing = await storage.getBotUsername();
        if (!existing) {
          const me = await tg.getMe();
          if (me?.username) await storage.setBotUsername(me.username);
        }
      } catch {}
    })());

    if (url.pathname === '/telegram' && req.method === 'POST') {
      if (env.TELEGRAM_WEBHOOK_SECRET) {
        const secret = req.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
        if (secret !== env.TELEGRAM_WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
      }
      // Telegram expects a fast response; do heavy work in waitUntil to avoid webhook retries/timeouts.
      const update = (await req.json()) as any;
      ctx.waitUntil((async () => {
        try {
          await handleUpdate({ tg, storage, env }, update);
        } catch (e) {
          // Avoid throwing inside the Worker; Telegram will retry otherwise.
          console.error('handleUpdate error', e);
        }
      })());
      return new Response('ok');
    }

    if (url.pathname === '/admin' && req.method === 'GET') {
      return html(adminHtml());
    }

    if (url.pathname.startsWith('/admin/api') && req.method === 'POST') {
      return handleAdminApi(req, env, storage);
    }

    if (url.pathname === '/miniapp' && req.method === 'GET') {
      const htmlText = await env.DB.get('asset:miniapp:index.html') || null;
      // use embedded file by default
      return html(htmlText || (await import('./miniapp_inline')).MINIAPP_HTML);
    }

    if (url.pathname.startsWith('/api') && req.method === 'POST') {
      return handleMiniAppApi(req, env, storage, tg);
    }

    return text('not found', { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // process custom prompt jobs
    const storage = new Storage(env);
    const tg = new Telegram(env.TELEGRAM_BOT_TOKEN);

    const list = await storage.listCustomPromptJobs(1000);
    const now = Date.now();

    for (const k of list.keys) {
      const id = k.name.replace('job:customprompt:', '');
      const job = await storage.getCustomPromptJob(id);
      if (!job) continue;
      if (job.dueAt > now) continue;

      ctx.waitUntil((async () => {
        try {
          const user = await storage.ensureUser(job.userId);
          const prompt = await generateCustomPrompt(env, storage, job.strategy);

          user.customPrompt = prompt;
          user.customPromptReady = true;
          await storage.putUser(user);

          await tg.sendMessage(job.userId, `✅ پرامپت اختصاصی آماده شد!\n\n<pre>${escapeHtml(prompt)}</pre>\n\nحالا می‌تونی Style را روی «custom_prompt» بذاری.`);
        } catch (e: any) {
          try { await tg.sendMessage(job.userId, `خطا در تولید پرامپت اختصاصی: ${escapeHtml(e?.message || String(e))}`); } catch {}
        } finally {
          await storage.deleteCustomPromptJob(id);
        }
      })());
    }
  },
};

async function generateCustomPrompt(env: Env, storage: Storage, strategy: string) {
  const base = (await storage.getPrompt('base')) || '';
  const instruction = `تو باید از روی متن استراتژی کاربر، یک پرامپت قابل استفاده برای تحلیل‌گر تولید کنی.
ویژگی‌ها:
- کوتاه ولی دقیق
- شامل قوانین ورود/خروج، مدیریت ریسک، فیلترها، و قالب خروجی
- فارسی

فقط خود پرامپت را بده (بدون توضیحات اضافه).`;
  const out = await (await import('./ai')).generateText(env as any, { system: base + '\n\n' + instruction, user: strategy, temperature: 0.2 });
  return out.trim();
}

function escapeHtml(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---- MiniApp APIs ----
async function handleMiniAppApi(req: Request, env: Env, storage: Storage, tg: Telegram) {
  const url = new URL(req.url);
  const path = url.pathname.replace('/api', '');
  const body = ((await req.json().catch(() => ({}))) as any);
  const initData = String(body.initData || '');
  const parsed = initData ? await verifyWebAppInitData(initData, env.TELEGRAM_BOT_TOKEN) : null;
  const userObj = parsed?.user;
  const userId = userObj?.id ? Number(userObj.id) : null;
  if (!userId) return json({ ok: false, error: 'invalid initData (open inside Telegram)' }, { status: 401 });

  const user = await storage.ensureUser(userId, { username: userObj?.username, firstName: userObj?.first_name });

  if (path === '/profile') {
    const q = await checkAndConsume(storage as any, env as any, user, false);
    return json({ ok: true, user, quota: q });
  }

  if (path === '/banner') {
    const b = await storage.getBanner();
    return json({ ok: true, banner: b });
  }

  if (path === '/settings') {
    if (body.timeframe) user.settings.timeframe = String(body.timeframe);
    if (body.risk) user.settings.risk = String(body.risk) as any;
    if (body.style) user.settings.style = String(body.style) as any;
    if (typeof body.news === 'boolean') user.settings.news = body.news;
    await storage.putUser(user);
    return json({ ok: true, settings: user.settings });
  }

  if (path === '/wallet/public') {
    const w = await storage.getWalletPublic();
    return json({ ok: true, walletPublic: w });
  }

  if (path === '/wallet/bep20') {
    user.bep20Address = String(body.bep20 || '').trim();
    await storage.putUser(user);
    return json({ ok: true, bep20Address: user.bep20Address });
  }

  if (path === '/wallet/request') {
    const kind = String(body.kind || '');
    if (kind === 'withdraw' && !user.bep20Address) {
      return badRequest('برای برداشت باید آدرس BEP20 ثبت کرده باشید.');
    }
    // notify admins
    const message = `📌 درخواست ${kind === 'deposit' ? 'واریز' : 'برداشت'} از MiniApp\nUser: ${user.id}\nBEP20: ${user.bep20Address || '-'}\nBalance(field): ${user.balance || 0}`;
    await notifyAdmins(env, tg, message);
    return json({ ok: true });
  }

  if (path === '/analyze') {
    const market = String(body.market || 'crypto') as any;
    const symbol = String(body.symbol || '').trim().toUpperCase();
    if (!symbol) return badRequest('symbol required');

    const quota = await checkAndConsume(storage as any, env as any, user, true);
    if (!quota.allowed) return json({ ok: false, error: quota.reason, quota });

    const tf = user.settings.timeframe;

    try {
      const candles = await fetchCandles(env as any, market, symbol, tf);
      const last = candles.slice(-20);
      const candlesSummary = last.map(c => `${new Date(c.x).toISOString().slice(0,16)} o:${c.o} h:${c.h} l:${c.l} c:${c.c}`).join(' | ');

      let newsDigest: string | undefined;
      if (user.settings.news) {
        const nd = await getNewsDigest({ storage, market, symbol, maxItems: 5, cacheTtlSec: 600 });
        newsDigest = nd.text;
      }

      const analysis = await runAnalysis({ env, storage, user, market, symbol, timeframe: tf, candlesSummary, newsDigest });
      // For MiniApp we return text + zones. The chart is still sent in Telegram via bot command flow.
      return json({ ok: true, analysis: analysis.text, zones: analysis.zones, news: newsDigest || '' });
    } catch (e: any) {
      return json({ ok: false, error: e?.message || String(e) }, { status: 500 });
    }
  }

  return json({ ok: false, error: 'not_found' }, { status: 404 });
}

async function notifyAdmins(env: Env, tg: Telegram, text: string) {
  const admins = (env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean).map(s => Number(s));
  const owner = env.OWNER_ID ? Number(env.OWNER_ID) : null;
  const targets = new Set<number>([...(owner ? [owner] : []), ...admins]);
  for (const id of targets) {
    try { await tg.sendMessage(id, text); } catch {}
  }
}
