import type { Env } from "../env";

export function adminHtml() {
  // Single-file modern admin panel (no external assets)
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Valinaf25 Admin</title>
  <style>
    :root{
      --bg:#070A12;
      --panel:#0C1222;
      --panel2:#0E1730;
      --stroke:#1C2A4A;
      --text:#E9EDF7;
      --muted:#A8B3CC;
      --brand:#4F8CFF;
      --brand2:#7C5CFF;
      --good:#2EE59D;
      --bad:#FF4F6D;
      --warn:#FFB020;
      --r:18px;
      --shadow: 0 18px 50px rgba(0,0,0,.55);
    }
    *{box-sizing:border-box}
    body{
      margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto;
      background:
        radial-gradient(900px 400px at 85% -10%, rgba(79,140,255,.35), transparent 60%),
        radial-gradient(600px 400px at 15% 0%, rgba(124,92,255,.25), transparent 60%),
        radial-gradient(800px 500px at 50% 110%, rgba(46,229,157,.10), transparent 60%),
        var(--bg);
      color:var(--text);
      min-height:100vh;
    }
    a{color:inherit}
    .wrap{max-width:1200px; margin:0 auto; padding:18px 14px 40px}
    .topbar{
      display:flex; align-items:center; gap:12px; justify-content:space-between;
      padding:14px 16px; border:1px solid rgba(255,255,255,.06);
      background: linear-gradient(180deg, rgba(12,18,34,.85), rgba(12,18,34,.55));
      border-radius:var(--r);
      box-shadow: var(--shadow);
      backdrop-filter: blur(12px);
      position:sticky; top:12px; z-index:5;
    }
    .brand{display:flex; gap:10px; align-items:center}
    .logo{
      width:38px; height:38px; border-radius:14px;
      background: linear-gradient(135deg, var(--brand), var(--brand2));
      box-shadow: 0 12px 30px rgba(79,140,255,.25);
    }
    .brand h1{font-size:16px; margin:0}
    .brand .sub{font-size:12px; color:var(--muted); margin-top:2px}
    .grid{
      display:grid;
      grid-template-columns: 260px 1fr;
      gap:14px;
      margin-top:14px;
    }
    .nav{
      border:1px solid rgba(255,255,255,.06);
      background: rgba(12,18,34,.55);
      border-radius:var(--r);
      box-shadow: var(--shadow);
      backdrop-filter: blur(12px);
      padding:10px;
      position:sticky; top:86px;
      height: fit-content;
    }
    .nav button{
      width:100%;
      text-align:right;
      padding:10px 12px;
      border-radius:14px;
      border:1px solid transparent;
      background: transparent;
      color:var(--text);
      cursor:pointer;
      display:flex; align-items:center; justify-content:space-between;
      gap:10px;
      transition: .15s ease;
      font-weight:650;
    }
    .nav button:hover{background: rgba(255,255,255,.04); border-color: rgba(255,255,255,.06)}
    .nav button.active{
      background: linear-gradient(135deg, rgba(79,140,255,.16), rgba(124,92,255,.10));
      border-color: rgba(79,140,255,.28);
      box-shadow: 0 10px 30px rgba(79,140,255,.10);
    }
    .chip{font-size:11px; color:var(--muted)}
    .main{
      border:1px solid rgba(255,255,255,.06);
      background: rgba(12,18,34,.55);
      border-radius:var(--r);
      box-shadow: var(--shadow);
      backdrop-filter: blur(12px);
      padding:14px;
    }
    .row{display:flex; gap:12px; flex-wrap:wrap}
    .card{
      border:1px solid rgba(255,255,255,.06);
      background: linear-gradient(180deg, rgba(14,23,48,.75), rgba(12,18,34,.55));
      border-radius:var(--r);
      padding:14px;
    }
    .card h2{margin:0 0 6px; font-size:14px}
    .muted{color:var(--muted); font-size:12px}
    label{display:block; font-size:12px; color:var(--muted); margin:10px 0 6px}
    input, textarea, select{
      width:100%;
      padding:12px 12px;
      border-radius:14px;
      border:1px solid rgba(255,255,255,.08);
      background: rgba(7,10,18,.65);
      color:var(--text);
      outline:none;
    }
    textarea{min-height:190px; resize:vertical; line-height:1.65}
    .btn{
      border:0;
      padding:10px 12px;
      border-radius:14px;
      cursor:pointer;
      font-weight:750;
      letter-spacing:.2px;
      color:white;
      background: linear-gradient(135deg, var(--brand), var(--brand2));
      box-shadow: 0 10px 30px rgba(79,140,255,.18);
      transition: transform .06s ease;
    }
    .btn:active{transform: translateY(1px)}
    .btn.secondary{
      background: rgba(255,255,255,.06);
      box-shadow:none;
      border:1px solid rgba(255,255,255,.10);
    }
    .btn.danger{
      background: linear-gradient(135deg, rgba(255,79,109,.95), rgba(255,176,32,.75));
    }
    .bar{display:flex; gap:10px; flex-wrap:wrap; margin-top:10px}
    .toast{
      position: fixed; left: 14px; bottom: 14px;
      padding: 10px 12px;
      background: rgba(7,10,18,.75);
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 14px;
      color: var(--text);
      box-shadow: var(--shadow);
      backdrop-filter: blur(12px);
      display:none;
      max-width: 92vw;
      z-index: 9;
      font-size: 12px;
    }
    pre{
      margin:10px 0 0;
      padding:12px;
      border-radius:14px;
      border:1px solid rgba(255,255,255,.08);
      background: rgba(7,10,18,.55);
      overflow:auto;
      max-height: 340px;
      font-size: 12px;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .kpi{display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px}
    .kpi .card{padding:12px}
    .kpi .num{font-size:18px; font-weight:900}
    .kpi .label{font-size:11px; color:var(--muted)}
    @media (max-width: 920px){
      .grid{grid-template-columns:1fr}
      .nav{position:static}
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div class="brand">
        <div class="logo"></div>
        <div>
          <h1>پنل مدیریت Valinaf25</h1>
          <div class="sub">مدیریت پرداخت‌ها، ولت، بنر و پرامپت‌های سبک‌ها</div>
        </div>
      </div>
      <div style="display:flex; gap:10px; align-items:center">
        <span class="chip" id="who">غیرفعال</span>
        <button class="btn secondary" id="logout">خروج</button>
      </div>
    </div>

    <div class="grid">
      <div class="nav">
        <button data-tab="auth" class="active">ورود <span class="chip">توکن</span></button>
        <button data-tab="prompts">پرامپت سبک‌ها <span class="chip">PA / ICT / ATR</span></button>
        <button data-tab="basevision">پرامپت‌های پایه <span class="chip">Base / Vision</span></button>
        <button data-tab="payments">پرداخت‌ها <span class="chip">Pending</span></button>
        <button data-tab="wallet">کیف پول <span class="chip">Public</span></button>
        <button data-tab="banner">بنر آفر <span class="chip">MiniApp</span></button>
        <button data-tab="raw">خروجی خام <span class="chip">Debug</span></button>
      </div>

      <div class="main">
        <!-- AUTH -->
        <section id="tab-auth">
          <div class="card">
            <h2>ورود ادمین</h2>
            <div class="muted">توکن پنل را وارد کنید (ADMIN_PANEL_TOKEN). توکن در مرورگر شما ذخیره می‌شود.</div>
            <label>Admin Token</label>
            <input id="tok" placeholder="توکن ادمین..." />
            <div class="bar">
              <button class="btn" id="saveTok">ذخیره و فعال‌سازی</button>
              <button class="btn secondary" id="testTok">تست دسترسی</button>
            </div>
            <pre id="authOut"></pre>
          </div>
        </section>

        <!-- STYLE PROMPTS -->
        <section id="tab-prompts" style="display:none">
          <div class="card">
            <h2>مدیریت پرامپت سبک‌ها</h2>
            <div class="muted">اینجا می‌توانید پرامپت هر سبک را Override کنید یا به حالت پیش‌فرض برگردانید.</div>

            <label>انتخاب سبک</label>
            <select id="styleSel">
              <option value="PA">پرایس اکشن (Ali Flah)</option>
              <option value="ICT">ICT (Smart Money)</option>
              <option value="ATR">ATR (Volatility)</option>
              <option value="RTM">RTM</option>
              <option value="GENERAL">General</option>
            </select>

            <div class="bar">
              <button class="btn secondary" id="loadStyle">نمایش پرامپت فعلی</button>
              <button class="btn" id="saveStyle">ذخیره (Override)</button>
              <button class="btn danger" id="resetStyle">بازگشت به پیش‌فرض</button>
            </div>

            <label>متن پرامپت</label>
            <textarea id="styleText" placeholder="متن پرامپت سبک..."></textarea>

            <div class="muted" id="styleMeta" style="margin-top:8px"></div>
            <pre id="styleOut"></pre>
          </div>
        </section>

        <!-- BASE / VISION -->
        <section id="tab-basevision" style="display:none">
          <div class="row">
            <div class="card" style="flex:1; min-width:280px">
              <h2>پرامپت پایه (Base)</h2>
              <div class="bar">
                <button class="btn secondary" id="loadBase">نمایش</button>
                <button class="btn" id="saveBase">ذخیره</button>
                <button class="btn danger" id="resetBase">ریست</button>
              </div>
              <label>متن Base</label>
              <textarea id="baseText"></textarea>
              <div class="muted" id="baseMeta" style="margin-top:8px"></div>
            </div>

            <div class="card" style="flex:1; min-width:280px">
              <h2>پرامپت ویژن (Vision)</h2>
              <div class="bar">
                <button class="btn secondary" id="loadVision">نمایش</button>
                <button class="btn" id="saveVision">ذخیره</button>
                <button class="btn danger" id="resetVision">ریست</button>
              </div>
              <label>متن Vision</label>
              <textarea id="visionText"></textarea>
              <div class="muted" id="visionMeta" style="margin-top:8px"></div>
            </div>
          </div>
          <pre id="bvOut"></pre>
        </section>

        <!-- PAYMENTS -->
        <section id="tab-payments" style="display:none">
          <div class="card">
            <h2>پرداخت‌های در انتظار</h2>
            <div class="muted">لیست TxIDهایی که کاربران ثبت کردند و منتظر تایید/رد هستند.</div>
            <div class="bar">
              <button class="btn secondary" id="loadPayments">بارگذاری</button>
            </div>
            <pre id="paymentsOut"></pre>
          </div>
        </section>

        <!-- WALLET -->
        <section id="tab-wallet" style="display:none">
          <div class="card">
            <h2>تنظیم ولت عمومی</h2>
            <div class="muted">این آدرس به کاربران در /wallet نمایش داده می‌شود.</div>
            <label>WALLET_ADDRESS</label>
            <input id="wallet" placeholder="0x... یا ..."/>
            <div class="bar">
              <button class="btn" id="setWallet">ثبت</button>
            </div>
            <pre id="walletOut"></pre>
          </div>
        </section>

        <!-- BANNER -->
        <section id="tab-banner" style="display:none">
          <div class="card">
            <h2>بنر آفر ویژه</h2>
            <div class="muted">در Mini App نمایش داده می‌شود (روشن/خاموش، متن، لینک).</div>
            <label>enabled</label>
            <select id="ben">
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
            <label>text</label>
            <input id="btext" placeholder="مثلاً 60% OFF برای اشتراک..." />
            <label>url</label>
            <input id="burl" placeholder="https://..." />
            <div class="bar">
              <button class="btn" id="setBanner">ثبت</button>
            </div>
            <pre id="bannerOut"></pre>
          </div>
        </section>

        <!-- RAW -->
        <section id="tab-raw" style="display:none">
          <div class="card">
            <h2>خروجی خام API</h2>
            <div class="muted">برای دیباگ سریع.</div>
            <label>مسیر API</label>
            <input id="rawPath" placeholder="/admin/api/prompt_get" value="/admin/api/prompt_get"/>
            <label>Body (JSON)</label>
            <textarea id="rawBody" style="min-height:140px">{ "type": "style:PA" }</textarea>
            <div class="bar">
              <button class="btn secondary" id="rawSend">ارسال</button>
            </div>
            <pre id="rawOut"></pre>
          </div>
        </section>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

<script>
  const $ = (id) => document.getElementById(id);

  function toast(msg){
    const t = $("toast");
    t.textContent = msg;
    t.style.display = "block";
    clearTimeout(window.__t);
    window.__t = setTimeout(()=> t.style.display="none", 2400);
  }

  const tokEl = $("tok");
  const saved = localStorage.getItem("adm_tok") || "";
  tokEl.value = saved;

  function setWho(){
    const ok = (localStorage.getItem("adm_tok") || "").trim().length > 0;
    $("who").textContent = ok ? "ادمین: فعال" : "ادمین: غیرفعال";
    $("who").style.color = ok ? "var(--good)" : "var(--warn)";
  }
  setWho();

  $("logout").onclick = () => {
    localStorage.removeItem("adm_tok");
    tokEl.value = "";
    setWho();
    toast("توکن پاک شد");
  };

  $("saveTok").onclick = () => {
    localStorage.setItem("adm_tok", tokEl.value.trim());
    setWho();
    toast("ذخیره شد");
  };

  async function adminApi(path, body){
    const tok = (localStorage.getItem("adm_tok") || "").trim();
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "content-type":"application/json",
        "authorization":"Bearer " + tok
      },
      body: JSON.stringify(body || {})
    });
    const text = await res.text();
    let j = null;
    try { j = JSON.parse(text); } catch { j = { raw:text }; }
    if (!res.ok) {
      toast((j && (j.error || j.message)) ? (j.error || j.message) : ("HTTP " + res.status));
    }
    return j;
  }

  // Tabs
  const tabs = {
    auth: $("tab-auth"),
    prompts: $("tab-prompts"),
    basevision: $("tab-basevision"),
    payments: $("tab-payments"),
    wallet: $("tab-wallet"),
    banner: $("tab-banner"),
    raw: $("tab-raw")
  };

  document.querySelectorAll(".nav button").forEach((b)=>{
    b.onclick = () => {
      document.querySelectorAll(".nav button").forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      const name = b.getAttribute("data-tab");
      Object.keys(tabs).forEach(k => tabs[k].style.display = (k===name) ? "block" : "none");
    };
  });

  // AUTH test
  $("testTok").onclick = async () => {
    const r = await adminApi("/admin/api/styles", {});
    $("authOut").textContent = JSON.stringify(r, null, 2);
    if (r && r.ok) toast("دسترسی تایید شد");
  };

  // STYLE PROMPTS
  async function loadStylePrompt(){
    const style = $("styleSel").value;
    const r = await adminApi("/admin/api/prompt_get", { type: "style:" + style });
    $("styleOut").textContent = JSON.stringify(r, null, 2);
    if (r && r.ok){
      $("styleText").value = r.text || "";
      $("styleMeta").textContent = "وضعیت: " + (r.source === "override" ? "Override (ادمین)" : "Default (پیش‌فرض)");
      toast("پرامپت بارگذاری شد");
    }
  }
  $("loadStyle").onclick = loadStylePrompt;

  $("saveStyle").onclick = async () => {
    const style = $("styleSel").value;
    const text = $("styleText").value || "";
    const r = await adminApi("/admin/api/prompt", { type: "style:" + style, text });
    $("styleOut").textContent = JSON.stringify(r, null, 2);
    if (r && r.ok){ toast("ذخیره شد"); await loadStylePrompt(); }
  };

  $("resetStyle").onclick = async () => {
    const style = $("styleSel").value;
    const r = await adminApi("/admin/api/prompt_reset", { type: "style:" + style });
    $("styleOut").textContent = JSON.stringify(r, null, 2);
    if (r && r.ok){ toast("ریست شد"); await loadStylePrompt(); }
  };

  // BASE/VISION
  async function loadBase(){
    const r = await adminApi("/admin/api/prompt_get", { type: "base" });
    $("bvOut").textContent = JSON.stringify(r, null, 2);
    if (r && r.ok){ $("baseText").value = r.text || ""; $("baseMeta").textContent = "وضعیت: " + (r.source==="override"?"Override":"Default"); }
  }
  async function loadVision(){
    const r = await adminApi("/admin/api/prompt_get", { type: "vision" });
    $("bvOut").textContent = JSON.stringify(r, null, 2);
    if (r && r.ok){ $("visionText").value = r.text || ""; $("visionMeta").textContent = "وضعیت: " + (r.source==="override"?"Override":"Default"); }
  }
  $("loadBase").onclick = loadBase;
  $("loadVision").onclick = loadVision;

  $("saveBase").onclick = async () => {
    const r = await adminApi("/admin/api/prompt", { type:"base", text: $("baseText").value });
    $("bvOut").textContent = JSON.stringify(r, null, 2);
    if (r && r.ok){ toast("Base ذخیره شد"); await loadBase(); }
  };
  $("saveVision").onclick = async () => {
    const r = await adminApi("/admin/api/prompt", { type:"vision", text: $("visionText").value });
    $("bvOut").textContent = JSON.stringify(r, null, 2);
    if (r && r.ok){ toast("Vision ذخیره شد"); await loadVision(); }
  };
  $("resetBase").onclick = async () => {
    const r = await adminApi("/admin/api/prompt_reset", { type:"base" });
    $("bvOut").textContent = JSON.stringify(r, null, 2);
    if (r && r.ok){ toast("Base ریست شد"); await loadBase(); }
  };
  $("resetVision").onclick = async () => {
    const r = await adminApi("/admin/api/prompt_reset", { type:"vision" });
    $("bvOut").textContent = JSON.stringify(r, null, 2);
    if (r && r.ok){ toast("Vision ریست شد"); await loadVision(); }
  };

  // Payments
  $("loadPayments").onclick = async () => {
    const r = await adminApi("/admin/api/payments", {});
    $("paymentsOut").textContent = JSON.stringify(r, null, 2);
  };

  // Wallet
  $("setWallet").onclick = async () => {
    const addr = $("wallet").value;
    const r = await adminApi("/admin/api/wallet", { address: addr });
    $("walletOut").textContent = JSON.stringify(r, null, 2);
    if (r && r.ok) toast("ولت ثبت شد");
  };

  // Banner
  $("setBanner").onclick = async () => {
    const r = await adminApi("/admin/api/banner", {
      enabled: $("ben").value === "true",
      text: $("btext").value,
      url: $("burl").value
    });
    $("bannerOut").textContent = JSON.stringify(r, null, 2);
    if (r && r.ok) toast("بنر ثبت شد");
  };

  // Raw
  $("rawSend").onclick = async () => {
    const path = ($("rawPath").value || "").trim();
    let body = {};
    try { body = JSON.parse($("rawBody").value || "{}"); } catch(e){ toast("JSON نامعتبر"); return; }
    const r = await adminApi(path, body);
    $("rawOut").textContent = JSON.stringify(r, null, 2);
  };

  // plans
  const plansText = document.getElementById("plansText");
  document.getElementById("plansLoad")?.addEventListener("click", async () => {
    const r = await authedFetch(api.plans, { method: "GET" });
    plansText.value = JSON.stringify(r.plans || [], null, 2);
    toast("Loaded plans");
  });
  document.getElementById("plansSave")?.addEventListener("click", async () => {
    let plans = [];
    try { plans = JSON.parse(plansText.value || "[]"); } catch { alert("Invalid JSON"); return; }
    await authedFetch(api.plans, { method: "POST", body: JSON.stringify({ plans }) });
    toast("Saved plans");
  });

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