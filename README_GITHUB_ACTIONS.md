# Deploy MarketiQ from GitHub Actions (Cloudflare Workers)

## 1) Repo structure پیشنهادی
- `marketiq_worker.js`
- `wrangler.toml`
- `package.json`
- `.github/workflows/deploy.yml`

## 2) GitHub Secrets لازم
در Settings → Secrets and variables → Actions این موارد را اضافه کنید:

### Cloudflare
- `CLOUDFLARE_API_TOKEN`  (توکن با دسترسی Workers + KV Edit)
- `CLOUDFLARE_ACCOUNT_ID`
- `CF_KV_NAMESPACE_ID`  (ID مربوط به BOT_KV)

### Telegram
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` (یک رشته رندوم)

### AI (حداقل یکی)
- `OPENAI_API_KEY`  یا
- `GEMINI_API_KEY`

## 3) KV را یک‌بار بسازید (لوکال)
روی سیستم خودتان:
```bash
npx wrangler kv namespace create BOT_KV
```
ID خروجی را داخل Secret `CF_KV_NAMESPACE_ID` بگذارید.

## 4) Deploy اتومات
با هر push روی branch `main`، اکشن `Deploy MarketiQ Worker` اجرا می‌شود.

## 5) Webhook
بعد از Deploy، وبهوک را به URL زیر ست کنید:
`https://<YOUR_DOMAIN>/telegram/<TELEGRAM_WEBHOOK_SECRET>`
(این مقدار را از Secret های GitHub بردارید؛ همان چیزی است که در Worker هم به عنوان Secret ست می‌شود.)
