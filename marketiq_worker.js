// @ts-nocheck
/*
  MarketiQ Worker (single-file)
  v4 hotfix: define response helpers BEFORE export default.
  دلیل: در بعضی جریان‌های Build/Editor کلودفلر، اگر helper ها پایین فایل باشند،
  ممکن است در اولین اجرا ReferenceError بخورند.
*/

var env; // global placeholder to avoid ReferenceError in helper calls

// Runtime timezone used for quota resets and date display (default: Europe/Istanbul)
let RUNTIME_TZ = "Europe/Istanbul";
function setRuntimeTZ(e){
  try{
    const tz = (e && (e.TIMEZONE || e.TZ)) ? String(e.TIMEZONE || e.TZ).trim() : "";
    if(tz) RUNTIME_TZ = tz;
  }catch(_e){}
}
function getRuntimeTZ(){ return RUNTIME_TZ; }


/* ========================== WORKER RESPONSE HELPERS (PRELUDE) ========================== */
function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function jsResponse(js, status = 200) {
  return new Response(js, {
    status,
    headers: { "content-type": "application/javascript; charset=utf-8" },
  });
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
export default {
  async fetch(request, env, ctx) {
  setRuntimeTZ(env);
  // Base URL for building Mini App links when PUBLIC_BASE_URL is not set
  env.__BASE_URL = new URL(request.url).origin;
    try {
      const url = new URL(request.url);

      if (url.pathname === "/health") return new Response("ok", { status: 200 });

      // ===== Payment Page =====
      if (request.method === "GET" && url.pathname === "/pay") {
        const wallet = await getWallet(env);
        const price = await getSubPrice(env);
        const currency = await getSubCurrency(env);
        const days = await getSubDays(env);
        return htmlResponse(buildPaymentPageHtml({ brand: BRAND, wallet, price, currency, days, support: (env.SUPPORT_HANDLE || "@support") }));
      }

      // ===== Mini App (inline) =====
      if (request.method === "GET" && url.pathname === "/") return htmlResponse(MINI_APP_HTML);
      if (request.method === "GET" && url.pathname === "/app.js") return jsResponse(MINI_APP_JS);

      if (request.method === "GET" && (url.pathname === "/admin" || url.pathname === "/admin/")) return htmlResponse(ADMIN_APP_HTML);
      if (request.method === "GET" && url.pathname === "/admin.js") return jsResponse(ADMIN_APP_JS);

      // ===== Mini App APIs =====
      if (url.pathname === "/api/user" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if (!v.ok) return jsonResponse({ ok: false, error: "auth_failed" }, 401);

        const st = await ensureUser(v.userId, env, { username: v.fromLike?.username || "" });
        const onboardOk = isOnboardComplete(st);
        const quota = await quotaText(st, v.fromLike, env);
        const dLim = await dailyLimitForUser(st, v.fromLike, env);
        const mLim = await monthlyLimitForUser(st, v.fromLike, env);
        const energy = {
          daily: { used: st.dailyUsed||0, limit: Number.isFinite(dLim)?dLim:null, remaining: Number.isFinite(dLim)?Math.max(0, dLim-(st.dailyUsed||0)):null },
          monthly: { used: st.monthlyUsed||0, limit: Number.isFinite(mLim)?mLim:null, remaining: Number.isFinite(mLim)?Math.max(0, mLim-(st.monthlyUsed||0)):null },
        };
        const offer = await getOfferConfig(env);
        const customPrompt = (() => {
          if(!st.customPromptRequestedAt) return { status:"none" };
          const readyMs = Date.parse(st.customPromptReadyAt||"");
          const isReady = Number.isFinite(readyMs) && Date.now() >= readyMs;
          if(st.customPromptDeliveredAt) return { status:"delivered", requestedAt: st.customPromptRequestedAt, deliveredAt: st.customPromptDeliveredAt };
          if(isReady) return { status:"ready", requestedAt: st.customPromptRequestedAt, readyAt: st.customPromptReadyAt };
          return { status:"pending", requestedAt: st.customPromptRequestedAt, readyAt: st.customPromptReadyAt };
        })();

        const from = v.fromLike || { id: v.userId };
        const role = {
          owner: String(v.userId) === String(env.OWNER_ID||""),
          admin: isAdmin(from, env),
          privileged: isPrivileged(from, env),
        };
        const symbols = [...MAJORS, ...METALS, ...INDICES, ...STOCKS, ...CRYPTOS];
        const wallet = await getWallet(env);
        const subPrice = await getSubPrice(env);
        const subCurrency = await getSubCurrency(env);
        const subDays = await getSubDays(env);
        const payUrl = new URL("/pay", url.origin).toString();

        return jsonResponse({
          ok: true,
          state: stPublic(st),
          quota,
          symbols,
          profile: {
            refLink: (()=>{ const botUsername = String(env.BOT_USERNAME||"").replace(/^@/,"").trim(); const code = Array.isArray(st.refCodes)&&st.refCodes.length?st.refCodes[0]:""; return (botUsername&&code)?`https://t.me/${botUsername}?start=${code}`:(code||""); })(),
            points: st.points||0,
            invites: st.successfulInvites||0,
            balance: st.walletBalance||0,
            depositRequests: st.walletDepositRequests||0,
            withdrawRequests: st.walletWithdrawRequests||0,
            bep20Address: st.bep20Address||"",
          },
          onboardOk,
          wallet,
          subPrice,
          subCurrency,
          subDays,
          payUrl,
          welcome: MINI_APP_WELCOME_TEXT,
          role,
          offer,
          energy,
          customPrompt,
          infoText: CUSTOM_PROMPT_INFO_TEXT,
        });
      }

      if (url.pathname === "/api/settings" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if (!v.ok) return jsonResponse({ ok: false, error: "auth_failed" }, 401);

        const st = await ensureUser(v.userId, env, { username: v.fromLike?.username || "" });
        if (!isOnboardComplete(st)) return jsonResponse({ ok: false, error: "onboarding_required" }, 403);

        if (typeof body.timeframe === "string") st.timeframe = sanitizeTimeframe(body.timeframe) || st.timeframe;
        if (typeof body.style === "string") {
          const nextStyle = sanitizeStyle(body.style) || st.style;
          if(nextStyle === "پرامپت اختصاصی" && !st.customPromptDeliveredAt){
            return jsonResponse({ ok:false, error:"custom_prompt_required", info: CUSTOM_PROMPT_INFO_TEXT }, 400);
          }
          st.style = nextStyle;
        }
        if (typeof body.risk === "string") st.risk = sanitizeRisk(body.risk) || st.risk;
        if (typeof body.newsEnabled === "boolean") st.newsEnabled = body.newsEnabled;

        if (env.BOT_KV) await saveUser(v.userId, st, env);
        const quota = await quotaText(st, v.fromLike, env);
        const dLim = await dailyLimitForUser(st, v.fromLike, env);
        const mLim = await monthlyLimitForUser(st, v.fromLike, env);
        const energy = {
          daily: { used: st.dailyUsed||0, limit: Number.isFinite(dLim)?dLim:null, remaining: Number.isFinite(dLim)?Math.max(0, dLim-(st.dailyUsed||0)):null },
          monthly: { used: st.monthlyUsed||0, limit: Number.isFinite(mLim)?mLim:null, remaining: Number.isFinite(mLim)?Math.max(0, mLim-(st.monthlyUsed||0)):null },
        };
        const offer = await getOfferConfig(env);
        const customPrompt = (() => {
          if(!st.customPromptRequestedAt) return { status:"none" };
          const readyMs = Date.parse(st.customPromptReadyAt||"");
          const isReady = Number.isFinite(readyMs) && Date.now() >= readyMs;
          if(st.customPromptDeliveredAt) return { status:"delivered", requestedAt: st.customPromptRequestedAt, deliveredAt: st.customPromptDeliveredAt };
          if(isReady) return { status:"ready", requestedAt: st.customPromptRequestedAt, readyAt: st.customPromptReadyAt };
          return { status:"pending", requestedAt: st.customPromptRequestedAt, readyAt: st.customPromptReadyAt };
        })();

        return jsonResponse({ ok: true, state: stPublic(st), quota });
      }

if (url.pathname === "/api/analyze" && request.method === "POST") {
  const body = await request.json().catch(() => null);
  if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

  const v = await authMiniApp(body, env);
  if (!v.ok) return jsonResponse({ ok: false, error: "auth_failed" }, 401);

  const st = await ensureUser(v.userId, env, v.fromLike);
  if (!isOnboardComplete(st)) return jsonResponse({ ok: false, error: "onboarding_required" }, 403);

  const symbol = normalizeSymbol(body.symbol);
  if (!symbol || !isSymbol(symbol)) return jsonResponse({ ok: false, error: "invalid_symbol" }, 400);

  // quota check (subscription-aware)
  if (env.BOT_KV && !(await canAnalyzeToday(st, v.fromLike, env))) {
    const quota = await quotaText(st, v.fromLike, env);
    return jsonResponse({ ok: false, error: "quota_exceeded", quota }, 429);
  }

  const userPrompt = typeof body.userPrompt === "string" ? body.userPrompt : "";

  try {
    // Run analysis first (don't consume quota on failure)
    const out = await runSignalTextFlowReturnText(env, v.fromLike, st, symbol, userPrompt);

    if (env.BOT_KV) {
      consumeDaily(st, v.fromLike, env);
      await saveUser(v.userId, st, env);
    }

    const quota = await quotaText(st, v.fromLike, env);
    return jsonResponse({
      ok: true,
      result: out?.text || "",
      chartUrl: out?.chartUrl || "",
      headlines: out?.headlines || [],
      state: stPublic(st),
      quota,
    });
  } catch (e) {
    console.error("api/analyze error:", e);

    const msg = String(e?.message || "");
    let code = "try_again";
    if (
      msg.includes("AI_binding_missing") ||
      msg.includes("OPENAI_API_KEY_missing") ||
      msg.includes("GEMINI_API_KEY_missing") ||
      msg.includes("all_text_providers_failed")
    ) code = "ai_not_configured";
    else if (
      msg.includes("market_data") ||
      msg.includes("binance_") ||
      msg.includes("yahoo_") ||
      msg.includes("twelvedata_") ||
      msg.includes("finnhub_") ||
      msg.includes("alphavantage_")
    ) code = "market_data_unavailable";

    const quota = await quotaText(st, v.fromLike, env).catch(() => "-");
    const payload = { ok: false, error: code, quota };
    if (isPrivileged(v.fromLike, env)) payload.debug = e?.message || String(e);
    return jsonResponse(payload, 500);
  }
}



      if (url.pathname === "/api/custom_prompt/request" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);

        const st = await ensureUser(v.userId, env, { username: v.fromLike?.username || "" });
        if(!isOnboardComplete(st)) return jsonResponse({ ok:false, error:"onboarding_required" }, 403);

        const desc = String(body.desc||"").trim();
        if(desc.length < 10) return jsonResponse({ ok:false, error:"desc_too_short", info: CUSTOM_PROMPT_INFO_TEXT }, 400);
        if(desc.length > 3000) return jsonResponse({ ok:false, error:"desc_too_long" }, 400);

        // Generate prompt now, but deliver after 2 hours.
        const genPrompt =
`You are an expert trading prompt engineer.
Create a concise, high-quality ANALYSIS PROMPT in Persian that the bot can prepend as STYLE_GUIDE.
The prompt must:
- Be actionable and structured
- Specify required sections 1 تا 5
- Enforce: no hallucination, rely on OHLC
- Include zones (supply/demand) and entry/SL/TP rules
User strategy description:
${desc}`;

        let generated = "";
        try{
          generated = await runTextProviders(genPrompt, env, st.textOrder);
        }catch(e){
          generated = `پرامپت اختصاصی (پیش‌فرض)
- قوانین و ستاپ‌ها را دقیقاً مطابق توضیحات کاربر اجرا کن.
- خروجی ۱ تا ۵.
- نواحی (Zone) + تریگر ورود + ابطال + تارگت‌ها.
- فقط بر اساس OHLC و داده‌های ارائه‌شده.`;
        }

        st.customPromptDesc = desc;
        st.customPromptText = String(generated||"").trim();
        st.customPromptRequestedAt = new Date().toISOString();
        st.customPromptReadyAt = new Date(Date.now() + CUSTOM_PROMPT_DELAY_MS).toISOString();
        st.customPromptDeliveredAt = "";
        await saveUser(v.userId, st, env);
        // Schedule automatic delivery (cron)
        await scheduleCustomPromptJob(env, st).catch(()=>{});

        return jsonResponse({ ok:true, readyAt: st.customPromptReadyAt });
      }

      if (url.pathname === "/api/wallet/set_bep20" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);
        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);
        const st = await ensureUser(v.userId, env, { username: v.fromLike?.username || "" });
        if(!isOnboardComplete(st)) return jsonResponse({ ok:false, error:"onboarding_required" }, 403);
        const addr = String(body.address||"").trim();
        if(addr.length < 10) return jsonResponse({ ok:false, error:"invalid_bep20" }, 400);
        st.bep20Address = addr;
        await saveUser(v.userId, st, env);
        return jsonResponse({ ok:true, state: stPublic(st) });
      }

      if (url.pathname === "/api/wallet/request_deposit" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);
        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);
        const st = await ensureUser(v.userId, env, { username: v.fromLike?.username || "" });
        if(!isOnboardComplete(st)) return jsonResponse({ ok:false, error:"onboarding_required" }, 403);
        st.walletDepositRequests = (st.walletDepositRequests||0) + 1;
        await saveUser(v.userId, st, env);
        // Notify admins/owner
        try{
          const admins = (env.ADMIN_IDS||"").split(",").map(s=>s.trim()).filter(Boolean);
          const owner = (env.OWNER_ID||"").trim();
          const targets = [...new Set([owner, ...admins].filter(Boolean))];
          for(const a of targets){
            await tgSendMessage(env, a, `💰 درخواست واریز\nuser=${v.userId}\nname=${st.profileName||"-"}\ncount=${st.walletDepositRequests}`, null).catch(()=>{});
          }
        }catch(_e){}
        return jsonResponse({ ok:true });
      }

      if (url.pathname === "/api/wallet/request_withdraw" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);
        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);
        const st = await ensureUser(v.userId, env, { username: v.fromLike?.username || "" });
        if(!isOnboardComplete(st)) return jsonResponse({ ok:false, error:"onboarding_required" }, 403);
        if(!st.bep20Address) return jsonResponse({ ok:false, error:"bep20_required" }, 400);
        st.walletWithdrawRequests = (st.walletWithdrawRequests||0) + 1;
        await saveUser(v.userId, st, env);
        // Notify admins/owner
        try{
          const admins = (env.ADMIN_IDS||"").split(",").map(s=>s.trim()).filter(Boolean);
          const owner = (env.OWNER_ID||"").trim();
          const targets = [...new Set([owner, ...admins].filter(Boolean))];
          for(const a of targets){
            await tgSendMessage(env, a, `🏦 درخواست برداشت\nuser=${v.userId}\nname=${st.profileName||"-"}\nBEP20=${st.bep20Address}\ncount=${st.walletWithdrawRequests}`, null).catch(()=>{});
          }
        }catch(_e){}
        return jsonResponse({ ok:true });
      }
      if (url.pathname === "/api/payment/submit" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if (!v.ok) return jsonResponse({ ok: false, error: "auth_failed" }, 401);

        const st = await ensureUser(v.userId, env, { username: v.fromLike?.username || "" });
        if (!isOnboardComplete(st)) return jsonResponse({ ok: false, error: "onboarding_required" }, 403);

        const txid = normalizeTxId(body.txid || "");
        if (!txid) return jsonResponse({ ok: false, error: "invalid_txid" }, 400);

        try{
          const rec = await createPendingPayment(env, v.userId, txid);

          // Notify admins/owner
          const admins = (env.ADMIN_IDS||"").split(",").map(s=>s.trim()).filter(Boolean);
          const owner = (env.OWNER_ID||"").trim();
          const targets = [...new Set([owner, ...admins].filter(Boolean))];
          for(const a of targets){
            await tgSendMessage(env, a, `💳 پرداخت جدید (Pending)\nuser=${v.userId}\nTxID=${rec.txid}\namount=${rec.amount} ${rec.currency}\ndays=${rec.days}`, null).catch(()=>{});
          }

          return jsonResponse({ ok: true });
        }catch(e){
          const msg = (e?.message === "txid_exists") ? "txid_exists" : "try_again";
          return jsonResponse({ ok: false, error: msg }, 400);
        }
      }

      if (url.pathname === "/api/admin/get" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);

        const from = v.fromLike || { id: v.userId };
        if(!isPrivileged(from, env)) return jsonResponse({ ok:false, error:"forbidden" }, 403);

        const wallet = await getWallet(env);
        const price = await getSubPrice(env);
        const currency = await getSubCurrency(env);
        const days = await getSubDays(env);
        const freeLimit = await getFreeDailyLimit(env);
        const subLimit = await getSubDailyLimit(env);
        const monthlyLimit = await getMonthlyLimit(env);
        const offer = await getOfferConfig(env);

        return jsonResponse({ ok:true, config:{ wallet, price, currency, days, freeLimit, subLimit, monthlyLimit, offer }, role:{
          owner: String(v.userId) === String(env.OWNER_ID||""),
          admin: isAdmin(from, env),
          privileged: true
        }});
      }

      if (url.pathname === "/api/admin/set" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);

        const from = v.fromLike || { id: v.userId };
        if(!isPrivileged(from, env)) return jsonResponse({ ok:false, error:"forbidden" }, 403);

        try{
          // Wallet (ADMIN only)
          if(body.wallet !== undefined){
            if(!isAdmin(from, env)) return jsonResponse({ ok:false, error:"wallet_admin_only" }, 403);
            await setWallet(env, String(body.wallet||"").trim(), from);
          }

          // Subscription settings (Owner/Admin)
          if(body.price !== undefined) await setSubPrice(env, body.price);
          if(body.currency !== undefined) await setSubCurrency(env, body.currency);
          if(body.days !== undefined) await setSubDays(env, body.days);

          // Limits
          if(body.freeLimit !== undefined) await setFreeDailyLimit(env, body.freeLimit);
          if(body.subLimit !== undefined) await setSubDailyLimit(env, body.subLimit);
          if(body.monthlyLimit !== undefined) await setMonthlyLimit(env, body.monthlyLimit);

          // Offer banner
          if(body.offer !== undefined){
            const o = body.offer || {};
            await setOfferConfig(env, { enabled: !!o.enabled, text: o.text || "", url: o.url || "" });
          }

          // Style prompt override
          if(body.styleKey !== undefined && body.stylePrompt !== undefined){
            const key = String(body.styleKey||"").trim();
            const prompt = String(body.stylePrompt||"");
            const safeKey = key.replace(/[^a-z0-9_]/gi, "").toLowerCase();
            if(["rtm","ict","price_action","prompt","custom_method","custom_prompt"].includes(safeKey)){
              await setCfg(env, `style_prompt_${safeKey}`, `cfg:style_prompt:${safeKey}`, prompt);
            }
          }

          return jsonResponse({ ok:true });
        }catch(e){
          console.error("admin/set error:", e);
          return jsonResponse({ ok:false, error:"try_again" }, 400);
        }
      }

      if (url.pathname === "/api/admin/payments" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);

        const from = v.fromLike || { id: v.userId };
        if(!isPrivileged(from, env)) return jsonResponse({ ok:false, error:"forbidden" }, 403);

        const res = await listPendingPayments(env, 30);
        return jsonResponse({ ok:true, items: res.items });
      }

      if (url.pathname === "/api/admin/approve" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);

        const from = v.fromLike || { id: v.userId };
        if(!isPrivileged(from, env)) return jsonResponse({ ok:false, error:"forbidden" }, 403);

        try{
          const rec = await markPaymentApproved(env, body.txid, v.userId);
          await tgSendMessage(env, rec.userId, `✅ پرداخت تایید شد. اشتراک شما فعال شد (${rec.days} روز).`).catch(()=>{});
          return jsonResponse({ ok:true });
        }catch(e){
          return jsonResponse({ ok:false, error:"try_again" }, 400);
        }
      }

      if (url.pathname === "/api/admin/reject" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);

        const from = v.fromLike || { id: v.userId };
        if(!isPrivileged(from, env)) return jsonResponse({ ok:false, error:"forbidden" }, 403);

        try{
          const rec = await markPaymentRejected(env, body.txid, v.userId);
          await tgSendMessage(env, rec.userId, "🚫 پرداخت شما رد شد. اگر اشتباه شده، با پشتیبانی تماس بگیرید.").catch(()=>{});
          return jsonResponse({ ok:true });
        }catch(e){
          return jsonResponse({ ok:false, error:"try_again" }, 400);
        }
      }

      if (url.pathname === "/api/admin/refgen" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);

        const from = v.fromLike || { id: v.userId };
        if(!isAdmin(from, env)) return jsonResponse({ ok:false, error:"admin_only" }, 403);

        try{
          const targetId = String(body.userId||"").trim();
          const codes = await adminGenerateRefCodes(env, targetId, 5);
          const botUsername = String(env.BOT_USERNAME||"").replace(/^@/,"");
          const links = botUsername ? codes.map(c=>`https://t.me/${botUsername}?start=${c}`) : codes;
          return jsonResponse({ ok:true, codes, links });
        }catch(e){
          return jsonResponse({ ok:false, error:"try_again" }, 400);
        }
      }

      // ===== Telegram webhook route: /telegram/<secret> =====
      if (url.pathname.startsWith("/telegram/")) {
        const secret = url.pathname.split("/")[2] || "";
        if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== String(env.TELEGRAM_WEBHOOK_SECRET)) {
          return new Response("forbidden", { status: 403 });
        }
        if (request.method !== "POST") return new Response("ok", { status: 200 });

        const update = await request.json().catch(() => null);
        if (!update) return new Response("bad request", { status: 400 });

        ctx.waitUntil(handleUpdate(update, env));
        return new Response("ok", { status: 200 });
      }

      if (env.ASSETS?.fetch) return env.ASSETS.fetch(request);
      return new Response("not found", { status: 404 });
    } catch (e) {
      // Don't leak internal errors to end-users (Mini App / Bot). Log server-side فقط.
      console.error("fetch error:", e);

      let path = "";
      try { path = new URL(request.url).pathname || ""; } catch {}

      if (path.startsWith("/api/")) {
        return jsonResponse({ ok: false, error: "try_again" }, 200);
      }

      // For browser/MiniApp load: show a friendly fallback instead of raw "error"
      return htmlResponse(`<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8">
<title>MarketiQ</title><body style="font-family:system-ui; padding:16px; line-height:1.8">
<h2>در حال بروزرسانی…</h2>
<div>اگر از تلگرام وارد شدی، چند ثانیه بعد دوباره تلاش کن.</div>
</body></html>`, 200);
    }
  },
  async scheduled(event, env, ctx){
    // Cron trigger (optional): used for delayed deliveries such as custom prompts
    setRuntimeTZ(env);
    ctx.waitUntil(processCustomPromptJobs(env));
  },
};

/* ========================== CONFIG ========================== */
const BRAND = "MarketiQ";

const MAJORS = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"];
const METALS = ["XAUUSD", "XAGUSD"];
const INDICES = ["DJI", "NDX", "SPX"];
const STOCKS = ["AAPL", "TSLA", "MSFT", "NVDA", "AMZN", "META", "GOOGL"];
const CRYPTOS = [
  "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT",
  "ADAUSDT","DOGEUSDT","TRXUSDT","TONUSDT","AVAXUSDT",
  "LINKUSDT","DOTUSDT","MATICUSDT","LTCUSDT","BCHUSDT",
];

const BTN = {
  ANALYZE: "✅ تحلیل کن",
  SIGNALS: "📈 سیگنال‌ها",
  SETTINGS: "⚙️ تنظیمات",
  PROFILE: "👤 پروفایل",
  SUPPORT: "🆘 پشتیبانی",
  EDUCATION: "📚 آموزش",
  LEVEL: "🧪 تعیین سطح",
  REFERRAL: "🎁 دعوت دوستان",
  BUY: "💳 خرید اشتراک",
  MINIAPP: "🧩 مینی‌اپ",
  BACK: "⬅️ برگشت",
  HOME: "🏠 منوی اصلی",

  CAT_MAJORS: "💱 جفت‌ارزها (Forex)",
  CAT_METALS: "🪙 فلزات",
  CAT_INDICES: "📊 شاخص‌ها",
  CAT_STOCKS: "📈 سهام",
  CAT_CRYPTO: "₿ کریپتو",

  SET_TF: "⏱ تایم‌فریم",
  SET_STYLE: "🎯 سبک",
  SET_RISK: "⚠️ ریسک",
  SET_NEWS: "📰 خبر",

  SHARE_CONTACT: "📱 ارسال شماره (Share Contact)",
  REQUEST_RELEVEL: "🔁 درخواست تعیین سطح مجدد",
  REQUEST_SETTINGS: "✉️ درخواست تغییر تنظیمات",
};

const TYPING_INTERVAL_MS = 4000;
const TIMEOUT_TEXT_MS = 11000;
const TIMEOUT_VISION_MS = 12000;
const TIMEOUT_POLISH_MS = 9000;

const REF_CODES_PER_USER = 5;
const REF_POINTS_PER_SUCCESS = 6;
const REF_POINTS_FOR_FREE_SUB = 500;

// Points & limits
const SUB_POINTS_PER_SUB = 1000;
function getRefPointsPerSuccess(env){ return toInt(env?.REF_POINTS_PER_SUCCESS, REF_POINTS_PER_SUCCESS); }
function getRefPointsForFreeSub(env){ return toInt(env?.REF_POINTS_FOR_FREE_SUB, REF_POINTS_FOR_FREE_SUB); }
function getSubPointsPerSub(env){ return toInt(env?.SUB_POINTS_PER_SUB, SUB_POINTS_PER_SUB); }

const DEFAULT_DAILY_LIMIT = 50;
const DEFAULT_MONTHLY_LIMIT = 500;

// Custom prompt flow (2h delay)
const CUSTOM_PROMPT_DELAY_MS = 2 * 60 * 60 * 1000;
const CUSTOM_PROMPT_INFO_TEXT = "استراتژی و سبک خود را بصورت متن توضیح دهید تا کارشناسان ما در اسرع وقت پاسخ دهند";


/* ========================== WELCOME TEXT ========================== */
const WELCOME_TEXT = `🎯 متن خوش‌آمدگویی بات تلگرام MarketiQ

👋 به MarketiQ خوش آمدید
هوش تحلیلی شما در بازارهای مالی

────────────────────────

📊 MarketiQ یک ایجنت تخصصی تحلیل بازارهای مالی است که با تمرکز بر تصمیم‌سازی هوشمند، در کنار شماست تا بازار را درست‌تر، عمیق‌تر و حرفه‌ای‌تر ببینید.

🔍 در MarketiQ چه دریافت می‌کنید؟
✅ تحلیل فاندامنتال بازارهای مالی
✅ تحلیل تکنیکال دقیق و ساختاریافته
✅ سیگنال‌های معاملاتی با رویکرد مدیریت ریسک
✅ پوشش بازارها:
- 🪙 کریپتوکارنسی
- 💱 جفت‌ارزها (Forex)
- 🪙 فلزات گران‌بها
- 📈 سهام

────────────────────────

🧠 فلسفه MarketiQ
ما سیگنال نمی‌فروشیم، ما «درک بازار» می‌سازیم.
هدف ما کمک به شما برای تصمیم‌گیری آگاهانه است، نه وابستگی کورکورانه به سیگنال.

────────────────────────

🚀 شروع کنید
/start | شروع تحلیل
/signals | سیگنال‌ها
/education | آموزش و مفاهیم بازار
/support | پشتیبانی

────────────────────────

⚠️ سلب مسئولیت:
تمام تحلیل‌ها صرفاً جنبه آموزشی و تحلیلی دارند و مسئولیت نهایی معاملات بر عهده کاربر است.`;

const MINI_APP_WELCOME_TEXT = `👋 به MarketiQ خوش آمدید — هوش تحلیلی شما در بازارهای مالی
این مینی‌اپ برای گرفتن تحلیل سریع، تنظیمات، و مدیریت دسترسی طراحی شده است.
⚠️ تحلیل‌ها آموزشی است و مسئولیت معاملات با شماست.`;

/* ========================== UTILS ========================== */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunkText = (s, size = 3500) => { const out=[]; for(let i=0;i<s.length;i+=size) out.push(s.slice(i,i+size)); return out; };
const timeoutPromise = (ms, label="timeout") => new Promise((_,rej)=>setTimeout(()=>rej(new Error(label)), ms));

async function fetchWithTimeout(url, init, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...init, signal: ac.signal }); }
  finally { clearTimeout(t); }
}

function toInt(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function normHandle(h){ if(!h) return ""; return "@"+String(h).replace(/^@/,"").toLowerCase(); }
function parseIds(raw){ const s=(raw||"").toString().trim(); if(!s) return []; return s.split(",").map(x=>String(x).trim()).filter(Boolean); }

function isAdmin(from, env) {
  const u = normHandle(from?.username);
  const setH = new Set((env.ADMIN_HANDLES||"").toString().split(",").map(normHandle).filter(Boolean));
  const setI = new Set(parseIds(env.ADMIN_IDS||""));
  return (u && setH.has(u)) || (from?.id && setI.has(String(from.id)));
}
function isOwner(from, env) {
  const u = normHandle(from?.username);
  const setH = new Set((env.OWNER_HANDLES||"").toString().split(",").map(normHandle).filter(Boolean));
  const setI = new Set(parseIds(env.OWNER_IDS||""));
  const single = String(env.OWNER_ID||"").trim();
  if(single) setI.add(single);
  return (u && setH.has(u)) || (from?.id && setI.has(String(from.id)));
}
function isPrivileged(from, env){ return isAdmin(from, env) || isOwner(from, env); }

function publicBaseUrl(env){
  const raw = (env.PUBLIC_BASE_URL || env.PUBLIC_URL || env.BASE_URL || "").toString().trim();
  return raw ? raw.replace(/\/+$/,"") : "";
}
function paymentPageUrl(env){
  const base = publicBaseUrl(env);
  return base ? `${base}/pay` : "";
}

function kyivDateString(d = new Date()) {
  // Returns YYYY-MM-DD in configured timezone
  return new Intl.DateTimeFormat("en-CA", { timeZone: getRuntimeTZ(), year:"numeric", month:"2-digit", day:"2-digit" }).format(d);
}

function kyivMonthString(d = new Date()) {
  // Returns YYYY-MM in configured timezone
  return new Intl.DateTimeFormat("en-CA", { timeZone: getRuntimeTZ(), year:"numeric", month:"2-digit" }).format(d);
}

function nowIso(){ return new Date().toISOString(); }

function parseOrder(raw, fallbackArr){
  const s=(raw||"").toString().trim();
  if(!s) return fallbackArr;
  return s.split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
}

function sanitizeTimeframe(tf){ tf=String(tf||"").toUpperCase().trim(); return ["M15","H1","H4","D1"].includes(tf)?tf:null; }
function sanitizeStyle(s){
  s = String(s||"").trim();
  const low = s.toLowerCase();
  const map = {
    scalp:"اسکالپ", swing:"سوئینگ", intraday:"اینترادی", smart:"اسمارت‌مانی", smartmoney:"اسمارت‌مانی",
    rtm:"RTM", ict:"ICT", "priceaction":"پرایس اکشن", "price_action":"پرایس اکشن",
    "prompt":"پرامپت", "custom":"روش اختصاصی", "custommethod":"روش اختصاصی",
    "custom_prompt":"پرامپت اختصاصی"
  };
  if(map[low]) return map[low];
  // normalize common Persian variants
  if(low.includes("پرایس") && low.includes("اکشن")) return "پرایس اکشن";
  if(low.includes("اختصاصی") && low.includes("پرامپت")) return "پرامپت اختصاصی";
  if(low.includes("روش") && low.includes("اختصاصی")) return "روش اختصاصی";

  const allowed = ["اسکالپ","سوئینگ","اینترادی","اسمارت‌مانی","RTM","ICT","پرایس اکشن","پرامپت","روش اختصاصی","پرامپت اختصاصی"];
  return allowed.includes(s) ? s : null;
}
function sanitizeRisk(s){
  s = String(s||"").trim();
  const low = s.toLowerCase();
  const map = { low:"کم", mid:"متوسط", medium:"متوسط", high:"زیاد" };
  if(map[low]) return map[low];
  return ["کم","متوسط","زیاد"].includes(s) ? s : null;
}
function sanitizeNewsChoice(s){ s=String(s||"").trim(); if(s.includes("روشن")) return true; if(s.includes("خاموش")) return false; return null; }

function isOnboardComplete(st){ return !!(st.profileName && st.phone); }

async function quotaText(st, from, env){
  const dLim = await dailyLimitForUser(st, from, env);
  const mLim = await monthlyLimitForUser(st, from, env);
  if(!Number.isFinite(dLim) && !Number.isFinite(mLim)) return "∞";
  const dPart = Number.isFinite(dLim) ? `روز: ${st.dailyUsed}/${dLim}` : "روز: ∞";
  const mPart = Number.isFinite(mLim) ? `ماه: ${st.monthlyUsed}/${mLim}` : "ماه: ∞";
  return `${dPart} | ${mPart}`;
}

/* ========================== KEYBOARDS ========================== */
function kb(rows){
  return { keyboard: rows, resize_keyboard:true, one_time_keyboard:false, input_field_placeholder:"از دکمه‌ها استفاده کن یا پیام بده…" };
}
function getMiniappUrl(env) {
  env = env || {};
  const raw = (env.MINIAPP_URL || env.PUBLIC_BASE_URL || env.__BASE_URL || "").toString().trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "") + "/";
}
function miniappKey(env) {
  const url = getMiniappUrl(env);
  if (!url) return BTN.MINIAPP;
  return { text: BTN.MINIAPP, web_app: { url } };
}
function appendMiniRow(rows, env) {
  rows = rows || [];
  rows.push([miniappKey(env)]);
  return rows;
}

function requestContactKeyboard(env) {
  return {
    keyboard: [
      [{ text: "📱 ارسال شماره تماس", request_contact: true }],
      [BTN.BACK, BTN.HOME],
      [miniappKey(env)],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function mainMenuKeyboard(env) {
  const rows = [
    [BTN.SIGNALS, BTN.SETTINGS],
    [BTN.PROFILE, BTN.REFERRAL],
    [BTN.LEVEL, BTN.EDUCATION],
    [BTN.BUY, BTN.SUPPORT],
    [BTN.HOME],
  ];
  appendMiniRow(rows, env);
  return kb(rows);
}

function signalsMenuKeyboard(env) {
  const rows = [
    [BTN.CAT_CRYPTO, BTN.CAT_MAJORS],
    [BTN.CAT_METALS, BTN.CAT_INDICES],
    [BTN.CAT_STOCKS],
    [BTN.BACK, BTN.HOME],
  ];
  appendMiniRow(rows, env);
  return kb(rows);
}

function settingsMenuKeyboard(env) {
  const rows = [
    [BTN.SET_TF, BTN.SET_STYLE],
    [BTN.SET_RISK, BTN.SET_NEWS],
    [BTN.BACK, BTN.HOME],
  ];
  appendMiniRow(rows, env);
  return kb(rows);
}

function listKeyboard(items, columns = 2, env) {
  const rows = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  rows.push([BTN.BACK, BTN.HOME]);
  appendMiniRow(rows, env);
  return kb(rows);
}

function optionsKeyboard(options, env) {
  const rows = [];
  for (let i = 0; i < options.length; i += 2) rows.push(options.slice(i, i + 2));
  rows.push([BTN.BACK, BTN.HOME]);
  appendMiniRow(rows, env);
  return kb(rows);
}

/* ========================== KV STATE ========================== */
async function getUser(userId, env){
  if(!env.BOT_KV) return null;
  const raw = await env.BOT_KV.get(`u:${userId}`);
  if(!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function saveUser(userId, st, env){
  if(!env.BOT_KV) return;
  await env.BOT_KV.put(`u:${userId}`, JSON.stringify(st));
}
function defaultUser(userId){
  return {
    userId, createdAt: nowIso(), updatedAt: nowIso(),
    chatId:null, username:"",
    state:"idle", selectedSymbol:"",
    timeframe:"H4", style:"اسمارت‌مانی", risk:"متوسط", newsEnabled:true,
    profileName:"", phone:"",
    experience:"", preferredMarket:"",
    level:"", levelScore:null, levelSummary:"", suggestedMarket:"",
    refCodes:[], pendingReferrerId:null, referrerId:null, successfulInvites:0, points:0, refCommissionTotal:0, lastPaymentTx:"", lastPaymentStatus:"",
    subActiveUntil:"", freeSubRedeemed:0,
    dailyDate: kyivDateString(), dailyUsed:0,
    monthKey: kyivMonthString(), monthlyUsed:0,
    bep20Address:"", walletBalance:0, walletDepositRequests:0, walletWithdrawRequests:0,
    customPromptDesc:"", customPromptText:"", customPromptRequestedAt:"", customPromptReadyAt:"", customPromptDeliveredAt:"",
    textOrder:"", visionOrder:"", polishOrder:"",
    quiz:{ active:false, idx:0, answers:[] },
  };
}
function patchUser(st, userId){
  const d = defaultUser(userId);
  const out = { ...d, ...st, userId };
  out.timeframe = sanitizeTimeframe(out.timeframe) || d.timeframe;
  out.style = sanitizeStyle(out.style) || d.style;
  out.risk = sanitizeRisk(out.risk) || d.risk;
  out.newsEnabled = typeof out.newsEnabled === "boolean" ? out.newsEnabled : d.newsEnabled;
  out.profileName = typeof out.profileName === "string" ? out.profileName : "";
  out.phone = typeof out.phone === "string" ? out.phone : "";
  out.experience = typeof out.experience === "string" ? out.experience : "";
  out.preferredMarket = typeof out.preferredMarket === "string" ? out.preferredMarket : "";
  out.level = typeof out.level === "string" ? out.level : "";
  out.levelSummary = typeof out.levelSummary === "string" ? out.levelSummary : "";
  out.suggestedMarket = typeof out.suggestedMarket === "string" ? out.suggestedMarket : "";
  out.refCodes = Array.isArray(out.refCodes) ? out.refCodes : [];
  out.pendingReferrerId = out.pendingReferrerId ?? null;
  out.referrerId = out.referrerId ?? null;
  out.successfulInvites = Number.isFinite(Number(out.successfulInvites)) ? Number(out.successfulInvites) : 0;
  out.points = Number.isFinite(Number(out.points)) ? Number(out.points) : 0;
  out.subActiveUntil = typeof out.subActiveUntil === "string" ? out.subActiveUntil : "";
  out.freeSubRedeemed = Number.isFinite(Number(out.freeSubRedeemed)) ? Number(out.freeSubRedeemed) : 0;
  out.dailyDate = out.dailyDate || d.dailyDate;
  out.dailyUsed = Number.isFinite(Number(out.dailyUsed)) ? Number(out.dailyUsed) : 0;
  out.monthKey = out.monthKey || d.monthKey;
  out.monthlyUsed = Number.isFinite(Number(out.monthlyUsed)) ? Number(out.monthlyUsed) : 0;
  out.bep20Address = typeof out.bep20Address === "string" ? out.bep20Address : "";
  out.walletBalance = Number.isFinite(Number(out.walletBalance)) ? Number(out.walletBalance) : 0;
  out.walletDepositRequests = Number.isFinite(Number(out.walletDepositRequests)) ? Number(out.walletDepositRequests) : 0;
  out.walletWithdrawRequests = Number.isFinite(Number(out.walletWithdrawRequests)) ? Number(out.walletWithdrawRequests) : 0;
  out.customPromptDesc = typeof out.customPromptDesc === "string" ? out.customPromptDesc : "";
  out.customPromptText = typeof out.customPromptText === "string" ? out.customPromptText : "";
  out.customPromptRequestedAt = typeof out.customPromptRequestedAt === "string" ? out.customPromptRequestedAt : "";
  out.customPromptReadyAt = typeof out.customPromptReadyAt === "string" ? out.customPromptReadyAt : "";
  out.customPromptDeliveredAt = typeof out.customPromptDeliveredAt === "string" ? out.customPromptDeliveredAt : "";
  out.quiz = out.quiz && typeof out.quiz === "object" ? out.quiz : d.quiz;
  if (typeof out.quiz.active !== "boolean") out.quiz.active = false;
  if (!Number.isFinite(Number(out.quiz.idx))) out.quiz.idx = 0;
  if (!Array.isArray(out.quiz.answers)) out.quiz.answers = [];
  return out;
}

async function ensureUser(userId, env, fromLike={}){
  const existing = await getUser(userId, env);
  let st = patchUser(existing||{}, userId);

  let dirty = false;

  // Daily reset 
  const today = kyivDateString();
  if(st.dailyDate !== today){
    st.dailyDate = today;
    st.dailyUsed = 0;
    dirty = true;
  }

  // Monthly reset 
  const monthKey = kyivMonthString();
  if(st.monthKey !== monthKey){
    st.monthKey = monthKey;
    st.monthlyUsed = 0;
    dirty = true;
  }

  // Save username once/when changed
  if(fromLike?.username){
    const u = String(fromLike.username||"").trim();
    if(u && st.username !== u){
      st.username = u;
      dirty = true;
    }
  }

  // Ensure each user has at least one referral code so their referral link is always available in profile.
  // (Per requirement: show each user's referral link in /profile.)
  if (env.BOT_KV) {
    try { st = await ensureReferralCodes(env, st); } catch (e) { console.error("ensureReferralCodes error:", e); }
  }

  // If custom prompt is ready and not delivered, try deliver on any interaction
  try{ await deliverCustomPromptIfReady(env, st); }catch(_e){}

  if(dirty){
    st.updatedAt = nowIso();
    if(env.BOT_KV) await saveUser(userId, st, env);
  }

  return st;
}

function isSubscribed(st){
  if(!st?.subActiveUntil) return false;
  const t = Date.parse(st.subActiveUntil);
  return Number.isFinite(t) && Date.now() < t;
}
async function dailyLimitForUser(st, from, env){
  if(isPrivileged(from, env)) return Infinity;
  const freeLimit = await getFreeDailyLimit(env);
  const subLimit = await getSubDailyLimit(env);
  return isSubscribed(st) ? subLimit : freeLimit;
}

async function monthlyLimitForUser(st, from, env){
  if(isPrivileged(from, env)) return Infinity;
  const lim = await getMonthlyLimit(env);
  return lim;
}

async function canAnalyzeToday(st, from, env){
  if(isPrivileged(from, env)) return true;
  const today = kyivDateString();
  const monthKey = kyivMonthString();
  const dUsed = (st.dailyDate === today) ? (st.dailyUsed||0) : 0;
  const mUsed = (st.monthKey === monthKey) ? (st.monthlyUsed||0) : 0;
  const dLim = await dailyLimitForUser(st, from, env);
  const mLim = await monthlyLimitForUser(st, from, env);
  return dUsed < dLim && mUsed < mLim;
}
function consumeDaily(st, from, env){
  if(isPrivileged(from, env)) return;
  const today = kyivDateString();
  const monthKey = kyivMonthString();
  if(st.dailyDate !== today){ st.dailyDate = today; st.dailyUsed = 0; }
  if(st.monthKey !== monthKey){ st.monthKey = monthKey; st.monthlyUsed = 0; }
  st.dailyUsed = (st.dailyUsed||0) + 1;
  st.monthlyUsed = (st.monthlyUsed||0) + 1;
}
function stPublic(st){
  return {
    userId: st.userId,
    createdAt: st.createdAt,
    dailyDate: st.dailyDate,
    dailyUsed: st.dailyUsed,
    monthKey: st.monthKey,
    monthlyUsed: st.monthlyUsed,
    timeframe: st.timeframe,
    style: st.style,
    risk: st.risk,
    newsEnabled: st.newsEnabled,
    profileName: st.profileName || "",
    experience: st.experience,
    preferredMarket: st.preferredMarket,
    level: st.level,
    suggestedMarket: st.suggestedMarket,
    successfulInvites: st.successfulInvites,
    points: st.points,
    subActiveUntil: st.subActiveUntil,
  };
}

/* ========================== REFERRALS ========================== */
function randCode(len=10){
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out="";
  for(let i=0;i<len;i++) out += alphabet[Math.floor(Math.random()*alphabet.length)];
  return out;
}
async function ensureReferralCodes(env, st){
  if(!env.BOT_KV) return st;
  const existing = new Set((st.refCodes||[]).filter(Boolean));
  const codes = (st.refCodes||[]).slice(0, REF_CODES_PER_USER).filter(Boolean);

  while(codes.length < REF_CODES_PER_USER){
    const c = `mq${randCode(10)}`;
    if(existing.has(c)) continue;
    existing.add(c);
    codes.push(c);
    await env.BOT_KV.put(`ref:${c}`, String(st.userId));
  }
  st.refCodes = codes;
  return st;
}

async function adminGenerateRefCodes(env, targetUserId, count=5){
  if(!env.BOT_KV) throw new Error("kv_required");
  const userId = String(targetUserId||"").trim();
  if(!userId) throw new Error("invalid_userid");

  const key = `u:${userId}`;
  const raw = await env.BOT_KV.get(key);
  let st = raw ? patchUser(safeJsonParse(raw)) : patchUser({ userId });

  // Revoke old codes
  if(Array.isArray(st.refCodes)){
    for(const c of st.refCodes){
      await env.BOT_KV.delete(`ref:${c}`).catch(()=>{});
    }
  }

  const codes = [];
  const n = Math.max(1, Math.min(20, Number(count)||5));
  for(let i=0;i<n;i++){
    // Avoid collisions (best-effort)
    let code = "";
    for(let tries=0; tries<10; tries++){
      code = randCode(8);
      const exists = await env.BOT_KV.get(`ref:${code}`);
      if(!exists) break;
    }
    codes.push(code);
    await env.BOT_KV.put(`ref:${code}`, userId);
  }

  st.refCodes = codes;
  await env.BOT_KV.put(key, JSON.stringify(st));
  return codes;
}

async function lookupReferrerIdByCode(code, env){
  if(!env.BOT_KV) return null;
  const c = String(code||"").trim();
  if(!c) return null;
  const id = await env.BOT_KV.get(`ref:${c}`);
  return id ? String(id) : null;
}
function normalizePhone(p){
  let s = String(p||"").trim();
  s = s.replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  return s;
}
async function bindPhoneToUser(userId, phone, env){
  if(!env.BOT_KV) return { ok:false, reason:"kv_missing" };
  const key = `phone:${phone}`;
  const existing = await env.BOT_KV.get(key);
  if(existing && String(existing) !== String(userId)) return { ok:false, reason:"phone_already_used" };
  await env.BOT_KV.put(key, String(userId));
  return { ok:true };
}

/* ========================== BOT CONFIG (WALLET / PROMPTS / SUBSCRIPTION) ========================== */
const _CFG_MEM = new Map();
function _cfgTtl(env){ return toInt(env.CFG_CACHE_TTL_MS, 60000); }

async function getCfg(env, memKey, kvKey, envFallback=""){
  const now = Date.now();
  const cached = _CFG_MEM.get(memKey);
  if(cached && cached.exp > now) return cached.v;

  let v = "";
  if(env.BOT_KV) v = (await env.BOT_KV.get(kvKey)) || "";
  if(!v) v = (envFallback || "").toString();
  v = String(v || "").trim();

  _CFG_MEM.set(memKey, { v, exp: now + _cfgTtl(env) });
  return v;
}
async function setCfg(env, memKey, kvKey, value){
  const v = String(value || "").trim();
  if(!env.BOT_KV) throw new Error("kv_missing");
  await env.BOT_KV.put(kvKey, v);
  _CFG_MEM.set(memKey, { v, exp: Date.now() + _cfgTtl(env) });
  return v;
}

async function getWallet(env){
  return await getCfg(env, "wallet", "cfg:wallet", env.WALLET_ADDRESS);
}
async function setWallet(env, addr, changedBy){
  const v = String(addr||"").trim();
  if(!v) throw new Error("invalid_wallet");
  // Read previous
  let prev = "";
  try{ prev = await getCfg(env, "wallet", "cfg:wallet", env.WALLET || ""); }catch(_e){ prev = ""; }
  await setCfg(env, "wallet", "cfg:wallet", v);

  // Alert owner if changed
  try{
    const ownerId = String(env.OWNER_ID||"").trim();
    if(ownerId && prev && prev !== v){
      const by = changedBy?.username ? ("@"+String(changedBy.username).replace(/^@/,"")) : (changedBy?.id ? ("ID:"+changedBy.id) : "-");
      const msg =
`🚨 تغییر آدرس ولت

ولت قبلی:
\`${prev}\`

ولت جدید:
\`${v}\`

تغییر توسط: ${by}
زمان: ${new Date().toISOString()}`;
      await tgSendMessage(env, ownerId, msg, null).catch(()=>{});
    }
  }catch(_e){}

  return v;
}

async function getSubPrice(env){
  const v = await getCfg(env, "sub_price", "cfg:sub_price", env.SUB_PRICE);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
async function setSubPrice(env, amount){
  const n = Number(amount);
  if(!Number.isFinite(n) || n <= 0) throw new Error("invalid_price");
  await setCfg(env, "sub_price", "cfg:sub_price", String(n));
  return n;
}
async function getSubCurrency(env){
  const v = await getCfg(env, "sub_currency", "cfg:sub_currency", env.SUB_CURRENCY || "USDT");
  return (v || "USDT").toUpperCase();
}
async function setSubCurrency(env, cur){
  const v = String(cur || "").trim().toUpperCase();
  if(!v) throw new Error("invalid_currency");
  await setCfg(env, "sub_currency", "cfg:sub_currency", v);
  return v;
}
async function getOfferConfig(env){
  const enabled = await getCfg(env, "offer_enabled", "cfg:offer_enabled", env.OFFER_ENABLED || "0");
  const text = await getCfg(env, "offer_text", "cfg:offer_text", env.OFFER_TEXT || "");
  const url = await getCfg(env, "offer_url", "cfg:offer_url", env.OFFER_URL || "");
  return {
    enabled: String(enabled||"0") === "1",
    text: String(text||"").trim(),
    url: String(url||"").trim(),
  };
}
async function setOfferConfig(env, cfg){
  const en = cfg?.enabled ? "1" : "0";
  await setCfg(env, "offer_enabled", "cfg:offer_enabled", en);
  await setCfg(env, "offer_text", "cfg:offer_text", String(cfg?.text||"").trim());
  await setCfg(env, "offer_url", "cfg:offer_url", String(cfg?.url||"").trim());
}

async function getSubDays(env){
  const v = await getCfg(env, "sub_days", "cfg:sub_days", env.SUB_DAYS || "30");
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}
async function setSubDays(env, days){
  const n = Number(days);
  if(!Number.isFinite(n) || n <= 0) throw new Error("invalid_days");
  await setCfg(env, "sub_days", "cfg:sub_days", String(Math.floor(n)));
  return Math.floor(n);
}


// Global daily limits (configurable by Admin/Owner via commands)
async function getFreeDailyLimit(env){
  const v = await getCfg(env, "free_daily_limit", "cfg:free_daily_limit", env.FREE_DAILY_LIMIT || String(DEFAULT_DAILY_LIMIT));
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_LIMIT;
}
async function setFreeDailyLimit(env, limit){
  const n = Number(limit);
  if(!Number.isFinite(n) || n < 0) throw new Error("invalid_free_limit");
  await setCfg(env, "free_daily_limit", "cfg:free_daily_limit", String(Math.floor(n)));
  return Math.floor(n);
}
async function getSubDailyLimit(env){
  const v = await getCfg(env, "sub_daily_limit", "cfg:sub_daily_limit", env.SUB_DAILY_LIMIT || String(DEFAULT_DAILY_LIMIT));
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_LIMIT;
}
async function setSubDailyLimit(env, limit){
  const n = Number(limit);
  if(!Number.isFinite(n) || n <= 0) throw new Error("invalid_sub_limit");
  await setCfg(env, "sub_daily_limit", "cfg:sub_daily_limit", String(Math.floor(n)));
  return Math.floor(n);
}


async function getMonthlyLimit(env){
  const v = await getCfg(env, "monthly_limit", "cfg:monthly_limit", env.MONTHLY_LIMIT || String(DEFAULT_MONTHLY_LIMIT));
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MONTHLY_LIMIT;
}
async function setMonthlyLimit(env, limit){
  const n = Number(limit);
  if(!Number.isFinite(n) || n <= 0) throw new Error("invalid_monthly_limit");
  await setCfg(env, "monthly_limit", "cfg:monthly_limit", String(Math.floor(n)));
  return Math.floor(n);
}

/* ========================== PAYMENTS (Manual Crypto, TxID) ========================== */
function normalizeTxId(txid){
  return String(txid||"").trim().replace(/\s+/g, "");
}

function addDaysToIso(iso, days){
  const n = Number(days);
  const now = new Date();
  const base = (iso && new Date(iso) > now) ? new Date(iso) : now;
  base.setUTCDate(base.getUTCDate() + Math.floor(n));
  return base.toISOString();
}

async function createPendingPayment(env, userId, txid){
  if(!env.BOT_KV) throw new Error("kv_required");
  const clean = normalizeTxId(txid);
  if(clean.length < 6) throw new Error("invalid_txid");

  const exists = await env.BOT_KV.get(`pay:tx:${clean}`);
  if(exists) throw new Error("txid_exists");

  const price = await getSubPrice(env);
  const currency = await getSubCurrency(env);
  const days = await getSubDays(env);

  const rec = {
    txid: clean,
    userId: String(userId),
    amount: price,
    currency,
    days,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  await env.BOT_KV.put(`pay:pending:${clean}`, JSON.stringify(rec));
  await env.BOT_KV.put(`pay:tx:${clean}`, "pending");
  return rec;
}

async function markPaymentApproved(env, txid, approvedBy){
  if(!env.BOT_KV) throw new Error("kv_required");
  const clean = normalizeTxId(txid);

  const raw = await env.BOT_KV.get(`pay:pending:${clean}`);
  if(!raw) throw new Error("payment_not_found");
  const rec = safeJsonParse(raw);
  if(!rec) throw new Error("payment_corrupt");

  rec.status = "approved";
  rec.approvedAt = new Date().toISOString();
  rec.approvedBy = approvedBy ? String(approvedBy) : "";

  await env.BOT_KV.delete(`pay:pending:${clean}`);
  await env.BOT_KV.put(`pay:approved:${clean}`, JSON.stringify(rec));
  await env.BOT_KV.put(`pay:tx:${clean}`, "approved");

  // Activate subscription for user
  const userKey = `u:${rec.userId}`;
  const stRaw = await env.BOT_KV.get(userKey);
  let st = stRaw ? patchUser(safeJsonParse(stRaw)) : patchUser({ userId: rec.userId });
  st.subActiveUntil = addDaysToIso(st.subActiveUntil, rec.days);
  st.points = (st.points||0) + getSubPointsPerSub(env);
  st.lastPaymentTx = clean;
  st.lastPaymentStatus = "approved";

  await env.BOT_KV.put(userKey, JSON.stringify(st));

  // Referral commission (tiered, up to 20%) if qualified
  function referralCommissionPct(invites){
    const n = Number(invites||0);
    if(!Number.isFinite(n) || n <= 0) return 0;
    const step = toInt(env.REF_COMMISSION_STEP_PCT, 4);
    const maxPct = toInt(env.REF_COMMISSION_MAX_PCT, 20);
    return Math.min(maxPct, Math.floor(n) * step); // 1->step%, ... 5->max%
  }
  if(st.referrerId){
    try{
      const refKey = `u:${st.referrerId}`;
      const refRaw = await env.BOT_KV.get(refKey);
      if(refRaw){
        let refSt = patchUser(safeJsonParse(refRaw));
                const pct = referralCommissionPct(refSt.successfulInvites);
        const commission = Number(rec.amount) * (pct/100);
        refSt.refCommissionTotal = Number(refSt.refCommissionTotal||0) + (Number.isFinite(commission)?commission:0);
        await env.BOT_KV.put(refKey, JSON.stringify(refSt));
      }
    }catch(_e){}
  }

  return rec;
}

async function markPaymentRejected(env, txid, rejectedBy){
  if(!env.BOT_KV) throw new Error("kv_required");
  const clean = normalizeTxId(txid);

  const raw = await env.BOT_KV.get(`pay:pending:${clean}`);
  if(!raw) throw new Error("payment_not_found");
  const rec = safeJsonParse(raw);
  if(!rec) throw new Error("payment_corrupt");

  rec.status = "rejected";
  rec.rejectedAt = new Date().toISOString();
  rec.rejectedBy = rejectedBy ? String(rejectedBy) : "";

  await env.BOT_KV.delete(`pay:pending:${clean}`);
  await env.BOT_KV.put(`pay:rejected:${clean}`, JSON.stringify(rec));
  await env.BOT_KV.put(`pay:tx:${clean}`, "rejected");

  // Store status in user (optional)
  const userKey = `u:${rec.userId}`;
  const stRaw = await env.BOT_KV.get(userKey);
  if(stRaw){
    let st = patchUser(safeJsonParse(stRaw));
    st.lastPaymentTx = clean;
    st.lastPaymentStatus = "rejected";
    await env.BOT_KV.put(userKey, JSON.stringify(st));
  }

  return rec;
}

async function listPendingPayments(env, limit=20, cursor=null){
  if(!env.BOT_KV) throw new Error("kv_required");
  const res = await env.BOT_KV.list({ prefix: "pay:pending:", limit, cursor: cursor || undefined });
  const items = [];
  for(const k of res.keys){
    const raw = await env.BOT_KV.get(k.name);
    const rec = safeJsonParse(raw);
    if(rec) items.push(rec);
  }
  return { items, cursor: res.cursor, list_complete: res.list_complete };
}


async function getAnalysisPromptTemplate(env){
  const p = await getCfg(env, "analysis_prompt", "cfg:analysis_prompt", "");
  return p ? p : null;
}
async function setAnalysisPromptTemplate(env, prompt){
  return await setCfg(env, "analysis_prompt", "cfg:analysis_prompt", prompt);
}
async function getVisionPromptTemplate(env){
  const p = await getCfg(env, "vision_prompt", "cfg:vision_prompt", "");
  return p ? p : null;
}
async function setVisionPromptTemplate(env, prompt){
  return await setCfg(env, "vision_prompt", "cfg:vision_prompt", prompt);
}

/* ========================== TELEGRAM API ========================== */
async function tgApi(env, method, payload, isMultipart=false){
  const _token = (env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN || env.TELEGRAM_TOKEN || env.BOT_API_TOKEN || "").toString().trim();
  if(!_token) throw new Error("missing_bot_token_env");
  const url = `https://api.telegram.org/bot${_token}/${method}`;
  const r = isMultipart
    ? await fetch(url, { method:"POST", body: payload })
    : await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });

  const j = await r.json().catch(()=>null);
  if(!j || !j.ok) console.error("Telegram API error:", method, j);
  return j;
}
async function tgSendMessage(env, chatId, text, replyMarkup){
  return tgApi(env, "sendMessage", {
    chat_id: chatId,
    text: String(text).slice(0,3900),
    reply_markup: replyMarkup,
    disable_web_page_preview: true,
  });
}
async function tgSendChatAction(env, chatId, action){
  return tgApi(env, "sendChatAction", { chat_id: chatId, action });
}
async function tgGetFilePath(env, fileId){
  const j = await tgApi(env, "getFile", { file_id: fileId });
  return j?.result?.file_path || "";
}
async function tgSendPhotoByUrl(env, chatId, photoUrl, caption=""){
  return tgApi(env, "sendPhoto", { chat_id: chatId, photo: photoUrl, caption: caption ? String(caption).slice(0,900) : undefined });
}

/* ========================== TYPING LOOP ========================== */
function stopToken(){ return { stop:false }; }
async function typingLoop(env, chatId, token){
  while(!token.stop){
    await tgSendChatAction(env, chatId, "typing");
    await sleep(TYPING_INTERVAL_MS);
  }
}

/* ========================== IMAGE PICKING ========================== */
function extractImageFileId(msg, env){
  if (msg.photo && msg.photo.length) {
    const maxBytes = Number(env.VISION_MAX_BYTES || 900000);
    const sorted = [...msg.photo].sort((a,b)=>(a.file_size||0)-(b.file_size||0));
    let best = null;
    for(const p of sorted){ if((p.file_size||0) <= maxBytes) best = p; }
    if(!best) best = sorted[0];
    return best?.file_id || "";
  }
  if(msg.document && msg.document.mime_type?.startsWith("image/")) return msg.document.file_id || "";
  return "";
}

/* ========================== PROMPTS (DEFAULTS) ========================== */
function institutionalPrompt(timeframe="H4"){
  return `SYSTEM OVERRIDE: ACTIVATE INSTITUTIONAL MODE

ROLE: You are an elite “Liquidity Hunter Algorithm” tracking Smart Money.
INPUT CONTEXT: ${timeframe} Timeframe Chart.

MINDSET
Retail traders predict. Whales react.
Focus on Liquidity Pools (Targets) and Imbalances (Magnets).
Crucial: Determine what happens AT the target level (Reversal vs. Continuation).

ANALYSIS PROTOCOL
LIQUIDITY MAPPING: Where are the Stop Losses? (The Target).
MANIPULATION DETECTOR: Identify recent traps/fake-outs.
INSTITUTIONAL FOOTPRINT: Locate Order Blocks/FVGs (The Defense Wall).
THE KILL ZONE: Predict the next move to the liquidity pool.
REACTION LOGIC (THE MOST IMPORTANT PART): Analyze the specific target level. What specifically needs to happen for a “Reversal” (Sweep) vs a “Collapse” (Breakout)?

OUTPUT FORMAT (STRICTLY PERSIAN - فارسی)
Use a sharp, revealing, and “whistle-blower” tone.

۱. نقشه پول‌های پارک‌شده (شکارگاه نهنگ‌ها):
۲. تله‌های قیمتی اخیر (فریب بازار):
۳. ردپای ورود پول هوشمند (دیوار بتنی):
۴. سناریوی بی‌رحمانه بعدی (مسیر احتمالی):
۵. استراتژی لحظه برخورد (ماشه نهایی):

سناریوی بازگشت (Reversal):
سناریوی سقوط/صعود (Continuation):`;
}

/* ========================== PROVIDERS ========================== */
async function runTextProviders(prompt, env, orderOverride){
  const chain = parseOrder(orderOverride || env.TEXT_PROVIDER_ORDER, ["cf","openai","gemini"]);
  let lastErr=null;
  for(const p of chain){
    try{
      const out = await Promise.race([ textProvider(p, prompt, env), timeoutPromise(TIMEOUT_TEXT_MS, `text_${p}_timeout`) ]);
      if(out && String(out).trim()) return String(out).trim();
    } catch(e){ lastErr=e; console.error("text provider failed:", p, e?.message||e); }
  }
  throw lastErr || new Error("all_text_providers_failed");
}
async function runPolishProviders(draft, env, orderOverride){
  const raw = (orderOverride || env.POLISH_PROVIDER_ORDER || "").toString().trim();
  if(!raw) return draft;
  const chain = parseOrder(raw, ["openai","cf","gemini"]);
  const polishPrompt =
    `تو یک ویراستار سخت‌گیر فارسی هستی. متن زیر را فقط “سفت‌وسخت” کن:
`+
    `- فقط فارسی
- قالب شماره‌دار ۱ تا ۵ حفظ شود
- لحن افشاگر/تیز
- اضافه‌گویی حذف
- خیال‌بافی نکن

`+
    `متن:
${draft}`;
  for(const p of chain){
    try{
      const out = await Promise.race([ textProvider(p, polishPrompt, env), timeoutPromise(TIMEOUT_POLISH_MS, `polish_${p}_timeout`) ]);
      if(out && String(out).trim()) return String(out).trim();
    } catch(e){ console.error("polish provider failed:", p, e?.message||e); }
  }
  return draft;
}
async function runVisionProviders(imageUrl, visionPrompt, env, orderOverride){
  const chain = parseOrder(orderOverride || env.VISION_PROVIDER_ORDER, ["openai","cf","gemini","hf"]);
  const totalBudget = Number(env.VISION_TOTAL_BUDGET_MS || 20000);
  const deadline = Date.now() + totalBudget;
  let lastErr=null;
  let cached=null;
  for(const p of chain){
    const remaining = deadline - Date.now();
    if(remaining <= 500) break;
    try{
      if((p==="cf"||p==="gemini"||p==="hf") && cached?.tooLarge) continue;
      const out = await Promise.race([
        visionProvider(p, imageUrl, visionPrompt, env, ()=>cached, (c)=>cached=c),
        timeoutPromise(Math.min(TIMEOUT_VISION_MS, remaining), `vision_${p}_timeout`)
      ]);
      if(out && String(out).trim()) return String(out).trim();
    } catch(e){ lastErr=e; console.error("vision provider failed:", p, e?.message||e); }
  }
  throw lastErr || new Error("all_vision_providers_failed_or_budget_exceeded");
}

async function textProvider(name, prompt, env){
  name = String(name||"").toLowerCase();
  if(name==="cf"){
    if(!env.AI) throw new Error("AI_binding_missing");
    const out = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages:[{role:"user", content: prompt}], max_tokens:900, temperature:0.25 });
    return out?.response || out?.result || "";
  }
  if(name==="openai"){
    if(!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_missing");
    const r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method:"POST",
      headers:{ Authorization:`Bearer ${env.OPENAI_API_KEY}`, "Content-Type":"application/json" },
      body: JSON.stringify({ model: env.OPENAI_TEXT_MODEL || "gpt-4o-mini", messages:[{role:"user", content: prompt}], temperature:0.25 })
    }, TIMEOUT_TEXT_MS);
    const j = await r.json().catch(()=>null);
    return j?.choices?.[0]?.message?.content || "";
  }
  if(name==="gemini"){
    if(!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY_missing");
    const r = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_TEXT_MODEL || "gemini-1.5-flash")}:generateContent?key=${env.GEMINI_API_KEY}`,
      { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ contents:[{parts:[{text: prompt}]}], generationConfig:{ temperature:0.25, maxOutputTokens:900 } }) },
      TIMEOUT_TEXT_MS
    );
    const j = await r.json().catch(()=>null);
    return j?.candidates?.[0]?.content?.parts?.map(p=>p.text).join("") || "";
  }
  throw new Error(`unknown_text_provider:${name}`);
}

function detectMimeFromHeaders(resp, fallback="image/jpeg"){
  const ct = resp.headers.get("content-type") || "";
  if(ct.startsWith("image/")) return ct.split(";")[0].trim();
  return fallback;
}
function arrayBufferToBase64(buf){
  const bytes = new Uint8Array(buf);
  let binary="";
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk){
    binary += String.fromCharCode(...bytes.subarray(i, i+chunk));
  }
  return btoa(binary);
}
async function ensureImageCache(imageUrl, env, getCache, setCache){
  const cur=getCache();
  if(cur?.buf && cur?.mime) return cur;
  const maxBytes = Number(env.VISION_MAX_BYTES || 900000);
  const resp = await fetchWithTimeout(imageUrl, {}, TIMEOUT_VISION_MS);
  const len = Number(resp.headers.get("content-length") || "0");
  if(len && len > maxBytes){ const c={ tooLarge:true, mime:"image/jpeg" }; setCache(c); return c; }
  const mime = detectMimeFromHeaders(resp, "image/jpeg");
  const buf = await resp.arrayBuffer();
  if(buf.byteLength > maxBytes){ const c={ tooLarge:true, mime }; setCache(c); return c; }
  const u8 = new Uint8Array(buf);
  const base64 = arrayBufferToBase64(buf);
  const c = { buf, mime, base64, u8, tooLarge:false };
  setCache(c);
  return c;
}

async function visionProvider(name, imageUrl, visionPrompt, env, getCache, setCache){
  name = String(name||"").toLowerCase();
  if(name==="openai"){
    if(!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_missing");
    const body = {
      model: env.OPENAI_VISION_MODEL || (env.OPENAI_TEXT_MODEL || "gpt-4o-mini"),
      messages:[{ role:"user", content:[{type:"text", text: visionPrompt},{type:"image_url", image_url:{ url:imageUrl }}] }],
      temperature:0.2
    };
    const r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method:"POST",
      headers:{ Authorization:`Bearer ${env.OPENAI_API_KEY}`, "Content-Type":"application/json" },
      body: JSON.stringify(body)
    }, TIMEOUT_VISION_MS);
    const j = await r.json().catch(()=>null);
    return j?.choices?.[0]?.message?.content || "";
  }
  if(name==="cf"){
    if(!env.AI) throw new Error("AI_binding_missing");
    const c = await ensureImageCache(imageUrl, env, getCache, setCache);
    if(c.tooLarge) return "";
    const bytesArr = [...c.u8];
    const out = await env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", { image: bytesArr, prompt: visionPrompt });
    return out?.description || out?.response || out?.result || "";
  }
  if(name==="gemini"){
    if(!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY_missing");
    const c = await ensureImageCache(imageUrl, env, getCache, setCache);
    if(c.tooLarge) return "";
    const r = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_VISION_MODEL || "gemini-1.5-flash")}:generateContent?key=${env.GEMINI_API_KEY}`,
      { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ contents:[{ parts:[{ text: visionPrompt },{ inlineData:{ mimeType: c.mime, data: c.base64 } }] }], generationConfig:{ temperature:0.2, maxOutputTokens:900 } }) },
      TIMEOUT_VISION_MS
    );
    const j = await r.json().catch(()=>null);
    return j?.candidates?.[0]?.content?.parts?.map(p=>p.text).join("") || "";
  }
  if(name==="hf"){
    if(!env.HF_API_KEY) throw new Error("HF_API_KEY_missing");
    const model = (env.HF_VISION_MODEL || "Salesforce/blip-image-captioning-large").toString().trim();
    const c = await ensureImageCache(imageUrl, env, getCache, setCache);
    if(c.tooLarge) return "";
    const r = await fetchWithTimeout(
      `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`,
      { method:"POST", headers:{ Authorization:`Bearer ${env.HF_API_KEY}`, "Content-Type":"application/octet-stream" }, body: c.u8 },
      TIMEOUT_VISION_MS
    );
    const j = await r.json().catch(()=>null);
    const txt = Array.isArray(j) ? j?.[0]?.generated_text : (j?.generated_text || j?.text);
    return txt ? String(txt) : "";
  }
  throw new Error(`unknown_vision_provider:${name}`);
}

/* ========================== MARKET DATA ========================== */
function assetKind(symbol){
  if(symbol.endsWith("USDT")) return "crypto";
  if(/^[A-Z]{6}$/.test(symbol)) return "forex";
  if(symbol==="XAUUSD"||symbol==="XAGUSD") return "metal";
  if(symbol==="DJI"||symbol==="NDX"||symbol==="SPX") return "index";
  if(STOCKS.includes(symbol)) return "stock";
  return "unknown";
}
function mapTimeframeToBinance(tf){ return ({M15:"15m",H1:"1h",H4:"4h",D1:"1d"})[tf] || "4h"; }
function mapTimeframeToTwelve(tf){ return ({M15:"15min",H1:"1h",H4:"4h",D1:"1day"})[tf] || "4h"; }
function mapForexSymbolForTwelve(symbol){
  if(/^[A-Z]{6}$/.test(symbol)) return `${symbol.slice(0,3)}/${symbol.slice(3,6)}`;
  if(symbol==="XAUUSD") return "XAU/USD";
  if(symbol==="XAGUSD") return "XAG/USD";
  return symbol;
}
function mapTimeframeToAlphaVantage(tf){ return ({M15:"15min",H1:"60min"})[tf] || "60min"; }
function toYahooSymbol(symbol){
  if(/^[A-Z]{6}$/.test(symbol)) return `${symbol}=X`;
  if(symbol.endsWith("USDT")) return `${symbol.replace("USDT","-USD")}`;
  if(symbol==="XAUUSD") return "XAUUSD=X";
  if(symbol==="XAGUSD") return "XAGUSD=X";
  return symbol;
}
function yahooInterval(tf){ return ({M15:"15m",H1:"60m",H4:"240m",D1:"1d"})[tf] || "240m"; }

async function fetchBinanceCandles(symbol, timeframe, limit, timeoutMs, env){
  if(!symbol.endsWith("USDT")) throw new Error("binance_not_crypto");
  const interval = mapTimeframeToBinance(timeframe);
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const headers = { "User-Agent": "Mozilla/5.0" };
  if(env?.BINANCE_API_KEY) headers["X-MBX-APIKEY"] = env.BINANCE_API_KEY;
  const r = await fetchWithTimeout(url, { headers }, timeoutMs);
  if(!r.ok) throw new Error(`binance_http_${r.status}`);
  const data = await r.json();
  return data.map(k => ({ t:k[0], o:Number(k[1]), h:Number(k[2]), l:Number(k[3]), c:Number(k[4]), v:Number(k[5]) }));
}

async function fetchBinanceTicker24h(symbol, timeoutMs, cacheTtlSec=60){
  if(!symbol.endsWith("USDT")) return null;
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
  const cacheKey = new Request(url, { method: "GET" });

  try{
    const cached = await caches.default.match(cacheKey);
    if(cached){
      const j = await cached.json().catch(()=>null);
      if(j) return j;
    }
  }catch{}

  const r = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" } }, timeoutMs);
  if(!r.ok) throw new Error(`binance_ticker_http_${r.status}`);
  const j = await r.json().catch(()=>null);
  if(!j) return null;

  const data = {
    last: Number(j.lastPrice),
    changePct: Number(j.priceChangePercent),
    high: Number(j.highPrice),
    low: Number(j.lowPrice),
    vol: Number(j.volume),
  };

  caches.default.put(cacheKey, new Response(JSON.stringify(data), {
    headers: { "content-type":"application/json; charset=utf-8", "cache-control": `public, max-age=${cacheTtlSec}` }
  })).catch(()=>{});

  return data;
}

async function fetchTwelveDataCandles(symbol, timeframe, limit, timeoutMs, env){
  if(!env.TWELVEDATA_API_KEY) throw new Error("twelvedata_key_missing");
  if(assetKind(symbol)==="unknown") throw new Error("twelvedata_unknown_symbol");
  const interval = mapTimeframeToTwelve(timeframe);
  const sym = mapForexSymbolForTwelve(symbol);
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(interval)}&outputsize=${limit}&apikey=${encodeURIComponent(env.TWELVEDATA_API_KEY)}`;
  const headers = { "User-Agent": "Mozilla/5.0" };
  if(env?.BINANCE_API_KEY) headers["X-MBX-APIKEY"] = env.BINANCE_API_KEY;
  const r = await fetchWithTimeout(url, { headers }, timeoutMs);
  if(!r.ok) throw new Error(`twelvedata_http_${r.status}`);
  const j = await r.json();
  if(j.status==="error") throw new Error(`twelvedata_err_${j.code||""}`);
  const values = Array.isArray(j.values) ? j.values : [];
  return values.reverse().map(v => ({ t: Date.parse(v.datetime+"Z")||Date.now(), o:Number(v.open), h:Number(v.high), l:Number(v.low), c:Number(v.close), v: v.volume?Number(v.volume):null }));
}
async function fetchAlphaVantageFxIntraday(symbol, timeframe, limit, timeoutMs, env){
  if(!env.ALPHAVANTAGE_API_KEY) throw new Error("alphavantage_key_missing");
  if(!/^[A-Z]{6}$/.test(symbol) && symbol!=="XAUUSD" && symbol!=="XAGUSD") throw new Error("alphavantage_only_fx_like");
  const from = symbol.slice(0,3), to = symbol.slice(3,6);
  const interval = mapTimeframeToAlphaVantage(timeframe);
  const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${encodeURIComponent(from)}&to_symbol=${encodeURIComponent(to)}&interval=${encodeURIComponent(interval)}&outputsize=compact&apikey=${encodeURIComponent(env.ALPHAVANTAGE_API_KEY)}`;
  const headers = { "User-Agent": "Mozilla/5.0" };
  if(env?.BINANCE_API_KEY) headers["X-MBX-APIKEY"] = env.BINANCE_API_KEY;
  const r = await fetchWithTimeout(url, { headers }, timeoutMs);
  if(!r.ok) throw new Error(`alphavantage_http_${r.status}`);
  const j = await r.json();
  const key = Object.keys(j).find(k=>k.startsWith("Time Series FX"));
  if(!key) throw new Error("alphavantage_no_timeseries");
  const ts = j[key];
  return Object.entries(ts).slice(0,limit).map(([dt,v]) => ({ t: Date.parse(dt+"Z")||Date.now(), o:Number(v["1. open"]), h:Number(v["2. high"]), l:Number(v["3. low"]), c:Number(v["4. close"]), v:null })).reverse();
}
function mapTimeframeToFinnhubResolution(tf){ return ({M15:"15",H1:"60",H4:"240",D1:"D"})[tf] || "240"; }
async function fetchFinnhubForexCandles(symbol, timeframe, limit, timeoutMs, env){
  if(!env.FINNHUB_API_KEY) throw new Error("finnhub_key_missing");
  if(!/^[A-Z]{6}$/.test(symbol)) throw new Error("finnhub_only_forex");
  const res = mapTimeframeToFinnhubResolution(timeframe);
  const inst = `OANDA:${symbol.slice(0,3)}_${symbol.slice(3,6)}`;
  const now = Math.floor(Date.now()/1000);
  const from = now - 60*60*24*10;
  const url = `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(inst)}&resolution=${encodeURIComponent(res)}&from=${from}&to=${now}&token=${encodeURIComponent(env.FINNHUB_API_KEY)}`;
  const headers = { "User-Agent": "Mozilla/5.0" };
  if(env?.BINANCE_API_KEY) headers["X-MBX-APIKEY"] = env.BINANCE_API_KEY;
  const r = await fetchWithTimeout(url, { headers }, timeoutMs);
  if(!r.ok) throw new Error(`finnhub_http_${r.status}`);
  const j = await r.json();
  if(j.s!=="ok") throw new Error(`finnhub_status_${j.s}`);
  const candles = j.t.map((t,i)=>({ t:t*1000, o:Number(j.o[i]), h:Number(j.h[i]), l:Number(j.l[i]), c:Number(j.c[i]), v:j.v?Number(j.v[i]):null }));
  return candles.slice(-limit);
}
async function fetchYahooChartCandles(symbol, timeframe, limit, timeoutMs){
  const interval = yahooInterval(timeframe);
  const ysym = toYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?interval=${encodeURIComponent(interval)}&range=10d`;
  const r = await fetchWithTimeout(url, { headers:{ "User-Agent":"Mozilla/5.0" } }, timeoutMs);
  if(!r.ok) throw new Error(`yahoo_http_${r.status}`);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  const ts = result?.timestamp || [];
  const q = result?.indicators?.quote?.[0];
  if(!ts.length || !q) throw new Error("yahoo_no_data");
  const candles = ts.map((t,i)=>({ t:t*1000, o:Number(q.open?.[i]), h:Number(q.high?.[i]), l:Number(q.low?.[i]), c:Number(q.close?.[i]), v:q.volume?.[i]!=null?Number(q.volume[i]):null })).filter(x=>Number.isFinite(x.c));
  return candles.slice(-limit);
}
async function getMarketCandlesWithFallback(env, symbol, timeframe){
  const timeoutMs = Number(env.MARKET_DATA_TIMEOUT_MS || 7000);
  const limit = Number(env.MARKET_DATA_CANDLES_LIMIT || 120);

  // Cache market data to scale for high user counts (e.g., 100k users)
  const cacheTtlSec = toInt(env.MARKET_CACHE_TTL_SEC, 20);
  const cache = (typeof caches !== "undefined") ? caches.default : null;
  const cacheKey = cache
    ? new Request(`https://cache.local/market?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(timeframe)}&limit=${limit}`)
    : null;

  if(cache && cacheTtlSec > 0 && cacheKey){
    try{
      const hit = await cache.match(cacheKey);
      if(hit){
        const data = await hit.json().catch(()=>null);
        if(Array.isArray(data) && data.length) return data;
      }
    }catch(_e){ /* ignore cache errors */ }
  }

  const chain = parseOrder(env.MARKET_DATA_PROVIDER_ORDER, ["binance","twelvedata","alphavantage","finnhub","yahoo"]);
  let lastErr=null;

  for(const p of chain){
    try{
      let candles = null;

      if(p==="binance") candles = await fetchBinanceCandles(symbol, timeframe, limit, timeoutMs, env);
      if(p==="twelvedata") candles = await fetchTwelveDataCandles(symbol, timeframe, limit, timeoutMs, env);
      if(p==="alphavantage") candles = await fetchAlphaVantageFxIntraday(symbol, timeframe, limit, timeoutMs, env);
      if(p==="finnhub") candles = await fetchFinnhubForexCandles(symbol, timeframe, limit, timeoutMs, env);
      if(p==="yahoo") candles = await fetchYahooChartCandles(symbol, timeframe, limit, timeoutMs);

      if(candles && candles.length){
        if(cache && cacheTtlSec > 0 && cacheKey){
          const resp = new Response(JSON.stringify(candles), {
            headers:{
              "content-type":"application/json; charset=utf-8",
              "cache-control":`public, max-age=${cacheTtlSec}`
            }
          });
          // don't block the user response on cache put
          cache.put(cacheKey, resp).catch(()=>{});
        }
        return candles;
      }
    }catch(e){
      lastErr = e;
      console.error("market provider failed:", p, e?.message || e);
    }
  }

  throw lastErr || new Error("market_data_all_failed");
}

function computeSnapshot(candles){
  if(!candles?.length) return null;
  const last = candles[candles.length-1];
  const prev = candles[candles.length-2] || last;
  const closes = candles.map(x=>x.c);
  const sma = (arr,p)=>{ if(arr.length<p) return null; const s=arr.slice(-p).reduce((a,b)=>a+b,0); return s/p; };
  const sma20 = sma(closes,20);
  const sma50 = sma(closes,50);
  const trend = (sma20 && sma50) ? (sma20 > sma50 ? "صعودی" : "نزولی") : "نامشخص";
  const n = Math.min(50, candles.length);
  const recent = candles.slice(-n);
  const hi = Math.max(...recent.map(x=>x.h));
  const lo = Math.min(...recent.map(x=>x.l));
  const lastClose = last.c;
  const changePct = prev?.c ? ((lastClose - prev.c) / prev.c) * 100 : 0;
  return { lastPrice:lastClose, changePct:Number(changePct.toFixed(3)), trend, range50:{hi,lo}, sma20:sma20?Number(sma20.toFixed(6)):null, sma50:sma50?Number(sma50.toFixed(6)):null, lastTs:last.t };
}
function candlesToCompactCSV(candles, maxRows=80){
  const tail = candles.slice(-maxRows);
  return tail.map(x=>`${x.t},${x.o},${x.h},${x.l},${x.c}`).join("\n");
}


/* ========================== NEWS (newsdata.io) ========================== */
// Map symbols to reasonable news queries
function newsQueryForSymbol(symbol){
  symbol = String(symbol||"").toUpperCase().trim();
  if(!symbol) return "";

  // Crypto base names
  if(symbol.endsWith("USDT")){
    const base = symbol.replace("USDT","");
    const map = {
      BTC:"Bitcoin", ETH:"Ethereum", BNB:"Binance Coin", SOL:"Solana", XRP:"Ripple",
      ADA:"Cardano", DOGE:"Dogecoin", TRX:"Tron", TON:"Toncoin", AVAX:"Avalanche",
      LINK:"Chainlink", DOT:"Polkadot", MATIC:"Polygon", LTC:"Litecoin", BCH:"Bitcoin Cash",
    };
    const name = map[base] || base;
    return `${name} crypto`;
  }

  // Forex pairs
  if(/^[A-Z]{6}$/.test(symbol)){
    const map = {
      EURUSD:"Euro Dollar", GBPUSD:"British Pound Dollar", USDJPY:"USD JPY Yen", USDCHF:"USD CHF Swiss Franc",
      AUDUSD:"Australian Dollar", USDCAD:"Canadian Dollar", NZDUSD:"New Zealand Dollar"
    };
    return `${map[symbol] || symbol} forex`;
  }

  // Metals
  if(symbol === "XAUUSD") return "Gold price";
  if(symbol === "XAGUSD") return "Silver price";

  // Indices
  if(symbol === "SPX") return "S&P 500";
  if(symbol === "NDX") return "Nasdaq 100";
  if(symbol === "DJI") return "Dow Jones";

  return symbol;
}

// NewsData.io timeframe supports 1-48 hours OR minutes with "m" suffix
function newsTimeframeParam(tf){
  tf = String(tf||"").toUpperCase().trim();
  if(tf === "M15") return "240m";  // ~4h
  if(tf === "H1")  return "12";    // 12h
  if(tf === "H4")  return "24";    // 24h
  if(tf === "D1")  return "48";    // 48h
  return "24";
}

async function fetchNewsHeadlines(env, symbol, timeframe){
  try{
    if(!env.NEWSDATA_API_KEY) return [];
    const q = newsQueryForSymbol(symbol);
    if(!q) return [];

    const lang = (env.NEWS_LANGUAGE || "en").toString().trim() || "en";
    const cat  = (env.NEWS_CATEGORY || "business").toString().trim() || "business";
    const tf   = newsTimeframeParam(timeframe);

    const url =
      `https://newsdata.io/api/1/latest?apikey=${encodeURIComponent(env.NEWSDATA_API_KEY)}` +
      `&q=${encodeURIComponent(q)}` +
      `&language=${encodeURIComponent(lang)}` +
      `&category=${encodeURIComponent(cat)}` +
      `&timeframe=${encodeURIComponent(tf)}`;

    const cacheKey = new Request(url, { method: "GET" });
    try{
      const cached = await caches.default.match(cacheKey);
      if(cached){
        const j = await cached.json().catch(()=>null);
        if(Array.isArray(j)) return j;
      }
    }catch{}

    const timeoutMs = toInt(env.NEWS_TIMEOUT_MS, 6000);
    const r = await fetchWithTimeout(url, {}, timeoutMs);
    if(!r.ok) return [];
    const j = await r.json().catch(()=>null);
    const results = Array.isArray(j?.results) ? j.results : [];

    const items = results.slice(0, 10).map(x => ({
      title: String(x?.title||"").trim(),
      source: String(x?.source_id||x?.source||"").trim(),
      pubDate: String(x?.pubDate||x?.pubdate||"").trim(),
      link: String(x?.link||x?.url||"").trim(),
    })).filter(x => x.title);

    const ttl = toInt(env.NEWS_CACHE_TTL_SEC, 600);
    caches.default.put(cacheKey, new Response(JSON.stringify(items), {
      headers: { "content-type":"application/json; charset=utf-8", "cache-control": `public, max-age=${ttl}` }
    })).catch(()=>{});

    return items;
  }catch(e){
    console.error("news fetch failed:", e?.message || e);
    return [];
  }
}

function formatNewsForPrompt(headlines, maxItems=5){
  const list = Array.isArray(headlines) ? headlines.slice(0, maxItems) : [];
  if(!list.length) return "NEWS_HEADLINES: (none)";
  const lines = list.map(h => `- ${h.source ? "["+h.source+"] " : ""}${h.title}${h.pubDate ? " ("+h.pubDate+")" : ""}`);
  return "NEWS_HEADLINES:\n" + lines.join("\n");
}


const STYLE_DEFAULT_PROMPTS = {
  "RTM": `رویکرد RTM:
- تمرکز روی ساختار بازار، نواحی برگشتی و تایید کندلی.
- ناحیه‌ها را به صورت Zone (Low/High) بده و تایید ورود را دقیق بنویس.
- ستاپ را در قالب: ناحیه → تریگر → ابطال → تارگت‌ها ارائه کن.`,
  "ICT": `رویکرد ICT:
- ساختار (Market Structure), Liquidity, FVG/OB و PD Arrays.
- نواحی OB/FVG را با بازه دقیق قیمت مشخص کن.
- سناریوها را: لایکوئیدیتی هانت → ری‌اکیومولیشن/ری‌دیستریبیشن → حرکت اصلی توضیح بده.`,
  "پرایس اکشن": `رویکرد پرایس اکشن:
- روند/ساختار، شکست/ری‌تست، الگوهای کندلی (Pin/Engulf) و سطوح کلیدی.
- حتماً شرط ورود را بر اساس Close/Wick بنویس.
- ریسک‌به‌ریوارد و نقاط ابطال را شفاف بده.`,
  "پرامپت": `رویکرد پرامپت (General Trading Prompt):
- خروجی را ساختارمند و قابل اجرا بده.
- اگر داده کافی نیست، صریح بگو و پیشنهاد تغییر TF/نماد بده.
- از خیال‌بافی پرهیز کن و فقط از OHLC و داده‌های ارائه‌شده استفاده کن.`,
  "روش اختصاصی": `رویکرد روش اختصاصی:
- اول از کاربر یک جمله خلاصه از قوانین روش را برداشت کن.
- سپس تحلیل را دقیقاً مطابق همان قوانین و با قالب ۱ تا ۵ ارائه بده.`,
  "پرامپت اختصاصی": `رویکرد پرامپت اختصاصی:
- دقیقاً مطابق پرامپت اختصاصی کاربر تحلیل کن و هیچ چارچوب اضافی تحمیل نکن.
- همچنان از داده OHLC و اصول عدم خیال‌بافی پیروی کن.`
};

function styleKeyFromName(style){
  const s = String(style||"").trim();
  if(s === "RTM") return "rtm";
  if(s === "ICT") return "ict";
  if(s === "پرایس اکشن") return "price_action";
  if(s === "پرامپت") return "prompt";
  if(s === "روش اختصاصی") return "custom_method";
  if(s === "پرامپت اختصاصی") return "custom_prompt";
  return "general";
}

async function getStylePrompt(env, st){
  const style = st?.style || "";
  // If user selected custom prompt style, prefer user's generated prompt (must be delivered)
  if(style === "پرامپت اختصاصی" && st?.customPromptDeliveredAt && st?.customPromptText){
    return st.customPromptText;
  }
  const key = styleKeyFromName(style);
  const cfgKey = `cfg:style_prompt:${key}`;
  const v = await getCfg(env, `style_prompt_${key}`, cfgKey, "");
  if(v && String(v).trim()) return String(v).trim();
  return STYLE_DEFAULT_PROMPTS[style] || "";
}

/* ========================== PROMPT BUILDERS ========================== */
async function buildBasePrompt(env, tf){
  const tpl = await getAnalysisPromptTemplate(env);
  const base = tpl ? tpl : institutionalPrompt(tf);
  return String(base).replaceAll("{{TF}}", tf).replaceAll("{{TIMEFRAME}}", tf);
}
async function buildTextPromptForSymbol(env, symbol, userPrompt, st, marketBlock){
  const tf = st.timeframe || "H4";
  const base = await buildBasePrompt(env, tf);
  const styleGuide = await getStylePrompt(env, st);
  const userExtra = userPrompt?.trim() ? userPrompt.trim() : "تحلیل کامل طبق چارچوب MarketiQ";
  return `${base}\n\nASSET: ${symbol}\nUSER SETTINGS: Style=${st.style}, Risk=${st.risk}, Experience=${st.experience||"-"}, PreferredMarket=${st.preferredMarket||"-"}`
    + (styleGuide ? `\n\nSTYLE_GUIDE:\n${styleGuide}\n` : "\n")
    + `\nMARKET_DATA:\n${marketBlock}\n\nUSER EXTRA REQUEST:\n${userExtra}\n\nRULES:\n- خروجی فقط فارسی و دقیقاً بخش‌های ۱ تا ۵\n- سطح‌های قیمتی را مشخص کن (X/Y/Z)\n- شرط کندلی را واضح بگو (close/wick)\n- از داده OHLC استفاده کن، خیال‌بافی نکن
- اگر NEWS_HEADLINES داده شده و خبر روشن است، اثر احتمالی اخبار را خیلی کوتاه در بخش ۴ یا ۵ اضافه کن (بدون خروج از قالب)`;
}
async function buildVisionPrompt(env, st){
  const tf = st.timeframe || "H4";
  const tpl = await getVisionPromptTemplate(env);
  const base = (tpl ? String(tpl) : institutionalPrompt(tf)).replaceAll("{{TF}}", tf).replaceAll("{{TIMEFRAME}}", tf);
  return `${base}\n\nTASK: این تصویر چارت را تحلیل کن. دقیقاً خروجی ۱ تا ۵ بده و سطح‌ها را مشخص کن.\nRULES: فقط فارسی، لحن افشاگر، خیال‌بافی نکن.\n`;
}

/* ========================== CHART RENDERING (QuickChart) ========================== */
// NOTE: Uses QuickChart plugins chartjs-chart-financial (candlestick) + annotation.

function safeJsonParse(s){
  try{ return JSON.parse(s); }catch(e){
    // try to extract json from text fences
    const m = String(s||"").match(/\{[\s\S]*\}/);
    if(m){ try{ return JSON.parse(m[0]); }catch(_e){} }
    return null;
  }
}

function faDigitsToEn(s){
  return String(s||"")
    .replace(/[۰٠]/g, "0").replace(/[۱١]/g, "1").replace(/[۲٢]/g, "2").replace(/[۳٣]/g, "3").replace(/[۴٤]/g, "4")
    .replace(/[۵٥]/g, "5").replace(/[۶٦]/g, "6").replace(/[۷٧]/g, "7").replace(/[۸٨]/g, "8").replace(/[۹٩]/g, "9");
}

function normalizeNumberText(s){
  return faDigitsToEn(String(s||""))
    .replace(/٬/g, "")
    .replace(/,/g, "")
    .replace(/٫/g, ".");
}

function extractRenderPlanHeuristic(analysisText, candles){
  const t = normalizeNumberText(analysisText);

  const zones = [];
  const lines = [];

  // Ranges patterns (e.g., 123-130 | 123 تا 130)
  const rangeRe = /(\d+(?:\.\d+)?)[\s]*?(?:-|–|—|تا)[\s]*?(\d+(?:\.\d+)?)/g;
  let m;
  while((m = rangeRe.exec(t))){
    const a = Number(m[1]), b = Number(m[2]);
    if(!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const low = Math.min(a,b), high = Math.max(a,b);
    // classify by nearby words
    const ctx = t.slice(Math.max(0, m.index-30), Math.min(t.length, m.index+30)).toLowerCase();
    let label = "Zone";
    if(ctx.includes("حمایت") || ctx.includes("support") || ctx.includes("demand") || ctx.includes("تقاضا") || ctx.includes("دیمند")) label = "زون تقاضا";
    if(ctx.includes("مقاومت") || ctx.includes("resist") || ctx.includes("supply") || ctx.includes("عرضه") || ctx.includes("ساپلای")) label = "زون عرضه";
    zones.push({ label, low, high });
  }

  // Single numbers - attempt to map to entry/stop/targets
  const numRe = /(\d+(?:\.\d+)?)/g;
  const nums = [];
  while((m = numRe.exec(t))){
    const n = Number(m[1]);
    if(Number.isFinite(n)) nums.push({ n, idx: m.index });
  }

  // Filter by recent price range
  let minP = null, maxP = null;
  if(Array.isArray(candles) && candles.length){
    const recent = candles.slice(-200);
    minP = Math.min(...recent.map(x => x.l));
    maxP = Math.max(...recent.map(x => x.h));
  }
  const within = (n) => (minP==null || maxP==null) ? true : (n >= minP*0.7 && n <= maxP*1.3);

  // Stop loss
  for(const x of nums){
    if(!within(x.n)) continue;
    const ctx = t.slice(Math.max(0, x.idx-25), Math.min(t.length, x.idx+25)).toLowerCase();
    if(ctx.includes("حد ضرر") || ctx.includes("sl") || ctx.includes("stop")){
      lines.push({ label: "حد ضرر", price: x.n });
      break;
    }
  }
  // Entry
  for(const x of nums){
    if(!within(x.n)) continue;
    const ctx = t.slice(Math.max(0, x.idx-25), Math.min(t.length, x.idx+25)).toLowerCase();
    if(ctx.includes("ورود") || ctx.includes("entry")){
      lines.push({ label: "ورود", price: x.n });
      break;
    }
  }
  // Targets
  let targetCount = 0;
  for(const x of nums){
    if(targetCount >= 3) break;
    if(!within(x.n)) continue;
    const ctx = t.slice(Math.max(0, x.idx-25), Math.min(t.length, x.idx+25)).toLowerCase();
    if(ctx.includes("هدف") || ctx.includes("tp") || ctx.includes("تارگت") || ctx.includes("target")){
      targetCount++;
      lines.push({ label: `هدف ${targetCount}`, price: x.n });
    }
  }

  // Deduplicate
  const uniqZones = [];
  const seenZ = new Set();
  for(const z of zones){
    const key = `${z.label}|${z.low.toFixed(6)}|${z.high.toFixed(6)}`;
    if(seenZ.has(key)) continue;
    seenZ.add(key);
    uniqZones.push(z);
  }
  const uniqLines = [];
  const seenL = new Set();
  for(const l of lines){
    const key = `${l.label}|${Number(l.price).toFixed(6)}`;
    if(seenL.has(key)) continue;
    seenL.add(key);
    uniqLines.push(l);
  }

  return { zones: uniqZones.slice(0, 6), lines: uniqLines.slice(0, 6) };
}

async function extractRenderPlan(env, analysisText, candles, st){
  const wantAI = (env.RENDER_PLAN_AI || "1") !== "0";
  const fallback = extractRenderPlanHeuristic(analysisText, candles);

  // If heuristic found something, skip AI for speed
  if(fallback.zones.length || fallback.lines.length || !wantAI) return fallback;

  try{
    const recent = candles?.slice(-120) || [];
    const lo = recent.length ? Math.min(...recent.map(x => x.l)) : 0;
    const hi = recent.length ? Math.max(...recent.map(x => x.h)) : 0;

    const prompt =
`فقط JSON بده. از متن تحلیل زیر «زون‌ها» و «سطح‌ها» را استخراج کن.
- اگر عددی نبود، آرایه‌ها خالی باشند.
- قیمت‌ها باید عدد باشند.
- زون‌ها: low < high
- خط‌ها: price
- حداکثر 6 زون و 6 خط
- بازه منطقی قیمت: ${lo} تا ${hi}

فرمت:
{"zones":[{"label":"زون تقاضا","low":0,"high":0}],"lines":[{"label":"ورود","price":0},{"label":"حد ضرر","price":0},{"label":"هدف 1","price":0}]}

متن تحلیل:
${analysisText}`;

    const raw = await runTextProviders(prompt, env, st.textOrder);
    const j = safeJsonParse(raw);
    if(j && Array.isArray(j.zones) && Array.isArray(j.lines)){
      const zones = j.zones.map(z => ({
        label: String(z?.label||"Zone").slice(0, 24),
        low: Number(z?.low),
        high: Number(z?.high),
      })).filter(z => Number.isFinite(z.low) && Number.isFinite(z.high) && z.low < z.high).slice(0, 6);

      const lines = j.lines.map(l => ({
        label: String(l?.label||"Level").slice(0, 24),
        price: Number(l?.price),
      })).filter(l => Number.isFinite(l.price)).slice(0, 6);

      if(zones.length || lines.length) return { zones, lines };
    }
  }catch(e){
    console.error("extractRenderPlan AI failed:", e?.message || e);
  }

  return fallback;
}

function roundForChart(n){
  if(!Number.isFinite(n)) return n;
  const abs = Math.abs(n);
  const dp = abs >= 1000 ? 2 : abs >= 10 ? 4 : 6;
  return Number(n.toFixed(dp));
}

function buildCandlesForChart(candles, max=80){
  const tail = (candles || []).slice(-max);
  return tail.map(c => ({
    x: c.t,
    o: roundForChart(c.o),
    h: roundForChart(c.h),
    l: roundForChart(c.l),
    c: roundForChart(c.c),
  }));
}

function buildQuickChartCandlestickConfig(symbol, timeframe, candles, plan){
  const data = buildCandlesForChart(candles, 80);
  if(!data.length) return null;
  const startTs = data[0].x;
  const endTs = data[data.length-1].x;

  const annotations = {};
  const zones = Array.isArray(plan?.zones) ? plan.zones : [];
  const lines = Array.isArray(plan?.lines) ? plan.lines : [];

  let zi = 0;
  for(const z of zones){
    const low = Number(z.low), high = Number(z.high);
    if(!Number.isFinite(low) || !Number.isFinite(high) || low >= high) continue;
    zi++;
    const label = String(z.label || "Zone").slice(0, 24);
    const isSupply = /عرضه|مقاومت|supply|resist/i.test(label);
    const bg = isSupply ? "rgba(255,77,77,0.12)" : "rgba(47,227,165,0.10)";
    const br = isSupply ? "rgba(255,77,77,0.55)" : "rgba(47,227,165,0.55)";

    annotations[`zone${zi}`] = {
      type: "box",
      xMin: startTs, xMax: endTs,
      yMin: low, yMax: high,
      backgroundColor: bg,
      borderColor: br,
      borderWidth: 1,
      label: {
        display: true,
        content: label,
        position: "center",
        color: "rgba(255,255,255,0.85)",
        font: { size: 10, weight: "bold" }
      }
    };
  }

  let li = 0;
  for(const l of lines){
    const price = Number(l.price);
    if(!Number.isFinite(price)) continue;
    li++;
    const label = String(l.label || "Level").slice(0, 24);

    const isStop = /حد ضرر|sl|stop/i.test(label);
    const isEntry = /ورود|entry/i.test(label);
    const isTarget = /هدف|tp|target/i.test(label);

    const color = isStop ? "rgba(255,77,77,0.8)" :
                  isTarget ? "rgba(47,227,165,0.8)" :
                  isEntry ? "rgba(0,209,255,0.8)" :
                  "rgba(255,255,255,0.6)";

    annotations[`line${li}`] = {
      type: "line",
      xMin: startTs, xMax: endTs,
      yMin: price, yMax: price,
      borderColor: color,
      borderWidth: 2,
      label: {
        display: true,
        content: `${label}: ${roundForChart(price)}`,
        position: "start",
        color: "rgba(255,255,255,0.85)",
        backgroundColor: "rgba(0,0,0,0.35)",
        font: { size: 10 }
      }
    };
  }

  return {
    type: "candlestick",
    data: { datasets: [{ label: `${symbol} ${timeframe}`, data }] },
    options: {
      parsing: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: `${symbol} · ${timeframe}` },
        annotation: { annotations }
      },
      scales: {
        x: {
          type: "time",
          time: { unit: timeframe === "D1" ? "day" : "hour" },
          ticks: { maxTicksLimit: 8 }
        },
        y: { position: "right", ticks: { maxTicksLimit: 8 } }
      }
    }
  };
}

async function buildQuickChartImageUrl(env, chartConfig){
  if(!chartConfig) return "";
  const width = toInt(env.CHART_WIDTH, 900);
  const height = toInt(env.CHART_HEIGHT, 520);
  const version = String(env.CHARTJS_VERSION || "4");

  // Optional short URL if QuickChart key is provided
  if(env.QUICKCHART_API_KEY){
    try{
      const r = await fetchWithTimeout("https://quickchart.io/chart/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: env.QUICKCHART_API_KEY,
          backgroundColor: "transparent",
          width,
          height,
          format: "png",
          version,
          chart: chartConfig,
        })
      }, 8000);
      const j = await r.json().catch(()=>null);
      const url = j?.url || j?.short_url;
      if(url) return String(url);
    }catch(e){
      console.error("quickchart create failed:", e?.message || e);
    }
  }

  const params = new URLSearchParams({
    version,
    width: String(width),
    height: String(height),
    format: "png",
    backgroundColor: "transparent",
    c: JSON.stringify(chartConfig),
  });
  return `https://quickchart.io/chart?${params.toString()}`;
}


/* ========================== QUIZ (LEVEL TEST) ========================== */
const QUIZ = [
  { q:"۱) حد ضرر (Stop Loss) برای چیست؟", options:{A:"محدود کردن ضرر",B:"افزایش سود",C:"دو برابر کردن حجم",D:"حذف کارمزد"}, correct:"A" },
  { q:"۲) ریسک به ریوارد 1:2 یعنی چه؟", options:{A:"ریسک دو برابر سود",B:"سود دو برابر ریسک",C:"هر دو برابر",D:"یعنی بدون ریسک"}, correct:"B" },
  { q:"۳) اگر سرمایه ۱۰۰۰ دلار و ریسک هر معامله ۱٪ باشد، حداکثر ضرر مجاز چقدر است؟", options:{A:"۱ دلار",B:"۱۰ دلار",C:"۱۰۰ دلار",D:"۵۰ دلار"}, correct:"B" },
  { q:"۴) در تایم‌فریم H4 هر کندل چند ساعت است؟", options:{A:"۱ ساعت",B:"۲ ساعت",C:"۴ ساعت",D:"۱۲ ساعت"}, correct:"C" },
  { q:"۵) لوریج (Leverage) چه ریسکی دارد؟", options:{A:"ریسک ندارد",B:"ریسک را کاهش می‌دهد",C:"می‌تواند ضرر را بزرگ‌تر کند",D:"فقط روی سود اثر دارد"}, correct:"C" },
];
function quizKeyboard(q){
  return kb([[`A) ${q.options.A}`,`B) ${q.options.B}`],[`C) ${q.options.C}`,`D) ${q.options.D}`],[BTN.BACK,BTN.HOME]]);
}
function parseQuizAnswer(text){
  const t=String(text||"").trim();
  if(t.startsWith("A)")) return "A";
  if(t.startsWith("B)")) return "B";
  if(t.startsWith("C)")) return "C";
  if(t.startsWith("D)")) return "D";
  if(["A","B","C","D"].includes(t.toUpperCase())) return t.toUpperCase();
  return null;
}
function scoreQuiz(answers){
  let score=0;
  for(let i=0;i<QUIZ.length;i++){ if(answers?.[i]===QUIZ[i].correct) score++; }
  return score;
}
async function evaluateLevelByAI(env, st){
  const answers = st.quiz?.answers || [];
  const score = scoreQuiz(answers);

  const prompt =
`تو ارزیاب تعیین‌سطح MarketiQ هستی. خروجی فقط JSON و فارسی.

ورودی‌ها:
- تجربه کاربر: ${st.experience||"-"}
- بازار مورد علاقه: ${st.preferredMarket||"-"}
- پاسخ‌ها (A/B/C/D): ${answers.join(",")}
- امتیاز خام: ${score} از ${QUIZ.length}

وظیفه:
1) سطح کاربر را تعیین کن: "مبتدی" یا "متوسط" یا "حرفه‌ای"
2) تنظیمات پیشنهادی:
   - timeframe یکی از: M15/H1/H4/D1
   - style یکی از: اسکالپ/سوئینگ/اسمارت‌مانی
   - risk یکی از: کم/متوسط/زیاد
3) یک بازار پیشنهادی: کریپتو/فارکس/فلزات/سهام
4) توضیح کوتاه 2-3 خطی.

فرمت خروجی:
{"level":"...","recommended":{"timeframe":"H4","style":"اسمارت‌مانی","risk":"متوسط","market":"فارکس"},"summary":"..."}`;

  try{
    const raw = await runTextProviders(prompt, env, st.textOrder);
    const j = safeJsonParse(raw);
    if(j && j.recommended) return { ok:true, j, score };
  } catch(e){ console.error("evaluateLevelByAI failed:", e?.message||e); }

  let level="مبتدی";
  if(score>=4) level="حرفه‌ای"; else if(score>=3) level="متوسط";
  const recommended = {
    timeframe: level==="مبتدی" ? "H4" : (level==="متوسط" ? "H1" : "M15"),
    style: level==="حرفه‌ای" ? "اسکالپ" : "اسمارت‌مانی",
    risk: level==="مبتدی" ? "کم" : (level==="متوسط" ? "متوسط" : "زیاد"),
    market: st.preferredMarket || "فارکس"
  };
  const summary = `سطح تقریبی بر اساس امتیاز: ${score}/${QUIZ.length}`;
  return { ok:true, j:{ level, recommended, summary }, score };
}

/* ========================== UPDATE HANDLER ========================== */
async function handleUpdate(update, env){
  try{
    const msg = update.message;
    if(!msg) return;
    const chatId = msg.chat?.id;
    const from = msg.from;
    const userId = from?.id;
    if(!chatId || !userId) return;

    const st = await ensureUser(userId, env, { username: from?.username || "" });
    let dirtyMeta = false;
    if(chatId && String(st.chatId||"") !== String(chatId)){
      st.chatId = chatId;
      dirtyMeta = true;
    }
    // username is mostly handled in ensureUser, but keep as safety
    if(from?.username){
      const u = String(from.username||"").trim();
      if(u && st.username !== u){
        st.username = u;
        dirtyMeta = true;
      }
    }
    if(dirtyMeta && env.BOT_KV) await saveUser(userId, st, env);

    // Contact share first (needed for referral acceptance)
    if(msg.contact){
      await handleContactShare(env, chatId, from, st, msg.contact);
      return;
    }

    // Vision (image)
    const imageFileId = extractImageFileId(msg, env);
    if(imageFileId){
      if(!isOnboardComplete(st)){
        await tgSendMessage(env, chatId, "برای استفاده از تحلیل (ویژن)، ابتدا پروفایل را تکمیل کن: نام + شماره ✅", mainMenuKeyboard(env));
        await startOnboardingIfNeeded(env, chatId, from, st);
        return;
      }
      await handleVisionFlow(env, chatId, from, userId, st, imageFileId);
      return;
    }

    const text = (msg.text || "").trim();
    const { cmd, arg } = parseCommand(text);

    if(cmd==="/start" || cmd==="/menu"){
      if(arg) await attachReferralIfAny(st, arg, env);
      st.state="idle"; st.selectedSymbol=""; st.quiz={active:false, idx:0, answers:[]};
      await saveUser(userId, st, env);
      await tgSendMessage(env, chatId, WELCOME_TEXT, mainMenuKeyboard(env));
      await startOnboardingIfNeeded(env, chatId, from, st);
      return;
    }

    if(cmd==="/signals" || cmd==="/signal" || text===BTN.SIGNALS){
      if(!isOnboardComplete(st)){
        await tgSendMessage(env, chatId, "برای دریافت سیگنال/تحلیل، ابتدا پروفایل را تکمیل کن ✅", mainMenuKeyboard(env));
        await startOnboardingIfNeeded(env, chatId, from, st);
        return;
      }
      st.state="choose_symbol"; st.selectedSymbol="";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "📈 دسته‌بندی بازارها:", signalsMenuKeyboard(env));
    }

    if(cmd==="/settings" || text===BTN.SETTINGS){
      return sendSettingsSummary(env, chatId, st, from);
    }

    if(cmd==="/profile" || text===BTN.PROFILE){
      return tgSendMessage(env, chatId, await profileText(st, from, env), mainMenuKeyboard(env));
    }

    if(cmd==="/buy" || cmd==="/pay" || text===BTN.BUY){
      await sendBuyInfo(env, chatId, from, st);
      return;
    }

    if(cmd==="/price"){
      const p = await getSubPrice(env);
      const c = await getSubCurrency(env);
      const d = await getSubDays(env);
      const msg = (p && p > 0)
        ? `💳 قیمت اشتراک: ${p} ${c} | مدت: ${d} روز`
        : "💳 قیمت اشتراک هنوز توسط مدیریت تعیین نشده است.";
      return tgSendMessage(env, chatId, msg, mainMenuKeyboard(env));
    }

    if(cmd==="/setprice"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
      await handleSetPrice(env, chatId, arg);
      return;
    }

    // Global limits (Admin/Owner)
    if(cmd==="/setfreelimit"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
      if(!arg) return tgSendMessage(env, chatId, "فرمت:\n/setfreelimit 5", mainMenuKeyboard(env));
      try{
        const n = await setFreeDailyLimit(env, arg);
        return tgSendMessage(env, chatId, `✅ سقف استفاده رایگان روزانه تنظیم شد: ${n}`, mainMenuKeyboard(env));
      }catch(_e){
        return tgSendMessage(env, chatId, "عدد نامعتبر است.", mainMenuKeyboard(env));
      }
    }
    if(cmd==="/setsublimit"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
      if(!arg) return tgSendMessage(env, chatId, "فرمت:\n/setsublimit 50", mainMenuKeyboard(env));
      try{
        const n = await setSubDailyLimit(env, arg);
        return tgSendMessage(env, chatId, `✅ سقف استفاده اشتراک روزانه تنظیم شد: ${n}`, mainMenuKeyboard(env));
      }catch(_e){
        return tgSendMessage(env, chatId, "عدد نامعتبر است.", mainMenuKeyboard(env));
      }
    }

    // Payment TxID submission (User)
    if(cmd==="/tx"){
      if(!isOnboardComplete(st)){
        await tgSendMessage(env, chatId, "برای ثبت TxID ابتدا پروفایل را تکمیل کن (نام + شماره).", mainMenuKeyboard(env));
        await startOnboardingIfNeeded(env, chatId, from, st);
        return;
      }
      if(!arg) return tgSendMessage(env, chatId, "فرمت:\n/tx YOUR_TXID", mainMenuKeyboard(env));
      try{
        const rec = await createPendingPayment(env, userId, arg);
        await tgSendMessage(env, chatId, "✅ TxID ثبت شد. پس از بررسی، اشتراک فعال می‌شود.", mainMenuKeyboard(env));

        // Notify admins
        const admins = (env.ADMIN_IDS||"").split(",").map(s=>s.trim()).filter(Boolean);
        const owner = (env.OWNER_ID||"").trim();
        const targets = [...new Set([owner, ...admins].filter(Boolean))];
        for(const a of targets){
          await tgSendMessage(env, a, `💳 پرداخت جدید (Pending)
user=${userId}
TxID=${rec.txid}
amount=${rec.amount} ${rec.currency}
days=${rec.days}`, null).catch(()=>{});
        }
        return;
      }catch(e){
        const msg = (e?.message === "txid_exists") ? "این TxID قبلاً ثبت شده است." : "ثبت TxID انجام نشد. لطفاً دوباره بررسی کن.";
        return tgSendMessage(env, chatId, msg, mainMenuKeyboard(env));
      }
    }

    // Admin/Owner: pending payments
    if(cmd==="/payments"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
      try{
        const res = await listPendingPayments(env, 20);
        if(!res.items.length) return tgSendMessage(env, chatId, "✅ پرداخت در انتظار نداریم.", mainMenuKeyboard(env));
        const lines = res.items.map(x => `• ${x.txid} | user=${x.userId} | ${x.amount} ${x.currency} | ${x.days}d`).join("\n");
        return tgSendMessage(env, chatId, `💳 پرداخت‌های در انتظار:\n${lines}\n\nبرای تایید: /approve TXID\nبرای رد: /reject TXID`, mainMenuKeyboard(env));
      }catch(_e){
        return tgSendMessage(env, chatId, "فعلاً امکان نمایش پرداخت‌ها نیست.", mainMenuKeyboard(env));
      }
    }
    if(cmd==="/approve"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
      if(!arg) return tgSendMessage(env, chatId, "فرمت:\n/approve TXID", mainMenuKeyboard(env));
      try{
        const rec = await markPaymentApproved(env, arg, userId);
        await tgSendMessage(env, chatId, `✅ تایید شد: ${rec.txid}\nاشتراک کاربر فعال شد.`, mainMenuKeyboard(env));
        await tgSendMessage(env, rec.userId, `✅ پرداخت تایید شد. اشتراک شما فعال شد (${rec.days} روز).`).catch(()=>{});
        return;
      }catch(e){
        return tgSendMessage(env, chatId, "تایید انجام نشد (TxID پیدا نشد یا مشکل داده).", mainMenuKeyboard(env));
      }
    }
    if(cmd==="/reject"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
      if(!arg) return tgSendMessage(env, chatId, "فرمت:\n/reject TXID", mainMenuKeyboard(env));
      try{
        const rec = await markPaymentRejected(env, arg, userId);
        await tgSendMessage(env, chatId, `🚫 رد شد: ${rec.txid}`, mainMenuKeyboard(env));
        await tgSendMessage(env, rec.userId, "🚫 پرداخت شما رد شد. اگر اشتباه شده، با پشتیبانی تماس بگیرید.").catch(()=>{});
        return;
      }catch(_e){
        return tgSendMessage(env, chatId, "رد انجام نشد (TxID پیدا نشد).", mainMenuKeyboard(env));
      }
    }

    // Admin: generate 5 referral codes for a user
    if(cmd==="/refgen"){
      if(!isAdmin(from, env)) return tgSendMessage(env, chatId, "⛔️ فقط ادمین می‌تواند رفرال بسازد.", mainMenuKeyboard(env));
      const targetId = arg || String(userId);
      try{
        const codes = await adminGenerateRefCodes(env, targetId, 5);
        const botUsername = (env.BOT_USERNAME||"").toString().replace(/^@/,"").trim();
        const links = botUsername ? codes.map(c=>`https://t.me/${botUsername}?start=${c}`).join("\n") : codes.join("\n");
        return tgSendMessage(env, chatId, `✅ 5 رفرال ساخته شد برای user=${targetId}:\n\n${links}`, mainMenuKeyboard(env));
      }catch(_e){
        return tgSendMessage(env, chatId, "ساخت رفرال انجام نشد. مطمئن شو userId درست است و KV فعال است.", mainMenuKeyboard(env));
      }
    }

    if(cmd==="/support" || text===BTN.SUPPORT){
      const handle = env.SUPPORT_HANDLE || "@support";
      return tgSendMessage(env, chatId, `🆘 پشتیبانی\n\nپیام بده به: ${handle}`, mainMenuKeyboard(env));
    }

    if(cmd==="/education" || text===BTN.EDUCATION){
      return tgSendMessage(env, chatId, "📚 آموزش (نسخه MVP)\n\nبه‌زودی: مفاهیم مدیریت ریسک، ساختار مارکت، اسمارت‌مانی و …", mainMenuKeyboard(env));
    }

    if(cmd==="/level" || text===BTN.LEVEL){
      await startLeveling(env, chatId, from, st);
      return;
    }

    if(cmd==="/wallet"){
      const w = await getWallet(env);
      if(!w) return tgSendMessage(env, chatId, "فعلاً آدرس ولت تنظیم نشده است.", mainMenuKeyboard(env));
      return tgSendMessage(env, chatId, `💳 آدرس ولت MarketiQ:\n\n\`${w}\``, mainMenuKeyboard(env));
    }

    if(cmd==="/redeem"){
      await redeemPointsForSubscription(env, chatId, from, st);
      return;
    }

    if(cmd==="/customprompt"){
      if(await startOnboardingIfNeeded(env, chatId, from, st)) return;
      st.state="custom_prompt_desc";
      await saveUser(userId, st, env);
      await tgSendMessage(env, chatId,
        "🧩 درخواست پرامپت اختصاصی\n\n"+CUSTOM_PROMPT_INFO_TEXT+"\n\nلطفاً توضیح استراتژی/سبک خود را همینجا ارسال کن (حداقل ۱۰ کاراکتر).\n\n⏳ پرامپت ۲ ساعت بعد برایت ارسال می‌شود.",
        kb([[BTN.BACK, BTN.HOME]])
      );
      return;
    }

    if(cmd==="/ref" || text===BTN.REFERRAL){
      await sendReferralInfo(env, chatId, from, st);
      return;
    }

    // Admin/Owner views
    if(cmd==="/users"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
      await adminListUsers(env, chatId);
      return;
    }
    if(cmd==="/user"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
      await adminShowUser(env, chatId, arg, from);
      return;
    }

    // Only ADMIN can set wallet
    if(cmd==="/setwallet"){
      if(!isAdmin(from, env)) return tgSendMessage(env, chatId, "⛔️ فقط ادمین می‌تواند آدرس ولت را تعیین کند.", mainMenuKeyboard(env));
      if(!arg) return tgSendMessage(env, chatId, "فرمت:\n/setwallet WALLET_ADDRESS", mainMenuKeyboard(env));
      await setWallet(env, arg, from);
      return tgSendMessage(env, chatId, "✅ آدرس ولت ذخیره شد.", mainMenuKeyboard(env));
    }

    // Prompts only Admin/Owner
    if(cmd==="/setprompt"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ فقط ادمین/اونر می‌تواند پرامپت را تعیین کند.", mainMenuKeyboard(env));
      st.state="admin_set_prompt"; await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "متن پرامپت تحلیل را همینجا ارسال کن (می‌تواند چندخطی باشد).", kb([[BTN.BACK,BTN.HOME]]));
    }
    if(cmd==="/setvisionprompt"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ فقط ادمین/اونر می‌تواند پرامپت ویژن را تعیین کند.", mainMenuKeyboard(env));
      st.state="admin_set_vision_prompt"; await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "متن پرامپت ویژن را همینجا ارسال کن (می‌تواند چندخطی باشد).", kb([[BTN.BACK,BTN.HOME]]));
    }
    if(cmd==="/getprompt"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
      const p = await getAnalysisPromptTemplate(env);
      return tgSendMessage(env, chatId, p ? `📌 پرامپت فعلی:\n\n${p}` : "پرامپت سفارشی تنظیم نشده؛ از پیش‌فرض استفاده می‌شود.", mainMenuKeyboard(env));
    }

    // Back/Home
    if(text === BTN.MINIAPP){
      const url = getMiniappUrl(env);
      if(url){
        return tgSendMessage(env, chatId, "🔗 برای باز کردن مینی‌اپ روی دکمه زیر بزن:", {
          reply_markup: {
            inline_keyboard: [[{ text: "باز کردن مینی‌اپ", web_app: { url } }]]
          }
        });
      }
      return tgSendMessage(env, chatId, "⚠️ لینک مینی‌اپ تنظیم نشده. لطفاً PUBLIC_BASE_URL یا MINIAPP_URL را تنظیم کن.", mainMenuKeyboard(env));
    }


    if(text===BTN.HOME){
      st.state="idle"; st.selectedSymbol=""; st.quiz={active:false, idx:0, answers:[]};
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "🏠 منوی اصلی:", mainMenuKeyboard(env));
    }
    if(text===BTN.BACK){
      if(st.state==="await_prompt"){ st.state="choose_symbol"; st.selectedSymbol=""; await saveUser(userId, st, env); return tgSendMessage(env, chatId, "📈 دسته‌بندی بازارها:", signalsMenuKeyboard(env)); }
      if(st.state.startsWith("set_")){ st.state="idle"; await saveUser(userId, st, env); return sendSettingsSummary(env, chatId, st, from); }
      if(st.state==="custom_prompt_desc" || st.state.startsWith("onboard_") || st.quiz?.active){ st.state="idle"; st.quiz={active:false, idx:0, answers:[]}; await saveUser(userId, st, env); return tgSendMessage(env, chatId, "متوقف شد. هر زمان خواستی دوباره از 🧪 تعیین سطح استفاده کن.", mainMenuKeyboard(env)); }
      if(st.state.startsWith("admin_set_")){ st.state="idle"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, "لغو شد.", mainMenuKeyboard(env)); }
      return tgSendMessage(env, chatId, "🏠 منوی اصلی:", mainMenuKeyboard(env));
    }

    // Admin prompt states
    if(st.state==="admin_set_prompt"){
      const p = String(text||"").trim();
      if(!p) return tgSendMessage(env, chatId, "متن خالی است. دوباره ارسال کن یا ⬅️ برگشت.", kb([[BTN.BACK,BTN.HOME]]));
      await setAnalysisPromptTemplate(env, p);
      st.state="idle"; await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "✅ پرامپت تحلیل ذخیره شد.", mainMenuKeyboard(env));
    }
    if(st.state==="admin_set_vision_prompt"){
      const p = String(text||"").trim();
      if(!p) return tgSendMessage(env, chatId, "متن خالی است. دوباره ارسال کن یا ⬅️ برگشت.", kb([[BTN.BACK,BTN.HOME]]));
      await setVisionPromptTemplate(env, p);
      st.state="idle"; await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "✅ پرامپت ویژن ذخیره شد.", mainMenuKeyboard(env));
    }

    // Onboarding
    if(st.state==="onboard_name"){
      const name = String(text||"").trim();
      if(name.length < 2) return tgSendMessage(env, chatId, "اسم کوتاه است. لطفاً نام خود را ارسال کن.", kb([[BTN.BACK,BTN.HOME]]));
      st.profileName = name.slice(0,48);
      st.state="onboard_contact";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "✅ ثبت شد.\n\nحالا لطفاً شماره‌ات را با دکمه زیر Share کن:", requestContactKeyboard(env));
    }
    if(st.state==="onboard_experience"){
      const exp = String(text||"").trim();
      if(!["مبتدی","متوسط","حرفه‌ای"].includes(exp)) return tgSendMessage(env, chatId, "یکی از گزینه‌ها را انتخاب کن:", optionsKeyboard(["مبتدی","متوسط","حرفه‌ای"]));
      st.experience = exp;
      st.state="onboard_market";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "کدام بازار برایت مهم‌تر است؟", optionsKeyboard(["کریپتو","فارکس","فلزات","سهام"]));
    }
    if(st.state==="onboard_market"){
      const m = String(text||"").trim();
      if(!["کریپتو","فارکس","فلزات","سهام"].includes(m)) return tgSendMessage(env, chatId, "یکی از گزینه‌ها را انتخاب کن:", optionsKeyboard(["کریپتو","فارکس","فلزات","سهام"]));
      st.preferredMarket = m;
      await saveUser(userId, st, env);
      await startQuiz(env, chatId, st);
      return;
    }

    // Quiz
    if(st.quiz?.active){
      const ans = parseQuizAnswer(text);
      if(!ans){
        const q = QUIZ[st.quiz.idx] || QUIZ[0];
        return tgSendMessage(env, chatId, "لطفاً یکی از گزینه‌های A/B/C/D را انتخاب کن.", quizKeyboard(q));
      }
      st.quiz.answers[st.quiz.idx] = ans;
      st.quiz.idx += 1;

      if(st.quiz.idx >= QUIZ.length){
        st.quiz.active=false;
        st.state="idle";
        await saveUser(userId, st, env);

        await tgSendMessage(env, chatId, "⏳ در حال تحلیل نتیجه تعیین سطح…", kb([[BTN.HOME]]));
        const t = stopToken();
        const typingTask = typingLoop(env, chatId, t);

        try{
          const evalRes = await evaluateLevelByAI(env, st);
          const rec = evalRes.j.recommended || {};
          st.level = evalRes.j.level || "متوسط";
          st.levelScore = evalRes.score;
          st.levelSummary = String(evalRes.j.summary || "").slice(0,800);
          st.suggestedMarket = String(rec.market || st.preferredMarket || "").trim();

          st.timeframe = sanitizeTimeframe(rec.timeframe) || st.timeframe;
          st.style = sanitizeStyle(rec.style) || st.style;
          st.risk = sanitizeRisk(rec.risk) || st.risk;

          await saveUser(userId, st, env);

          t.stop=true;
          await Promise.race([typingTask, sleep(10)]).catch(()=>{});

          const msgTxt =
`✅ نتیجه تعیین سطح MarketiQ

👤 نام: ${st.profileName || "-"}
📌 سطح: ${st.level}  (امتیاز: ${st.levelScore}/${QUIZ.length})
🎯 بازار پیشنهادی: ${st.suggestedMarket || "-"}

⚙️ تنظیمات پیشنهادی اعمال شد:
⏱ تایم‌فریم: ${st.timeframe}
🎯 سبک: ${st.style}
⚠️ ریسک: ${st.risk}

📝 توضیح:
${st.levelSummary || "—"}

اگر خواستی دوباره تعیین سطح بدی: /level`;

          await tgSendMessage(env, chatId, msgTxt, mainMenuKeyboard(env));
          return;
        } catch(e){
          console.error("quiz finalize error:", e);
          t.stop=true;
          await tgSendMessage(env, chatId, "⚠️ خطا در تعیین سطح. دوباره تلاش کن: /level", mainMenuKeyboard(env));
          return;
        }
      } else {
        await saveUser(userId, st, env);
        const q = QUIZ[st.quiz.idx];
        return tgSendMessage(env, chatId, q.q, quizKeyboard(q));
      }
    }

    // Categories
    if(text===BTN.CAT_MAJORS) return tgSendMessage(env, chatId, "💱 جفت‌ارزها (Forex):", listKeyboard(MAJORS, 2, env));
    if(text===BTN.CAT_METALS) return tgSendMessage(env, chatId, "🪙 فلزات:", listKeyboard(METALS, 2, env));
    if(text===BTN.CAT_INDICES) return tgSendMessage(env, chatId, "📊 شاخص‌ها:", listKeyboard(INDICES, 2, env));
    if(text===BTN.CAT_STOCKS) return tgSendMessage(env, chatId, "📈 سهام:", listKeyboard(STOCKS, 2, env));
    if(text===BTN.CAT_CRYPTO) return tgSendMessage(env, chatId, "₿ کریپتو:", listKeyboard(CRYPTOS, 2, env));

    // Requests to admins
    if(text===BTN.REQUEST_SETTINGS){
      await requestToAdmins(env, st, `درخواست تغییر تنظیمات از کاربر: ${st.profileName||"-"} (ID:${st.userId})`);
      return tgSendMessage(env, chatId, "✅ درخواست شما برای ادمین/اونر ارسال شد.", mainMenuKeyboard(env));
    }
    if(text===BTN.REQUEST_RELEVEL){
      await requestToAdmins(env, st, `درخواست تعیین سطح مجدد از کاربر: ${st.profileName||"-"} (ID:${st.userId})`);
      return tgSendMessage(env, chatId, "✅ درخواست تعیین سطح مجدد ارسال شد. اگر دوست داری همین الان هم /level رو بزن.", mainMenuKeyboard(env));
    }

    
    // Custom prompt request (bot)
    if(st.state==="custom_prompt_desc"){
      const desc = String(text||"").trim();
      if(desc.length < 10) return tgSendMessage(env, chatId, "متن خیلی کوتاه است. لطفاً با جزئیات بیشتری توضیح بده (حداقل ۱۰ کاراکتر).", kb([[BTN.BACK,BTN.HOME]]));
      if(desc.length > 3000) return tgSendMessage(env, chatId, "متن خیلی طولانی است. لطفاً خلاصه‌تر بنویس (حداکثر ۳۰۰۰ کاراکتر).", kb([[BTN.BACK,BTN.HOME]]));

      const genPrompt =
`You are an expert trading prompt engineer.
Create a concise, high-quality ANALYSIS PROMPT in Persian that the bot can prepend as STYLE_GUIDE.
The prompt must:
- Be actionable and structured
- Specify required sections 1 تا 5
- Enforce: no hallucination, rely on OHLC
- Include zones (supply/demand) and entry/SL/TP rules
User strategy description:
${desc}`;

      let generated = "";
      try{
        generated = await runTextProviders(genPrompt, env, st.textOrder);
      }catch(_e){
        generated = `پرامپت اختصاصی (پیش‌فرض)
- قوانین و ستاپ‌ها را دقیقاً مطابق توضیحات کاربر اجرا کن.
- خروجی ۱ تا ۵.
- نواحی (Zone) + تریگر ورود + ابطال + تارگت‌ها.
- فقط بر اساس OHLC و داده‌های ارائه‌شده.`;
      }

      st.customPromptDesc = desc;
      st.customPromptText = String(generated||"").trim();
      st.customPromptRequestedAt = new Date().toISOString();
      st.customPromptReadyAt = new Date(Date.now() + CUSTOM_PROMPT_DELAY_MS).toISOString();
      st.customPromptDeliveredAt = "";
      st.state="idle";

      await saveUser(userId, st, env);
      await scheduleCustomPromptJob(env, st).catch(()=>{});

      return tgSendMessage(env, chatId,
        `✅ درخواست ثبت شد.\n\n⏳ پرامپت شما ۲ ساعت بعد ارسال می‌شود.\nزمان آماده‌شدن: ${st.customPromptReadyAt}`,
        mainMenuKeyboard(env)
      );
    }

// Settings menu actions
    if(text===BTN.SET_TF){ st.state="set_tf"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, "⏱ تایم‌فریم:", optionsKeyboard(["M15","H1","H4","D1"])); }
    if(text===BTN.SET_STYLE){ st.state="set_style"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, "🎯 سبک:", optionsKeyboard(["RTM","ICT","پرایس اکشن","اسکالپ","اینترادی","سوئینگ","اسمارت‌مانی","پرامپت","روش اختصاصی","پرامپت اختصاصی"])); }
    if(text===BTN.SET_RISK){ st.state="set_risk"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, "⚠️ ریسک:", optionsKeyboard(["کم","متوسط","زیاد"])); }
    if(text===BTN.SET_NEWS){ st.state="set_news"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, "📰 خبر:", optionsKeyboard(["روشن ✅","خاموش ❌"])); }

    if(st.state==="set_tf"){ const tf=sanitizeTimeframe(text); if(!tf) return tgSendMessage(env, chatId, "یکی از گزینه‌ها را انتخاب کن:", optionsKeyboard(["M15","H1","H4","D1"])); st.timeframe=tf; st.state="idle"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, `✅ تایم‌فریم: ${st.timeframe}`, mainMenuKeyboard(env)); }
    if(st.state==="set_style"){
      const v=sanitizeStyle(text);
      if(!v) return tgSendMessage(env, chatId, "یکی از گزینه‌ها را انتخاب کن:", optionsKeyboard(["RTM","ICT","پرایس اکشن","اسکالپ","اینترادی","سوئینگ","اسمارت‌مانی","پرامپت","روش اختصاصی","پرامپت اختصاصی"]));
      // "پرامپت اختصاصی" only after request + delivery
      if(v==="پرامپت اختصاصی" && !(st.customPromptDeliveredAt && st.customPromptText)){
        await tgSendMessage(env, chatId,
          "🔒 برای انتخاب «پرامپت اختصاصی» ابتدا باید درخواست بدی.\n\n"+
          CUSTOM_PROMPT_INFO_TEXT+
          "\n\nدستور: /customprompt\nیا از مینی‌اپ استفاده کن.",
          optionsKeyboard(["RTM","ICT","پرایس اکشن","اسکالپ","اینترادی","سوئینگ","اسمارت‌مانی","پرامپت","روش اختصاصی","پرامپت اختصاصی"])
        );
        return;
      }
      st.style=v; st.state="idle"; await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, `✅ سبک: ${st.style}`, mainMenuKeyboard(env));
    }
    if(st.state==="set_risk"){ const v=sanitizeRisk(text); if(!v) return tgSendMessage(env, chatId, "یکی از گزینه‌ها را انتخاب کن:", optionsKeyboard(["کم","متوسط","زیاد"])); st.risk=v; st.state="idle"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, `✅ ریسک: ${st.risk}`, mainMenuKeyboard(env)); }
    if(st.state==="set_news"){ const v=sanitizeNewsChoice(text); if(v===null) return tgSendMessage(env, chatId, "یکی از گزینه‌ها را انتخاب کن:", optionsKeyboard(["روشن ✅","خاموش ❌"])); st.newsEnabled=v; st.state="idle"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, `✅ خبر: ${st.newsEnabled ? "روشن ✅" : "خاموش ❌"}`, mainMenuKeyboard(env)); }

    // Symbol selection
    if(isSymbol(text)){
      const symbol = text;

      // اگر کاربر ثبت‌نامش کامل نیست، اول ثبت‌نام انجام شود
      if(await startOnboardingIfNeeded(env, chatId, from, st)) return;

      // Guard: custom prompt style requires delivered prompt
      if(st.style==="پرامپت اختصاصی" && !(st.customPromptDeliveredAt && st.customPromptText)){
        await tgSendMessage(env, chatId,
          "🔒 برای تحلیل با «پرامپت اختصاصی» ابتدا باید درخواست بدی.\n\n"+CUSTOM_PROMPT_INFO_TEXT+"\n\nدستور: /customprompt",
          mainMenuKeyboard(env)
        );
        return;
      }

      // بررسی سهمیه روزانه (به جز ادمین/پرمیوم)
      if(env.BOT_KV && !isPrivileged(from, env)){
        const ok = await canAnalyzeToday(st, from, env);
        if(!ok){
          const limit = await dailyLimitForUser(st, from, env);
          return tgSendMessage(env, chatId, `⛔ سهمیه امروزت تموم شده. ( ${st.dailyUsed}/${limit} )\n\nبرای افزایش سهمیه، از «${BTN.BUY}» اشتراک بگیر.`, kb([[BTN.BUY],[BTN.HOME],[miniappKey(env)]]));
        }
      }

      // پیام سریع برای UX
      await tgSendMessage(env, chatId, `⏳ در حال تحلیل ${symbol} ...`, kb([[BTN.HOME],[miniappKey(env)]]));

      // مصرف سهمیه و ریست وضعیت
      if(env.BOT_KV && !isPrivileged(from, env)) await consumeDaily(st, from, env);
      st.state = "idle";
      st.selectedSymbol = "";
      await saveUser(userId, st, env);

      // اجرای تحلیل
      await runSignalTextFlow(env, chatId, from, st, symbol, "");
      return;
    }

    // Prompt => Signal flow
    if(st.state==="await_prompt" && st.selectedSymbol){
      if(!isOnboardComplete(st)){
        await tgSendMessage(env, chatId, "برای تحلیل، ابتدا پروفایل را تکمیل کن ✅", mainMenuKeyboard(env));
        await startOnboardingIfNeeded(env, chatId, from, st);
        return;
      }
      if(env.BOT_KV && !(await canAnalyzeToday(st, from, env))){
        const lim = await dailyLimitForUser(st, from, env);
        return tgSendMessage(env, chatId, `⛔️ سهمیه امروزت تموم شده (${Number.isFinite(lim)?lim:"∞"} تحلیل در روز).`, mainMenuKeyboard(env));
      }

      const symbol = st.selectedSymbol;
      const isAnalyzeCmd = (text===BTN.ANALYZE) || (text.replace(/\s+/g,"")==="تحلیلکن");
      const userPrompt = isAnalyzeCmd ? "" : text;

      st.state="idle"; st.selectedSymbol="";
      if(env.BOT_KV){ await consumeDaily(st, from, env); await saveUser(userId, st, env); }

      await runSignalTextFlow(env, chatId, from, st, symbol, userPrompt);
      return;
    }

    // Default fallback
    return tgSendMessage(env, chatId, "از منوی پایین استفاده کن ✅", mainMenuKeyboard(env));
  } catch(e){
    console.error("handleUpdate error:", e);
  }
}

function parseCommand(text){
  const t = String(text||"").trim();
  if(!t.startsWith("/")) return { cmd:"", arg:"" };
  const parts = t.split(/\s+/);
  return { cmd: parts[0].toLowerCase(), arg: parts.slice(1).join(" ").trim() };
}
function isSymbol(t){ return MAJORS.includes(t)||METALS.includes(t)||INDICES.includes(t)||STOCKS.includes(t)||CRYPTOS.includes(t); }

/* ========================== ONBOARDING ========================== */
async function startOnboardingIfNeeded(env, chatId, from, st){
  // Returns true if we started/continued onboarding and the caller should stop processing the current action.
  if(!st.profileName){
    st.state = "onboard_name";
    await saveUser(st.userId, st, env);
    await tgSendMessage(env, chatId, "👤 قبل از شروع، نامت رو بفرست:", kb([[BTN.BACK, BTN.HOME]]));
    return true;
  }
  if(!st.phone){
    st.state = "onboard_contact";
    await saveUser(st.userId, st, env);
    await tgSendMessage(env, chatId, "📱 لطفاً شماره موبایل را با دکمه زیر ارسال کن (Share Contact):", requestContactKeyboard(env));
    return true;
  }
  if(!st.experience){
    st.state = "onboard_experience";
    await saveUser(st.userId, st, env);
    await tgSendMessage(env, chatId, "🧠 تجربه‌ات در بازار چقدر است؟", optionsKeyboard(["مبتدی","متوسط","حرفه‌ای"])) ;
    return true;
  }
  if(!st.preferredMarket){
    st.state = "onboard_market";
    await saveUser(st.userId, st, env);
    await tgSendMessage(env, chatId, "🎯 بازار مورد علاقه‌ات کدام است؟", optionsKeyboard(["کریپتو","فارکس","فلزات","سهام"])) ;
    return true;
  }

  // Leveling is recommended (not strictly required)
  if(!st.level){
    await tgSendMessage(env, chatId, "🧪 برای تعیین سطح و تنظیم خودکار، این دستور را بزن: /level", mainMenuKeyboard(env));
  }
  return false;
}

async function handleContactShare(env, chatId, from, st, contact){
  if(contact.user_id && String(contact.user_id) !== String(st.userId)){
    await tgSendMessage(env, chatId, "⛔️ این شماره مربوط به خودت نیست. لطفاً با همان اکانت شماره‌ی خودت را Share کن.", mainMenuKeyboard(env));
    return;
  }
  const phone = normalizePhone(contact.phone_number);
  if(!phone || phone.length < 6){
    await tgSendMessage(env, chatId, "شماره نامعتبر است. دوباره تلاش کن.", requestContactKeyboard(env));
    return;
  }
  if(!env.BOT_KV){
    st.phone = phone;
    st.state = "idle";
    await tgSendMessage(env, chatId, "✅ شماره ذخیره شد (KV غیرفعال).", mainMenuKeyboard(env));
    return;
  }

  const bind = await bindPhoneToUser(st.userId, phone, env);
  if(!bind.ok){
    if(bind.reason==="phone_already_used"){
      await tgSendMessage(env, chatId, "⛔️ این شماره قبلاً در سیستم ثبت شده است و قابل استفاده نیست.\n\nاگر فکر می‌کنی اشتباه است، به پشتیبانی پیام بده.", mainMenuKeyboard(env));
      return;
    }
    await tgSendMessage(env, chatId, "⚠️ خطا در ذخیره شماره. دوباره تلاش کن.", requestContactKeyboard(env));
    return;
  }

  st.phone = phone;

  // Referral accepted ONLY if: contact shared + phone is new (we enforce uniqueness here)
  if(st.pendingReferrerId && !st.referrerId && String(st.pendingReferrerId) !== String(st.userId)){
    await creditReferral(env, st.pendingReferrerId, st.userId);
    st.referrerId = st.pendingReferrerId;
  }
  st.pendingReferrerId = null;

  if(st.state==="onboard_contact"){
    st.state="onboard_experience";
    await saveUser(st.userId, st, env);
    await tgSendMessage(env, chatId, "✅ شماره ثبت شد.\n\nسطح تجربه‌ات در بازار چقدر است؟", optionsKeyboard(["مبتدی","متوسط","حرفه‌ای"]));
    return;
  }

  await saveUser(st.userId, st, env);
  await tgSendMessage(env, chatId, "✅ شماره ثبت شد.", mainMenuKeyboard(env));
}

async function attachReferralIfAny(st, code, env){
  const c = String(code||"").trim();
  if(!c || !env.BOT_KV) return;
  const referrerId = await lookupReferrerIdByCode(c, env);
  if(!referrerId) return;
  if(String(referrerId) === String(st.userId)) return;
  if(st.referrerId || st.pendingReferrerId) return;
  st.pendingReferrerId = String(referrerId);
  await saveUser(st.userId, st, env);
}

async function creditReferral(env, referrerId, invitedUserId){
  if(!env.BOT_KV) return;
  const refStRaw = await getUser(referrerId, env);
  if(!refStRaw) return;
  const refSt = patchUser(refStRaw, referrerId);
  refSt.successfulInvites = (refSt.successfulInvites||0) + 1;
  refSt.points = (refSt.points||0) + getRefPointsPerSuccess(env);
  await saveUser(referrerId, refSt, env);

  if(refSt.chatId){
    const msg =
`🎉 معرفی موفق در MarketiQ

✅ یک کاربر جدید با موفقیت ثبت‌نام کرد.
➕ امتیاز دریافت‌شده: ${getRefPointsPerSuccess(env)}
⭐ امتیاز فعلی شما: ${refSt.points}

هر ${getRefPointsForFreeSub(env)} امتیاز = یک اشتراک رایگان (/redeem)`;
    await tgSendMessage(env, refSt.chatId, msg, mainMenuKeyboard(env)).catch(()=>{});
  }
}

async function deliverCustomPromptIfReady(env, st){
  if(!env.BOT_KV) return false;
  if(!st || !st.customPromptReadyAt || !st.customPromptText) return false;
  if(st.customPromptDeliveredAt) return false;

  const readyMs = Date.parse(st.customPromptReadyAt);
  if(!Number.isFinite(readyMs)) return false;
  if(Date.now() < readyMs) return false;

  if(st.chatId){
    const msg =
`✅ پرامپت اختصاصی شما آماده شد

${st.customPromptText}

برای استفاده، وارد تنظیمات شوید و «پرامپت اختصاصی» را انتخاب کنید.`;
    await tgSendMessage(env, st.chatId, msg, mainMenuKeyboard(env)).catch(()=>{});
  }
  st.customPromptDeliveredAt = new Date().toISOString();
  await saveUser(st.userId, st, env);
  return true;
}

/* ========================== CUSTOM PROMPT JOBS (CRON DELIVERY) ========================== */
// We generate the user's custom prompt immediately, but deliver it ~2 hours later.
// To deliver even if user is inactive, we store a KV job key and process it via scheduled events.
async function scheduleCustomPromptJob(env, st){
  if(!env.BOT_KV) return;
  const readyMs = Date.parse(st?.customPromptReadyAt||"");
  if(!Number.isFinite(readyMs)) return;

  const jobKey = `job:customprompt:${readyMs}:${st.userId}`;
  const ptrKey = `job:customprompt_ptr:${st.userId}`;

  try{
    // Replace previous job for this user (if any)
    const prev = await env.BOT_KV.get(ptrKey);
    if(prev) await env.BOT_KV.delete(prev).catch(()=>{});
    await env.BOT_KV.put(jobKey, JSON.stringify({ userId: String(st.userId), readyAt: st.customPromptReadyAt }));
    await env.BOT_KV.put(ptrKey, jobKey);
  }catch(_e){}
}

async function processCustomPromptJobs(env){
  if(!env.BOT_KV?.list) return { ok:false, reason:"kv_list_unavailable" };

  const now = Date.now();
  const maxToProcess = toInt(env.CUSTOM_PROMPT_JOB_BATCH, 200);
  let processed = 0;
  let delivered = 0;
  let cursor;

  try{
    while(processed < maxToProcess){
      const res = await env.BOT_KV.list({ prefix:"job:customprompt:", cursor, limit: 100 });
      cursor = res.cursor;

      if(!Array.isArray(res.keys) || !res.keys.length) break;

      for(const k of res.keys){
        if(processed >= maxToProcess) break;
        processed++;

        const parts = String(k.name||"").split(":");
        // job:customprompt:{ms}:{userId}
        const ms = Number(parts?.[2]);
        const userId = String(parts?.[3]||"").trim();
        if(!Number.isFinite(ms) || ms > now) continue;

        try{
          const st = await ensureUser(userId, env, {});
          const ok = await deliverCustomPromptIfReady(env, st);
          if(ok){
            delivered++;
            await env.BOT_KV.delete(k.name).catch(()=>{});
            await env.BOT_KV.delete(`job:customprompt_ptr:${userId}`).catch(()=>{});
          }
        }catch(e){
          // keep job for retry
          console.error("processCustomPromptJobs item failed:", e?.message || e);
        }
      }

      if(!cursor) break;
    }
  }catch(e){
    console.error("processCustomPromptJobs failed:", e?.message || e);
    return { ok:false, reason:"error" };
  }

  return { ok:true, processed, delivered };
}

/* ========================== ADMIN VIEWS ========================== */
async function adminListUsers(env, chatId){
  if(!env.BOT_KV?.list) return tgSendMessage(env, chatId, "KV list در این محیط فعال نیست.", mainMenuKeyboard(env));
  const list = await env.BOT_KV.list({ prefix:"u:", limit:50 });
  const keys = list?.keys || [];
  if(!keys.length) return tgSendMessage(env, chatId, "کاربری یافت نشد.", mainMenuKeyboard(env));
  const lines=[];
  for(const k of keys.slice(0,30)){
    const id = k.name.replace(/^u:/,"");
    const u = await getUser(id, env);
    const st = patchUser(u||{}, id);
    lines.push(`- ${st.profileName||"-"} | ID:${st.userId} | @${st.username||"-"} | points:${st.points} | invites:${st.successfulInvites}`);
  }
  return tgSendMessage(env, chatId, `👥 لیست کاربران (حداکثر ۳۰):\n\n${lines.join("\n")}\n\nبرای دیدن جزئیات:\n/user USER_ID`, mainMenuKeyboard(env));
}
async function adminShowUser(env, chatId, userIdArg, from){
  const id = String(userIdArg||"").trim();
  if(!id) return tgSendMessage(env, chatId, "فرمت:\n/user USER_ID", mainMenuKeyboard(env));
  const u = await getUser(id, env);
  if(!u) return tgSendMessage(env, chatId, "کاربر پیدا نشد.", mainMenuKeyboard(env));
  const st = patchUser(u, id);
  const quota = await quotaText(st, from, env);
  const sub = isSubscribed(st) ? `✅ تا ${st.subActiveUntil}` : "—";
  const txt =
`👤 مشخصات کاربر
نام: ${st.profileName||"-"}
یوزرنیم: @${st.username||"-"}
ID: ${st.userId}
چت: ${st.chatId||"-"}

📱 شماره: ${st.phone ? "`"+st.phone+"`" : "-"}

⚙️ تنظیمات:
TF=${st.timeframe} | Style=${st.style} | Risk=${st.risk} | News=${st.newsEnabled?"ON":"OFF"}

🧪 سطح:
Experience=${st.experience||"-"} | Preferred=${st.preferredMarket||"-"} | Level=${st.level||"-"} | Score=${st.levelScore ?? "-"}

🎁 رفرال:
invites=${st.successfulInvites} | points=${st.points} | referrer=${st.referrerId||"-"}

💳 اشتراک:
${sub}

📊 سهمیه امروز:
${quota}`;
  return tgSendMessage(env, chatId, txt, mainMenuKeyboard(env));
}

/* ========================== REQUEST TO ADMINS/OWNERS ========================== */
async function requestToAdmins(env, st, message){
  const ids = parseIds(env.ADMIN_NOTIFY_CHAT_IDS || env.ADMIN_CHAT_IDS || env.NOTIFY_CHAT_IDS || "");
  if(!ids.length) return;
  const payload = `${message}\n\nUser: ${st.profileName||"-"} | ID:${st.userId} | @${st.username||"-"}`;
  for(const id of ids){ await tgSendMessage(env, id, payload).catch(()=>{}); }
}

/* ========================== SUBSCRIPTION / REDEEM ========================== */
function extendIsoDate(curIso, addDays){
  const now = Date.now();
  const cur = Date.parse(curIso||"");
  const base = Number.isFinite(cur) && cur > now ? cur : now;
  return new Date(base + Number(addDays)*24*60*60*1000).toISOString();
}
async function redeemPointsForSubscription(env, chatId, from, st){
  if(!env.BOT_KV) return tgSendMessage(env, chatId, "KV فعال نیست. این قابلیت در این محیط کار نمی‌کند.", mainMenuKeyboard(env));
  const pts = st.points || 0;
  if(pts < REF_POINTS_FOR_FREE_SUB){
    return tgSendMessage(env, chatId, `امتیاز کافی نیست.\nامتیاز فعلی: ${pts}\nحداقل برای اشتراک رایگان: ${REF_POINTS_FOR_FREE_SUB}`, mainMenuKeyboard(env));
  }
  const days = toInt(env.FREE_SUB_DAYS_PER_REDEEM, 30);
  st.points = pts - REF_POINTS_FOR_FREE_SUB;
  st.freeSubRedeemed = (st.freeSubRedeemed||0) + 1;
  st.subActiveUntil = extendIsoDate(st.subActiveUntil, days);
  await saveUser(st.userId, st, env);
  return tgSendMessage(env, chatId, `✅ اشتراک رایگان فعال شد.\nمدت: ${days} روز\nتا تاریخ: ${st.subActiveUntil}\nامتیاز باقی‌مانده: ${st.points}`, mainMenuKeyboard(env));
}

/* ========================== REFERRAL INFO ========================== */
async function sendReferralInfo(env, chatId, from, st){
  // Ensure user has referral codes
  try{ if(env.BOT_KV) await ensureReferralCodes(st.userId, env); }catch(_e){}

  const botUsername = (env.BOT_USERNAME||"").toString().replace(/^@/,"").trim();
  const codes = Array.isArray(st.refCodes) ? st.refCodes.slice(0, REF_CODES_PER_USER) : [];
  const links = codes.map((c,i)=>{
    const link = botUsername ? `https://t.me/${botUsername}?start=${c}` : `start=${c}`;
    return `${i+1}) ${link}`;
  });

  const inviteCount = Number(st.successfulInvites||0);
  const step = toInt(env.REF_COMMISSION_STEP_PCT, 4);      // 1 invite => 4%
  const maxPct = toInt(env.REF_COMMISSION_MAX_PCT, 20);    // 5 invites => 20%
  const pct = Math.min(maxPct, Math.max(0, inviteCount) * step);
  const currency = await getSubCurrency(env);

  const stats =
`🎁 دعوت دوستان

📌 قوانین پذیرش:
- فقط زمانی معرفی ثبت می‌شود که کاربر دعوت‌شده «Share Contact» بزند.
- شماره باید جدید باشد (قبلاً در سیستم ثبت نشده باشد).

✅ پاداش:
- هر معرفی موفق: ${getRefPointsPerSuccess(env)} امتیاز
- هر ${getRefPointsForFreeSub(env)} امتیاز: یک اشتراک رایگان (/redeem)

💸 پاداش تمدید/خرید اشتراک دوست:
- درصد براساس تعداد «معرفی موفق» شما محاسبه می‌شود (تا ۵ نفر)
- درصد فعلی شما: ${pct}%

📊 آمار شما:
invites=${st.successfulInvites} | points=${st.points} | commissionTotal=${Number(st.refCommissionTotal||0).toFixed(2)} ${currency}`;

  const msg =
`${stats}

🔗 لینک‌های اختصاصی (${REF_CODES_PER_USER} عدد):
${links.length ? links.join("\n") : "—"}`;

  return tgSendMessage(env, chatId, msg, mainMenuKeyboard(env));
}

/* ========================== TEXTS ========================== */
async function sendSettingsSummary(env, chatId, st, from){
  const quota = await quotaText(st, from, env);
  const sub = isSubscribed(st) ? `✅ فعال تا ${st.subActiveUntil}` : "—";
  const w = await getWallet(env);
  const txt =
`⚙️ تنظیمات:

⏱ تایم‌فریم: ${st.timeframe}
🎯 سبک: ${st.style}
⚠️ ریسک: ${st.risk}
📰 خبر: ${st.newsEnabled ? "روشن ✅" : "خاموش ❌"}

🧪 سطح: ${st.level || "-"}
🎯 بازار پیشنهادی: ${st.suggestedMarket || "-"}

💳 اشتراک: ${sub}
💳 ولت: ${w ? w : "—"}

📊 سهمیه امروز: ${quota}

📌 نکته: پرامپت‌های تحلیل فقط توسط ادمین/اونر تعیین می‌شوند.`;
  return tgSendMessage(env, chatId, txt, settingsMenuKeyboard(env));
}

async function profileText(st, from, env){
  const quota = await quotaText(st, from, env);
  const roleTag = isPrivileged(from, env) ? "🛡️ مدیریت" : "👤 کاربر";
  const sub = isSubscribed(st) ? `✅ تا ${st.subActiveUntil}` : "—";
  const canRedeem = (st.points||0) >= REF_POINTS_FOR_FREE_SUB ? "✅ دارد" : "—";
  const botUsername = (env.BOT_USERNAME || "").toString().replace(/^@/, "").trim();
  const code = Array.isArray(st.refCodes) && st.refCodes.length ? st.refCodes[0] : "";
  const refLink = (botUsername && code) ? `https://t.me/${botUsername}?start=${code}` : (code || "—");
  return `👤 پروفایل MarketiQ

وضعیت: ${roleTag}
نام: ${st.profileName || "-"}
یوزرنیم: @${st.username || "-"}
🆔 ID: ${st.userId}
📱 شماره: ${st.phone ? st.phone : "—"}
📅 امروز: ${kyivDateString()}
📊 سهمیه امروز: ${quota}

🔗 لینک رفرال شما: ${refLink}

🎁 رفرال: invites=${st.successfulInvites} | points=${st.points} | redeem=${canRedeem}
💰 کمیسیون رفرال: ${Number(st.refCommissionTotal||0).toFixed(2)} ${await getSubCurrency(env)}
💳 اشتراک: ${sub}

🏦 کیف پول:
موجودی: ${Number(st.walletBalance||0).toFixed(2)}
درخواست‌های واریز: ${st.walletDepositRequests||0}
درخواست‌های برداشت: ${st.walletWithdrawRequests||0}
آدرس BEP20: ${st.bep20Address ? "`"+st.bep20Address+"`" : "— (برای برداشت لازم است)"}`;
}

/* ========================== LEVELING ========================== */
async function startLeveling(env, chatId, from, st){
  if(!st.profileName || !st.phone){
    await tgSendMessage(env, chatId, "برای تعیین سطح، ابتدا نام و شماره را تکمیل کن ✅", mainMenuKeyboard(env));
    await startOnboardingIfNeeded(env, chatId, from, st);
    return;
  }
  st.quiz={active:false, idx:0, answers:[]};
  st.state="onboard_experience";
  await saveUser(st.userId, st, env);
  await tgSendMessage(env, chatId, "🧪 تعیین سطح MarketiQ\n\nسطح تجربه‌ات در بازار چقدر است؟", optionsKeyboard(["مبتدی","متوسط","حرفه‌ای"]));
}
async function startQuiz(env, chatId, st){
  st.quiz={ active:true, idx:0, answers:[] };
  st.state="idle";
  await saveUser(st.userId, st, env);
  const q = QUIZ[0];
  await tgSendMessage(env, chatId, "🧪 تست تعیین سطح شروع شد.\n\n"+q.q, quizKeyboard(q));
}

async function sendBuyInfo(env, chatId, from, st){
  // Keep user-facing texts friendly (no technical errors)
  if(!isOnboardComplete(st)){
    await tgSendMessage(env, chatId, "برای خرید/فعال‌سازی اشتراک، ابتدا پروفایل را کامل کن (نام + شماره).", mainMenuKeyboard(env));
    return;
  }

  const wallet = await getWallet(env);
  const price = await getSubPrice(env);
  const currency = await getSubCurrency(env);
  const days = await getSubDays(env);
  const payUrl = paymentPageUrl(env);
  const support = env.SUPPORT_HANDLE || "@support";

  let msg = `💳 خرید اشتراک ${BRAND}\n\n`;
  msg += (price && price > 0) ? `مبلغ: *${price} ${currency}* | مدت: *${days} روز*\n\n` : `مبلغ: —\n\n`;
  msg += wallet ? `آدرس ولت:\n\`${wallet}\`\n\n` : `آدرس ولت هنوز تنظیم نشده است.\n\n`;
  msg += `بعد از پرداخت، TxID را در همین بات ثبت کن:\n/tx YOUR_TXID\n\nاگر مشکلی بود به پشتیبانی پیام بده: ${support}\n`;
  if(payUrl) msg += `\n🔗 صفحه پرداخت:\n${payUrl}`;

  await tgSendMessage(env, chatId, msg, mainMenuKeyboard(env));

  // Send QR as image (optional)
  if(wallet){
    const qr = `https://quickchart.io/qr?text=${encodeURIComponent(wallet)}&size=512&margin=1`;
    await tgSendPhotoByUrl(env, chatId, qr, "QR Code ولت").catch(()=>{});
  }
}

async function handleSetPrice(env, chatId, argRaw){
  const parts = String(argRaw||"").trim().split(/\s+/).filter(Boolean);
  if(!parts.length){
    return tgSendMessage(env, chatId, "فرمت درست:\n/setprice 10 USDT 30\n\n(مقدار، واحد، مدت روز)", mainMenuKeyboard(env));
  }
  const amount = parts[0];
  const cur = parts[1];
  const days = parts[2];

  try{
    const p = await setSubPrice(env, amount);
    let c = await getSubCurrency(env);
    let d = await getSubDays(env);
    if(cur) c = await setSubCurrency(env, cur);
    if(days) d = await setSubDays(env, days);

    return tgSendMessage(env, chatId, `✅ قیمت اشتراک تنظیم شد:\n${p} ${c} | مدت: ${d} روز`, mainMenuKeyboard(env));
  }catch(_e){
    return tgSendMessage(env, chatId, "⚠️ ذخیره قیمت ناموفق بود. مقدار را بررسی کن.", mainMenuKeyboard(env));
  }
}

/* ========================== FLOWS ========================== */
async function runSignalTextFlow(env, chatId, from, st, symbol, userPrompt){
  symbol = normalizeSymbol(symbol);
  const tf = (st.timeframe || "H4");

  // quick feedback
  await tgSendChatAction(env, chatId, "typing").catch(()=>{});

  try{
    const candles = await getMarketCandlesWithFallback(env, symbol, tf);
    if(!candles || candles.length < 60){
      await tgSendMessage(env, chatId, "فعلاً دادهٔ کافی برای این نماد ندارم. لطفاً کمی بعد دوباره امتحان کنید.");
      return;
    }

    const snap = computeSnapshot(candles);
    const ohlc = candlesToCompactCSV(candles, 80);

    // Optional Binance ticker snapshot (for crypto)
    let binanceBlock = "";
    if(symbol.endsWith("USDT")){
      try{
        const t = await fetchBinanceTicker24h(symbol, toInt(env.MARKET_TIMEOUT_MS, 8000), toInt(env.BINANCE_TICKER_CACHE_TTL_SEC, 60));
        if(t && Number.isFinite(t.last)){
          binanceBlock = `BINANCE_24H: last=${t.last} change%=${t.changePct} high=${t.high} low=${t.low} vol=${t.vol}`;
        }
      }catch(_e){}
    }

    // Optional news headlines (newsdata.io)
    let headlines = [];
    if(st.newsEnabled){
      headlines = await fetchNewsHeadlines(env, symbol, tf);
    }
    const newsBlock = st.newsEnabled ? formatNewsForPrompt(headlines, 5) : "NEWS_HEADLINES: (disabled)";

    const marketBlock =
      `lastPrice=${snap?.lastPrice}
`+
      `changePct=${snap?.changePct}%
`+
      `range50={lo:${snap?.range50?.lo},hi:${snap?.range50?.hi}}
`+
      `trend50=${snap?.trend50}
`+
      `volatility50=${snap?.volatility50}
`+
      (binanceBlock ? `${binanceBlock}
` : "")+
      `${newsBlock}

`+
      `OHLC_CSV (${tf}) last ${Math.min(candles.length, 80)}:
${ohlc}`;

    const prompt = await buildTextPromptForSymbol(env, symbol, userPrompt, st, marketBlock);
    let draft;
    try {
      draft = await runTextProviders(prompt, env, st.textOrder);
    } catch (e) {
      console.log("text providers failed:", e?.message || e);
      draft = heuristicAnalysisText(symbol, tf, snap, headlines, st);
    }

    let polished = draft;
    try {
      polished = await runPolishProviders(draft, env, st.polishOrder);
    } catch (e) {
      console.log("polish providers failed:", e?.message || e);
    }

    // Chart rendering (candlestick + zones/levels)
    if((env.RENDER_CHART || "1") !== "0"){
      try{
        const plan = await extractRenderPlan(env, polished, candles, st);
        const cfg = buildQuickChartCandlestickConfig(symbol, tf, candles, plan);
        const imgUrl = await buildQuickChartImageUrl(env, cfg);
        if(imgUrl){
          await tgSendPhotoByUrl(env, chatId, imgUrl, `📊 ${symbol} · ${tf}`);
        }
      }catch(e){
        console.error("chart render failed:", e?.message || e);
      }
    }

    // Send analysis in chunks
    for(const part of chunkText(polished, 3500)){
      await tgSendMessage(env, chatId, part, mainMenuKeyboard(env));
    }

    // Send headlines as short add-on (optional)
    if(st.newsEnabled && Array.isArray(headlines) && headlines.length){
      const list = headlines.slice(0, 5).map(h => `- ${h.source ? "["+h.source+"] " : ""}${h.title}`).join("\n");
      await tgSendMessage(env, chatId, `📰 تیترهای خبری مرتبط:
${list}`, mainMenuKeyboard(env));
    }

  }catch(e){
    console.error("runSignalTextFlow error:", e?.message || e);
    // Do not show raw errors to user
    const msg = isPrivileged(from, env)
      ? `⚠️ خطا در تحلیل: ${e?.message || e}`
      : "متأسفانه الان نمی‌تونم تحلیل رو انجام بدم. لطفاً چند دقیقه دیگه دوباره تلاش کنید.";
    await tgSendMessage(env, chatId, msg, mainMenuKeyboard(env));
  }
}

async function handleVisionFlow(env, chatId, from, userId, st, fileId){
  if(env.BOT_KV && !(await canAnalyzeToday(st, from, env))){
    const lim = await dailyLimitForUser(st, from, env);
    await tgSendMessage(env, chatId, `⛔️ سهمیه امروزت تموم شده (${Number.isFinite(lim)?lim:"∞"} تحلیل در روز).`, mainMenuKeyboard(env));
    return;
  }
  await tgSendMessage(env, chatId, "🖼️ عکس دریافت شد… در حال تحلیل ویژن 🔍", kb([[BTN.HOME]]));
  const t = stopToken();
  const typingTask = typingLoop(env, chatId, t);
  try{
    const filePath = await tgGetFilePath(env, fileId);
    if(!filePath) throw new Error("no_file_path");
    const imageUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;

    if(env.BOT_KV){ await consumeDaily(st, from, env); await saveUser(userId, st, env); }

    const vPrompt = await buildVisionPrompt(env, st);
    const visionRaw = await runVisionProviders(imageUrl, vPrompt, env, st.visionOrder);

    const tf = st.timeframe || "H4";
    const base = await buildBasePrompt(env, tf);
    const finalPrompt =
      `${base}\n\nورودی ویژن (مشاهدات تصویر):\n${visionRaw}\n\n`+
      `وظیفه: بر اساس همین مشاهده‌ها خروجی دقیق ۱ تا ۵ بده. سطح‌ها را مشخص کن.\n`+
      `قوانین: فقط فارسی، لحن افشاگر، خیال‌بافی نکن.\n`;

    const draft = await runTextProviders(finalPrompt, env, st.textOrder);
    const polished = await runPolishProviders(draft, env, st.polishOrder);

    t.stop=true;
    await Promise.race([typingTask, sleep(10)]).catch(()=>{});

    for(const part of chunkText(polished, 3500)) await tgSendMessage(env, chatId, part, mainMenuKeyboard(env));
  } catch(e){
    console.error("handleVisionFlow error:", e);
    t.stop=true;
    await tgSendMessage(env, chatId, "⚠️ فعلاً امکان تحلیل تصویر نیست. لطفاً کمی بعد دوباره تلاش کن.", mainMenuKeyboard(env));
  }
}

/* ========================== Mini App helper APIs ========================== */

function heuristicAnalysisText(symbol, tf, snap, headlines, st){
  const last = Number(snap?.lastPrice);
  const lo = Number(snap?.range50?.lo);
  const hi = Number(snap?.range50?.hi);
  const trend = (snap?.trend50 || "FLAT").toUpperCase();
  const vol = (snap?.volatility50 || "MED").toUpperCase();

  const hasNums = Number.isFinite(last) && Number.isFinite(lo) && Number.isFinite(hi) && hi > lo;
  if(!hasNums){
    return `📌 تحلیل خودکار (بدون AI)

نماد: ${symbol}
تایم‌فریم: ${tf}

داده کافی برای تحلیل دقیق موجود نیست. لطفاً دوباره تلاش کن یا تایم‌فریم را تغییر بده.`;
  }

  const range = hi - lo;
  const lvl38 = lo + range * 0.382;
  const lvl62 = lo + range * 0.618;

  const riskPct = (vol === "HIGH") ? 0.02 : (vol === "LOW" ? 0.01 : 0.015);
  const stop = Math.max(0, last * (1 - riskPct));
  const t1 = (trend === "DOWN") ? Math.max(0, last * (1 + riskPct)) : lvl62;
  const t2 = (trend === "DOWN") ? lvl62 : hi;

  const bias =
    trend === "UP" ? "صعودی" :
    trend === "DOWN" ? "نزولی" : "خنثی";

  const noteNews = (st?.newsEnabled && Array.isArray(headlines) && headlines.length)
    ? `

📰 خبرهای مرتبط فعال است؛ در تصمیم‌گیری حتماً نوسانات خبری را در نظر بگیر.`
    : "";

  return (
`📌 تحلیل خودکار (بدون AI)

`+
`نماد: ${symbol}
`+
`تایم‌فریم: ${tf}

`+
`🧭 جهت کلی: ${bias}
`+
`🌊 نوسان: ${vol}

`+
`📍 سطوح کلیدی:
`+
`- حمایت: ${lo}
`+
`- میانه (38%): ${Number(lvl38.toFixed(6))}
`+
`- میانه (62%): ${Number(lvl62.toFixed(6))}
`+
`- مقاومت: ${hi}

`+
`🧠 سناریوها:
`+
`1) اگر قیمت بالای ${Number(lvl62.toFixed(6))} تثبیت شود → ادامه حرکت تا ${hi}
`+
`2) اگر قیمت زیر ${Number(lvl38.toFixed(6))} برگردد → احتمال برگشت به ${lo}

`+
`🎯 پلن پیشنهادی (آموزشی):
`+
`- ورود پله‌ای نزدیک حمایت/بریک‌اوت معتبر
`+
`- حدضرر تقریبی: ${Number(stop.toFixed(6))}
`+
`- تارگت ۱: ${Number(t1.toFixed(6))}
`+
`- تارگت ۲: ${Number(t2.toFixed(6))}

`+
`⚠️ این خروجی صرفاً آموزشی است و توصیه مالی نیست.`+
noteNews
  );
}


async function runSignalTextFlowReturnText(env, from, st, symbol, userPrompt){
  symbol = normalizeSymbol(symbol);
  const tf = (st.timeframe || "H4");

  const candles = await getMarketCandlesWithFallback(env, symbol, tf);
  if(!candles || candles.length < 60) return { text: "فعلاً دادهٔ کافی برای این نماد ندارم.", chartUrl: "", headlines: [] };

  const snap = computeSnapshot(candles);
  const ohlc = candlesToCompactCSV(candles, 80);

  // Optional Binance ticker snapshot (for crypto)
  let binanceBlock = "";
  if(symbol.endsWith("USDT")){
    try{
      const t = await fetchBinanceTicker24h(symbol, toInt(env.MARKET_TIMEOUT_MS, 8000), toInt(env.BINANCE_TICKER_CACHE_TTL_SEC, 60));
      if(t && Number.isFinite(t.last)){
        binanceBlock = `BINANCE_24H: last=${t.last} change%=${t.changePct} high=${t.high} low=${t.low} vol=${t.vol}`;
      }
    }catch(_e){}
  }

  // Optional news headlines
  let headlines = [];
  if(st.newsEnabled){
    headlines = await fetchNewsHeadlines(env, symbol, tf);
  }
  const newsBlock = st.newsEnabled ? formatNewsForPrompt(headlines, 5) : "NEWS_HEADLINES: (disabled)";

  const marketBlock =
    `lastPrice=${snap.lastPrice}
`+
    `changePct=${snap.changePct}%
`+
    `range50={lo:${snap.range50.lo},hi:${snap.range50.hi}}
`+
    `trend50=${snap.trend50}
`+
    `volatility50=${snap.volatility50}
`+
    (binanceBlock ? `${binanceBlock}
` : "")+
    `${newsBlock}

`+
    `OHLC_CSV (${tf}) last ${Math.min(candles.length, 80)}:
${ohlc}`;

  const prompt = await buildTextPromptForSymbol(env, symbol, userPrompt, st, marketBlock);
    let draft;
    try {
      draft = await runTextProviders(prompt, env, st.textOrder);
    } catch (e) {
      console.log("text providers failed:", e?.message || e);
      draft = heuristicAnalysisText(symbol, tf, snap, headlines, st);
    }

    let polished = draft;
    try {
      polished = await runPolishProviders(draft, env, st.polishOrder);
    } catch (e) {
      console.log("polish providers failed:", e?.message || e);
    }

  // Chart URL for mini-app
  let chartUrl = "";
  if((env.RENDER_CHART || "1") !== "0"){
    try{
      const plan = await extractRenderPlan(env, polished, candles, st);
      const cfg = buildQuickChartCandlestickConfig(symbol, tf, candles, plan);
      chartUrl = await buildQuickChartImageUrl(env, cfg);
    }catch(e){
      console.error("chart render (miniapp) failed:", e?.message || e);
      chartUrl = "";
    }
  }

  return { text: polished, chartUrl, headlines };
}

/* ========================== TELEGRAM MINI APP INITDATA VERIFY ========================== */

async function authMiniApp(body, env) {
  // Dev-mode bypass for local/browser testing (ONLY if DEV_MODE=1).
  // Use ?dev=1 in the Mini App URL; the frontend will send {dev:true,userId:"..."}.
  if (body && body.dev === true && String(env.DEV_MODE || "") === "1") {
    const uid = String(body.userId || "999000").trim() || "999000";
    return { ok: true, userId: uid, fromLike: { username: "dev" }, dev: true };
  }
  const ttl = Number(env.TELEGRAM_INITDATA_TTL_SEC || 21600);
  return verifyTelegramInitData(body?.initData, env.TELEGRAM_BOT_TOKEN, ttl);
}

async function verifyTelegramInitData(initData, botToken, ttlSec){
  if(!initData || typeof initData !== "string") return { ok:false, reason:"initData_missing" };
  if(!botToken) return { ok:false, reason:"bot_token_missing" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if(!hash) return { ok:false, reason:"hash_missing" };
  params.delete("hash");

  const authDate = Number(params.get("auth_date") || "0");
  if(!Number.isFinite(authDate) || authDate <= 0) return { ok:false, reason:"auth_date_invalid" };
  const now = Math.floor(Date.now()/1000);
  const ttl = Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : 21600;
  if(now - authDate > ttl) return { ok:false, reason:"initData_expired" };

  const pairs=[];
  for(const [k,v] of params.entries()) pairs.push([k,v]);
  pairs.sort((a,b)=>a[0].localeCompare(b[0]));
  const dataCheckString = pairs.map(([k,v])=>`${k}=${v}`).join("\n");

  const secretKey = await hmacSha256Raw(utf8("WebAppData"), utf8(botToken));
  const sigHex = await hmacSha256Hex(secretKey, utf8(dataCheckString));

  if(!timingSafeEqualHex(sigHex, hash)) return { ok:false, reason:"hash_mismatch" };

  const user = safeJsonParse(params.get("user") || "") || {};
  const userId = user?.id;
  if(!userId) return { ok:false, reason:"user_missing" };
  const fromLike = { username: user?.username || "", id: userId };
  return { ok:true, userId, fromLike };
}
function utf8(s){ return new TextEncoder().encode(String(s)); }
async function hmacSha256Raw(keyBytes, msgBytes){
  const key = await crypto.subtle.importKey("raw", keyBytes, { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, msgBytes);
  return new Uint8Array(sig);
}
async function hmacSha256Hex(keyBytes, msgBytes){
  const key = await crypto.subtle.importKey("raw", keyBytes, { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, msgBytes);
  return toHex(new Uint8Array(sig));
}
function toHex(u8){ let out=""; for(const b of u8) out += b.toString(16).padStart(2,"0"); return out; }
function timingSafeEqualHex(a,b){
  a=String(a||"").toLowerCase(); b=String(b||"").toLowerCase();
  if(a.length !== b.length) return false;
  let diff=0;
  for(let i=0;i<a.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff===0;
}

/* ========================== WORKER RESPONSE HELPERS ========================== */
function escapeHtml(s){
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function buildPaymentPageHtml({ brand, wallet, price, currency, days, support }){
  const amount = price || 0;
  const cur = currency || "USDT";
  const dur = days || 30;

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${brand} | پرداخت</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; margin:16px; color:#111; background:#fafafa}
    .card{background:#fff; border:1px solid #e6e6e6; border-radius:16px; padding:14px; margin-bottom:12px}
    .row{display:flex; gap:12px; flex-wrap:wrap}
    .col{flex:1 1 280px}
    .muted{color:#666; font-size:12px; line-height:1.6}
    code{background:#f2f2f2; padding:4px 8px; border-radius:10px}
    input,button{width:100%; padding:12px; border-radius:12px; border:1px solid #d0d0d0; margin-top:8px; font-size:15px}
    button{cursor:pointer; background:#111; color:#fff; border:none}
    button.secondary{background:#fff; color:#111; border:1px solid #d0d0d0}
    #msg{margin-top:10px; font-size:13px}
    .ok{color:#0a7}
    .bad{color:#c00}
    img{max-width:100%; height:auto; border-radius:14px; border:1px solid #eee}
    .title{margin:0 0 6px 0}
  </style>
</head>
<body>
  <div class="card">
    <h2 class="title">💳 خرید اشتراک ${brand}</h2>
    <div class="muted">۱) پرداخت را انجام بده. ۲) TxID را ثبت کن (اینجا یا داخل بات با <code>/tx</code>). ۳) بعد از تایید مدیریت، اشتراک فعال می‌شود.</div>
  </div>

  <div class="card">
    <div><b>قیمت:</b> ${amount} ${cur}</div>
    <div><b>مدت:</b> ${dur} روز</div>
    <div style="margin-top:10px"><b>آدرس ولت (فقط همین):</b></div>
    <div style="word-break:break-all"><code id="wallet">${wallet || "—"}</code></div>
    <div class="muted" style="margin-top:6px">روی آدرس بزن تا کپی شود.</div>
  </div>

  <div class="card">
    <div class="row">
      <div class="col">
        <h3 class="title">📷 QR Code</h3>
        <div id="qrWrap">${wallet ? `<img alt="QR" src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(wallet)}"/>` : "—"}</div>
        <div class="muted" style="margin-top:8px">QR فقط آدرس ولت را نشان می‌دهد.</div>
      </div>
      <div class="col">
        <h3 class="title">🧾 ثبت TxID</h3>
        <input id="txid" placeholder="TxID / Hash تراکنش را وارد کن" />
        <button id="submitBtn">ثبت TxID</button>
        <div id="msg" class="muted"></div>
        <div class="muted" style="margin-top:10px">
          اگر این صفحه خارج از تلگرام باز شده باشد، دکمه ثبت کار نمی‌کند؛ از بات استفاده کن.<br/>
          پشتیبانی: <b>${support || ""}</b>
        </div>
        <button id="closeBtn" class="secondary" style="margin-top:10px">بستن</button>
      </div>
    </div>
  </div>

  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script>
    const tg = window.Telegram?.WebApp;
    try{ tg?.ready(); }catch(e){}

    const msg = document.getElementById("msg");
    const txInput = document.getElementById("txid");
    const walletEl = document.getElementById("wallet");

    walletEl?.addEventListener("click", async ()=>{
      try{
        await navigator.clipboard.writeText(walletEl.textContent.trim());
        msg.textContent = "✅ آدرس کپی شد";
        msg.className = "ok";
      }catch(e){ /* ignore */ }
    });

    document.getElementById("submitBtn").addEventListener("click", async ()=>{
      const txid = (txInput.value||"").trim();
      if(!txid){
        msg.textContent = "TxID را وارد کن.";
        msg.className = "bad";
        return;
      }
      if(!tg?.initData){
        msg.textContent = "این صفحه باید داخل تلگرام باز شود. (یا از /tx در بات استفاده کن)";
        msg.className = "bad";
        return;
      }

      msg.textContent = "در حال ثبت...";
      msg.className = "muted";
      try{
        const r = await fetch("/api/payment/submit", {
          method:"POST",
          headers:{"content-type":"application/json"},
          body: JSON.stringify({ initData: tg.initData, txid })
        });
        const j = await r.json().catch(()=>null);
        if(j?.ok){
          msg.textContent = "✅ ثبت شد. بعد از تایید مدیریت، اشتراک فعال می‌شود.";
          msg.className = "ok";
          txInput.value = "";
        }else{
          msg.textContent = "ثبت انجام نشد. لطفاً دوباره چک کن یا از /tx استفاده کن.";
          msg.className = "bad";
        }
      }catch(e){
        msg.textContent = "ثبت انجام نشد. لطفاً بعداً تلاش کن.";
        msg.className = "bad";
      }
    });

    document.getElementById("closeBtn").addEventListener("click", ()=> {
      try{ tg?.close(); }catch(e){ window.close(); }
    });
  </script>
</body>
</html>`;
}

/* ========================== MINI APP ASSETS (SMALL) ========================== */
const ADMIN_APP_HTML = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${BRAND}</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; margin:0; background:#0b0f17; color:#e8eefc}
    header{padding:14px 14px 10px 14px; border-bottom:1px solid rgba(255,255,255,.08)}
    h1{margin:0; font-size:18px}
    .sub{font-size:12px; color:rgba(232,238,252,.7); margin-top:4px}
    .wrap{padding:14px; max-width:860px; margin:0 auto}
    .card{background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.10); border-radius:16px; padding:14px; margin-bottom:12px}
    .row{display:flex; gap:12px; flex-wrap:wrap}
    .col{flex:1 1 240px}
    label{display:block; font-size:12px; color:rgba(232,238,252,.75); margin-bottom:6px}
    select,input,textarea{width:100%; padding:11px 12px; border-radius:12px; border:1px solid rgba(255,255,255,.14); background:rgba(0,0,0,.25); color:#e8eefc; outline:none}
    textarea{min-height:90px; resize:vertical}
    button{padding:11px 12px; border-radius:12px; border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.10); color:#e8eefc; cursor:pointer}
    button.primary{background:#2f6bff; border-color:#2f6bff}
    button.danger{background:#ff4d4d; border-color:#ff4d4d}
    button.ok{background:#2fe3a5; border-color:#2fe3a5; color:#0b0f17}
    .pill{display:inline-block; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12); font-size:12px; margin-left:6px}
    .muted{color:rgba(232,238,252,.7); font-size:12px; line-height:1.6}
    .out{white-space:pre-wrap; font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size:13px; background:rgba(0,0,0,.25); padding:12px; border-radius:12px; border:1px solid rgba(255,255,255,.12)}
    img{max-width:100%; height:auto; border-radius:16px; border:1px solid rgba(255,255,255,.12)}
    .hidden{display:none}
    .list{margin:0; padding:0 18px}
    .list li{margin:6px 0}
    .hr{height:1px; background:rgba(255,255,255,.10); margin:12px 0}
    .toast{position:fixed; bottom:14px; left:14px; right:14px; max-width:860px; margin:0 auto; background:rgba(0,0,0,.7); border:1px solid rgba(255,255,255,.14); padding:10px 12px; border-radius:12px; font-size:13px}
  </style>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
</head>
<body>
  <header>
    <h1>${BRAND}</h1>
    <div class="sub">تحلیل تکنیکال + اخبار + رندر چارت (قابل نمایش در تلگرام)</div>
  </header>

  <div class="wrap">
    <div class="card">
      <div class="row">
        <div class="col">
          <div><span class="pill" id="quota">…</span><span class="pill" id="sub">…</span><span class="pill hidden" id="rolePill">ADMIN</span></div>
          <div class="muted" id="welcome" style="margin-top:10px"></div>
        </div>
        <div class="col">
          <button id="buyBtn" class="primary">خرید / تمدید اشتراک</button>
          <button id="closeBtn" style="margin-top:10px">بستن</button>
        </div>
      </div>
    </div>

    <div class="card" id="onboardCard" class="hidden">
      <div class="muted">برای استفاده کامل، پروفایل را در ربات تکمیل کن (نام + شماره). سپس دوباره این پنل را باز کن.</div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 10px 0">⚙️ تنظیمات</h3>
      <div class="row">
        <div class="col">
          <label>تایم‌فریم</label>
          <select id="tf">
            <option value="M15">M15</option>
            <option value="H1">H1</option>
            <option value="H4" selected>H4</option>
            <option value="D1">D1</option>
          </select>
        </div>
        <div class="col">
          <label>سبک</label>
          <select id="style">
            <option value="rtm">RTM</option>
            <option value="ict">ICT</option>
            <option value="price_action">پرایس اکشن</option>
            <option value="smart" selected>اسمارت‌مانی</option>
            <option value="scalp">اسکالپ</option>
            <option value="swing">سوئینگ</option>
            <option value="intraday">اینترادی</option>
            <option value="prompt">پرامپت</option>
            <option value="custom_method">روش اختصاصی</option>
            <option value="custom_prompt">پرامپت اختصاصی</option>
          </select>
        </div>
        <div class="col">
          <label>ریسک</label>
          <select id="risk">
            <option value="low">کم</option>
            <option value="mid" selected>متوسط</option>
            <option value="high">زیاد</option>
          </select>
        </div>
        <div class="col">
          <label>اخبار</label>
          <select id="news">
            <option value="1" selected>فعال</option>
            <option value="0">غیرفعال</option>
          </select>
        </div>
      </div>
      <div style="margin-top:10px">
        <button id="saveSettingsBtn" class="ok">ذخیره تنظیمات</button>
        <span class="muted" id="settingsMsg" style="margin-right:10px"></span>
      </div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 10px 0">📈 تحلیل</h3>
      <div class="row">
        <div class="col">
          <label>نماد</label>
          <select id="symbol"></select>
        </div>
        <div class="col">
          <label>درخواست (اختیاری)</label>
          <input id="prompt" placeholder="مثلاً: دنبال ورود کم‌ریسک هستم" />
        </div>
      </div>
      <div style="margin-top:10px">
        <button id="analyzeBtn" class="primary">تحلیل کن</button>
        <span class="muted" id="analyzeMsg" style="margin-right:10px"></span>
      </div>

      <div class="hr"></div>

      <div id="chartWrap" class="hidden">
        <img id="chartImg" alt="chart"/>
        <div class="muted" style="margin-top:8px">اگر تصویر لود نشد، دوباره «تحلیل کن» را بزن.</div>
        <div class="hr"></div>
      </div>

      <div class="out" id="result">—</div>

      <div id="newsWrap" class="hidden" style="margin-top:12px">
        <div class="hr"></div>
        <div class="muted"><b>📰 تیترهای خبری مرتبط</b></div>
        <ul class="list" id="newsList"></ul>
      </div>
    </div>

    <div class="card hidden" id="adminCard">
      <h3 style="margin:0 0 10px 0">🛠️ پنل مدیریت</h3>
      <div class="muted">فقط ادمین/اونر این بخش را می‌بینند.</div>

      <div class="hr"></div>

      <div class="row">
        <div class="col">
          <label>قیمت اشتراک</label>
          <input id="admPrice" />
        </div>
        <div class="col">
          <label>واحد</label>
          <input id="admCurrency" />
        </div>
        <div class="col">
          <label>روز اشتراک</label>
          <input id="admDays" />
        </div>
      </div>

      <div class="row" style="margin-top:10px">
        <div class="col">
          <label>سقف روزانه رایگان</label>
          <input id="admFreeLimit" />
        </div>
        <div class="col">
          <label>سقف روزانه اشتراک</label>
          <input id="admSubLimit" />
        </div>
        <div class="col">
          <label>سقف ماهانه کاربر</label>
          <input id="admMonthlyLimit" />
        </div>
      </div>

      <div class="row" style="margin-top:10px">
        <div class="col" id="walletCol">
          <label>ولت (فقط ادمین)</label>
          <input id="admWallet" />
        </div>
        <div class="col">
          <label>بنر آفر ویژه (فعال/غیرفعال)</label>
          <select id="admOfferEnabled"><option value="0">خاموش</option><option value="1">روشن</option></select>
        </div>
        <div class="col">
          <label>لینک آفر</label>
          <input id="admOfferUrl" placeholder="https://..." />
        </div>
      </div>
      <div class="row" style="margin-top:10px">
        <div class="col">
          <label>متن آفر</label>
          <input id="admOfferText" placeholder="مثلاً: ۳۰٪ تخفیف ویژه" />
        </div>
      </div>

      <div class="hr"></div>

      <div>
        <h4 style="margin:0 0 8px 0">🧠 پرامپت‌های پیش‌فرض سبک‌ها</h4>
        <div class="row">
          <div class="col">
            <label>Style Key</label>
            <select id="admStyleKey">
              <option value="rtm">RTM</option>
              <option value="ict">ICT</option>
              <option value="price_action">پرایس اکشن</option>
              <option value="prompt">پرامپت</option>
              <option value="custom_method">روش اختصاصی</option>
              <option value="custom_prompt">پرامپت اختصاصی</option>
            </select>
          </div>
          <div class="col">
            <label>متن پرامپت (Override)</label>
            <textarea id="admStylePrompt" placeholder="اگر خالی بگذارید، از پیش‌فرض استفاده می‌شود."></textarea>
          </div>
        </div>
        <div style="margin-top:10px">
          <button id="saveStylePromptBtn">ذخیره پرامپت این سبک</button>
          <span class="muted" id="stylePromptMsg" style="margin-right:10px"></span>
        </div>
      </div>

      <div style="margin-top:10px">
        <button id="saveAdminBtn" class="ok">ذخیره تنظیمات مدیریت</button>
        <span class="muted" id="adminMsg" style="margin-right:10px"></span>
      </div>

      <div class="hr"></div>

      <div>
        <h4 style="margin:0 0 8px 0">💳 پرداخت‌های در انتظار</h4>
        <button id="reloadPaymentsBtn">بارگذاری</button>
        <div id="paymentsWrap" class="muted" style="margin-top:10px">—</div>
      </div>

      <div class="hr"></div>

      <div>
        <h4 style="margin:0 0 8px 0">🔗 ساخت رفرال برای کاربر</h4>
        <div class="row">
          <div class="col">
            <label>User ID</label>
            <input id="refUserId" placeholder="مثلاً 123456789" />
          </div>
          <div class="col">
            <label>&nbsp;</label>
            <button id="refGenBtn" class="primary">ساخت ۵ رفرال</button>
          </div>
        </div>
        <div class="out hidden" id="refOut" style="margin-top:10px"></div>
      </div>
    </div>

    <div id="toast" class="toast hidden"></div>
  </div>

<script>
  const tg = window.Telegram?.WebApp;
  try{ tg?.ready(); tg?.expand(); }catch(e){}

  const $ = (id)=>document.getElementById(id);
  function toast(msg){
    const el = $("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    setTimeout(()=>el.classList.add("hidden"), 2600);
  }

  async function api(path, payload){
    const r = await fetch(path, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(payload||{}) });
    return r.json().catch(()=>null);
  }

  function fillSymbols(list){
    const sel = $("symbol");
    sel.innerHTML = "";
    (list||[]).forEach(s=>{
      const o = document.createElement("option");
      o.value = s;
      o.textContent = s;
      sel.appendChild(o);
    });
  }

  let user = null;

  async function boot(){
    const initData = tg?.initData || "";
    if(!initData){
      toast("این پنل باید داخل تلگرام باز شود.");
      return;
    }

    const j = await api("/api/user", { initData });
    if(!j?.ok){
      const code = j?.error || "try_again";
      if(code === "auth_failed") toast("احراز هویت تلگرام ناموفق است. مینی‌اپ را از داخل تلگرام باز کن.");
      else toast("خطا در اتصال. دوباره تلاش کن.");
      return;
    }

    user = j;
    $("welcome").textContent = j.welcome || "";
    $("quota").textContent = "سهمیه: " + (j.quota || "—");
    $("sub").textContent = j.state?.subscribed ? "اشتراک: فعال" : "اشتراک: غیرفعال";
    if(j.role?.privileged){
      $("rolePill").classList.remove("hidden");
      $("adminCard").classList.remove("hidden");
    }
    if(j.state?.onboardOk === false){
      $("onboardCard").classList.remove("hidden");
    }

    fillSymbols(j.symbols || []);
    // Settings
    $("tf").value = j.state?.timeframe || "H4";
    const styleBack={"RTM":"rtm","ICT":"ict","پرایس اکشن":"price_action","پرامپت":"prompt","روش اختصاصی":"custom_method","پرامپت اختصاصی":"custom_prompt","اسکالپ":"scalp","سوئینگ":"swing","اینترادی":"intraday","اسمارت‌مانی":"smart"};
    $("style").value = styleBack[j.state?.style] || "swing";
    const riskBack={"کم":"low","متوسط":"mid","زیاد":"high"};
    $("risk").value = riskBack[j.state?.risk] || "mid";
    $("news").value = j.state?.newsEnabled ? "1" : "0";

    // Admin config bootstrap
    if(j.role?.privileged){
      const a = await api("/api/admin/get", { initData });
      if(a?.ok){
        $("admPrice").value = a.config.price;
        $("admCurrency").value = a.config.currency;
        $("admDays").value = a.config.days;
        $("admFreeLimit").value = a.config.freeLimit;
        $("admSubLimit").value = a.config.subLimit;
        $("admMonthlyLimit").value = a.config.monthlyLimit;
        $("admWallet").value = a.config.wallet || "";
        $("admOfferEnabled").value = a.config.offer?.enabled ? "1" : "0";
        $("admOfferText").value = a.config.offer?.text || "";
        $("admOfferUrl").value = a.config.offer?.url || "";
        if(!j.role?.admin){
          $("walletCol").classList.add("hidden");
        }
      }
    }
  }

  $("saveSettingsBtn").addEventListener("click", async ()=>{
    const initData = tg?.initData || "";
    const payload = {
      initData,
      timeframe: $("tf").value,
      style: $("style").value,
      risk: $("risk").value,
      newsEnabled: $("news").value === "1"
    };
    $("settingsMsg").textContent = "در حال ذخیره…";
    const j = await api("/api/settings", payload);
    if(j?.ok){
      $("settingsMsg").textContent = "✅ ذخیره شد";
      $("quota").textContent = "سهمیه: " + (j.quota || "—");
      toast("تنظیمات ذخیره شد");
    }else{
      $("settingsMsg").textContent = "❌ خطا";
      toast("ذخیره نشد. دوباره تلاش کن.");
    }
  });

  $("analyzeBtn").addEventListener("click", async ()=>{
    const initData = tg?.initData || "";
    const payload = {
      initData,
      symbol: $("symbol").value,
      userPrompt: $("prompt").value
    };
    $("analyzeMsg").textContent = "در حال تحلیل…";
    $("result").textContent = "…";
    $("chartWrap").classList.add("hidden");
    $("newsWrap").classList.add("hidden");
    const j = await api("/api/analyze", payload);

    if(j?.ok){
      $("analyzeMsg").textContent = "✅ آماده";
      $("quota").textContent = "سهمیه: " + (j.quota || "—");
      $("result").textContent = j.result || "";
      if(j.chartUrl){
        $("chartImg").src = j.chartUrl;
        $("chartWrap").classList.remove("hidden");
      }
      const heads = Array.isArray(j.headlines) ? j.headlines : [];
      if(heads.length){
        const ul = $("newsList");
        ul.innerHTML = "";
        heads.forEach(h=>{
          const li = document.createElement("li");
          li.textContent = (h.source ? "["+h.source+"] " : "") + h.title;
          ul.appendChild(li);
        });
        $("newsWrap").classList.remove("hidden");
      }
    
}else{
  $("analyzeMsg").textContent = "❌";
  const code = j?.error || "try_again";
  let msg = "تحلیل انجام نشد. لطفاً دوباره تلاش کن.";
  if(code === "onboarding_required") msg = "ابتدا ثبت‌نام را کامل کن: نام را وارد کن و در چت ربات «اشتراک‌گذاری شماره تماس» را بزن.";
  else if(code === "auth_failed") msg = "این پنل باید از داخل تلگرام باز شود.";
  else if(code === "quota_exceeded") msg = "سهمیه امروزت تمام شده.";
  else if(code === "ai_not_configured") msg = "سرویس تحلیل هنوز فعال نشده. (ادمین باید کلید/AI Binding را تنظیم کند.)";
  else if(code === "market_data_unavailable") msg = "دریافت داده بازار ناموفق بود. بعداً امتحان کن.";
  $("result").textContent = msg + (j?.debug ? "

[دیباگ]
" + j.debug : "");
  toast(msg);
}
});

  $("buyBtn").addEventListener("click", ()=>{
    if(user?.payUrl){
      try{ tg?.openLink(user.payUrl); }catch(e){ window.location.href = user.payUrl; }
    }
  });

  $("closeBtn").addEventListener("click", ()=>{
    try{ tg?.close(); }catch(e){ window.close(); }
  });

  // Admin actions
  $("saveStylePromptBtn")?.addEventListener("click", async ()=>{
    const initData = tg?.initData || "";
    $("stylePromptMsg").textContent = "در حال ذخیره…";
    const payload = {
      initData,
      styleKey: $("admStyleKey").value,
      stylePrompt: $("admStylePrompt").value,
    };
    const j = await api("/api/admin/set", payload);
    if(j?.ok){ $("stylePromptMsg").textContent = "✅ ذخیره شد"; toast("پرامپت سبک ذخیره شد"); }
    else { $("stylePromptMsg").textContent = "❌ خطا"; toast("ذخیره نشد"); }
  });

  $("saveAdminBtn").addEventListener("click", async ()=>{
    const initData = tg?.initData || "";
    $("adminMsg").textContent = "در حال ذخیره…";
    const payload = {
      initData,
      price: $("admPrice").value,
      currency: $("admCurrency").value,
      days: $("admDays").value,
      freeLimit: $("admFreeLimit").value,
      subLimit: $("admSubLimit").value,
      monthlyLimit: $("admMonthlyLimit").value,
      offer: { enabled: $("admOfferEnabled").value === "1", text: $("admOfferText").value, url: $("admOfferUrl").value },
    };
    if(user?.role?.admin){
      payload.wallet = $("admWallet").value;
    }
    const j = await api("/api/admin/set", payload);
    if(j?.ok){
      $("adminMsg").textContent = "✅ ذخیره شد";
      toast("تنظیمات مدیریت ذخیره شد");
    }else{
      $("adminMsg").textContent = "❌ خطا";
      toast("ذخیره نشد.");
    }
  });

  $("reloadPaymentsBtn").addEventListener("click", async ()=>{
    const initData = tg?.initData || "";
    $("paymentsWrap").textContent = "در حال بارگذاری…";
    const j = await api("/api/admin/payments", { initData });
    if(!j?.ok){
      $("paymentsWrap").textContent = "خطا در بارگذاری.";
      return;
    }
    const items = j.items || [];
    if(!items.length){
      $("paymentsWrap").textContent = "✅ پرداخت در انتظار نداریم.";
      return;
    }

    const wrap = document.createElement("div");
    items.forEach(rec=>{
      const box = document.createElement("div");
      box.style.padding = "10px";
      box.style.border = "1px solid rgba(255,255,255,.12)";
      box.style.borderRadius = "12px";
      box.style.marginBottom = "10px";
      box.innerHTML = '<div><b>TxID:</b> ' + rec.txid + '</div>'
        + '<div class="muted">user=' + rec.userId + ' | ' + rec.amount + ' ' + rec.currency + ' | ' + rec.days + ' روز</div>';
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "10px";
      row.style.marginTop = "10px";

      const okBtn = document.createElement("button");
      okBtn.className = "ok";
      okBtn.textContent = "تایید";
      okBtn.onclick = async ()=>{
        const r = await api("/api/admin/approve", { initData, txid: rec.txid });
        if(r?.ok){ toast("تایید شد"); $("reloadPaymentsBtn").click(); }
        else toast("تایید نشد");
      };

      const rejBtn = document.createElement("button");
      rejBtn.className = "danger";
      rejBtn.textContent = "رد";
      rejBtn.onclick = async ()=>{
        const r = await api("/api/admin/reject", { initData, txid: rec.txid });
        if(r?.ok){ toast("رد شد"); $("reloadPaymentsBtn").click(); }
        else toast("رد نشد");
      };

      row.appendChild(okBtn);
      row.appendChild(rejBtn);
      box.appendChild(row);
      wrap.appendChild(box);
    });

    $("paymentsWrap").innerHTML = "";
    $("paymentsWrap").appendChild(wrap);
  });

  $("refGenBtn").addEventListener("click", async ()=>{
    const initData = tg?.initData || "";
    const userId = ($("refUserId").value||"").trim();
    if(!userId){ toast("User ID را وارد کن"); return; }
    const j = await api("/api/admin/refgen", { initData, userId });
    if(j?.ok){
      $("refOut").classList.remove("hidden");
      $("refOut").textContent = (j.links || j.codes || []).join("\n");
      toast("رفرال ساخته شد");
    }else{
      toast("ساخت رفرال انجام نشد");
    }
  });

  boot();
</script>
</body>
</html>`;
const ADMIN_APP_JS = `const tg = window.Telegram?.WebApp;
if (tg) tg.ready();

const DEV = new URL(location.href).searchParams.get("dev") === "1";
const DEV_UID = new URL(location.href).searchParams.get("uid") || "999000";

const out = document.getElementById("out");
const statusEl = document.getElementById("status");
const welcome = document.getElementById("welcome");
const symbolSel = document.getElementById("symbol");
const q = document.getElementById("q");

let ALL = [];
let onboardOk = false;
let payUrl = "/pay";

async function api(path, body){
  const r = await fetch(path, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(()=>null);
  return { status: r.status, j };
}

function fillSymbols(list){
  ALL = Array.isArray(list) ? list : [];
  symbolSel.innerHTML = "";
  for(const s of ALL){
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    symbolSel.appendChild(opt);
  }
}
function filterSymbols(txt){
  const needle = (txt||"").trim().toUpperCase();
  symbolSel.innerHTML = "";
  const list = needle ? ALL.filter(s=>s.includes(needle)) : ALL;
  for(const s of list){
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    symbolSel.appendChild(opt);
  }
}
q.addEventListener("input", (e)=>filterSymbols(e.target.value));

function friendlyError(code, httpStatus){
  code = String(code || "");
  if(code === "quota_exceeded") return "سهمیه امروز تمام شد.";
  if(code === "onboarding_required") return "ابتدا در بات تلگرام ثبت‌نام را کامل کنید (نام + شماره).";
  if(code === "auth_failed") return "اتصال تلگرام ناموفق بود. لطفاً دوباره باز کنید.";
  return "مشکلی پیش آمد. دوباره تلاش کنید.";
}

async function boot(){
  out.textContent = "⏳ در حال آماده‌سازی…";

  // اگر خارج از تلگرام باز شده باشد (مثلاً Cloudflare Preview)، initData نداریم.
  const initData = tg?.initData || "";
  if(!tg || !initData){
    welcome.textContent = "برای استفاده از MarketiQ Mini App باید این صفحه را داخل تلگرام باز کنید ✅";
    statusEl.textContent = "Offline";
    out.textContent =
      "این صفحه در مرورگر باز شده و احراز هویت تلگرام ندارد.\n\n" +
      "لطفاً وارد ربات شوید و از داخل تلگرام روی دکمه Mini App کلیک کنید.";
    // نمادها را خالی می‌گذاریم تا کاربر فکر نکند قابل استفاده است
    fillSymbols([]);
    return;
  }

  const {status: httpStatus, j} = await api("/api/user", { initData });

  if(!j?.ok){
    // خطای فنی را به کاربر نمایش نده
    welcome.textContent = "اتصال ناموفق";
    statusEl.textContent = "Offline";
    out.textContent = "اتصال به سرور برقرار نشد. لطفاً Mini App را از داخل تلگرام باز کنید یا دوباره تلاش کنید.";
    return;
  }

  onboardOk = !!j.onboardOk;
  payUrl = j.payUrl || "/pay";

  welcome.textContent = j.welcome || "";
  statusEl.textContent = "Online | Quota: " + (j.quota || "-");
  fillSymbols(j.symbols || []);

  if(j.state?.timeframe) document.getElementById("timeframe").value = j.state.timeframe;
  if(j.state?.style) document.getElementById("style").value = j.state.style;
  if(j.state?.risk) document.getElementById("risk").value = j.state.risk;

  if(!onboardOk){
    // پیام کوتاه و دوستانه
    out.textContent = "برای فعال‌سازی، ابتدا در بات تلگرام نام و شماره را ثبت کنید.";
  } else {
    out.textContent = "✅ آماده";
  }
}
document.getElementById("save").addEventListener("click", async ()=>{
  if(!onboardOk){
    out.textContent = "ℹ️ ابتدا ثبت‌نام را در بات تلگرام کامل کنید.";
    return;
  }
  out.textContent = "⏳ ذخیره…";
  const initData = tg?.initData || "";
  const payload = {
    initData,
    timeframe: document.getElementById("timeframe").value,
    style: document.getElementById("style").value,
    risk: document.getElementById("risk").value,
  };
  const {status: httpStatus, j} = await api("/api/settings", payload);
  if(!j?.ok){
    out.textContent = "⚠️ " + friendlyError(j?.error, httpStatus);
    return;
  }
  out.textContent = "✅ ذخیره شد.";
  statusEl.textContent = "Quota: " + (j.quota || "-") + " | ID: " + (j.state?.userId || "-");
});

document.getElementById("analyze").addEventListener("click", async ()=>{
  if(!onboardOk){
    out.textContent = "ℹ️ ابتدا ثبت‌نام را در بات تلگرام کامل کنید.";
    return;
  }
  out.textContent = "⏳ تحلیل…";
  const initData = tg?.initData || "";
  const payload = { initData, symbol: symbolSel.value, userPrompt: "" };
  const {status: httpStatus, j} = await api("/api/analyze", payload);
  if(!j?.ok){
    out.textContent = "⚠️ " + friendlyError(j?.error, httpStatus);
    return;
  }
  out.textContent = j.result || "—";
  statusEl.textContent = "Quota: " + (j.quota || "-") + " | ID: " + (j.state?.userId || "-");
});

document.getElementById("buy").addEventListener("click", ()=>{
  try{
    const url = (location.origin || "") + (payUrl || "/pay");
    if(tg?.openLink) tg.openLink(url);
    else window.open(url, "_blank");
  }catch(e){
    // silent
  }
});

document.getElementById("close").addEventListener("click", ()=> tg?.close());
boot();`;


/* ========================== SIMPLE MINI APP (NEW UI) ========================== */
const MINI_APP_HTML = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>MarketiQ Mini App</title>
  <meta name="color-scheme" content="dark light" />
  <style>
    :root{
      --bg: #0B0F17;
      --card: rgba(255,255,255,.06);
      --text: rgba(255,255,255,.92);
      --muted: rgba(255,255,255,.62);
      --good:#2FE3A5;
      --warn:#FFB020;
      --bad:#FF4D4D;
      --shadow: 0 10px 30px rgba(0,0,0,.35);
      --radius: 18px;
      --font: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans";
    }
    *{ box-sizing:border-box; }
    body{
      margin:0;
      font-family: var(--font);
      color: var(--text);
      background:
        radial-gradient(900px 500px at 25% -10%, rgba(109,94,246,.35), transparent 60%),
        radial-gradient(800px 500px at 90% 0%, rgba(0,209,255,.20), transparent 60%),
        linear-gradient(180deg, #070A10 0%, #0B0F17 60%, #090D14 100%);
      padding: 12px 12px calc(14px + env(safe-area-inset-bottom));
    }
    .shell{ max-width: 760px; margin: 0 auto; }
    .topbar{
      position: sticky; top: 0; z-index: 50;
      backdrop-filter: blur(10px);
      background: rgba(11,15,23,.65);
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 20px;
      padding: 12px;
      box-shadow: var(--shadow);
      display:flex; align-items:center; justify-content:space-between;
      gap: 10px;
      margin-bottom: 12px;
    }
    .brand{ display:flex; align-items:center; gap:10px; min-width: 0; }
    .logo{
      width: 38px; height: 38px; border-radius: 14px;
      background: linear-gradient(135deg, rgba(109,94,246,1), rgba(0,209,255,1));
      box-shadow: 0 10px 22px rgba(109,94,246,.25);
      display:flex; align-items:center; justify-content:center;
      font-weight: 900;
    }
    .titlewrap{ min-width: 0; }
    .title{ font-size: 15px; font-weight: 900; white-space: nowrap; overflow:hidden; text-overflow: ellipsis; }
    .subtitle{ font-size: 12px; color: var(--muted); white-space: nowrap; overflow:hidden; text-overflow: ellipsis; }
    .pill{
      display:inline-flex; align-items:center; gap:7px;
      padding: 9px 10px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.10);
      background: rgba(255,255,255,.06);
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    .dot{ width: 8px; height: 8px; border-radius: 99px; background: var(--good); box-shadow: 0 0 0 3px rgba(47,227,165,.12); }
    .grid{ display:grid; grid-template-columns: 1fr; gap: 12px; }
    .card{
      background: var(--card);
      border: 1px solid rgba(255,255,255,.10);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow:hidden;
    }
    .card-h{
      padding: 12px 14px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      border-bottom: 1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.03);
    }
    .card-h strong{ font-size: 13px; }
    .card-h span{ font-size: 12px; color: var(--muted); }
    .card-b{ padding: 14px; }
    .row{ display:flex; gap:10px; flex-wrap: wrap; align-items:center; }
    .field{ display:flex; flex-direction: column; gap:8px; min-width: 140px; flex:1; }
    .label{ font-size: 12px; color: var(--muted); }
    .control{
      width:100%;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.06);
      color: var(--text);
      padding: 12px 12px;
      font-size: 14px;
      outline:none;
    }
    .chips{ display:flex; gap:8px; flex-wrap: wrap; }
    .chip{
      border:1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.06);
      color: var(--muted);
      padding: 9px 12px;
      border-radius: 999px;
      font-size: 13px;
      cursor:pointer;
      user-select:none;
    }
    .chip.on{
      color: rgba(255,255,255,.92);
      border-color: rgba(109,94,246,.55);
      background: rgba(109,94,246,.16);
      box-shadow: 0 8px 20px rgba(109,94,246,.15);
    }
    .actions{ display:flex; gap:10px; flex-wrap:wrap; }
    .btn{
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.06);
      color: var(--text);
      padding: 12px 12px;
      border-radius: 16px;
      font-size: 14px;
      cursor:pointer;
      display:inline-flex; align-items:center; justify-content:center; gap:8px;
      min-width: 120px;
      flex: 1;
    }
    .btn.primary{
      border-color: rgba(109,94,246,.65);
      background: linear-gradient(135deg, rgba(109,94,246,.92), rgba(0,209,255,.55));
      box-shadow: 0 12px 30px rgba(109,94,246,.20);
      font-weight: 900;
    }
    .btn.ghost{ color: var(--muted); }
    .out{
      padding: 14px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace;
      font-size: 13px;
      line-height: 1.75;
      white-space: pre-wrap;
      background: rgba(0,0,0,.20);
      border-top: 1px solid rgba(255,255,255,.08);
      min-height: 240px;
    }
    .toast{
      position: fixed;
      left: 12px; right: 12px;
      bottom: calc(12px + env(safe-area-inset-bottom));
      max-width: 760px;
      margin: 0 auto;
      background: rgba(20,25,36,.92);
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 16px;
      padding: 12px 12px;
      box-shadow: var(--shadow);
      display:none;
      gap: 10px;
      align-items: center;
      z-index: 100;
    }
    .toast.show{ display:flex; }
    .toast .t{ font-size: 13px; color: var(--text); }
    .toast .s{ font-size: 12px; color: var(--muted); }
    .toast .badge{
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 12px;
      border: 1px solid rgba(255,255,255,.10);
      background: rgba(255,255,255,.06);
      color: var(--muted);
      white-space: nowrap;
    }
    .spin{
      width: 16px; height: 16px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,.25);
      border-top-color: rgba(255,255,255,.85);
      animation: spin .8s linear infinite;
    }
    @keyframes spin{ to { transform: rotate(360deg); } }
    .muted{ color: var(--muted); }
  </style>
</head>
<body>
  <div class="shell">
    <div id="offerWrap" class="card" style="display:none; margin-bottom:12px;">
      <div class="card-b" style="padding:12px 14px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div style="min-width:0">
          <div style="font-weight:900; font-size:13px;">🎁 آفر ویژه</div>
          <div class="muted" id="offerText" style="margin-top:4px; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"></div>
        </div>
        <button id="offerBtn" class="btn" style="min-width:120px; flex:0;">مشاهده</button>
      </div>
    </div>

    <div class="topbar">
      <div class="brand">
        <div class="logo">MQ</div>
        <div class="titlewrap">
          <div class="title">MarketiQ Mini App</div>
          <div class="subtitle" id="sub">اتصال…</div>
        </div>
      </div>
      <div class="pill"><span class="dot"></span><span id="pillTxt">Online</span></div>
    </div>

    <div id="energyWrap" class="card" style="margin-bottom:12px;">
      <div class="card-b" style="padding:12px 14px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="font-weight:900; font-size:13px;">⚡ انرژی</div>
          <div class="muted" id="energyTxt" style="font-size:12px;">—</div>
        </div>
        <div style="height:10px"></div>
        <div style="background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.10); border-radius:999px; overflow:hidden; height:12px;">
          <div id="energyBar" style="height:12px; width:0%; background:linear-gradient(90deg, rgba(47,227,165,.95), rgba(109,94,246,.9));"></div>
        </div>
        <div style="height:8px"></div>
        <div class="muted" id="energySub" style="font-size:12px; line-height:1.6;">—</div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-h">
          <strong>تحلیل سریع</strong>
          <span id="meta">—</span>
        </div>
        <div class="card-b">
          <div class="row">
            <div class="field" style="flex:1.4">
              <div class="label">جستجوی نماد</div>
              <input id="q" class="control" placeholder="مثلاً BTC یا EUR یا XAU…" />
            </div>
            <div class="field" style="flex:1">
              <div class="label">نماد</div>
              <select id="symbol" class="control"></select>
            </div>
          </div>

          <div style="height:10px"></div>

          <div class="row">
            <div class="field">
              <div class="label">تایم‌فریم</div>
              <div class="chips" id="tfChips">
                <div class="chip" data-tf="M15">M15</div>
                <div class="chip" data-tf="H1">H1</div>
                <div class="chip on" data-tf="H4">H4</div>
                <div class="chip" data-tf="D1">D1</div>
              </div>
              <select id="timeframe" class="control" style="display:none">
                <option value="M15">M15</option>
                <option value="H1">H1</option>
                <option value="H4" selected>H4</option>
                <option value="D1">D1</option>
              </select>
            </div>
            <div class="field">
              <div class="label">سبک</div>
              <select id="style" class="control">
                <option value="RTM">RTM</option>
                <option value="ICT">ICT</option>
                <option value="پرایس اکشن">پرایس اکشن</option>
                <option value="اسمارت‌مانی" selected>اسمارت‌مانی</option>
                <option value="اسکالپ">اسکالپ</option>
                <option value="سوئینگ">سوئینگ</option>
                <option value="اینترادی">اینترادی</option>
                <option value="پرامپت">پرامپت</option>
                <option value="روش اختصاصی">روش اختصاصی</option>
                <option value="پرامپت اختصاصی">پرامپت اختصاصی</option>
              </select>
            </div>
            <div class="field">
              <div class="label">ریسک</div>
              <select id="risk" class="control">
                <option value="کم">کم</option>
                <option value="متوسط" selected>متوسط</option>
                <option value="زیاد">زیاد</option>
              </select>
            </div>
            <div class="field">
              <div class="label">خبر</div>
              <select id="newsEnabled" class="control">
                <option value="true" selected>روشن ✅</option>
                <option value="false">خاموش ❌</option>
              </select>
            </div>
          </div>

          <div style="height:12px"></div>

          <div class="actions">
            <button id="save" class="btn">💾 ذخیره</button>
            <button id="analyze" class="btn primary">⚡ تحلیل</button>
            <button id="close" class="btn ghost">✖ بستن</button>
          </div>

          <div style="height:10px"></div>
          <div class="muted" style="font-size:12px; line-height:1.6;" id="welcome"></div>
        </div>

        <div class="out" id="out">آماده…</div>
      </div>
    </div>

    <div class="card" id="profileCard">
      <div class="card-h"><strong>حساب کاربری</strong><span id="profileMeta">—</span></div>
      <div class="card-b">
        <div class="muted" style="font-size:12px; line-height:1.7" id="profileOut">—</div>
        <div style="height:12px"></div>
        <div class="row">
          <div class="field" style="flex:1.2">
            <div class="label">آدرس برداشت (BEP20)</div>
            <input id="bep20" class="control" placeholder="آدرس BEP20 خود را وارد کنید" />
          </div>
          <div class="field" style="flex:.8">
            <div class="label">&nbsp;</div>
            <button id="saveBep20" class="btn">💾 ثبت BEP20</button>
          </div>
        </div>
        <div style="height:10px"></div>
        <div class="actions">
          <button id="reqDeposit" class="btn">➕ درخواست واریز</button>
          <button id="reqWithdraw" class="btn">➖ درخواست برداشت</button>
        </div>
        <div style="height:12px"></div>
        <div class="card" style="background:rgba(255,255,255,.04); border-radius:16px;">
          <div class="card-b" style="padding:12px 14px;">
            <div style="font-weight:900; font-size:13px;">🧩 پرامپت اختصاصی</div>
            <div class="muted" style="margin-top:6px; font-size:12px; line-height:1.7" id="cpInfo">—</div>
            <div style="height:10px"></div>
            <textarea id="cpDesc" class="control" placeholder="استراتژی/سبک خود را توضیح دهید…" style="min-height:90px"></textarea>
            <div style="height:10px"></div>
            <div class="actions">
              <button id="cpReq" class="btn primary">ارسال درخواست</button>
            </div>
            <div style="height:8px"></div>
            <div class="muted" id="cpStatus" style="font-size:12px;">—</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="toast" id="toast">
    <div class="spin" id="spin" style="display:none"></div>
    <div style="min-width:0">
      <div class="t" id="toastT">…</div>
      <div class="s" id="toastS"></div>
    </div>
    <div class="badge" id="toastB"></div>
  </div>

  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src="/app.js"></script>
</body>
</html>`;

const MINI_APP_JS = `const tg = window.Telegram?.WebApp;
if (tg) tg.ready();

const out = document.getElementById("out");
const meta = document.getElementById("meta");
const sub = document.getElementById("sub");
const pillTxt = document.getElementById("pillTxt");
const welcome = document.getElementById("welcome");

function el(id){ return document.getElementById(id); }
function val(id){ return el(id).value; }
function setVal(id, v){ el(id).value = v; }

const toast = el("toast");
const toastT = el("toastT");
const toastS = el("toastS");
const toastB = el("toastB");
const spin = el("spin");

let ALL_SYMBOLS = [];

function showToast(title, subline = "", badge = "", loading = false){
  toastT.textContent = title || "";
  toastS.textContent = subline || "";
  toastB.textContent = badge || "";
  spin.style.display = loading ? "inline-block" : "none";
  toast.classList.add("show");
}
function hideToast(){ toast.classList.remove("show"); }

function fillSymbols(list){
  ALL_SYMBOLS = Array.isArray(list) ? list.slice() : [];
  const sel = el("symbol");
  const cur = sel.value;
  sel.innerHTML = "";
  for (const s of ALL_SYMBOLS) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    sel.appendChild(opt);
  }
  if (cur && ALL_SYMBOLS.includes(cur)) sel.value = cur;
}

function filterSymbols(q){
  q = (q || "").trim().toUpperCase();
  const sel = el("symbol");
  const cur = sel.value;
  sel.innerHTML = "";

  const list = !q ? ALL_SYMBOLS : ALL_SYMBOLS.filter(s => s.includes(q));
  for (const s of list) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    sel.appendChild(opt);
  }
  if (cur && list.includes(cur)) sel.value = cur;
}

function setTf(tf){
  setVal("timeframe", tf);
  const chips = el("tfChips")?.querySelectorAll(".chip") || [];
  for (const c of chips) c.classList.toggle("on", c.dataset.tf === tf);
}

async function api(path, body){
  const r = await fetch(path, {
    method: "POST",
    headers: {"content-type":"application/json"},
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, json: j };
}

function prettyErr(j, status){
  const e = j?.error || "نامشخص";
  if (String(e) === "auth_failed") return "این مینی‌اپ فقط داخل تلگرام کار می‌کند.";
  if (status === 429 && String(e).startsWith("quota_exceeded")) return "سهمیه امروز تمام شد.";
  if (status === 403 && (String(e) === "onboarding_required" || String(e) === "onboarding_needed")) return "ابتدا نام و شماره را داخل ربات ثبت کنید.";
  if (status === 401) return "احراز هویت تلگرام ناموفق است. لطفاً مینی‌اپ را داخل تلگرام باز کنید.";
  return "مشکلی پیش آمد. لطفاً دوباره تلاش کنید.";
}

function updateMeta(state, quota){
  meta.textContent = "سهمیه: " + (quota || "-");
  sub.textContent = "ID: " + (state?.userId || "-") + " | امروز: " + (state?.dailyDate || "-");
}

function updateEnergy(energy){
  const bar = el("energyBar");
  const txt = el("energyTxt");
  const subl = el("energySub");
  if(!energy || !bar || !txt || !subl) return;

  const d = energy.daily || {};
  const m = energy.monthly || {};
  const dLim = Number.isFinite(d.limit) ? d.limit : null;
  const mLim = Number.isFinite(m.limit) ? m.limit : null;

  // show primary as daily, fallback to monthly
  const used = Number(d.used||0);
  const lim = dLim || mLim || 1;
  const pct = Math.max(0, Math.min(100, Math.round((used/lim)*100)));
  bar.style.width = pct + "%";

  txt.textContent = "روز: " + (d.used||0) + "/" + (dLim ?? "∞") + " | ماه: " + (m.used||0) + "/" + (mLim ?? "∞");
  subl.textContent = "باقی‌مانده روز: " + (d.remaining ?? "∞") + " | باقی‌مانده ماه: " + (m.remaining ?? "∞");
}

function renderOffer(offer){
  const wrap = el("offerWrap");
  const text = el("offerText");
  const btn = el("offerBtn");
  if(!wrap || !text || !btn) return;
  if(!offer || !offer.enabled || !offer.url){ wrap.style.display = "none"; return; }
  wrap.style.display = "block";
  text.textContent = offer.text || "";
  btn.onclick = ()=>{
    try{ if(tg?.openLink) tg.openLink(offer.url); else window.open(offer.url, "_blank"); }catch(e){}
  };
}

function renderProfile(profile){
  const box = el("profileOut");
  const metaEl = el("profileMeta");
  if(!box) return;
  const ref = profile?.refLink ? "\n🔗 رفرال: " + profile.refLink : "";
  box.textContent = "⭐ امتیاز: " + (profile?.points ?? 0) + "\n🎁 دعوت موفق: " + (profile?.invites ?? 0) + ref + "\n💰 موجودی: " + (profile?.balance ?? 0) + "\n➕ درخواست واریز: " + (profile?.depositRequests ?? 0) + "\n➖ درخواست برداشت: " + (profile?.withdrawRequests ?? 0) + "\n🏦 BEP20: " + (profile?.bep20Address ? profile.bep20Address : "—");
  if(metaEl) metaEl.textContent = "Profile";
  if(el("bep20") && profile?.bep20Address) el("bep20").value = profile.bep20Address;
}

async function boot(){
  out.textContent = "⏳ در حال آماده‌سازی…";
  pillTxt.textContent = "Connecting…";
  showToast("در حال اتصال…", "دریافت پروفایل و تنظیمات", "API", true);

  if (!tg && !DEV) {
    hideToast();
    pillTxt.textContent = "Offline";
    out.textContent = "این مینی‌اپ فقط داخل تلگرام کار می‌کند. از داخل ربات روی «🧩 مینی‌اپ» بزن.";
    showToast("فقط داخل تلگرام", "از داخل ربات باز کن", "TG", false);
    return;
  }

  const initData = tg?.initData || "";
  const {status, json} = await api("/api/user", { initData, dev: DEV, userId: DEV ? DEV_UID : undefined });

  if (!json?.ok) {
    hideToast();
    pillTxt.textContent = "Offline";
    const msg = prettyErr(json, status);
    out.textContent = "⚠️ " + msg;
    showToast("خطا", msg, "API", false);
    return;
  }

  welcome.textContent = json.welcome || "";
  fillSymbols(json.symbols || []);
  renderOffer(json.offer);
  updateEnergy(json.energy);
  renderProfile(json.profile);
  if(el("cpInfo")) el("cpInfo").textContent = json.infoText || "";
  if(el("cpStatus")) el("cpStatus").textContent = "وضعیت: " + (json.customPrompt?.status || "none");
  if (json.state?.timeframe) setTf(json.state.timeframe);
  if (json.state?.style) setVal("style", json.state.style);
  if (json.state?.risk) setVal("risk", json.state.risk);
  setVal("newsEnabled", String(!!json.state?.newsEnabled));

  if (json.symbols?.length) setVal("symbol", json.symbols[0]);

  updateMeta(json.state, json.quota);
  out.textContent = "آماده ✅";
  pillTxt.textContent = "Online";
  hideToast();
}

el("q").addEventListener("input", (e) => filterSymbols(e.target.value));

el("tfChips").addEventListener("click", (e) => {
  const chip = e.target?.closest?.(".chip");
  const tf = chip?.dataset?.tf;
  if (!tf) return;
  setTf(tf);
});

el("save").addEventListener("click", async () => {
  showToast("در حال ذخیره…", "تنظیمات ذخیره می‌شود", "SET", true);
  out.textContent = "⏳ ذخیره تنظیمات…";

  const initData = tg?.initData || "";
  const payload = {
    initData,
    dev: DEV,
    userId: DEV ? DEV_UID : undefined,
    timeframe: val("timeframe"),
    style: val("style"),
    risk: val("risk"),
    newsEnabled: val("newsEnabled") === "true",
  };

  const {status, json} = await api("/api/settings", payload);
  if (!json?.ok) {
    const msg = prettyErr(json, status);
    out.textContent = "⚠️ " + msg;
    showToast("خطا", msg, "SET", false);
    return;
  }

  out.textContent = "✅ تنظیمات ذخیره شد.";
  updateMeta(json.state, json.quota);
  showToast("ذخیره شد ✅", "تنظیمات اعمال شد", "OK", false);
  setTimeout(hideToast, 1200);
});

el("analyze").addEventListener("click", async () => {
  showToast("در حال تحلیل…", "جمع‌آوری دیتا + تولید خروجی", "AI", true);
  out.textContent = "⏳ در حال تحلیل…";

  const initData = tg?.initData || "";
  const payload = { initData, dev: DEV, userId: DEV ? DEV_UID : undefined, symbol: val("symbol"), userPrompt: "" };

  const {status, json} = await api("/api/analyze", payload);
  if (!json?.ok) {
    const msg = prettyErr(json, status);
    out.textContent = "⚠️ " + msg;
    showToast("خطا", msg, status === 429 ? "Quota" : "AI", false);
    return;
  }

  out.textContent = json.result || "⚠️ بدون خروجی";
  updateMeta(json.state, json.quota);
  showToast("آماده ✅", "خروجی دریافت شد", "OK", false);
  setTimeout(hideToast, 1200);
});

el("close").addEventListener("click", () => tg?.close());

// Wallet + custom prompt actions
el("saveBep20")?.addEventListener("click", async ()=>{
  showToast("در حال ثبت…", "ذخیره آدرس BEP20", "WAL", true);
  const initData = tg?.initData || "";
  const address = val("bep20");
  const {status, json} = await api("/api/wallet/set_bep20", { initData, dev: DEV, userId: DEV ? DEV_UID : undefined, address });
  if(!json?.ok){
    const msg = (json?.error === "invalid_bep20") ? "آدرس نامعتبر است." : prettyErr(json, status);
    showToast("خطا", msg, "WAL", false);
    out.textContent = "⚠️ " + msg;
    return;
  }
  showToast("ثبت شد ✅", "آدرس BEP20 ذخیره شد", "OK", false);
  setTimeout(hideToast, 1200);
});

el("reqDeposit")?.addEventListener("click", async ()=>{
  showToast("ثبت درخواست…", "درخواست واریز ارسال می‌شود", "DEP", true);
  const initData = tg?.initData || "";
  const {status, json} = await api("/api/wallet/request_deposit", { initData, dev: DEV, userId: DEV ? DEV_UID : undefined });
  if(!json?.ok){
    const msg = prettyErr(json, status);
    showToast("خطا", msg, "DEP", false);
    return;
  }
  showToast("ارسال شد ✅", "درخواست واریز ثبت شد", "OK", false);
  setTimeout(hideToast, 1200);
});

el("reqWithdraw")?.addEventListener("click", async ()=>{
  showToast("ثبت درخواست…", "درخواست برداشت بررسی می‌شود", "WD", true);
  const initData = tg?.initData || "";
  const {status, json} = await api("/api/wallet/request_withdraw", { initData, dev: DEV, userId: DEV ? DEV_UID : undefined });
  if(!json?.ok){
    const msg = (json?.error === "bep20_required") ? "برای برداشت ابتدا آدرس BEP20 را ثبت کن." : prettyErr(json, status);
    showToast("خطا", msg, "WD", false);
    out.textContent = "⚠️ " + msg;
    return;
  }
  showToast("ارسال شد ✅", "درخواست برداشت ثبت شد", "OK", false);
  setTimeout(hideToast, 1200);
});

el("cpReq")?.addEventListener("click", async ()=>{
  const desc = (el("cpDesc")?.value || "").trim();
  if(desc.length < 10){
    showToast("توضیح کوتاه است", "لطفاً جزئیات بیشتری بنویس", "CP", false);
    return;
  }
  showToast("در حال ارسال…", "پرامپت شما ساخته می‌شود", "CP", true);
  const initData = tg?.initData || "";
  const {status, json} = await api("/api/custom_prompt/request", { initData, dev: DEV, userId: DEV ? DEV_UID : undefined, desc });
  if(!json?.ok){
    const msg = (json?.error === "desc_too_short") ? (json?.info || "توضیح کوتاه است") : prettyErr(json, status);
    showToast("خطا", msg, "CP", false);
    return;
  }
  if(el("cpStatus")) el("cpStatus").textContent = "وضعیت: pending | آماده پس از: " + (json.readyAt || "—");
  showToast("ثبت شد ✅", "۲ ساعت بعد ارسال می‌شود", "OK", false);
  setTimeout(hideToast, 1400);
});

boot();`;
