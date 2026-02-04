import type { Env } from "../env";

export function appHtml(env: Env) {
  // Minimal Telegram Mini App
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Market IQ</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0a0f1d;
      --bg-soft: #0f1526;
      --card: #121a2d;
      --card-border: rgba(99, 124, 188, 0.2);
      --text: #e7ecf6;
      --muted: rgba(231, 236, 246, 0.65);
      --accent: #5b8cff;
      --accent-2: #22d3ee;
      --radius: 16px;
      --shadow: 0 20px 40px rgba(2, 6, 23, 0.55);
    }
    * { box-sizing: border-box; }
    body {
      font-family: "IRANSansX", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      margin: 0;
      background: radial-gradient(circle at top, rgba(91, 140, 255, 0.2), transparent 55%), var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      padding: 16px 20px;
      background: rgba(10, 15, 29, 0.88);
      backdrop-filter: blur(14px);
      border-bottom: 1px solid rgba(99, 124, 188, 0.25);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo {
      width: 38px;
      height: 38px;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      display: grid;
      place-items: center;
      font-weight: 700;
      box-shadow: 0 12px 30px rgba(59, 130, 246, 0.35);
    }
    main {
      max-width: 960px;
      margin: 0 auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .card {
      background: linear-gradient(145deg, rgba(18, 26, 45, 0.95), rgba(12, 18, 32, 0.95));
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      padding: 18px;
      box-shadow: var(--shadow);
    }
    .row { display: flex; gap: 10px; flex-wrap: wrap; }
    .pill {
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(91, 140, 255, 0.12);
      border: 1px solid rgba(91, 140, 255, 0.35);
      font-size: 12px;
    }
    button {
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      color: white;
      border: 0;
      padding: 10px 12px;
      border-radius: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    input,select,textarea {
      width: 100%;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(99, 124, 188, 0.3);
      background: rgba(10, 15, 29, 0.8);
      color: var(--text);
    }
    a { color: #8bb5ff; }
    .muted { color: var(--muted); font-size: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .bar { height: 10px; background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(99, 124, 188, 0.25); border-radius: 999px; overflow: hidden; }
    .bar > div { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); width: 0%; }
    .banner { background: rgba(91, 140, 255, 0.12); border: 1px dashed rgba(91, 140, 255, 0.6); }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="logo">MIQ</div>
      <div>
        <h2 style="margin:0">Market IQ</h2>
        <div class="muted">داشبورد هوشمند تحلیل و مدیریت حساب</div>
      </div>
    </div>
  </header>

  <main>
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
          <option value="GENERAL">پرامپت عمومی</option>
          <option value="RTM">RTM</option>
          <option value="ICT">ICT</option>
          <option value="PA">پرایس اکشن</option>
          <option value="ATR">ATR (Volatility)</option>
          <option value="DEEP">Deep Style</option>
          <option value="CUSTOM">پرامپت اختصاصی</option>
        </select>
        <select id="news">
          <option value="OFF">خبر خاموش</option>
          <option value="ON">خبر روشن</option>
        </select>
      </div>
      <button style="margin-top:10px" id="save">ذخیره</button>
      <div id="saveMsg" class="muted" style="margin-top:8px"></div>
    </div>

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
  </main>

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
