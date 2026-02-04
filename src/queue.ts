import type { Env } from "./env";
import type { Job } from "./lib/jobs";
import { fetchCandlesWithMeta } from "./lib/data";
import { callAI, extractJsonBlock } from "./lib/ai";
import { quickChartUrl, type Zone } from "./lib/chart";
import { getUser, getPromptBase, getPromptStyle } from "./lib/storage";
import { consume } from "./lib/quota";
import { buildAnalysisPrompt } from "./lib/prompts";
import { analysisCacheKey, getJson, putJson } from "./lib/cache";
import { cacheGetJson, cachePutJson } from "./lib/cache";


function normalizeZones(input: any): Zone[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set(["demand", "supply", "support", "resistance", "fvg", "ob", "other"]);
  const out: Zone[] = [];
  for (const z of input) {
    if (!z || typeof z !== "object") continue;
    const type = typeof z.type === "string" && allowed.has(z.type) ? z.type : "other";
    const from = Number(z.from);
    const to = Number(z.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const a = Math.min(from, to);
    const b = Math.max(from, to);
    const label = typeof z.label === "string" ? z.label.slice(0, 64) : undefined;
    out.push({ type: type as any, from: a, to: b, ...(label ? { label } : {}) });
  }
  return out;
}

async function tg(env: Env, method: string, body: any) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
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

export async function handleJob(env: Env, job: Job) {
  if (job.type === "SIGNAL_ANALYSIS") {
    const u = await getUser(env, job.userId);
    if (!u) {
      await send(env, job.chatId, "❌ کاربر پیدا نشد. لطفاً دوباره /start را بزنید.");
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
const cachedAnalysis = await getJson<any>(env, aKey);
const out = cachedAnalysis?.out ? String(cachedAnalysis.out) : await callAI(env, prompt, { temperature: 0.2 });
const cachedZones = Array.isArray(cachedAnalysis?.zones) ? cachedAnalysis.zones : null;

    const parsed = cachedZones ? null : extractJsonBlock(out);
    const zones = normalizeZones(cachedZones || parsed?.zones);

    if (!cachedAnalysis) {
      try {
        await putJson(env, aKey, { out, zones }, 60 * 30); // 30 minutes
      } catch {}
    }

    const chart = zones.length ? quickChartUrl(job.symbol, candles, zones) : null;

    const header =
      `✅ <b>تحلیل آماده شد</b>\n` +
      `بازار: <b>${job.market}</b> | نماد: <b>${job.symbol}</b> | تایم‌فریم: <b>${job.timeframe}</b>\n` +
      `دیتا: <code>${dataSource}</code>`;

    // Keep JSON minimal and safe
    const tailJson = `\n\n<code>${JSON.stringify({ zones })}</code>`;

    if (chart) {
      await sendPhoto(env, job.chatId, chart, header);
      await send(env, out + tailJson);
    } else {
      await send(env, header + "\n\n" + out + tailJson);
    }
    return;
  }

  if (job.type === "CUSTOM_PROMPT_DELIVER") {
    const u = await getUser(env, job.userId);
    const cp = (u as any).customPrompt;
    if (!cp?.ready || !cp?.text) return;
    await send(env, job.chatId, `✅ پرامپت اختصاصی شما آماده شد:\n\n${cp.text}`);
    return;
  }
}

export default {
  async queue(batch: MessageBatch<Job>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await handleJob(env, msg.body);
      } catch {
        const b: any = msg.body;
        if (b?.chatId) {
          try {
            await send(env, b.chatId, "❌ خطا در پردازش درخواست. لطفاً دوباره تلاش کنید.");
          } catch {}
        }
      }
    }
  },
};
