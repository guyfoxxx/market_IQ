# بات تلگرام سیگنال/تحلیل + مینی‌اپ + پنل ادمین (Cloudflare Worker)

این پروژه یک Cloudflare Worker + grammY است که:
- Webhook تلگرام را هندل می‌کند
- داده‌ها را در Cloudflare KV ذخیره می‌کند
- Cron هر ۵ دقیقه، custom prompt های موعددار را برای کاربر ارسال می‌کند
- یک Mini App ساده در `/app` و یک Admin Panel ساده در `/admin` دارد
- برای تحلیل از OpenAI + Gemini + Cloudflare Workers AI با زنجیره fallback استفاده می‌کند

> نکته: برای تولید تصویر چارت، از QuickChart استفاده شده (chartjs-chart-financial + annotation).

---

## 1) پیش‌نیازها
- Cloudflare Workers + Wrangler
- یک KV Namespace بسازید و ID را در `wrangler.toml` قرار دهید
- در BotFather توکن بگیرید

---

## 2) تنظیم Secrets
```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET

# اگر استفاده می‌کنید:
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put ALPHAVANTAGE_API_KEY
# ...
```

---

## 3) تنظیم BOT_INFO
1) در مرورگر:
`https://api.telegram.org/bot<BOT_TOKEN>/getMe`
2) مقدار `result` را بردارید و داخل `BOT_INFO` در `wrangler.toml` قرار دهید.

---

## 4) Deploy
```bash
npm i
npm run deploy
```

---

## 5) ست کردن Webhook
در تلگرام باید webhook روی URL Worker تنظیم شود.

### روش سریع (Browser)
```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<WORKER>.<SUBDOMAIN>.workers.dev/webhook&secret_token=<WEBHOOK_SECRET>
```

### روش اسکریپت
1) فایل `scripts/setWebhook.js` را ببینید
2) env های `BOT_TOKEN`, `WEBHOOK_SECRET`, `PUBLIC_BASE_URL` را ست کنید
3) سپس:
```bash
npm run set-webhook
```

---

## 6) GitHub Auto Deploy
در ریپوی GitHub:
- Secrets را بگذارید:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- هر push روی `main` -> deploy

---

## مسیرها
- `POST /webhook`  ورودی آپدیت‌های تلگرام
- `GET /app`       مینی‌اپ
- `GET /admin`     پنل ادمین (با توکن)
- `POST /api/*`    APIهای مینی‌اپ
- `POST /admin/api/*` APIهای پنل ادمین

---

## نکته‌های مهم
- برای اینکه Mini App بتواند کاربر را تشخیص دهد، از `initData` تلگرام استفاده می‌کند و Worker آن را verify می‌کند.
- برای مقیاس بالا، بهتر است پرداخت‌ها/لیست‌ها را به D1 یا Durable Object منتقل کنید. این نسخه KV-only است.



---

## Verify پرداخت (BSC / USDT BEP20)
این نسخه می‌تواند **TxID انتقال ERC20 (BEP20)** را روی BSC با BscScan verify کند.

### تنظیمات
- `PAYMENT_TOKEN_CONTRACT` (پیش‌فرض USDT BEP20)
- `MIN_CONFIRMATIONS` (پیش‌فرض 3)
- `BSCSCAN_API_KEY` (اختیاری اما پیشنهاد می‌شود)

### دستور ادمین
- `/verify <TXID>` نتیجه verify را نشان می‌دهد.
- سپس اگر OK بود: `/approve <TXID>`

> نکته: اگر `AUTO_VERIFY_PAYMENTS=ON` باشد، قبل از approve، verify انجام می‌شود (پیشنهاد: OFF و دستی).


---

## تحلیل (AI) با فالبک چندمدلی
برای تحلیل، بات به صورت پیش‌فرض این ترتیب را امتحان می‌کند:

`openai -> gemini -> cloudflare (Workers AI)`

با متغیر زیر قابل تغییر است:
- `AI_CHAIN=openai,gemini,cloudflare`
- `CLOUDFLARE_AI_MODEL=@cf/meta/llama-3.1-8b-instruct`

> برای فعال شدن Workers AI لازم است در `wrangler.toml` این باشد:
> `[ai] binding = "AI"` (در این پروژه اضافه شده)

## دیتا (Market Data) با فالبک
- کریپتو: `binance -> twelvedata -> alphavantage`
- سایر بازارها: `twelvedata -> alphavantage`

قابل تغییر:
- `DATA_SOURCES_CRYPTO=binance,twelvedata,alphavantage`
- `DATA_SOURCES_OTHER=twelvedata,alphavantage`

---

## سبک‌های تحلیل
- PA (Price Action - Ali Flah)
- ICT (Smart Money)
- ATR (Volatility/ATR)
- CUSTOM (بعد از ساخت پرامپت اختصاصی)
# bazariq # bazariq
