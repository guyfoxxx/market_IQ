import type { Env } from "./env";
import type { Job } from "./lib/jobs";
import { fetchCandlesWithMeta } from "./lib/data";
import { callAI, extractJsonBlock } from "./lib/ai";
import { quickChartUrl, type Zone } from "./lib/chart";
import { getUser, getPromptBase, getPromptStyle } from "./lib/storage";
import { consume } from "./lib/quota";
import { buildAnalysisPrompt } from "./lib/prompts";
import { analysisCacheKey, getJson, putJson } from "./lib/cache";

async function tg(env: Env, method: string, body: any) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Telegram ${method} failed: ${res.status} ${t}`);
  }
}

async function send(env: Env, chatId: number, text: string) {
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

async function sendPhoto(env: Env, chatId: number, photoUrl: string, caption?: string) {
  await tg(env, "sendPhoto", { chat_id: chatId, photo: photoUrl, caption, parse_mode: "HTML" });
}

function normalizeZones(z: any): Zone[] {
  if (!Array.isArray(z)) return [];
  const out: Zone[] = [];
  for (const it of z) {
    if (!it) continue;
    const type = String(it.type || "").toUpperCase();
    const priceLow = Number(it.priceLow);
    const priceHigh = Number(it.priceHigh);
    if (!Number.isFinite(priceLow) || !Number.isFinite(priceHigh)) continue;
    if (priceHigh <= priceLow) continue;
    if (type !== "SUPPLY" && type !== "DEMAND") continue;
    out.push({
      type: type as any,
      priceLow,
      priceHigh,
      label: it.label ? String(it.label) : "",
    });
  }
  return out.slice(0, 12);
}

export async function handleJob(env: Env, job: Job) {
  if (job.type !== "SIGNAL_ANALYSIS") {
    if (job.type === "CUSTOM_PROMPT_DELIVER") {
      const u = await getUser(env, job.userId);
      const cp = (u as any)?.customPrompt;
      if (!cp?.ready || !cp?.text) return;
      await send(env, job.chatId, `✅ پرامپت اختصاصی شما آماده شد:\n\n${cp.text}`);
    }
    return;
  }

  const u = await getUser(env, job.userId);
  if (!u) {
    await send(env, job.chatId, "❌ کاربر یافت نشد. لطفاً /start را دوباره بزنید.");
    return;
  }

  // quota consume inside worker (queue-side) to avoid webhook timeouts/races
  const q = await consume(env, u, 1);
  if (!q.ok) {
    await send(env, job.chatId, `⛔️ ${q.reason}\nبرای مشاهده سهمیه: /profile`);
    return;
  }

  const { candles, source: dataSource, normalizedSymbol } = await fetchCandlesWithMeta(
    env,
    job.market,
    job.symbol,
    job.timeframe,
    200
  );

  const base = await getPromptBase(env);
  const stylePrompt = await getPromptStyle(env, job.style);

  const prompt = buildAnalysisPrompt({
    basePrompt: base,
    stylePrompt,
    market: job.market,
    symbol: job.symbol,
    normalizedSymbol,
    dataSource,
    timeframe: job.timeframe,
    risk: job.risk,
    news: job.news,
    candles,
  });

  // AI analysis cache (reduces cost & latency at scale)
  const aKey = analysisCacheKey({
    market: job.market,
    symbol: job.symbol,
    tf: job.timeframe,
    style: job.style,
    risk: job.risk,
    news: job.news,
  });

  let outText = "";
  let zones: Zone[] = [];

  const cached = await getJson<any>(env, aKey);
  if (cached?.out) {
    outText = String(cached.out);
    zones = normalizeZones(cached.zones);
  } else {
    outText = await callAI(env, prompt, { temperature: 0.2 });

    let parsed: any = null;
    try {
      parsed = extractJsonBlock(outText);
    } catch {
      parsed = null;
    }
    zones = normalizeZones(parsed?.zones);

    // store cache
    await putJson(env, aKey, { out: outText, zones }, 120);
  }

  const chart = zones.length ? quickChartUrl(job.symbol, candles, zones) : null;

  const header =
    `✅ <b>تحلیل آماده شد</b>\n` +
    `بازار: <b>${job.market}</b> | نماد: <b>${job.symbol}</b> | تایم‌فریم: <b>${job.timeframe}</b>\n` +
    `دیتا: <code>${dataSource}</code>`;

  const tailJson = `\n\n<code>${JSON.stringify({ zones })}</code>`;

  if (chart) {
    await sendPhoto(env, job.chatId, chart, header);
    await send(env, outText + tailJson);
  } else {
    await send(env, header + "\n\n" + outText + tailJson);
  }
}
