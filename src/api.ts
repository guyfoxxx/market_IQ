import type { Env } from "./env";
import { verifyInitData } from "./lib/telegramAuth";
import { ensureUser, getBanner, getPublicWallet, getPromptBase, getPromptVision, getPromptStyle, getUser, listPayments, putUser, setBanner, setPromptBase, setPromptStyle, setPromptVision, setPublicWallet } from "./lib/storage";
import { remaining, consume } from "./lib/quota";
import { escapeHtml, parseIntSafe } from "./lib/utils";
import { callAI, extractJsonBlock } from "./lib/ai";
import { fetchCandlesWithMeta } from "./lib/data";
import { normalizeZoneForApi, quickChartUrlFromApi } from "./lib/miniHelpers";

function json(data: any, status = 200) {

  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}


async function notifyAdmins(env: Env, text: string) {
  const ids = (env.ADMIN_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean).map(Number);
  const owner = env.OWNER_ID ? Number(env.OWNER_ID) : undefined;
  const targets = new Set<number>(ids);
  if (owner) targets.add(owner);
  for (const id of targets) {
    try {
      await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: id, text })
      });
    } catch {}
  }
}

async function getUserFromInit(req: Request, env: Env) {
  const init = req.headers.get("x-telegram-init-data") || "";
  const v = await verifyInitData(init, env.BOT_TOKEN);
  if (!v.ok || !v.userId) return null;
  const u = await ensureUser(env, { id: v.userId, username: v.user?.username, firstName: v.user?.first_name });
  return u;
}

export async function handleApi(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  const user = await getUserFromInit(req, env);
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);

  if (path === "/api/me") {
    const q = remaining(env, user);
    const banner = await getBanner(env);
    return json({ ok: true, user, quota: q, banner });
  }

  if (path === "/api/settings") {
    const body = await req.json().catch(() => ({}));
    const s = body?.settings;
    if (s) {
      // CUSTOM only if ready
      if (s.style === "CUSTOM" && !user.customPrompt?.ready) {
        return json({ ok: false, error: "custom prompt not ready" }, 400);
      }
      user.settings = { ...user.settings, ...s };
      await putUser(env, user);
    }
    return json({ ok: true, user });
  }

  if (path === "/api/analyze") {
    const quota = await consume(env, user, 1);
    if (!quota.ok) return json({ ok: false, error: quota.reason || "quota" }, 429);
    const body = await req.json().catch(() => ({}));
    const symbol = String(body.symbol || "").trim();
    const market = String(body.market || "CRYPTO").trim();
    if (!symbol) return json({ ok: false, error: "symbol required" }, 400);

    try {
      const { candles, source: dataSource, normalizedSymbol } = await fetchCandlesWithMeta(env, market as any, symbol, user.settings.timeframe as any, 200);
      const base = await getPromptBase(env);
      const stylePrompt = user.settings.style === "CUSTOM" && user.customPrompt?.ready && user.customPrompt.text
        ? user.customPrompt.text
        : await getPromptStyle(env, user.settings.style);
      const candleSummary = summarizeCandles(candles);

      const analysisPrompt = `${base}

[Style]
${stylePrompt}

[User settings]
timeframe=${user.settings.timeframe}
risk=${user.settings.risk}
news=${user.settings.news}

[Market]
market=${market}
symbol=${symbol}
data_source=${dataSource}
normalized_symbol=${normalizedSymbol}

[OHLC summary]
${candleSummary}

در انتها دقیقاً یک بلوک JSON با \`\`\`json تولید کن با zones و levels.
`;
      const out = await callAI(env, analysisPrompt, { temperature: 0.15 });
      const j = extractJsonBlock(out);
      const zones = normalizeZoneForApi(j?.zones);
      const chartUrl = zones.length ? quickChartUrlFromApi(symbol, candles, zones) : null;
      return json({ ok: true, text: out, chartUrl, zones, meta: { dataSource, normalizedSymbol } });
    } catch (e: any) {
      return json({ ok: false, error: e?.message ?? "error" }, 500);
    }
  }

  return json({ ok: false, error: "not_found" }, 404);
}

function summarizeCandles(candles: Array<{ t: number; o: number; h: number; l: number; c: number }>) {
  const last = candles.slice(-60);
  const hi = Math.max(...last.map(c => c.h));
  const lo = Math.min(...last.map(c => c.l));
  const first = last[0]?.c ?? 0;
  const lastc = last[last.length - 1]?.c ?? 0;
  const chg = first ? ((lastc - first) / first) * 100 : 0;
  return `last_close=${lastc}
range_high=${hi}
range_low=${lo}
change_pct_last_60_bars=${chg.toFixed(2)}`;
}

function bearer(req: Request) {
  const a = req.headers.get("authorization") || "";
  const m = a.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : "";
}

export async function handleAdminApi(req: Request, env: Env): Promise<Response> {
  const token = bearer(req);
  const ok = token && token === env.ADMIN_PANEL_TOKEN;
  if (!ok) return json({ ok: false, error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/admin/api/payments") {
    const pending = await listPayments(env, "PENDING");
    return json({ ok: true, pending });
  }

  if (path === "/admin/api/wallet") {
    const body = await req.json().catch(() => ({}));
    const addr = String(body.address || "").trim();
    if (!addr) return json({ ok: false, error: "address required" }, 400);
    await setPublicWallet(env, addr);
    return json({ ok: true });
  }

  if (path === "/admin/api/banner") {
    const body = await req.json().catch(() => ({}));
    await setBanner(env, { enabled: !!body.enabled, text: String(body.text || ""), url: String(body.url || "") });
    return json({ ok: true });
  }

  if (path === "/admin/api/prompt") {
    const body = await req.json().catch(() => ({}));
    const type = String(body.type || "").trim();
    const text = String(body.text || "");
    if (!type || !text.trim()) return json({ ok: false, error: "type/text required" }, 400);

    if (type === "base") await setPromptBase(env, text);
    else if (type === "vision") await setPromptVision(env, text);
    else if (type.startsWith("style:")) await setPromptStyle(env, type.slice("style:".length), text);
    else return json({ ok: false, error: "invalid type" }, 400);

    return json({ ok: true });
  }

  return json({ ok: false, error: "not_found" }, 404);
}
