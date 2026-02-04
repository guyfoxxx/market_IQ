import type { Env } from "../env";

export function adminHtml() {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Admin Panel</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto; background:#0b0f17; color:#e6e8ef; margin:0}
    header{padding:16px}
    .card{background:#121a29; border:1px solid #1f2b44; border-radius:14px; padding:14px; margin:12px 16px;}
    input,textarea{width:100%; padding:10px; border-radius:12px; border:1px solid #22314f; background:#0f1524; color:#e6e8ef;}
    button{background:#2b6cff; color:white; border:0; padding:10px 12px; border-radius:12px; font-weight:700;}
    .muted{color:#9aa6be; font-size:12px}
    pre{white-space:pre-wrap}
  </style>
</head>
<body>
<header>
  <div class="muted">Admin Panel</div>
  <h2 style="margin:8px 0 0">مدیریت</h2>
</header>

<div class="card">
  <div class="muted">Admin Token</div>
  <input id="tok" placeholder="توکن را وارد کنید (ADMIN_PANEL_TOKEN)" />
  <button style="margin-top:10px" id="saveTok">ذخیره</button>
  <div class="muted" style="margin-top:8px">توکن در localStorage ذخیره می‌شود.</div>
</div>

<div class="card">
  <h3 style="margin:0 0 8px">پرداخت‌های در انتظار</h3>
  <button id="loadPayments">بارگذاری</button>
  <pre id="paymentsOut" style="margin-top:10px"></pre>
</div>

<div class="card">
  <h3 style="margin:0 0 8px">تنظیم ولت عمومی</h3>
  <input id="wallet" placeholder="WALLET_ADDRESS" />
  <button style="margin-top:10px" id="setWallet">ثبت</button>
  <pre id="walletOut" style="margin-top:10px"></pre>
</div>

<div class="card">
  <h3 style="margin:0 0 8px">بنر آفر</h3>
  <div class="muted">enabled (true/false)</div>
  <input id="ben" placeholder="true" />
  <div class="muted" style="margin-top:8px">text</div>
  <input id="btext" placeholder="متن بنر" />
  <div class="muted" style="margin-top:8px">url</div>
  <input id="burl" placeholder="https://..." />
  <button style="margin-top:10px" id="setBanner">ثبت</button>
  <pre id="bannerOut" style="margin-top:10px"></pre>
</div>

<div class="card">
  <h3 style="margin:0 0 8px">پرامپت‌ها</h3>
  <div class="muted">type: base | vision | style:RTM | style:ICT | style:PA | style:GENERAL</div>
  <input id="ptype" placeholder="base" />
  <textarea id="ptext" rows="6" placeholder="متن پرامپت"></textarea>
  <button style="margin-top:10px" id="setPrompt">ثبت</button>
  <pre id="promptOut" style="margin-top:10px"></pre>
</div>

<script>
  const tokEl = document.getElementById("tok");
  const t0 = localStorage.getItem("adm_tok") || "";
  tokEl.value = t0;

  document.getElementById("saveTok").onclick = () => {
    localStorage.setItem("adm_tok", tokEl.value.trim());
    alert("Saved");
  };

  async function adminApi(path, body) {
    const tok = (localStorage.getItem("adm_tok") || "").trim();
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + tok
      },
      body: JSON.stringify(body || {})
    });
    return res.json();
  }

  document.getElementById("loadPayments").onclick = async () => {
    const r = await adminApi("/admin/api/payments", {});
    document.getElementById("paymentsOut").textContent = JSON.stringify(r, null, 2);
  };

  document.getElementById("setWallet").onclick = async () => {
    const addr = document.getElementById("wallet").value;
    const r = await adminApi("/admin/api/wallet", { address: addr });
    document.getElementById("walletOut").textContent = JSON.stringify(r, null, 2);
  };

  document.getElementById("setBanner").onclick = async () => {
    const r = await adminApi("/admin/api/banner", {
      enabled: (document.getElementById("ben").value || "true") === "true",
      text: document.getElementById("btext").value,
      url: document.getElementById("burl").value
    });
    document.getElementById("bannerOut").textContent = JSON.stringify(r, null, 2);
  };

  document.getElementById("setPrompt").onclick = async () => {
    const r = await adminApi("/admin/api/prompt", {
      type: document.getElementById("ptype").value,
      text: document.getElementById("ptext").value
    });
    document.getElementById("promptOut").textContent = JSON.stringify(r, null, 2);
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
