/**
 * Set Telegram webhook with secret_token header.
 * Usage:
 *   PUBLIC_BASE_URL=https://xxx.workers.dev BOT_TOKEN=... WEBHOOK_SECRET=... node scripts/setWebhook.js
 */
const base = process.env.PUBLIC_BASE_URL;
const token = process.env.BOT_TOKEN;
const secret = process.env.WEBHOOK_SECRET;

if (!base || !token || !secret) {
  console.error("Missing env: PUBLIC_BASE_URL, BOT_TOKEN, WEBHOOK_SECRET");
  process.exit(1);
}

const url = `${base.replace(/\/$/, "")}/webhook`;

(async () => {
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, secret_token: secret }),
  });
  const data = await res.json();
  console.log(data);
})();
