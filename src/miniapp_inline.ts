export const MINIAPP_HTML = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Market IQ</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0a0f1d;
      --bg-soft: #0f1526;
      --card: #121a2d;
      --card-border: rgba(99, 124, 188, 0.2);
      --card-glow: rgba(30, 64, 175, 0.18);
      --text: #e7ecf6;
      --muted: rgba(231, 236, 246, 0.65);
      --accent: #5b8cff;
      --accent-2: #22d3ee;
      --success: #22c55e;
      --danger: #f97316;
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

    header .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    header .logo {
      width: 38px;
      height: 38px;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      display: grid;
      place-items: center;
      font-weight: 700;
      box-shadow: 0 12px 30px rgba(59, 130, 246, 0.35);
    }

    header h1 {
      margin: 0;
      font-size: 18px;
    }

    header p {
      margin: 2px 0 0;
      font-size: 12px;
      color: var(--muted);
    }

    main {
      max-width: 960px;
      margin: 0 auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .tabs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      background: rgba(17, 24, 39, 0.6);
      padding: 6px;
      border-radius: 999px;
      border: 1px solid rgba(99, 124, 188, 0.25);
      backdrop-filter: blur(10px);
    }

    .tab {
      padding: 8px 14px;
      border-radius: 999px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted);
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .tab.active {
      background: linear-gradient(135deg, rgba(91, 140, 255, 0.25), rgba(34, 211, 238, 0.2));
      color: var(--text);
      border-color: rgba(91, 140, 255, 0.6);
      box-shadow: inset 0 0 0 1px rgba(34, 211, 238, 0.15);
    }

    .card {
      background: linear-gradient(145deg, rgba(18, 26, 45, 0.95), rgba(12, 18, 32, 0.95));
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      padding: 18px;
      box-shadow: var(--shadow);
    }

    .stack {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .hero {
      display: flex;
      flex-direction: column;
      gap: 12px;
      position: relative;
      overflow: hidden;
    }

    .hero::after {
      content: "";
      position: absolute;
      inset: -50px -50px auto auto;
      width: 160px;
      height: 160px;
      background: radial-gradient(circle, rgba(34, 211, 238, 0.25), transparent 70%);
      pointer-events: none;
    }

    .hero h2 {
      margin: 0;
      font-size: 20px;
    }

    .hero .meta {
      color: var(--muted);
      font-size: 13px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(91, 140, 255, 0.15);
      border: 1px solid rgba(91, 140, 255, 0.35);
      font-size: 11px;
      color: var(--accent);
    }

    .grid {
      display: grid;
      gap: 12px;
    }

    .grid.two {
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }

    .metric {
      padding: 14px;
      border-radius: 14px;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(99, 124, 188, 0.2);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .metric .label {
      font-size: 11px;
      color: var(--muted);
    }

    .metric .value {
      font-size: 18px;
      font-weight: 600;
    }

    .progress {
      height: 10px;
      background: rgba(15, 23, 42, 0.75);
      border-radius: 999px;
      overflow: hidden;
      border: 1px solid rgba(99, 124, 188, 0.25);
    }

    .progress span {
      display: block;
      height: 100%;
      width: 0;
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
      transition: width 0.3s ease;
    }

    input, select, textarea {
      width: 100%;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(99, 124, 188, 0.3);
      background: rgba(10, 15, 29, 0.8);
      color: var(--text);
    }

    button {
      padding: 10px 14px;
      border: 0;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      color: #fff;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.1s ease, filter 0.2s ease;
    }

    button:hover { filter: brightness(1.05); }
    button:active { transform: scale(0.98); }

    .row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
    }

    pre {
      white-space: pre-wrap;
      background: rgba(10, 15, 29, 0.7);
      border: 1px solid rgba(99, 124, 188, 0.25);
      padding: 12px;
      border-radius: 12px;
      color: var(--muted);
      min-height: 80px;
    }

    a { color: #9ec5ff; }

    .banner {
      border: 1px dashed rgba(91, 140, 255, 0.6);
      background: rgba(91, 140, 255, 0.12);
      padding: 12px;
      border-radius: var(--radius);
      margin-bottom: 12px;
      display: none;
    }

    .chip-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .chip {
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(14, 23, 45, 0.8);
      border: 1px solid rgba(99, 124, 188, 0.25);
      font-size: 12px;
    }

    .muted { color: var(--muted); font-size: 12px; }
  </style>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
</head>
<body>
<header>
  <div class="brand">
    <div class="logo">IQ</div>
    <div>
      <h1>Market IQ</h1>
      <p>داشبورد هوشمند تحلیل، اشتراک و تنظیمات</p>
    </div>
  </div>
</header>
<main>
  <div id="banner" class="banner">
    <div id="bannerText"></div>
    <a id="bannerLink" href="#" target="_blank" rel="noreferrer">باز کردن</a>
  </div>

  <div class="tabs">
    <div class="tab active" data-tab="dash" onclick="switchTab('dash')">داشبورد</div>
    <div class="tab" data-tab="analyze" onclick="switchTab('analyze')">تحلیل</div>
    <div class="tab" data-tab="settings" onclick="switchTab('settings')">تنظیمات</div>
    <div class="tab" data-tab="wallet" onclick="switchTab('wallet')">کیف پول</div>
  </div>

  <section id="dash" class="stack">
    <div class="card hero">
      <span class="badge">پروفایل کاربری</span>
      <h2 id="userName">—</h2>
      <div id="userMeta" class="meta">—</div>
    </div>

    <div class="grid two">
      <div class="metric">
        <div class="label">امتیاز</div>
        <div id="userPoints" class="value">—</div>
      </div>
      <div class="metric">
        <div class="label">دعوت موفق</div>
        <div id="userInvites" class="value">—</div>
      </div>
      <div class="metric">
        <div class="label">کمیسیون رفرال</div>
        <div id="userCommission" class="value">—</div>
      </div>
      <div class="metric">
        <div class="label">اشتراک</div>
        <div id="userSubscription" class="value">—</div>
      </div>
    </div>

    <div class="grid two">
      <div class="card">
        <h3 style="margin:0 0 8px">سهمیه روزانه</h3>
        <div class="progress"><span id="dailyBar"></span></div>
        <div id="dailyText" class="muted" style="margin-top:8px">—</div>
      </div>
      <div class="card">
        <h3 style="margin:0 0 8px">سهمیه ماهانه</h3>
        <div class="progress"><span id="monthlyBar"></span></div>
        <div id="monthlyText" class="muted" style="margin-top:8px">—</div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 8px">کدهای رفرال</h3>
      <div id="refCodes" class="chip-list"></div>
      <div class="muted" style="margin-top:8px">هر دعوت موفق امتیاز و کمیسیون بیشتری برای شما ایجاد می‌کند.</div>
    </div>
  </section>

  <section id="analyze" class="card" style="display:none;">
    <div class="row">
      <div>
        <label>Market</label>
        <select id="mkt">
          <option value="crypto">Crypto</option>
          <option value="forex">Forex</option>
          <option value="metals">Metals</option>
          <option value="stocks">Stocks</option>
        </select>
      </div>
      <div>
        <label>Symbol</label>
        <input id="sym" placeholder="BTCUSDT / EUR/USD / XAUUSD / AAPL" />
      </div>
    </div>
    <button onclick="runAnalysis()">اجرای تحلیل</button>
    <pre id="an_out"></pre>
  </section>

  <section id="settings" class="card" style="display:none;">
    <div class="row">
      <div>
        <label>Timeframe</label>
        <select id="tf">
          <option>H1</option><option selected>H4</option><option>D1</option><option>W1</option>
        </select>
      </div>
      <div>
        <label>Risk</label>
        <select id="risk">
          <option value="low">کم</option><option value="medium" selected>متوسط</option><option value="high">زیاد</option>
        </select>
      </div>
    </div>
    <label>Style</label>
    <select id="style">
      <option value="ict" selected>ICT</option>
      <option value="rtm">RTM</option>
      <option value="deep">Deep</option>
      <option value="price_action">پرایس اکشن</option>
      <option value="general_prompt">پرامپت عمومی</option>
      <option value="custom_prompt">پرامپت اختصاصی</option>
    </select>
    <label>News</label>
    <select id="news"><option value="false" selected>خاموش</option><option value="true">روشن</option></select>
    <button onclick="saveSettings()">ذخیره</button>
    <pre id="set_out"></pre>
  </section>

  <section id="wallet" class="card" style="display:none;">
    <div id="walletPublic"></div>
    <label>آدرس برداشت BEP20</label>
    <input id="bep20" placeholder="0x..." />
    <button onclick="saveBep20()">ذخیره BEP20</button>
    <div style="height:12px"></div>
    <button onclick="requestDeposit()">درخواست واریز</button>
    <button onclick="requestWithdraw()" style="margin-right:8px">درخواست برداشت</button>
    <pre id="w_out"></pre>
  </section>
</main>

<script>
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

function getInitData() {
  return (tg && tg.initData) ? tg.initData : '';
}

function escapeHtml(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function api(path, body) {
  const res = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: getInitData(), ...body }),
  });
  return await res.json();
}

function switchTab(id) {
  for (const el of document.querySelectorAll('section')) el.style.display = 'none';
  document.getElementById(id).style.display = '';
  for (const t of document.querySelectorAll('.tab')) t.classList.remove('active');
  document.querySelector('.tab[data-tab=\"' + id + '\"]').classList.add('active');
}

function marketLabel(market) {
  switch (market) {
    case 'crypto': return 'کریپتو';
    case 'forex': return 'فارکس';
    case 'metals': return 'فلزات';
    case 'stocks': return 'سهام';
    default: return '—';
  }
}

function setBar(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

async function loadDash() {
  const out = await api('/profile', {});
  if (!out.ok) {
    document.getElementById('dash').innerHTML = '<div class=\"card\">خطا در دریافت اطلاعات. لطفاً داخل تلگرام باز کنید.</div>';
    return;
  }

  const user = out.user || {};
  const quota = out.quota || {};
  const subActive = user.subEnd && user.subEnd > Date.now();
  const subLabel = subActive ? ('فعال تا ' + new Date(user.subEnd).toLocaleDateString('fa-IR')) : 'غیرفعال';

  document.getElementById('userName').textContent = user.name || user.firstName || 'کاربر';
  document.getElementById('userMeta').textContent = 'تجربه: ' + (user.experience || '—') + ' | بازار: ' + marketLabel(user.favoriteMarket) + ' | ریسک: ' + (user.settings?.risk || '—');

  document.getElementById('userPoints').textContent = user.points ?? 0;
  document.getElementById('userInvites').textContent = user.successfulInvites ?? 0;
  document.getElementById('userCommission').textContent = (user.commissionPct ?? 0) + '%';
  document.getElementById('userSubscription').textContent = subLabel;

  const dailyLimit = quota.limitDaily;
  const monthlyLimit = quota.limitMonthly;
  const dailyUsed = quota.usedDaily || 0;
  const monthlyUsed = quota.usedMonthly || 0;

  const dailyPct = dailyLimit === Infinity ? 0 : (dailyUsed / Math.max(1, dailyLimit)) * 100;
  const monthlyPct = monthlyLimit === Infinity ? 0 : (monthlyUsed / Math.max(1, monthlyLimit)) * 100;

  setBar('dailyBar', dailyPct);
  setBar('monthlyBar', monthlyPct);

  document.getElementById('dailyText').textContent = dailyLimit === Infinity
    ? 'نامحدود'
    : ('باقی‌مانده: ' + (quota.remainingDaily ?? 0) + ' از ' + dailyLimit);
  document.getElementById('monthlyText').textContent = monthlyLimit === Infinity
    ? 'نامحدود'
    : ('باقی‌مانده: ' + (quota.remainingMonthly ?? 0) + ' از ' + monthlyLimit);

  const refCodes = document.getElementById('refCodes');
  refCodes.innerHTML = '';
  (user.referralCodes || []).forEach((code) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = code;
    refCodes.appendChild(chip);
  });
}

async function loadBanner() {
  const out = await api('/banner', {});
  const b = out.banner;
  const el = document.getElementById('banner');
  if (b && b.enabled) {
    el.style.display = '';
    document.getElementById('bannerText').textContent = b.text || '';
    const link = document.getElementById('bannerLink');
    link.href = b.url || '#';
  } else {
    el.style.display = 'none';
  }
}

async function runAnalysis() {
  const market = document.getElementById('mkt').value;
  const symbol = document.getElementById('sym').value;
  const out = await api('/analyze', { market, symbol });
  document.getElementById('an_out').textContent = JSON.stringify(out, null, 2);
}

async function saveSettings() {
  const out = await api('/settings', {
    timeframe: document.getElementById('tf').value,
    risk: document.getElementById('risk').value,
    style: document.getElementById('style').value,
    news: document.getElementById('news').value === 'true',
  });
  document.getElementById('set_out').textContent = JSON.stringify(out, null, 2);
}

async function saveBep20() {
  const bep20 = document.getElementById('bep20').value;
  const out = await api('/wallet/bep20', { bep20 });
  document.getElementById('w_out').textContent = JSON.stringify(out, null, 2);
}

async function requestDeposit() {
  const out = await api('/wallet/request', { kind: 'deposit' });
  document.getElementById('w_out').textContent = JSON.stringify(out, null, 2);
}
async function requestWithdraw() {
  const out = await api('/wallet/request', { kind: 'withdraw' });
  document.getElementById('w_out').textContent = JSON.stringify(out, null, 2);
}

(async () => {
  await loadBanner();
  await loadDash();
  const pub = await api('/wallet/public', {});
  document.getElementById('walletPublic').innerHTML = '<h3>ولت عمومی</h3><pre>' + escapeHtml(JSON.stringify(pub, null, 2)) + '</pre>';
})();
</script>
</body>
</html>`;
