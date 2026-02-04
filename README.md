# Market IQ – Telegram Trading Bot (Cloudflare Worker + KV + Cron + MiniApp)

این پروژه یک **استارتر آماده دیپلوی** است که بخش‌های اصلی‌ای که گفتید را پیاده‌سازی کرده و قابل گسترش است:
- Webhook تلگرام روی Cloudflare Workers
- ذخیره‌سازی همه دیتاها روی KV
- Cron (Scheduled) برای ارسال Custom Prompt با تاخیر ۲ ساعت
- پنل ادمین داخل خود Worker
- مینی‌اپ (Telegram WebApp) با APIهای اصلی

> نکته: برای ساخت تصویر چارت، از **QuickChart** استفاده شده (Chart.js + Annotation + Financial). شما می‌توانید بعداً رندر را با سرویس دلخواه جایگزین کنید.

---

## 1) نصب و اجرای محلی
```bash
npm i
cp .dev.vars.example .dev.vars
# مقادیر .dev.vars را تنظیم کنید
npm run dev
```

---

## 2) ساخت KV و اتصال به Worker
```bash
wrangler kv:namespace create DB
```
`id` خروجی را داخل `wrangler.toml` جایگزین کنید.

---

## 3) ست‌کردن وبهوک تلگرام
URL وبهوک شما:
`{PUBLIC_BASE_URL}/telegram`

در تلگرام:
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook"   -H "Content-Type: application/json"   -d '{
    "url": "https://YOUR_WORKER_SUBDOMAIN.workers.dev/telegram",
    "secret_token": "TELEGRAM_WEBHOOK_SECRET"
  }'
```

---

## 4) دیپلوی دستی
```bash
npm run deploy
```

---

## 5) دیپلوی خودکار از GitHub
در ریپو GitHub این Secrets را تنظیم کنید:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

سپس هر Push روی `main` → دیپلوی خودکار.

---

## 6) دستورات مهم داخل بات
- `/start` , `/menu`
- `/signals`
- `/settings`
- `/profile`
- `/buy` یا `/pay`
- `/tx <TXID>`
- `/wallet`
- `/level`
- `/customprompt`
- `/ref`
- `/redeem`
- `/support` , `/education`

ادمین/اونر:
- `/payments`
- `/approve TXID`
- `/reject TXID`
- `/setwallet WALLET_ADDRESS`
- `/setfreelimit <n>`
- `/setsublimit <n>`
- `/admin` (لینک پنل)

---

## 7) نکته‌های مهم امنیتی
- برای وبهوک تلگرام از `secret_token` استفاده شده (`TELEGRAM_WEBHOOK_SECRET`).
- برای پنل ادمین، توکن جداگانه دارید (`ADMIN_PANEL_TOKEN`).
- APIهای مینی‌اپ از `initData` تلگرام verify می‌شوند.

---

## 8) ساختار KV
کلیدهای اصلی:
- `user:<telegramId>`
- `phone:<phoneE164>` → جلوگیری از شماره تکراری
- `ref:<code>` → referrerId
- `pay:<txid>`
- `cfg:*` (wallet, banner, limits, prompts, botUsername)
- `session:<telegramId>`
- `job:customprompt:<jobId>`

---

اگر دوست دارید، می‌تونم در مرحله بعد:
- شِمای دقیق‌تر خروجی AI برای تحلیل و زون‌ها را سخت‌گیرانه‌تر کنم،
- یا منابع دیتا را دقیق‌تر/حرفه‌ای‌تر (مثلاً مدیریت RateLimit و Cache و ...) کنم.


---

## Zones (Strict) – خروجی سخت‌گیرانه برای زون‌ها

ربات در انتهای هر تحلیل، **آخرین بخش پیام** یک بلاک ` ```json``` ` تولید می‌کند که باید **JSON معتبر** و مطابق `zones_v1` باشد.

**اسکیمای خروجی:**
```json
{
  "schema_version": "zones_v1",
  "symbol": "BTCUSDT",
  "market": "crypto",
  "timeframe": "H4",
  "generated_at": "2026-02-04T00:00:00Z",
  "zones": [
    {
      "id": "Z1",
      "kind": "demand",
      "price_from": 0,
      "price_to": 0,
      "timeframe": "H4",
      "rationale": "علت/منطق کوتاه",
      "invalidation": "شرط باطل شدن",
      "confidence": 0.0
    }
  ]
}
```

> نکته: اگر مدل JSON را خراب برگرداند، سیستم یک‌بار تلاش می‌کند JSON را **ترمیم** کند تا چارت با زون‌ها حتماً ساخته شود.

---

## News – پشتیبانی بهتر از خبرهای بازار

اگر `News` در تنظیمات کاربر روشن باشد:
- خبرهای مرتبط قبل از تحلیل به عنوان **زمینه** به مدل داده می‌شود.
- بعد از تحلیل، یک پیام جداگانه شامل خلاصه خبر/لینک‌ها ارسال می‌شود.
- در Mini App هم خروجی خبرها همراه تحلیل برگشت داده می‌شود.

**منابع فعلی (RSS):**
- Yahoo Finance RSS (بر اساس سمبل) – `feeds.finance.yahoo.com/rss/2.0/headline?...`
- CoinDesk RSS (برای Crypto) – `coindesk.com/arc/outboundfeeds/rss/?outputType=xml`
- ForexFactory Calendar RSS (برای Forex) – `forexfactory.com/calendar/rss`

**دستور جدید:**
- `/news [market] [symbol]`
  - مثال: `/news crypto BTCUSDT`
  - مثال: `/news forex EUR/USD`

