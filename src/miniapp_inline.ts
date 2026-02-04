// Embedded fallback HTML for /miniapp (used when KV asset is not present).
//
// Important:
// - We export the entire page using a TypeScript template literal.
// - Therefore we avoid JS template literals (backticks) inside the HTML <script> section.

export const MINIAPP_HTML = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mini App</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background:#0b1220; color:#e9eef9; }
    header { padding: 14px 16px; background:#111a2e; border-bottom:1px solid #223055; position: sticky; top: 0; }
    header h1 { margin:0; font-size: 16px; }
    main { padding: 16px; max-width: 860px; margin: 0 auto; }
    .tabs { display:flex; gap:10px; margin-bottom: 12px; flex-wrap: wrap; }
    .tab { padding: 8px 10px; border-radius: 999px; border:1px solid #223055; background:#111a2e; cursor:pointer; }
    .tab.active { background:#3b82f6; border-color:#3b82f6; }
    .card { background:#111a2e; border:1px solid #223055; border-radius:14px; padding: 14px; margin-bottom: 12px; }
    input, select, textarea { width:100%; padding: 10px 12px; border-radius:10px; border:1px solid #2a3b68; background:#0b1220; color:#e9eef9; }
    button { padding: 10px 12px; border: 0; border-radius: 10px; background:#3b82f6; color:white; cursor:pointer; }
    .row { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    pre { white-space: pre-wrap; background:#0b1220; border:1px solid #223055; padding:10px; border-radius:10px; }
    a { color: #93c5fd; }
    .banner { border: 1px dashed #3b82f6; background: rgba(59,130,246,0.12); padding: 12px; border-radius: 14px; margin-bottom: 12px; display:none;}
  </style>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
</head>
<body>
<header><h1>Mini App</h1></header>
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

  <section id="dash" class="card"></section>

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
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); }

function getInitData() {
  return (tg && tg.initData) ? tg.initData : '';
}

async function api(path, body) {
  const res = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ initData: getInitData() }, body || {})),
  });
  return await res.json();
}

function switchTab(id) {
  const sections = document.querySelectorAll('section');
  for (const el of sections) el.style.display = 'none';
  const target = document.getElementById(id);
  if (target) target.style.display = '';
  const tabs = document.querySelectorAll('.tab');
  for (const t of tabs) t.classList.remove('active');
  const active = document.querySelector('.tab[data-tab="' + id + '"]');
  if (active) active.classList.add('active');
}

async function loadDash() {
  const out = await api('/profile', {});
  const dash = document.getElementById('dash');
  if (!dash) return;
  dash.innerHTML = '<h3>پروفایل</h3><pre id="dash_pre"></pre><small>اگر initData ندارید، این صفحه باید داخل Telegram WebApp باز شود.</small>';
  const pre = document.getElementById('dash_pre');
  if (pre) pre.textContent = JSON.stringify(out, null, 2);
}

async function loadBanner() {
  const out = await api('/banner', {});
  const b = out && out.banner ? out.banner : null;
  const el = document.getElementById('banner');
  if (!el) return;
  if (b && b.enabled) {
    el.style.display = '';
    const t = document.getElementById('bannerText');
    if (t) t.textContent = b.text || '';
    const link = document.getElementById('bannerLink');
    if (link) link.href = b.url || '#';
  } else {
    el.style.display = 'none';
  }
}

async function runAnalysis() {
  const market = document.getElementById('mkt').value;
  const symbol = document.getElementById('sym').value;
  const out = await api('/analyze', { market: market, symbol: symbol });
  const pre = document.getElementById('an_out');
  if (!pre) return;
  if (out && out.ok) {
    const txt = [out.analysis || '', out.news ? ('\n\n' + out.news) : ''].join('');
    pre.textContent = (txt && txt.trim()) ? txt.trim() : 'بدون خروجی';
  } else {
    pre.textContent = JSON.stringify(out, null, 2);
  }
}

async function saveSettings() {
  const out = await api('/settings', {
    timeframe: document.getElementById('tf').value,
    risk: document.getElementById('risk').value,
    style: document.getElementById('style').value,
    news: document.getElementById('news').value === 'true',
  });
  const pre = document.getElementById('set_out');
  if (pre) pre.textContent = JSON.stringify(out, null, 2);
}

async function saveBep20() {
  const bep20 = document.getElementById('bep20').value;
  const out = await api('/wallet/bep20', { bep20: bep20 });
  const pre = document.getElementById('w_out');
  if (pre) pre.textContent = JSON.stringify(out, null, 2);
}

async function requestDeposit() {
  const out = await api('/wallet/request', { kind: 'deposit' });
  const pre = document.getElementById('w_out');
  if (pre) pre.textContent = JSON.stringify(out, null, 2);
}
async function requestWithdraw() {
  const out = await api('/wallet/request', { kind: 'withdraw' });
  const pre = document.getElementById('w_out');
  if (pre) pre.textContent = JSON.stringify(out, null, 2);
}

(async () => {
  await loadBanner();
  await loadDash();
  const pub = await api('/wallet/public', {});
  const wrap = document.getElementById('walletPublic');
  if (wrap) {
    wrap.innerHTML = '<h3>ولت عمومی</h3><pre id="wallet_pre"></pre>';
    const pre = document.getElementById('wallet_pre');
    if (pre) pre.textContent = JSON.stringify(pub, null, 2);
  }
})();
</script>
</body>
</html>
`;
