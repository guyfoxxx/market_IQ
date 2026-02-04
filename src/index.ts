import { webhookCallback } from "grammy";
import type { Env } from "./env";
import { createBot } from "./bot";
import { appHtml, htmlResponse as html } from "./pages/app";
import { adminHtml, htmlResponse as htmlAdmin } from "./pages/admin";
import { handleAdminApi, handleApi } from "./api";
import { listDueCustomPrompts, markCustomPromptSent, getUser, putUser } from "./lib/storage";

let _bot: ReturnType<typeof createBot> | null = null;
function getBot(env: Env) {
  if (!_bot) _bot = createBot(env);
  return _bot;
}

function isTelegramWebhook(req: Request, env: Env) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token") || "";
  return secret && env.WEBHOOK_SECRET && secret === env.WEBHOOK_SECRET;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Webhook endpoint
    if (url.pathname === "/webhook") {
      if (!isTelegramWebhook(request, env)) return new Response("forbidden", { status: 403 });
      const bot = getBot(env);
      return webhookCallback(bot, "cloudflare-mod")(request);
    }

    // Mini App + Admin UI
    if (url.pathname === "/app") return html(appHtml(env));
    if (url.pathname === "/admin") return htmlAdmin(adminHtml());

    // Mini App API
    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      return handleApi(request, env);
    }

    // Admin API
    if (url.pathname.startsWith("/admin/api/")) {
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      return handleAdminApi(request, env);
    }

    // Health
    if (url.pathname === "/") {
      return new Response("OK - Valinaf25 bot worker", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    return new Response("not found", { status: 404 });
  },

  // Cron job: send due custom prompts
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const bot = getBot(env);
    const due = await listDueCustomPrompts(env);
    for (const task of due) {
      ctx.waitUntil((async () => {
        try {
          const u = await getUser(env, task.userId);
          if (!u) return;
          // Mark custom prompt ready
          u.customPrompt = { ready: true, text: task.promptText, generatedAt: u.customPrompt?.generatedAt };
          await putUser(env, u);

 await bot.api.sendMessage(task.userId, "✅ پرامپت اختصاصی شما آماده شد:

" + task.promptText);
          await markCustomPromptSent(env, task.userId);
        } catch (e) {
          console.log("cron error", e);
        }
      })());
    }
  },
};
