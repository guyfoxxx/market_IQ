export function adminHtml() {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Panel</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #0b1220; color: #e9eef9; margin: 0; }
    header { padding: 16px 20px; background: #111a2e; border-bottom: 1px solid #223055; }
    h1 { margin: 0; font-size: 18px; }
    main { padding: 20px; max-width: 980px; margin: 0 auto; }
    .card { background: #111a2e; border: 1px solid #223055; border-radius: 14px; padding: 16px; margin-bottom: 16px; }
    label { display: block; margin: 8px 0 6px; color: #b9c5e6; }
    input, textarea, select { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid #2a3b68; background: #0b1220; color: #e9eef9; }
    button { margin-top: 10px; padding: 10px 12px; border: 0; border-radius: 10px; background: #3b82f6; color: white; cursor: pointer; }
    button.secondary { background: #223055; }
    .row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
    small { color: #95a3c8; }
    pre { white-space: pre-wrap; word-break: break-word; background: #0b1220; border: 1px solid #223055; padding: 10px; border-radius: 10px; }
  </style>
</head>
<body>
<header><h1>پنل مدیریت – Worker</h1></header>
<main>
  <div class="card">
    <h3>توکن ادمین</h3>
    <label>ADMIN_PANEL_TOKEN</label>
    <input id="token" placeholder="توکن را وارد کنید" />
    <small>این توکن را در ENV گذاشته‌اید.</small>
  </div>

  <div class="card">
    <h3>کیف پول عمومی</h3>
    <label>Wallet Address</label>
    <input id="wallet" placeholder="مثلاً 0x..." />
    <button onclick="setWallet()">ذخیره</button>
    <pre id="wallet_out"></pre>
  </div>

  <div class="card">
    <h3>Limitها</h3>
    <div class="row">
      <div>
        <label>Free Daily</label>
        <input id="freeDaily" type="number" />
      </div>
      <div>
        <label>Free Monthly</label>
        <input id="freeMonthly" type="number" />
      </div>
      <div>
        <label>Sub Daily</label>
        <input id="subDaily" type="number" />
      </div>
    </div>
    <button onclick="setLimits()">ذخیره</button>
    <pre id="limits_out"></pre>
  </div>

  <div class="card">
    <h3>بنر آفر (MiniApp)</h3>
    <label>Enabled</label>
    <select id="bannerEnabled"><option value="true">روشن</option><option value="false">خاموش</option></select>
    <label>Text</label>
    <input id="bannerText" />
    <label>URL</label>
    <input id="bannerUrl" />
    <button onclick="setBanner()">ذخیره</button>
    <pre id="banner_out"></pre>
  </div>

  <div class="card">
    <h3>Promptها</h3>
    <label>Base Prompt</label>
    <textarea id="basePrompt" rows="8"></textarea>
    <button onclick="setPrompt('base')">ذخیره Base</button>

    <label style="margin-top:12px;">Vision Prompt</label>
    <textarea id="visionPrompt" rows="5"></textarea>
    <button onclick="setPrompt('vision')">ذخیره Vision</button>

    <label style="margin-top:12px;">Style Prompt Key (مثل style:ict یا style:rtm)</label>
    <input id="styleKey" placeholder="style:ict" />
    <label>Style Prompt Value</label>
    <textarea id="styleValue" rows="5"></textarea>
    <button onclick="setPrompt(document.getElementById('styleKey').value)">ذخیره Style</button>
    <pre id="prompt_out"></pre>
  </div>

  <div class="card">
    <h3>پرداخت‌های در انتظار</h3>
    <button class="secondary" onclick="loadPayments()">Refresh</button>
    <pre id="pay_out"></pre>
  </div>
</main>

<script>
async function api(path, body) {
  const token = document.getElementById('token').value.trim();
  const res = await fetch('/admin/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(body || {}),
  });
  return await res.json();
}

async function setWallet() {
  const wallet = document.getElementById('wallet').value.trim();
  const out = await api('/wallet', { wallet });
  document.getElementById('wallet_out').textContent = JSON.stringify(out, null, 2);
}

async function setLimits() {
  const out = await api('/limits', {
    freeDaily: Number(document.getElementById('freeDaily').value),
    freeMonthly: Number(document.getElementById('freeMonthly').value),
    subDaily: Number(document.getElementById('subDaily').value),
  });
  document.getElementById('limits_out').textContent = JSON.stringify(out, null, 2);
}

async function setBanner() {
  const out = await api('/banner', {
    enabled: document.getElementById('bannerEnabled').value === 'true',
    text: document.getElementById('bannerText').value,
    url: document.getElementById('bannerUrl').value,
  });
  document.getElementById('banner_out').textContent = JSON.stringify(out, null, 2);
}

async function setPrompt(key) {
  const base = document.getElementById('basePrompt').value;
  const vision = document.getElementById('visionPrompt').value;
  const styleValue = document.getElementById('styleValue').value;

  let value = '';
  if (key === 'base') value = base;
  else if (key === 'vision') value = vision;
  else value = styleValue;

  const out = await api('/prompt', { key, value });
  document.getElementById('prompt_out').textContent = JSON.stringify(out, null, 2);
}

async function loadPayments() {
  const out = await api('/payments', {});
  document.getElementById('pay_out').textContent = JSON.stringify(out, null, 2);
}
</script>
</body>
</html>`;
}
