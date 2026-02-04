import type { Env } from "../env";
import { escapeHtml } from "../lib/utils";

export function appHtml(env: Env) {
  // Minimal Telegram Mini App
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Valinaf25 Mini App</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto; margin:0; background:#0b0f17; color:#e6e8ef;}
    header{padding:16px 16px 8px}
    .card{background:#121a29; border:1px solid #1f2b44; border-radius:14px; padding:14px; margin:12px 16px;}
    .row{display:flex; gap:10px; flex-wrap:wrap}
    .pill{padding:6px 10px; border-radius:999px; background:#0f1524; border:1px solid #22314f; font-size:12px}
    button{background:#2b6cff; color:white; border:0; padding:10px 12px; border-radius:12px; font-weight:700;}
    input,select,textarea{width:100%; padding:10px; border-radius:12px; border:1px solid #22314f; background:#0f1524; color:#e6e8ef;}
    a{color:#8bb5ff}
    .muted{color:#9aa6be; font-size:12px}
    .grid{display:grid; grid-template-columns:1fr 1fr; gap:10px}
    .bar{height:10px; background:#0f1524; border:1px solid #22314f; border-radius:999px; overflow:hidden}
    .bar > div{height:100%; background:#2b6cff; width:0%}
    .banner{background:#1a2a50; border:1px dashed #5f83ff}
  </style>
</head>
<body>
  <header>
    <div class="muted">Mini App</div>
    <h2 style="margin:8px 0 0">داشبورد</h2>
  </header>

  <div id="banner" class="card banner" style="display:none">
    <div id="bannerText"></div>
    <div style="margin-top:8px"><a id="bannerLink" href="#" target="_blank">مشاهده</a></div>
  </div>

  <div class="card">
    <div class="row">
      <div class="pill" id="pName">نام: ...</div>
      <div class="pill" id="pPoints">امتیاز: ...</div>
      <div class="pill" id="pInvites">دعوت موفق: ...</div>
    </div>
    <div style="margin-top:10px" class="muted" id="pSub">اشتراک: ...</div>

    <div style="margin-top:14px">
      <div class="muted">سهمیه روزانه</div>
      <div class="bar"><div id="dailyBar"></div></div>
      <div class="muted" id="dailyText" style="margin-top:6px">...</div>
    </div>

    <div style="margin-top:14px">
      <div class="muted">سهمیه ماهانه</div>
      <div class="bar"><div id="monthBar"></div></div>
      <div class="muted" id="monthText" style="margin-top:6px">...</div>
    </div>
  </div>

  <div class="card">
    <h3 style="margin:0 0 8px">تحلیل سریع</h3>
    <div class="grid">
      <select id="market">
        <option value="CRYPTO">کریپتو</option>
        <option value="FOREX">فارکس</option>
        <option value="METALS">فلزات</option>
        <option value="STOCKS">سهام</option>
      </select>
      <input id="symbol" placeholder="نماد (مثلاً BTCUSDT یا BTC-USD یا EURUSD=X)" />
    </div>
    <button style="margin-top:10px" id="run">اجرای تحلیل</button>
    <div id="out" style="margin-top:12px; white-space:pre-wrap"></div>
    <div id="img" style="margin-top:12px"></div>
  </div>

  <div class="card">
    <h3 style="margin:0 0 8px">تنظیمات</h3>
    <div class="grid">
      <select id="tf">
        <option value="M15">M15</option>
        <option value="H1">H1</option>
        <option value="H4">H4</option>
        <option value="D1">D1</option>
      </select>
      <select id="risk">
        <option value="LOW">ریسک کم</option>
        <option value="MEDIUM">ریسک متوسط</option>
        <option value="HIGH">ریسک زیاد</option>
      </select>
      <select id="style">
        <option value="PA">پرایس اکشن (Ali Flah)</option>
        <option value="ICT">ICT / Smart Money</option>
        <option value="ATR">ATR / Volatility</option>
        <option value="CUSTOM">پرامپت اختصاصی</option>
      </select>
      <select id="news">
        <option value="OFF">خبر خاموش</option>
        <option value="ON">خبر روشن</option>
      </select>
    </div>
    <button style="margin-top:10px" id="save">ذخیره</button>
    <div id="saveMsg" class="muted" style="margin-top:8px"></div>
  
<div class="card">
  <h3 style="margin:0 0 8px">کیف پول</h3>
  <div class="muted">آدرس برداشت BEP20</div>
  <input id="bep20" placeholder="0x..." />
  <button style="margin-top:10px" id="saveWallet">ثبت آدرس</button>
  <div class="grid" style="margin-top:10px">
    <input id="amt" placeholder="مبلغ (USDT)" />
    <select id="wkind">
      <option value="deposit">درخواست واریز</option>
      <option value="withdraw">درخواست برداشت</option>
    </select>
  </div>
  <button style="margin-top:10px" id="walletReq">ثبت درخواست</button>
  <div id="wmsg" class="muted" style="margin-top:8px"></div>
</div>
</div>

<script>
  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  async function api(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-init-data": tg?.initData || ""
      },
      body: JSON.stringify(body || {})
    });
    return res.json();
  }

  function setBar(el, pct) {
    el.style.width = Math.max(0, Math.min(100, pct)) + "%";
  }

  async function load() {
    const me = await api("/api/me");
    if (!me.ok) {
      document.body.innerHTML = "<div style='padding:18px'>خطا در احراز هویت Mini App. لطفاً از داخل تلگرام باز کنید.</div>";
      return;
    }

    document.getElementById("pName").textContent = "نام: " + (me.user.name || me.user.firstName || "—");
    document.getElementById("pPoints").textContent = "امتیاز: " + me.user.points;
    document.getElementById("pInvites").textContent = "دعوت موفق: " + me.user.successfulInvites;
    document.getElementById("pSub").textContent = "اشتراک: " + (me.user.subscription.active ? ("فعال تا " + (me.user.subscription.expiresAt || "")) : "غیرفعال");

    document.getElementById("tf").value = me.user.settings.timeframe;
    document.getElementById("risk").value = me.user.settings.risk;
    document.getElementById("style").value = me.user.settings.style;
    document.getElementById("news").value = me.user.settings.news;

    const bep = document.getElementById("bep20");
    if (bep) bep.value = (me.user.wallet && me.user.wallet.bep20Address) ? me.user.wallet.bep20Address : "";

    // quota bars
    const dPct = me.quota.limits.daily === Infinity ? 0 : (me.user.quota.dailyUsed / me.quota.limits.daily) * 100;
    const mPct = me.quota.limits.monthly === Infinity ? 0 : (me.user.quota.monthlyUsed / me.quota.limits.monthly) * 100;
    setBar(document.getElementById("dailyBar"), dPct);
    setBar(document.getElementById("monthBar"), mPct);
    document.getElementById("dailyText").textContent = me.quota.dailyLeft === Infinity ? "نامحدود" : ("باقی‌مانده: " + me.quota.dailyLeft);
    document.getElementById("monthText").textContent = me.quota.monthLeft === Infinity ? "نامحدود" : ("باقی‌مانده: " + me.quota.monthLeft);

    // banner
    if (me.banner && me.banner.enabled) {
      document.getElementById("banner").style.display = "block";
      document.getElementById("bannerText").textContent = me.banner.text;
      document.getElementById("bannerLink").href = me.banner.url || "#";
    }
  }

  document.getElementById("save").onclick = async () => {
    const body = {
      settings: {
        timeframe: document.getElementById("tf").value,
        risk: document.getElementById("risk").value,
        style: document.getElementById("style").value,
        news: document.getElementById("news").value
      }
    };
    const r = await api("/api/settings", body);
    document.getElementById("saveMsg").textContent = r.ok ? "ذخیره شد ✅" : (r.error || "خطا");
    if (r.ok) load();
  };

  document.getElementById("run").onclick = async () => {
    document.getElementById("out").textContent = "در حال تحلیل...";
    document.getElementById("img").innerHTML = "";
    const body = {
      symbol: document.getElementById("symbol").value,
      market: document.getElementById("market").value
    };
    const r = await api("/api/analyze", body);
    if (!r.ok) {
      document.getElementById("out").textContent = r.error || "خطا";
      return;
    }
    document.getElementById("out").textContent = r.text;
    if (r.chartUrl) {
      const img = document.createElement("img");
      img.src = r.chartUrl;
      img.style.width = "100%";
      img.style.borderRadius = "14px";
      document.getElementById("img").appendChild(img);
    }
  };

  load();

document.getElementById("saveWallet").onclick = async () => {
  const addr = document.getElementById("bep20").value;
  const r = await api("/api/wallet/set", { address: addr });
  document.getElementById("wmsg").textContent = r.ok ? "ثبت شد ✅" : (r.error || "خطا");
  if (r.ok) load();
};

document.getElementById("walletReq").onclick = async () => {
  const kind = document.getElementById("wkind").value;
  const amount = Number(document.getElementById("amt").value || 0);
  const r = await api("/api/wallet/request", { kind, amount });
  document.getElementById("wmsg").textContent = r.ok ? ("ثبت شد ✅ (ID: " + r.id + ")") : (r.error || "خطا");
};
</script>
</body>
</html>`;
}

export function htmlResponse(html: string) {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
