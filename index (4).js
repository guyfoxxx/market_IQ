export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (pathEndsWith(url.pathname, "/health")) return new Response("ok", { status: 200 });

      // ===== MINI APP (inline) =====
      // Serve app.js from root and nested miniapp paths (e.g. /miniapp/app.js)
      if (request.method === "GET" && (url.pathname === "/app.js" || url.pathname.endsWith("/app.js") || url.pathname === "/app.v20260215b.js" || url.pathname.endsWith("/app.v20260215b.js"))) {
        return jsResponse(MINI_APP_JS);
      }
      // Serve Mini App shell on root and non-API clean paths (e.g. /miniapp)
      if (
        request.method === "GET" &&
        url.pathname !== "/health" &&
        !pathIncludes(url.pathname, "/api/") &&
        !pathIncludes(url.pathname, "/telegram/") &&
        !url.pathname.endsWith(".js")
      ) {
        return htmlResponse(MINI_APP_HTML);
      }

      // ===== MINI APP APIs =====
      if (pathEndsWith(url.pathname, "/api/user") && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);
        const v = await verifyMiniappAuth(body, env);
        if (!v.ok) {
          if (miniappGuestEnabled(env)) {
            const gp = await buildMiniappGuestPayload(env);
            gp.authError = v.reason || "";
            return jsonResponse(gp);
          }
          return jsonResponse({ ok: false, error: v.reason }, 401);
        }

        const st = await ensureUser(v.userId, env, v.fromLike);
        applyLocaleFromTelegramUser(st, v.fromLike || {});
        if (env.BOT_KV) await saveUser(v.userId, st, env);
        const quota = isStaff(v.fromLike, env) ? "∞" : `points:${Number(st.points?.balance || 0)}`;
        const symbols = await getMiniappSymbolUniverse(env);
        const miniToken = await issueMiniappToken(env, v.userId, v.fromLike || {});
        const styles = await getStyleList(env);
        const [offerBanner, offerBannerImage] = await Promise.all([getOfferBanner(env), getOfferBannerImage(env)]);
        const customPrompts = await getCustomPrompts(env);
        const role = isOwner(v.fromLike, env) ? "owner" : (isAdmin(v.fromLike, env) ? "admin" : "user");

        return jsonResponse({
          ok: true,
          welcome: await getMiniappWelcomeText(env),
          state: st,
          quota,
          symbols,
          styles,
          offerBanner,
          offerBannerImage,
          customPrompts,
          role,
          isStaff: role !== "user",
          wallet: (await getWallet(env)) || "",
          locale: {
            language: st.profile?.language || "fa",
            countryCode: st.profile?.countryCode || "IR",
            timezone: st.profile?.timezone || "Asia/Tehran",
            entrySource: st.profile?.entrySource || "",
          },
          miniToken,
        });
      }

      if (pathEndsWith(url.pathname, "/api/settings") && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await verifyMiniappAuth(body, env);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);

        const st = await ensureUser(v.userId, env);

        // users can tweak only their preferences (admin-only prompt/wallet enforced elsewhere)
        if (typeof body.timeframe === "string") st.timeframe = body.timeframe;
        if (typeof body.style === "string") {
          const styles = await getStyleList(env);
          if (styles.includes(body.style)) st.style = body.style;
        }
        if (typeof body.risk === "string") st.risk = body.risk;
        if (typeof body.newsEnabled === "boolean") st.newsEnabled = body.newsEnabled;
        if (typeof body.promptMode === "string") {
          const pm = String(body.promptMode || "").trim();
          const allowedPromptModes = ["style_only", "combined_all", "custom_only", "style_plus_custom"];
          st.promptMode = allowedPromptModes.includes(pm) ? pm : (st.promptMode || "style_plus_custom");
        }
        if (typeof body.selectedSymbol === "string") {
          const s = normalizeSymbol(body.selectedSymbol);
          if (!s || isSymbol(s)) st.selectedSymbol = s;
        }
        if (body.capitalAmount != null) {
          const cap = Number(body.capitalAmount);
          if (Number.isFinite(cap) && cap > 0) {
            st.capital = st.capital || { amount: 0, enabled: true };
            st.capital.amount = cap;
          }
        }
        if (typeof body.customPromptId === "string") {
          const prompts = await getCustomPrompts(env);
          const id = body.customPromptId.trim();
          st.customPromptId = prompts.find((p) => String(p?.id || "") === id) ? id : "";
        }
        if (typeof body.language === "string") st.profile.language = String(body.language || "").trim() || st.profile.language;
        if (typeof body.timezone === "string") st.profile.timezone = String(body.timezone || "").trim() || st.profile.timezone;

        if (env.BOT_KV) await saveUser(v.userId, st, env);

        const quota = isStaff(v.fromLike, env) ? "∞" : `${st.dailyUsed}/${dailyLimit(env, st)}`;
        return jsonResponse({ ok: true, state: st, quota });
      }

      if (url.pathname.startsWith("/api/admin/") && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN, env.INITDATA_MAX_AGE_SEC, env.MINIAPP_AUTH_LENIENT);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);
        if (!isStaff(v.fromLike, env)) return jsonResponse({ ok: false, error: "forbidden" }, 403);

        if (pathEndsWith(url.pathname, "/api/admin/bootstrap")) {
          const [prompt, styles, commission, offerBanner, offerBannerImage, payments, stylePrompts, customPrompts, freeDailyLimit, basePoints, withdrawals, tickets, adminFlags, welcomeBot, welcomeMiniapp] = await Promise.all([
            getAnalysisPrompt(env),
            getStyleList(env),
            getCommissionSettings(env),
            getOfferBanner(env),
            getOfferBannerImage(env),
            listPayments(env, 25),
            getStylePromptMap(env),
            getCustomPrompts(env),
            getFreeDailyLimit(env),
            getBasePoints(env),
            listWithdrawals(env, 100),
            listSupportTickets(env, 100),
            getAdminFlags(env),
            getBotWelcomeText(env),
            getMiniappWelcomeText(env),
          ]);
          return jsonResponse({ ok: true, prompt, styles, commission, offerBanner, offerBannerImage, payments, stylePrompts, customPrompts, freeDailyLimit, basePoints, withdrawals, tickets, adminFlags, welcomeBot, welcomeMiniapp });
        }

        if (pathEndsWith(url.pathname, "/api/admin/welcome")) {
          if (typeof body.welcomeBot === "string") await setBotWelcomeText(env, body.welcomeBot);
          if (typeof body.welcomeMiniapp === "string") await setMiniappWelcomeText(env, body.welcomeMiniapp);
          return jsonResponse({ ok: true, welcomeBot: await getBotWelcomeText(env), welcomeMiniapp: await getMiniappWelcomeText(env) });
        }

        if (pathEndsWith(url.pathname, "/api/admin/wallet")) {
          if (!isOwner(v.fromLike, env)) return jsonResponse({ ok: false, error: "forbidden" }, 403);
          if (!env.BOT_KV) return jsonResponse({ ok: false, error: "bot_kv_missing" }, 500);
          const wallet = typeof body.wallet === "string" ? body.wallet.trim() : null;
          if (wallet !== null) {
            await setWallet(env, wallet);
          }
          return jsonResponse({ ok: true, wallet: await getWallet(env) });
        }

        if (pathEndsWith(url.pathname, "/api/admin/tickets/list")) {
          const limit = Math.min(300, Math.max(1, Number(body.limit || 100)));
          const tickets = await listSupportTickets(env, limit);
          return jsonResponse({ ok: true, tickets });
        }

        if (pathEndsWith(url.pathname, "/api/admin/tickets/update")) {
          const id = String(body.id || "").trim();
          const status = String(body.status || "").trim();
          const reply = String(body.reply || "").trim();
          if (!id) return jsonResponse({ ok: false, error: "ticket_id_required" }, 400);
          const allowed = ["pending", "answered", "closed"];
          if (!allowed.includes(status)) return jsonResponse({ ok: false, error: "bad_status" }, 400);

          const nextStatus = reply ? (status === "pending" ? "answered" : status) : status;

          let updated = null;
          try {
            updated = await updateSupportTicket(env, id, {
              status: nextStatus,
              reply: reply || undefined,
              updatedBy: normHandle(v.fromLike?.username),
            });
          } catch (e) {
            const msg = String(e?.message || e || "update_failed");
            const http = msg.includes("not_found") ? 404 : 500;
            return jsonResponse({ ok: false, error: msg }, http);
          }

          if (reply && updated?.userId) {
            const chat = Number(updated.userId);
            if (chat) {
              const who = updated.username ? ("@" + String(updated.username).replace(/^@/, "")) : updated.userId;
              const msg = `📩 پاسخ پشتیبانی

شناسه تیکت: ${updated.id}
کاربر: ${who}

${reply}`;
              await tgSendMessage(env, chat, msg);
            }
          }

          return jsonResponse({ ok: true, ticket: updated });
        }

        if (pathEndsWith(url.pathname, "/api/admin/prompt")) {
          if (typeof body.prompt === "string" && env.BOT_KV) {
            await env.BOT_KV.put("settings:analysis_prompt", body.prompt.trim());
          }
          const prompt = await getAnalysisPrompt(env);
          return jsonResponse({ ok: true, prompt });
        }

        if (pathEndsWith(url.pathname, "/api/admin/styles")) {
          const list = await getStyleList(env);
          const action = String(body.action || "");
          const style = String(body.style || "").trim();
          let next = list.slice();
          if (action === "add" && style) {
            if (ALLOWED_STYLE_LIST.includes(style) && !next.includes(style)) next.push(style);
          } else if (action === "remove" && style) {
            next = next.filter((s) => s !== style);
          }
          if (env.BOT_KV) await setStyleList(env, next);
          return jsonResponse({ ok: true, styles: await getStyleList(env) });
        }

        if (pathEndsWith(url.pathname, "/api/admin/style-prompts")) {
          const map = await getStylePromptMap(env);
          if (typeof body.stylePrompts === "object" && body.stylePrompts) {
            await setStylePromptMap(env, body.stylePrompts);
          }
          return jsonResponse({ ok: true, stylePrompts: await getStylePromptMap(env) });
        }

        if (pathEndsWith(url.pathname, "/api/admin/custom-prompts")) {
          if (Array.isArray(body.customPrompts)) {
            await setCustomPrompts(env, body.customPrompts);
          }
          return jsonResponse({ ok: true, customPrompts: await getCustomPrompts(env) });
        }

        if (pathEndsWith(url.pathname, "/api/admin/free-limit")) {
          const limit = toInt(body.limit, 3);
          await setFreeDailyLimit(env, limit);
          return jsonResponse({ ok: true, freeDailyLimit: await getFreeDailyLimit(env) });
        }

        if (pathEndsWith(url.pathname, "/api/admin/points/base")) {
          const points = toInt(body.basePoints, 0);
          await setBasePoints(env, points);
          return jsonResponse({ ok: true, basePoints: await getBasePoints(env) });
        }


        if (pathEndsWith(url.pathname, "/api/admin/features")) {
          if (!isOwner(v.fromLike, env)) return jsonResponse({ ok: false, error: "forbidden" }, 403);
          const flags = await getAdminFlags(env);
          if (typeof body.capitalModeEnabled === "boolean") flags.capitalModeEnabled = body.capitalModeEnabled;
          if (typeof body.profileTipsEnabled === "boolean") flags.profileTipsEnabled = body.profileTipsEnabled;
          await setAdminFlags(env, flags);
          return jsonResponse({ ok: true, adminFlags: await getAdminFlags(env) });
        }


        if (pathEndsWith(url.pathname, "/api/admin/offer")) {
          if (typeof body.offerBanner === "string" && env.BOT_KV) {
            await setOfferBanner(env, body.offerBanner);
          }
          if (body.clearOfferBannerImage) {
            await setOfferBannerImage(env, "");
          } else if (typeof body.offerBannerImage === "string") {
            try {
              await setOfferBannerImage(env, body.offerBannerImage);
            } catch (e) {
              return jsonResponse({ ok: false, error: String(e?.message || e || "offer_image_failed") }, 400);
            }
          }
          return jsonResponse({ ok: true, offerBanner: await getOfferBanner(env), offerBannerImage: await getOfferBannerImage(env) });
        }

        if (pathEndsWith(url.pathname, "/api/admin/commissions")) {
          const settings = await getCommissionSettings(env);
          const action = String(body.action || "");
          if (action === "setGlobal" && Number.isFinite(Number(body.percent))) {
            settings.globalPercent = Number(body.percent);
          }
          if (action === "setOverride") {
            const handle = normHandle(body.username);
            const pct = Number(body.percent);
            if (handle && Number.isFinite(pct)) settings.overrides[handle] = pct;
          }
          if (action === "removeOverride") {
            const handle = normHandle(body.username);
            if (handle) delete settings.overrides[handle];
          }
          await setCommissionSettings(env, settings);
          return jsonResponse({ ok: true, commission: await getCommissionSettings(env) });
        }

        if (pathEndsWith(url.pathname, "/api/admin/users")) {
          if (!isOwner(v.fromLike, env)) return jsonResponse({ ok: false, error: "forbidden" }, 403);
          const users = await listUsers(env, Number(body.limit || 100));
          const now = Date.now();
          const report = users.map((u) => {
            const createdAt = u.createdAt || "";
            const usageDays = createdAt ? Math.max(1, Math.ceil((now - Date.parse(createdAt)) / (24 * 3600 * 1000))) : 0;
            const lastTx = Array.isArray(u.wallet?.transactions) ? u.wallet.transactions[u.wallet.transactions.length - 1] : null;
            return {
              userId: u.userId,
              username: u.profile?.username || "",
              phone: u.profile?.phone || "",
              createdAt,
              usageDays,
              totalAnalyses: u.stats?.successfulAnalyses || 0,
              lastAnalysisAt: u.stats?.lastAnalysisAt || "",
              paymentCount: u.stats?.totalPayments || 0,
              paymentTotal: u.stats?.totalPaymentAmount || 0,
              lastTxHash: lastTx?.txHash || "",
              referralBy: u.referral?.referredBy || "",
              referralInvites: u.referral?.successfulInvites || 0,
              subscriptionActive: !!u.subscription?.active,
              subscriptionType: u.subscription?.type || "free",
              subscriptionExpiresAt: u.subscription?.expiresAt || "",
              dailyLimit: dailyLimit(env, u),
              dailyUsed: u.dailyUsed || 0,
              customPromptId: u.customPromptId || "",
            };
          });
          return jsonResponse({ ok: true, users: report });
        }

        if (pathEndsWith(url.pathname, "/api/admin/report/pdf")) {
          if (!isOwner(v.fromLike, env)) return jsonResponse({ ok: false, error: "forbidden" }, 403);
          const users = await listUsers(env, Math.min(300, Math.max(1, Number(body.limit || 200))));
          const payments = await listPayments(env, 120);
          const withdrawals = await listWithdrawals(env, 120);
          const tickets = await listSupportTickets(env, 120);
          const lines = buildAdminReportLines(users, payments, withdrawals, tickets);
          const pdfBytes = buildSimplePdfFromText(lines.join(String.fromCharCode(10)));
          return new Response(pdfBytes, {
            status: 200,
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `attachment; filename=admin-report-${Date.now()}.pdf`,
              "Cache-Control": "no-store",
            },
          });
        }

        if (pathEndsWith(url.pathname, "/api/admin/payments/list")) {
          return jsonResponse({ ok: true, payments: await listPayments(env, 100) });
        }
        if (pathEndsWith(url.pathname, "/api/admin/capital/toggle")) {
          const username = String(body.username || "").trim();
          const enabled = !!body.enabled;
          const userId = await getUserIdByUsername(env, username);
          if (!userId) return jsonResponse({ ok: false, error: "user_not_found" }, 404);
          const st = await ensureUser(userId, env);
          st.capital = st.capital || { amount: 0, enabled: true };
          st.capital.enabled = enabled;
          await saveUser(userId, st, env);
          return jsonResponse({ ok: true, capital: st.capital });
        }


        if (pathEndsWith(url.pathname, "/api/admin/withdrawals/list")) {
          const withdrawals = await listWithdrawals(env, 200);
          return jsonResponse({ ok: true, withdrawals });
        }

        if (pathEndsWith(url.pathname, "/api/admin/withdrawals/review")) {
          const id = String(body.id || "").trim();
          const decision = String(body.decision || "").trim();
          const txHash = String(body.txHash || "").trim();
          if (!id || !["approved","rejected"].includes(decision)) return jsonResponse({ ok: false, error: "bad_request" }, 400);
          const updated = await reviewWithdrawal(env, id, decision, txHash, v.fromLike);
          return jsonResponse({ ok: true, withdrawal: updated });
        }

        if (pathEndsWith(url.pathname, "/api/admin/payments/decision")) {
          const paymentId = String(body.paymentId || "").trim();
          const status = String(body.status || "").trim() === "approved" ? "approved" : "rejected";
          const raw = env.BOT_KV ? await env.BOT_KV.get(`payment:${paymentId}`) : "";
          if (!raw) return jsonResponse({ ok: false, error: "payment_not_found" }, 404);
          let payment = null;
          try { payment = JSON.parse(raw); } catch {}
          if (!payment) return jsonResponse({ ok: false, error: "payment_bad_json" }, 500);
          payment.status = status;
          payment.reviewedAt = new Date().toISOString();
          payment.reviewedBy = normHandle(v.fromLike?.username);
          if (env.BOT_KV) await env.BOT_KV.put(`payment:${paymentId}`, JSON.stringify(payment));
          return jsonResponse({ ok: true, payment });
        }

        // Backward-compat alias for older admin clients
        if (pathEndsWith(url.pathname, "/api/admin/withdrawals/decision")) {
          const id = String(body.withdrawalId || body.id || "").trim();
          const decisionRaw = String(body.status || body.decision || "").trim();
          const decision = decisionRaw === "approved" ? "approved" : (decisionRaw === "rejected" ? "rejected" : "");
          const txHash = String(body.txHash || "").trim();
          if (!id || !decision) return jsonResponse({ ok: false, error: "bad_request" }, 400);
          const updated = await reviewWithdrawal(env, id, decision, txHash, v.fromLike);
          return jsonResponse({ ok: true, withdrawal: updated });
        }



        if (pathEndsWith(url.pathname, "/api/admin/payments/approve")) {
          const username = String(body.username || "").trim();
          const userId = await getUserIdByUsername(env, username);
          if (!userId) return jsonResponse({ ok: false, error: "user_not_found" }, 404);

          const st = await ensureUser(userId, env);
          const amount = Number(body.amount || 0);
          const days = toInt(body.days, 30);
          const txHash = String(body.txHash || "").trim();
          const premiumLimit = toInt(env.PREMIUM_DAILY_LIMIT, 50);
          const now = new Date().toISOString();
          const payment = {
            id: `pay_${Date.now()}_${userId}`,
            userId,
            username,
            amount,
            txHash,
            status: "approved",
            createdAt: now,
            approvedAt: now,
            approvedBy: normHandle(v.fromLike?.username),
          };

          st.subscription.active = true;
          st.subscription.type = "premium";
          st.subscription.dailyLimit = premiumLimit;
          st.subscription.expiresAt = futureISO(days);
          st.stats.totalPayments = (st.stats.totalPayments || 0) + 1;
          st.stats.totalPaymentAmount = (st.stats.totalPaymentAmount || 0) + amount;
          st.wallet.transactions = Array.isArray(st.wallet.transactions) ? st.wallet.transactions : [];
          if (txHash) {
            st.wallet.transactions.push({ txHash, amount, createdAt: now });
            st.wallet.transactions = st.wallet.transactions.slice(-10);
          }

          if (st.referral?.referredBy) {
            const inviter = await ensureUser(String(st.referral.referredBy), env);
            const commission = await getCommissionSettings(env);
            const pctRaw = resolveCommissionPercent(inviter.profile?.username, commission);
            const pct = Math.max(10, Number.isFinite(Number(pctRaw)) ? Number(pctRaw) : 0);
            const reward = pct > 0 ? Math.round((amount * pct) * 100) / 100 : 0;
            inviter.referral.commissionTotal = (inviter.referral.commissionTotal || 0) + reward;
            inviter.referral.commissionBalance = (inviter.referral.commissionBalance || 0) + reward;
            await saveUser(inviter.userId, inviter, env);
            payment.commission = { inviterId: inviter.userId, percent: pct, amount: reward };
          }

          await saveUser(userId, st, env);
          await storePayment(env, payment);
          return jsonResponse({ ok: true, payment, subscription: st.subscription });
        }

        if (pathEndsWith(url.pathname, "/api/admin/subscription/activate")) {
          const username = String(body.username || "").trim();
          const userId = await getUserIdByUsername(env, username);
          if (!userId) return jsonResponse({ ok: false, error: "user_not_found" }, 404);
          const st = await ensureUser(userId, env);
          const days = toInt(body.days, 30);
          const premiumLimit = toInt(body.dailyLimit, toInt(env.PREMIUM_DAILY_LIMIT, 50));
          st.subscription.active = true;
          st.subscription.type = "manual";
          st.subscription.dailyLimit = premiumLimit;
          st.subscription.expiresAt = futureISO(days);
          await saveUser(userId, st, env);
          return jsonResponse({ ok: true, subscription: st.subscription });
        }

        if (pathEndsWith(url.pathname, "/api/admin/custom-prompts/requests")) {
          if (String(body.action || "") === "decide") {
            const requestId = String(body.requestId || "").trim();
            const statusRaw = String(body.status || "").trim();
            const status = statusRaw === "approved" ? "approved" : "rejected";
            const promptId = String(body.promptId || "").trim();

            const requests = await listCustomPromptRequests(env, 200);
            const req = requests.find((x) => x.id === requestId);
            if (!req) return jsonResponse({ ok: false, error: "request_not_found" }, 404);

            req.status = status;
            if (status === "approved") {
              req.promptId = promptId || req.promptId || "";
              if (!req.promptId) return jsonResponse({ ok: false, error: "prompt_id_required" }, 400);
            } else {
              req.promptId = "";
            }

            req.decidedAt = new Date().toISOString();
            req.decidedBy = normHandle(v.fromLike?.username);

            await storeCustomPromptRequest(env, req);

            if (req.status === "approved") {
              const st = await ensureUser(req.userId, env);
              st.customPromptId = String(req.promptId);
              await saveUser(req.userId, st, env);
            }

            // notify user
            const chat = Number(req.userId);
            if (chat) {
              const msg = req.status === "approved"
                ? `✅ درخواست پرامپت اختصاصی شما تایید شد.

شناسه پرامپت: ${req.promptId}

از منوی تنظیمات می‌تونی پرامپت اختصاصی رو انتخاب کنی.`
                : `❌ درخواست پرامپت اختصاصی شما رد شد.

اگر سوالی داری، از بخش پشتیبانی تیکت بزن.`;
              await tgSendMessage(env, chat, msg);
            }

            return jsonResponse({ ok: true, request: req });
          }
          return jsonResponse({ ok: true, requests: await listCustomPromptRequests(env, 200) });
        }

        if (pathEndsWith(url.pathname, "/api/admin/custom-prompts/send")) {
          const username = String(body.username || "").trim();
          const promptId = String(body.promptId || "").trim();
          const userId = await getUserIdByUsername(env, username);
          if (!userId) return jsonResponse({ ok: false, error: "user_not_found" }, 404);
          const prompts = await getCustomPrompts(env);
          const match = prompts.find((p) => String(p?.id || "") === promptId);
          if (!match) return jsonResponse({ ok: false, error: "prompt_not_found" }, 404);
          await tgSendMessage(env, userId, `📌 پرامپت اختصاصی فعال شد:\n${match.title || match.id}\n\n${match.text || ""}`, mainMenuKeyboard(env));
          return jsonResponse({ ok: true });
        }

        if (pathEndsWith(url.pathname, "/api/admin/payments/check")) {
          const payload = {
            txHash: String(body.txHash || "").trim(),
            address: String(body.address || "").trim(),
            amount: Number(body.amount || 0),
          };
          const result = await verifyBlockchainPayment(payload, env);
          return jsonResponse({ ok: true, result });
        }
      }

      if (pathEndsWith(url.pathname, "/api/support/ticket") && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await verifyMiniappAuth(body, env);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);

        const st = await ensureUser(v.userId, env);
        const text = String(body.text || "").trim();
        const kind = String(body.kind || "general").trim();
        if (text.length < 4) return jsonResponse({ ok: false, error: "ticket_too_short" }, 400);

        const ticket = {
          id: `t_${Date.now()}_${st.userId}`,
          userId: String(st.userId),
          username: st.profile?.username || "",
          phone: st.profile?.phone || "",
          text,
          kind,
          status: "pending",
          createdAt: new Date().toISOString(),
        };
        await storeSupportTicket(env, ticket);

        const supportChatId = env.SUPPORT_CHAT_ID ? Number(env.SUPPORT_CHAT_ID) : 0;
        if (supportChatId) {
          await tgSendMessage(env, supportChatId, `📩 تیکت جدید
شناسه: ${ticket.id}
نوع: ${kind}
کاربر: ${st.profile?.username ? "@"+st.profile.username : st.userId}
شماره: ${st.profile?.phone || "-"}
متن:
${text}`);
        }


        return jsonResponse({ ok: true, ticket, supportNotified: !!supportChatId });
      }

      if (pathEndsWith(url.pathname, "/api/wallet/deposit/notify") && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);
        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN, env.INITDATA_MAX_AGE_SEC, env.MINIAPP_AUTH_LENIENT);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);

        const st = await ensureUser(v.userId, env);
        const txid = String(body.txid || body.txHash || "").trim();
        const amount = Number(body.amount || 0);
        if (!txid) return jsonResponse({ ok: false, error: "txid_required" }, 400);

        const payment = {
          id: `dep_${Date.now()}_${st.userId}`,
          userId: String(st.userId),
          username: st.profile?.username || "",
          amount,
          txHash: txid,
          status: "pending",
          createdAt: new Date().toISOString(),
          source: "user_txid",
        };
        await storePayment(env, payment);

        const supportChatId = env.SUPPORT_CHAT_ID ? Number(env.SUPPORT_CHAT_ID) : 0;
        if (supportChatId) {
          await tgSendMessage(env, supportChatId, `💳 درخواست واریز جدید
کاربر: ${st.profile?.username ? "@"+st.profile.username : st.userId}
TxID: ${txid}
مبلغ: ${amount || "-"}
وضعیت: pending`);
        }


        return jsonResponse({ ok: true, payment, supportNotified: !!supportChatId });
      }

      if (pathEndsWith(url.pathname, "/api/chart") && request.method === "GET") {
        const symbol = normalizeSymbol(url.searchParams.get("symbol") || "");
        const tf = String(url.searchParams.get("tf") || "H4").trim().toUpperCase();
        const levelsRaw = String(url.searchParams.get("levels") || "").trim();
        const chartId = String(url.searchParams.get("id") || "").trim();
        const levels = levelsRaw
          ? levelsRaw.split(",").map((x) => Number(x)).filter((n) => Number.isFinite(n)).slice(0, 8)
          : [];

        if (!symbol || !isSymbol(symbol)) {
          return jsonResponse({ ok: false, error: "invalid_symbol" }, 400);
        }

        const quoteRespKey = `quote|${symbol}|${tf}`;
        const quoteCachedResp = apiRespCacheGet(quoteRespKey);
        if (quoteCachedResp) return jsonResponse(quoteCachedResp);

        let candles = [];
        try {
          candles = await getMarketCandlesWithFallback(env, symbol, tf);
        } catch (e) {
          console.error("api/chart market fallback failed:", e?.message || e);
          candles = [];
        }

        if (!Array.isArray(candles) || candles.length === 0) {
          const cacheKey = marketCacheKey(symbol, tf);
          candles = await getMarketCacheStale(env, cacheKey);
        }

        if (!Array.isArray(candles) || candles.length === 0) {
          return jsonResponse({ ok: false, error: "no_market_data" }, 404);
        }

        try {
          let qcSpec = null;
          if (chartId && env.BOT_KV) {
            const raw = await env.BOT_KV.get(chartId);
            if (raw) {
              try { qcSpec = JSON.parse(raw); } catch { qcSpec = null; }
            }
          }
          const png = await renderQuickChartPng(env, candles, symbol, tf, levels, qcSpec);
          return new Response(png, {
            status: 200,
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "public, max-age=60",
            },
          });
        } catch (e) {
          console.error("api/chart quickchart render failed:", e?.message || e);
          const autoLevels = (Array.isArray(levels) && levels.length)
            ? levels
            : extractLevelsFromCandles(candles);
          const svg = buildLevelsOnlySvg(symbol, tf, autoLevels);
          return new Response(svg, {
            status: 200,
            headers: {
              "Content-Type": "image/svg+xml; charset=utf-8",
              "Cache-Control": "public, max-age=30",
              "X-Chart-Fallback": "internal_svg",
            },
          });
        }
      }

      if (pathEndsWith(url.pathname, "/api/quote") && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await verifyMiniappAuth(body, env);
        const allowGuest = miniappGuestEnabled(env) && !v.ok && !!body.allowGuest;
        if (!v.ok && !allowGuest) return jsonResponse({ ok: false, error: v.reason }, 401);

        const st = v.ok ? await ensureUser(v.userId, env) : defaultUser("guest");
        const symbol = normalizeSymbol(body.symbol || "");
        const tf = String(body.timeframe || st.timeframe || "H4").toUpperCase();
        if (!symbol || !isSymbol(symbol)) return jsonResponse({ ok: false, error: "invalid_symbol" }, 400);

        const quoteRespKey = `quote|${symbol}|${tf}`;
        const quoteCachedResp = apiRespCacheGet(quoteRespKey);
        if (quoteCachedResp) return jsonResponse(quoteCachedResp);

        let candles = [];
        try {
          candles = await getMarketCandlesWithFallback(env, symbol, tf);
        } catch (e) {
          console.error("api/quote market fallback failed:", e?.message || e);
          candles = [];
        }
        if (!Array.isArray(candles) || !candles.length) {
          candles = await getMarketCacheStale(env, marketCacheKey(symbol, tf));
        }
        if (!Array.isArray(candles) || !candles.length) {
          return jsonResponse({ ok: false, error: "quote_unavailable" }, 404);
        }

        const snap = computeSnapshot(candles);
        if (!snap || !Number.isFinite(Number(snap.lastPrice))) {
          return jsonResponse({ ok: false, error: "quote_bad_data" }, 502);
        }
        const cp = Number(snap.changePct || 0);
        const status = cp > 0.08 ? "up" : (cp < -0.08 ? "down" : "flat");
        const quality = candles.length >= minCandlesForTimeframe(tf) ? "full" : "limited";

        const quotePayload = {
          ok: true,
          symbol,
          timeframe: tf,
          price: Number(snap.lastPrice),
          changePct: cp,
          trend: snap.trend || "نامشخص",
          sma20: snap.sma20,
          sma50: snap.sma50,
          lastTs: snap.lastTs,
          candles: candles.length,
          quality,
          status,
        };
        apiRespCacheSet(quoteRespKey, quotePayload, Number(env.QUOTE_RESPONSE_CACHE_MS || 10000));
        return jsonResponse(quotePayload);
      }

      if (pathEndsWith(url.pathname, "/api/news") && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await verifyMiniappAuth(body, env);
        const allowGuest = miniappGuestEnabled(env) && !v.ok && !!body.allowGuest;
        if (!v.ok && !allowGuest) return jsonResponse({ ok: false, error: v.reason }, 401);

        const symbol = normalizeSymbol(body.symbol || "");
        if (!symbol || !isSymbol(symbol)) return jsonResponse({ ok: false, error: "invalid_symbol" }, 400);

        const newsRespKey = `news|${symbol}`;
        const newsCachedResp = apiRespCacheGet(newsRespKey);
        if (newsCachedResp) return jsonResponse(newsCachedResp);
        try {
          const articles = await fetchSymbolNewsFa(symbol, env);
          const payload = { ok: true, symbol, articles, count: articles.length };
          apiRespCacheSet(newsRespKey, payload, Number(env.NEWS_RESPONSE_CACHE_MS || 30000));
          return jsonResponse(payload);
        } catch (e) {
          console.error("api/news failed:", e?.message || e);
          return jsonResponse({ ok: false, error: "news_unavailable", symbol, articles: [] }, 502);
        }
      }

      if (pathEndsWith(url.pathname, "/api/news/analyze") && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await verifyMiniappAuth(body, env);
        const allowGuest = miniappGuestEnabled(env) && !v.ok && !!body.allowGuest;
        if (!v.ok && !allowGuest) return jsonResponse({ ok: false, error: v.reason }, 401);

        const symbol = normalizeSymbol(body.symbol || "");
        if (!symbol || !isSymbol(symbol)) return jsonResponse({ ok: false, error: "invalid_symbol" }, 400);

        const newsAnRespKey = `news_an|${symbol}`;
        const newsAnCachedResp = apiRespCacheGet(newsAnRespKey);
        if (newsAnCachedResp) return jsonResponse(newsAnCachedResp);
        try {
          const articles = await fetchSymbolNewsFa(symbol, env);
          const summary = await buildNewsAnalysisSummary(symbol, articles, env);
          const payload = { ok: true, symbol, summary, articles, count: articles.length };
          apiRespCacheSet(newsAnRespKey, payload, Number(env.NEWS_ANALYSIS_RESPONSE_CACHE_MS || 45000));
          return jsonResponse(payload);
        } catch (e) {
          console.error("api/news/analyze failed:", e?.message || e);
          return jsonResponse({ ok: false, error: "news_analysis_unavailable", symbol, summary: "", articles: [] }, 502);
        }
      }
      if (pathEndsWith(url.pathname, "/api/analyze") && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await verifyMiniappAuth(body, env);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);

        const st = await ensureUser(v.userId, env, v.fromLike);
        const symbol = normalizeSymbol(body.symbol || "");
        if (!symbol || !isSymbol(symbol)) return jsonResponse({ ok: false, error: "invalid_symbol" }, 400);

        const isOnboardingReady = !!(
          st.profile?.onboardingDone &&
          st.profile?.name &&
          st.profile?.phone &&
          st.profile?.preferredStyle &&
          st.profile?.preferredMarket &&
          Number(st.profile?.capital || 0) > 0
        );
        if (!isOnboardingReady) {
          return jsonResponse({ ok: false, error: "onboarding_required" }, 403);
        }


        const userPrompt = typeof body.userPrompt === "string" ? body.userPrompt : "";

        // NEW: points-based billing for free-pro users
        const ptsCheck = canSpendAnalysisPoints(st, v.fromLike, env);
        if (!ptsCheck.ok) {
          return jsonResponse({ ok: false, error: ptsCheck.reason }, 402);
        }


        try {
          const flowTimeoutMs = Math.max(15000, Number(env.SIGNAL_FLOW_TIMEOUT_MS || 70000));
          const rawResult = await Promise.race([
            runSignalTextFlowReturnText(env, v.fromLike, st, symbol, userPrompt),
            timeoutPromise(flowTimeoutMs, "api_analyze_timeout"),
          ]);
          const { cleaned: result, qc: qcRaw } = extractQcJsonAndStrip(rawResult);
          if (env.BOT_KV) {
            consumeDaily(st, v.fromLike, env);
            recordAnalysisSuccess(st);
            // NEW: deduct points on each successful analysis (all users)
            if (!isStaff(v.fromLike, env)) spendAnalysisPoints(st, env);
            await saveUser(v.userId, st, env);
          }
          const quota = isStaff(v.fromLike, env) ? "∞" : `${st.dailyUsed}/${dailyLimit(env, st)}`;
          let chartUrl = "";
          let levels = [];
          let quickChartSpec = null;
          let zonesSvg = "";
          let chartCandlesCount = 0;
          try {
            if (String(env.QUICKCHART || "") !== "0") {
              const tf = st.timeframe || "H4";
              levels = extractLevels(result);
              const qcSpec = normalizeQcSpec(qcRaw, levels);
              const origin = new URL(request.url).origin;
              const candles = await getMarketCandlesWithFallback(env, symbol, tf).catch(() => []);
              chartCandlesCount = Array.isArray(candles) ? candles.length : 0;
              if (Array.isArray(candles) && candles.length) {
                let chartId = "";
                if (env.BOT_KV) {
                  chartId = `qc|${v.userId}|${Date.now()}`;
                  const ttl = Number(env.CHART_SPEC_TTL_SEC || 900);
                  await env.BOT_KV.put(chartId, JSON.stringify(qcSpec), { expirationTtl: Math.max(60, ttl) });
                }
                chartUrl = chartId
                  ? `${origin}/api/chart?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&id=${encodeURIComponent(chartId)}`
                  : `${origin}/api/chart?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&levels=${encodeURIComponent(levels.join(","))}`;
                quickChartSpec = buildQuickChartSpec(candles, symbol, tf, levels, qcSpec);
              } else if (levels.length) {
                chartUrl = buildQuickChartLevelsOnlyUrl(symbol, tf, levels);
                quickChartSpec = { fallback: "levels_only", symbol, timeframe: tf, levels };
              }
            }
          } catch (e) {
            console.error("chartUrl build error:", e?.message || e);
          }
          try {
            zonesSvg = buildZonesSvgFromAnalysis(result, symbol, st.timeframe || "H4");
          } catch (e) {
            console.error("zones svg build error:", e?.message || e);
          }
          const tf = st.timeframe || "H4";
          const quickchartConfig = { symbol, timeframe: tf, levels };
          const chartMeta = { timeframe: tf, candles: chartCandlesCount, zones: levels.length };
          return jsonResponse({ ok: true, result, state: st, quota, chartUrl, levels, quickChartSpec, quickchartConfig, chartMeta, zonesSvg });
        } catch (e) {
          console.error("api/analyze error:", e);
          const msg = String(e?.message || e || "");
          if (msg.includes("api_analyze_timeout") || msg.includes("text_") || msg.includes("timeout")) {
            let candles = [];
            try { candles = await getMarketCandlesWithFallback(env, symbol, st.timeframe || "H4"); } catch {}
            const fallback = buildLocalFallbackAnalysis(symbol, st, candles, msg || "analysis_timeout");
            return jsonResponse({ ok: true, result: fallback, state: st, quota: isStaff(v.fromLike, env) ? "∞" : `${st.dailyUsed}/${dailyLimit(env, st)}`, fallback: true, reason: msg || "timeout" });
          }
          return jsonResponse({ ok: false, error: "server_error" }, 500);
        }
      }

      // Telegram webhook route: /telegram/<secret> (supports rootpath prefixes like /bot/telegram/<secret>)
      if (pathIncludes(url.pathname, "/telegram/")) {
        const parts = url.pathname.split("/").filter(Boolean);
        const tIdx = parts.indexOf("telegram");
        const secret = tIdx >= 0 ? (parts[tIdx + 1] || "") : "";
        if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== String(env.TELEGRAM_WEBHOOK_SECRET)) {
          return new Response("forbidden", { status: 403 });
        }
        if (request.method !== "POST") return new Response("method not allowed", { status: 405 });

        const update = await request.json().catch(() => null);
        if (!update) return new Response("bad request", { status: 400 });

        ctx.waitUntil(handleUpdate(update, env));
        return new Response("ok", { status: 200 });
      }

      return new Response("not found", { status: 404 });
    } catch (e) {
      console.error("fetch error:", e);
      return new Response("error", { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try { await runDailySuggestions(env); } catch (e) { console.error("runDailySuggestions error:", e); }
      try { await runDailyProfileNotifications(env); } catch (e) { console.error("runDailyProfileNotifications error:", e); }
    })());
  },
};

/* ========================== BRAND / COPY ========================== */
const MINIAPP_EXEC_CHECKLIST_TEXT = [
  "✅ دامنه را در BotFather > Bot Settings > Domain ثبت کن",
  "✅ Menu Button را روی MINIAPP_URL تنظیم کن",
  "✅ Worker با RootPath درست Deploy شده باشد (مثلاً /bot)",
  "✅ WEB_ADMIN_TOKEN/WEB_OWNER_TOKEN فقط برای وب (خارج تلگرام) است",
  "✅ داخل تلگرام Mini App باید initData داشته باشد",
].join("\n");

const BOT_NAME = "MarketiQ";
const WELCOME_BOT =
`🎯 متن خوش‌آمدگویی بات تلگرام MarketiQ

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
/signals
/support
────────────────────────

⚠️ سلب مسئولیت:
تمام تحلیل‌ها صرفاً جنبه آموزشی و تحلیلی دارند و مسئولیت نهایی معاملات بر عهده کاربر است.`;

const WELCOME_MINIAPP =
`👋 به MarketiQ خوش آمدید — هوش تحلیلی شما در بازارهای مالی
این مینی‌اپ برای گرفتن تحلیل سریع، تنظیمات، و مدیریت دسترسی طراحی شده است.
⚠️ تحلیل‌ها آموزشی است و مسئولیت معاملات با شماست.`;

/* ========================== CONFIG ========================== */
const MAJORS = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"];
const FX_CODES = ["USD","EUR","GBP","JPY","CHF","AUD","CAD","NZD","SEK","NOK","DKK","PLN","HUF","CZK","TRY","ZAR","MXN","BRL","RUB","CNY","HKD","SGD"];
const CRYPTO_QUOTE_CODES = ["USDT","USDC","BUSD","TUSD","FDUSD","USD","BTC","ETH","BNB"];
const EXTRA_INDICES = ["US500","NAS100","GER40","UK100","JP225","HK50","AUS200"];

const METALS = ["XAUUSD", "XAGUSD"];
const INDICES = ["DJI", "NDX", "SPX"];
const CRYPTOS = [
  "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT",
  "ADAUSDT","DOGEUSDT","TRXUSDT","TONUSDT","AVAXUSDT",
  "LINKUSDT","DOTUSDT","MATICUSDT","LTCUSDT","BCHUSDT",
];

const BTN = {
  ANALYZE: "✅ تحلیل کن",
  SIGNAL: "📈 سیگنال‌ها",
  SETTINGS: "⚙️ تنظیمات",
  PROFILE: "👤 پروفایل",
  INVITE: "🤝 دعوت",
  SUPPORT: "🆘 پشتیبانی",
  SUPPORT_TICKET: "✉️ ارسال تیکت",
  SUPPORT_FAQ: "❓ سوالات آماده",
  SUPPORT_CUSTOM_PROMPT: "🧠 درخواست پرامپت اختصاصی",
  EDUCATION: "📚 آموزش",
  LEVELING: "🧪 تعیین سطح",
  BACK: "⬅️ برگشت",
  HOME: "🏠 منوی اصلی",
  MINIAPP: "🧩 مینی‌اپ",
  QUOTE: "💹 قیمت لحظه‌ای",
  NEWS: "📰 اخبار نماد",
  NEWS_ANALYSIS: "🧠 تحلیل خبر",

  WALLET: "💳 ولت",
  WALLET_BALANCE: "💰 موجودی",
  WALLET_DEPOSIT: "➕ واریز",
  WALLET_WITHDRAW: "➖ برداشت",

  CAT_MAJORS: "💱 ماجورها",
  CAT_METALS: "🪙 فلزات",
  CAT_INDICES: "📊 شاخص‌ها",
  CAT_CRYPTO: "₿ کریپتو (15)",

  SET_TF: "⏱ تایم‌فریم",
  SET_STYLE: "🎯 سبک",
  SET_RISK: "⚠️ ریسک",
  SET_NEWS: "📰 خبر",
  SET_CAPITAL: "💼 سرمایه",

  REQUEST_CUSTOM_PROMPT: "🧠 درخواست پرامپت اختصاصی",
};

const TYPING_INTERVAL_MS = 4000;
const TIMEOUT_TEXT_MS = 38000;
const TIMEOUT_VISION_MS = 12000;
const TIMEOUT_POLISH_MS = 15000;

/* ========================== UTILS ========================== */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chunkText(s, size = 3500) {
  const out = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

function timeoutPromise(ms, label = "timeout") {
  return new Promise((_, rej) => setTimeout(() => rej(new Error(label)), ms));
}

async function fetchWithTimeout(url, init, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

function toInt(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function normHandle(h) {
  if (!h) return "";
  return "@" + String(h).replace(/^@/, "").toLowerCase();
}

function inferLocaleByPhone(phone) {
  const p = String(phone || "").replace(/[^+\d]/g, "");
  const map = [
    { prefix: "+98", country: "IR", lang: "fa", tz: "Asia/Tehran" },
    { prefix: "+971", country: "AE", lang: "ar", tz: "Asia/Dubai" },
    { prefix: "+90", country: "TR", lang: "tr", tz: "Europe/Istanbul" },
    { prefix: "+7", country: "RU", lang: "ru", tz: "Europe/Moscow" },
    { prefix: "+44", country: "GB", lang: "en", tz: "Europe/London" },
    { prefix: "+1", country: "US", lang: "en", tz: "America/New_York" },
  ];
  for (const x of map) if (p.startsWith(x.prefix)) return x;
  if (p.startsWith("09") || p.startsWith("98")) return { country: "IR", lang: "fa", tz: "Asia/Tehran" };
  return { country: "INT", lang: "en", tz: "UTC" };
}

function applyLocaleDefaults(st) {
  const loc = inferLocaleByPhone(st?.profile?.phone || "");
  st.profile = st.profile || {};
  st.profile.language = st.profile.language || loc.lang;
  st.profile.countryCode = st.profile.countryCode || loc.country;
  st.profile.timezone = st.profile.timezone || loc.tz;

  const policy = localePolicy(st.profile.language, st.profile.countryCode);
  if (!st.timeframe) st.timeframe = policy.timeframe;
  if (!st.risk) st.risk = policy.risk;
  if (!st.style) st.style = policy.style;
  if (st.profile.preferredStyle && ALLOWED_STYLE_LIST.includes(st.profile.preferredStyle)) {
    st.style = st.profile.preferredStyle;
  }
  if (typeof st.newsEnabled !== "boolean") st.newsEnabled = true;
  if (!st.promptMode) st.promptMode = "style_only";
  return st;
}

function localePolicy(language = "fa", country = "IR") {
  const lang = String(language || "fa").toLowerCase();
  const c = String(country || "IR").toUpperCase();
  if (c === "IR") return { timeframe: "H1", risk: "متوسط", style: "پرایس اکشن" };
  if (lang.startsWith("ar")) return { timeframe: "H1", risk: "متوسط", style: "پرایس اکشن" };
  if (lang.startsWith("tr") || lang.startsWith("ru")) return { timeframe: "H4", risk: "متوسط", style: "ICT" };
  return { timeframe: "H4", risk: "medium", style: "پرایس اکشن" };
}

function applyLocaleFromTelegramUser(st, fromLike = {}) {
  st.profile = st.profile || {};
  const langRaw = String(fromLike?.language_code || "").trim().toLowerCase();
  if (!st.profile.language && langRaw) st.profile.language = langRaw.split("-")[0];
  if (!st.profile.countryCode && langRaw.includes("-")) st.profile.countryCode = langRaw.split("-")[1].toUpperCase();
  if (!st.profile.countryCode) st.profile.countryCode = st.profile.language === "fa" ? "IR" : "INT";
  if (!st.profile.timezone) {
    const tzMap = { fa: "Asia/Tehran", ar: "Asia/Riyadh", tr: "Europe/Istanbul", ru: "Europe/Moscow", en: "UTC" };
    st.profile.timezone = tzMap[st.profile.language] || "UTC";
  }
  const policy = localePolicy(st.profile.language, st.profile.countryCode);
  if (!st.timeframe) st.timeframe = policy.timeframe;
  if (!st.risk) st.risk = policy.risk;
  if (!st.style) st.style = policy.style;
}

async function finalizeOnboardingRewards(env, st) {
  if (!st?.profile?.onboardingDone) return;
  if (!st?.referral?.referredBy || !st?.referral?.referredByCode) return;
  if (st?.referral?.onboardingRewardDone) return;

  const phone = st.profile?.phone || "";
  if (!phone) return;
  const isNew = await isPhoneNew(env, phone);
  await markPhoneSeen(env, phone, st.userId);
  if (!isNew) {
    st.referral.onboardingRewardDone = true;
    st.referral.onboardingRewardAt = new Date().toISOString();
    return;
  }

  const inviterId = String(st.referral.referredBy);
  const inviter = await ensureUser(inviterId, env);
  inviter.referral.successfulInvites = (inviter.referral.successfulInvites || 0) + 1;
  // legacy referral points (kept)
  inviter.referral.points = (inviter.referral.points || 0) + 3;
  // NEW: free-pro invite points
  awardInvitePoints(inviter, env);
  if (inviter.referral.points >= 500) {
    inviter.referral.points -= 500;
    inviter.subscription.active = true;
    inviter.subscription.type = "gift";
    inviter.subscription.dailyLimit = 50;
    inviter.subscription.expiresAt = futureISO(30);
  }
  await saveUser(inviterId, inviter, env);

  st.referral.onboardingRewardDone = true;
  st.referral.onboardingRewardAt = new Date().toISOString();
}

function isStaff(from, env) {
  // staff = admin or owner
  return isOwner(from, env) || isAdmin(from, env);
}


function isFreePro(st) {
  return !!(st?.subscription?.active && (st.subscription.type === "gift" || st.subscription.type === "free_pro"));
}
function ensurePoints(st) {
  if (!st.points) st.points = { balance: 0, spent: 0, earnedFromInvites: 0, initialized: false };
  st.points.balance = Number.isFinite(Number(st.points.balance)) ? Number(st.points.balance) : 0;
  st.points.spent = Number.isFinite(Number(st.points.spent)) ? Number(st.points.spent) : 0;
  st.points.earnedFromInvites = Number.isFinite(Number(st.points.earnedFromInvites)) ? Number(st.points.earnedFromInvites) : 0;
  if (typeof st.points.initialized !== "boolean") st.points.initialized = false;
  return st;
}
function canSpendAnalysisPoints(st, fromLike, env) {
  // Points are enforced for ALL users (except staff)
  if (isStaff(fromLike, env)) return { ok: true };
  ensurePoints(st);
  const cost = Number(env.ANALYSIS_POINTS_COST || 2);
  if (st.points.balance < cost) return { ok: false, reason: "insufficient_points" };
  return { ok: true };
}
function spendAnalysisPoints(st, env) {
  ensurePoints(st);
  const cost = Number(env.ANALYSIS_POINTS_COST || 2);
  st.points.balance = Math.max(0, Number(st.points.balance) - cost);
  st.points.spent = Number(st.points.spent) + cost;
}
function awardInvitePoints(inviter, env) {
  // each successful invite gives 1000 points if inviter is free-pro
  if (!isFreePro(inviter)) return;
  ensurePoints(inviter);
  const gain = Number(env.INVITE_POINTS_GAIN || 1000);
  inviter.points.balance = Number(inviter.points.balance) + gain;
  inviter.points.earnedFromInvites = Number(inviter.points.earnedFromInvites) + gain;
}
function isOwner(from, env) {
  // owner by Telegram user id OR username handle
  const id = String(from?.id || "").trim();
  const rawIds = String(env.OWNER_IDS || "").trim();
  if (id && rawIds) {
    const idSet = new Set(rawIds.split(",").map((x) => String(x || "").trim()).filter(Boolean));
    if (idSet.has(id)) return true;
  }

  const u = normHandle(from?.username);
  if (!u) return false;
  const raw = String(env.OWNER_HANDLES || "").trim();
  if (!raw) return false;
  const set = new Set(raw.split(",").map(normHandle).filter(Boolean));
  return set.has(u);
}

function isAdmin(from, env) {
  // admin by Telegram user id OR username handle
  const id = String(from?.id || "").trim();
  const rawIds = String(env.ADMIN_IDS || "").trim();
  if (id && rawIds) {
    const idSet = new Set(rawIds.split(",").map((x) => String(x || "").trim()).filter(Boolean));
    if (idSet.has(id)) return true;
  }

  const u = normHandle(from?.username);
  if (!u) return false;
  const raw = String(env.ADMIN_HANDLES || "").trim();
  if (!raw) return false;
  const set = new Set(raw.split(",").map(normHandle).filter(Boolean));
  return set.has(u);
}

function firstHandleFromCsv(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.split(",").map((x) => normHandle(x)).filter(Boolean)[0] || "";
}


function kyivDateString(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function parseOrder(raw, fallbackArr) {
  const s = (raw || "").toString().trim();
  if (!s) return fallbackArr;
  return s.split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}

function detectMimeFromHeaders(resp, fallback = "image/jpeg") {
  const ct = resp.headers.get("content-type") || "";
  if (ct.startsWith("image/")) return ct.split(";")[0].trim();
  return fallback;
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function randomCode(len = 10) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

const MARKET_CACHE = new Map();
const ANALYSIS_CACHE = new Map();
const MARKET_PROVIDER_FAIL_UNTIL = new Map();
const PROVIDER_FAILURE_COUNT = new Map();

function providerInCooldown(provider) {
  const key = String(provider || "").toLowerCase();
  if (!key) return false;
  const until = Number(MARKET_PROVIDER_FAIL_UNTIL.get(key) || 0);
  if (!until) return false;
  if (Date.now() >= until) {
    MARKET_PROVIDER_FAIL_UNTIL.delete(key);
    return false;
  }
  return true;
}

function markProviderSuccess(provider, _scope) {
  const key = String(provider || "").toLowerCase();
  if (!key) return;
  MARKET_PROVIDER_FAIL_UNTIL.delete(key);
  PROVIDER_FAILURE_COUNT.delete(key);
}

function markProviderFailure(provider, env, _scope) {
  const key = String(provider || "").toLowerCase();
  if (!key) return;
  const fails = Number(PROVIDER_FAILURE_COUNT.get(key) || 0) + 1;
  PROVIDER_FAILURE_COUNT.set(key, fails);

  const baseMs = Number(env?.PROVIDER_COOLDOWN_BASE_MS || 5000);
  const maxMs = Number(env?.PROVIDER_COOLDOWN_MAX_MS || 120000);
  const cooldownMs = Math.min(maxMs, baseMs * Math.min(16, 2 ** Math.max(0, fails - 1)));
  MARKET_PROVIDER_FAIL_UNTIL.set(key, Date.now() + cooldownMs);
}

function cacheGet(map, key) {
  const hit = map.get(key);
  if (!hit) return null;
  if (hit.expiresAt && hit.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(map, key, value, ttlMs, maxSize = 500) {
  map.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (map.size > maxSize) {
    const [first] = map.keys();
    if (first) map.delete(first);
  }
}

async function r2GetJson(bucket, key) {
  if (!bucket) return null;
  const obj = await bucket.get(key);
  if (!obj) return null;
  try { return await obj.json(); } catch { return null; }
}

async function r2PutJson(bucket, key, value, ttlMs) {
  if (!bucket) return;
  const body = JSON.stringify({ value, expiresAt: Date.now() + ttlMs });
  await bucket.put(key, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { ttlMs: String(ttlMs || "") },
  });
}

async function getCachedR2Value(bucket, key) {
  const payload = await r2GetJson(bucket, key);
  if (!payload) return null;
  if (payload.expiresAt && payload.expiresAt <= Date.now()) return null;
  return payload.value;
}

async function getCachedR2ValueAllowStale(bucket, key) {
  const payload = await r2GetJson(bucket, key);
  if (!payload) return null;
  return payload.value;
}

/* ========================== PROMPTS (ADMIN/OWNER ONLY) ========================== */
const DEFAULT_ANALYSIS_PROMPT = `SYSTEM: تحلیل‌گر حرفه‌ای بازار

قوانین قطعی:
1) خروجی نهایی فقط فارسی باشد.
2) فقط بر اساس STYLE_PROMPT_JSON (سبک انتخابی کاربر) تحلیل کن.
3) فقط از داده MARKET_DATA استفاده کن و خیال‌پردازی نکن.
4) ورودی‌های کاربر را الزامی لحاظ کن: Symbol, Timeframe, Risk, Capital.
5) خروجی را مرحله‌ای، اجرایی و با مدیریت ریسک ارائه بده.
6) در صورت نبود داده کافی، شفاف اعلام کن.

ساختار خروجی:
۱) بایاس و وضعیت ساختار
۲) نواحی و نقدینگی/سطوح کلیدی
۳) سناریوی ورود (Entry/SL/TP)
۴) مدیریت ریسک و اندازه پوزیشن
۵) سناریوی ابطال و جمع‌بندی اجرایی`;

/* ========================== STYLE PROMPTS (DEFAULTS) ==========================
 * Users choose st.style (Persian labels) and we inject a style-specific guide
 * into the analysis prompt. Admin can still override the global base prompt via KV.
 */
const STYLE_PROMPTS_DEFAULT = {
  "ICT": `{"role":"system","identity":{"title":"ICT & Smart Money Analyst","language":"persian","methodology":["ICT (Inner Circle Trader)","Smart Money Concepts"],"restrictions":["No indicators","No retail concepts","ICT & Smart Money concepts ONLY"]},"task":{"description":"Analyze the requested market (Symbol, Timeframe) using ICT & Smart Money Concepts ONLY."},"analysis_requirements":{"1_higher_timeframe_bias":{"timeframes":["Daily","H4"],"elements":["Overall HTF bias (Bullish / Bearish / Neutral)","Premium zone","Discount zone","Equilibrium level (50%)","Imbalance vs Balance state"]},"2_liquidity_mapping":{"identify":["Equal Highs (EQH)","Equal Lows (EQL)","Buy-side liquidity","Sell-side liquidity","Stop-loss pools"],"objective":"Determine where liquidity is resting and likely to be engineered toward"},"3_market_structure":{"elements":["BOS (Break of Structure)","MSS / CHoCH (Market Structure Shift)"],"clarification":["Manipulation phase","Expansion phase"]},"4_pd_arrays":{"arrays":["Bullish Order Blocks","Bearish Order Blocks","Fair Value Gaps (FVG)","Liquidity Voids","Previous Day High (PDH)","Previous Day Low (PDL)","Previous Week High (PWH)","Previous Week Low (PWL)"]},"5_kill_zones":{"condition":"Intraday only","zones":["London Kill Zone","New York Kill Zone"],"explanation":"Explain why timing matters for this setup"},"6_entry_model":{"model_examples":["Liquidity Sweep → MSS → FVG Entry","Liquidity Sweep → Order Block Entry"],"must_include":["Entry price","Stop Loss location (above/below OB or swing)","Take Profit targets based on liquidity"]},"7_narrative":{"storytelling":["Who is trapped?","Where did smart money enter?","Where is price likely engineered to go?"]}},"execution_plan":{"bias":"Bullish or Bearish","entry_conditions":"Clear confirmation rules","targets":"Liquidity-based targets","invalidation_point":"Price level that invalidates the idea"},"output_style":{"tone":"Professional, precise, educational","structure":"Step-by-step, clearly labeled sections","language":"Clear and technical ICT terminology"}}`,
  "ATR": `{"role":"persian quantitative_trading_assistant","strategy":"ATR-based volatility trading","analysis_requirements":{"volatility_state":["Current ATR value","Comparison with historical ATR average","Volatility expansion or contraction"],"market_condition":["Trending or Ranging","Breakout vs Mean Reversion suitability"],"trade_setup":{"entry":"Based on price structure","stop_loss":"SL = Entry ± (ATR × Multiplier)","take_profit":["TP1 based on ATR expansion","TP2 based on ATR expansion"]},"position_sizing":["Risk per trade (%)","Position size based on SL distance"],"trade_filtering":["When NOT to trade based on ATR","High-risk volatility conditions (news, spikes)"],"risk_management":["Max daily loss","Max consecutive losses","ATR-based trailing stop logic"],"summary":["Statistical justification","Expected trade duration","Risk classification (Low/Medium/High)"]}}`,
  "پرایس اکشن": `{"role":"system","description":"Professional Price Action Market Analysis Prompt","constraints":{"analysis_style":"Pure Price Action Only","indicators":"Forbidden unless explicitly requested","focus":"High-probability setups only","language":"Professional, clear, step-by-step and persian"},"required_sections":{"market_structure":{"items":["Trend identification (Uptrend / Downtrend / Range)","HH, HL, LH, LL labeling","Structure status (Intact / BOS / MSS)"]},"key_levels":{"items":["Strong Support zones","Strong Resistance zones","Flip zones (SR to Resistance / Resistance to Support)","Psychological levels (if relevant)"]},"candlestick_behavior":{"items":["Pin Bar","Engulfing","Inside Bar","Explanation of buyer/seller intent"]},"entry_scenarios":{"requirements":["Clear entry zone","Logical structure-based Stop Loss","TP1 and TP2 targets","Minimum Risk:Reward of 1:2"]},"bias_and_scenarios":{"items":["Main bias (Bullish / Bearish / Neutral)","Alternative scenario upon invalidation"]},"execution_plan":{"items":["Continuation or Reversal trade","Required confirmation before entry"]}},"instructions":["Explain everything step-by-step","Use structure-based logic","Avoid overtrading","Execution-focused explanations"]}`,
};
const DEFAULT_CUSTOM_PROMPTS = [
  { id: "ict_style", title: "ICT & Smart Money", text: STYLE_PROMPTS_DEFAULT["ICT"] },
  { id: "atr_style", title: "ATR Volatility", text: STYLE_PROMPTS_DEFAULT["ATR"] },
  { id: "price_action_style", title: "Price Action", text: STYLE_PROMPTS_DEFAULT["پرایس اکشن"] },
];


function normalizeStyleLabel(style) {
  const s = String(style || "").trim();
  if (!s) return "";
  const low = s.toLowerCase();
  if (low === "price action" || low === "priceaction") return "پرایس اکشن";
  if (low === "ict") return "ICT";
  if (low === "atr") return "ATR";
  return s;
}

function getStyleGuide(style) {
  const key = normalizeStyleLabel(style);
  return STYLE_PROMPTS_DEFAULT[key] || "";
}


async function getAnalysisPrompt(env) {
  const kv = env.BOT_KV;
  if (!kv) return DEFAULT_ANALYSIS_PROMPT;
  const p = await kv.get("settings:analysis_prompt");
  return (p && p.trim()) ? p : DEFAULT_ANALYSIS_PROMPT;
}

async function getBotWelcomeText(env) {
  if (!env.BOT_KV) return WELCOME_BOT;
  const raw = await env.BOT_KV.get("settings:welcome_bot");
  return (raw && raw.trim()) ? raw : WELCOME_BOT;
}

async function setBotWelcomeText(env, text) {
  if (!env.BOT_KV) return;
  await env.BOT_KV.put("settings:welcome_bot", String(text || "").trim());
}

async function getMiniappWelcomeText(env) {
  if (!env.BOT_KV) return WELCOME_MINIAPP;
  const raw = await env.BOT_KV.get("settings:welcome_miniapp");
  return (raw && raw.trim()) ? raw : WELCOME_MINIAPP;
}

async function setMiniappWelcomeText(env, text) {
  if (!env.BOT_KV) return;
  await env.BOT_KV.put("settings:welcome_miniapp", String(text || "").trim());
}

/* ========================== STYLE PROMPTS (PER-STYLE) ========================== */
function styleKey(style) {
  return String(style || "").trim().toLowerCase().replace(/\s+/g, "_");
}
async function getStylePrompt(env, style) {
  const map = await getStylePromptMap(env);
  const key = normalizeStyleLabel(style);
  return (map?.[styleKey(key)] || STYLE_PROMPTS_DEFAULT[key] || "").toString().trim();
}
async function setStylePrompt(env, style, prompt) {
  if (!env.BOT_KV) return;
  const map = await getStylePromptMap(env);
  map[styleKey(style)] = String(prompt || "");
  await setStylePromptMap(env, map);
}

async function getStylePromptMap(env) {
  const defaults = {
    [styleKey("ICT")]: STYLE_PROMPTS_DEFAULT["ICT"],
    [styleKey("ATR")]: STYLE_PROMPTS_DEFAULT["ATR"],
    [styleKey("پرایس اکشن")]: STYLE_PROMPTS_DEFAULT["پرایس اکشن"],
  };
  if (!env.BOT_KV) return defaults;
  const raw = await env.BOT_KV.get("settings:style_prompts_json");
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return defaults;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

async function setStylePromptMap(env, map) {
  if (!env.BOT_KV) return;
  const payload = map && typeof map === "object" ? map : {};
  await env.BOT_KV.put("settings:style_prompts_json", JSON.stringify(payload));
}

async function getCustomPrompts(env) {
  if (!env.BOT_KV) return DEFAULT_CUSTOM_PROMPTS.slice();
  const raw = await env.BOT_KV.get("settings:custom_prompts");
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return (Array.isArray(parsed) && parsed.length) ? parsed : DEFAULT_CUSTOM_PROMPTS.slice();
  } catch {
    return DEFAULT_CUSTOM_PROMPTS.slice();
  }
}

async function setCustomPrompts(env, prompts) {
  if (!env.BOT_KV) return;
  const clean = Array.isArray(prompts) ? prompts : [];
  await env.BOT_KV.put("settings:custom_prompts", JSON.stringify(clean));
}

async function getFreeDailyLimit(env) {
  if (!env.BOT_KV) return 3;
  const raw = await env.BOT_KV.get("settings:free_daily_limit");
  return toInt(raw, 3);
}

async function setFreeDailyLimit(env, limit) {
  if (!env.BOT_KV) return;
  await env.BOT_KV.put("settings:free_daily_limit", String(limit));
}


async function getBasePoints(env) {
  // Admin-configured base points (applied to new users and one-time backfill for zeroed users)
  const fallback = 50;
  if (!env.BOT_KV) return fallback;
  const raw = await env.BOT_KV.get("settings:base_points");
  return toInt(raw, fallback);
}
async function setBasePoints(env, points) {
  if (!env.BOT_KV) return;
  await env.BOT_KV.put("settings:base_points", String(points));
}
const ALLOWED_STYLE_LIST = ["پرایس اکشن", "ICT", "ATR"];
const DEFAULT_STYLE_LIST = ALLOWED_STYLE_LIST.slice();

async function getStyleList(env) {
  if (!env.BOT_KV) return DEFAULT_STYLE_LIST.slice();
  const raw = await env.BOT_KV.get("settings:style_list");
  if (!raw) return DEFAULT_STYLE_LIST.slice();
  try {
    const list = JSON.parse(raw);
    const filtered = Array.isArray(list) ? list.filter((s) => ALLOWED_STYLE_LIST.includes(s)) : [];
    return filtered.length ? filtered : DEFAULT_STYLE_LIST.slice();
  } catch {
    return DEFAULT_STYLE_LIST.slice();
  }
}

async function setStyleList(env, styles) {
  if (!env.BOT_KV) return;
  const clean = (Array.isArray(styles) ? styles : [])
    .map((s) => String(s || "").trim())
    .filter((s) => ALLOWED_STYLE_LIST.includes(s));
  await env.BOT_KV.put("settings:style_list", JSON.stringify(clean));
}

async function getOfferBanner(env) {
  if (!env.BOT_KV) return (env.SPECIAL_OFFER_TEXT || "").toString().trim();
  const raw = await env.BOT_KV.get("settings:offer_banner");
  return (raw || env.SPECIAL_OFFER_TEXT || "").toString().trim();
}

async function setOfferBanner(env, text) {
  if (!env.BOT_KV) return;
  await env.BOT_KV.put("settings:offer_banner", String(text || "").trim());
}

async function getOfferBannerImage(env) {
  if (!env.BOT_KV) return (env.SPECIAL_OFFER_IMAGE || "").toString().trim();
  const raw = await env.BOT_KV.get("settings:offer_banner_image");
  return (raw || env.SPECIAL_OFFER_IMAGE || "").toString().trim();
}






async function setOfferBannerImage(env, dataUrl) {
  if (!env.BOT_KV) return;
  const clean = String(dataUrl || "").trim();
  if (!clean) {
    await env.BOT_KV.delete("settings:offer_banner_image");
    return;
  }
  const isDataImage = clean.startsWith("data:image/");
  const isHttpUrl = /^https?:\/\//i.test(clean);
  if (!isDataImage && !isHttpUrl) throw new Error("bad_offer_image_format");
  if (isDataImage && clean.length > 1_500_000) throw new Error("offer_image_too_large");
  await env.BOT_KV.put("settings:offer_banner_image", clean);
}

async function getCommissionSettings(env) {
  if (!env.BOT_KV) return { globalPercent: 0, overrides: {} };
  const g = await env.BOT_KV.get("settings:commission:globalPercent");
  const o = await env.BOT_KV.get("settings:commission:overrides");
  let overrides = {};
  try { overrides = o ? JSON.parse(o) : {}; } catch { overrides = {}; }
  return {
    globalPercent: toInt(g, 0),
    overrides: overrides && typeof overrides === "object" ? overrides : {},
  };
}

async function setCommissionSettings(env, settings) {
  if (!env.BOT_KV) return;
  if (typeof settings.globalPercent === "number") {
    await env.BOT_KV.put("settings:commission:globalPercent", String(settings.globalPercent));
  }
  if (settings.overrides) {
    await env.BOT_KV.put("settings:commission:overrides", JSON.stringify(settings.overrides || {}));
  }
}

function resolveCommissionPercent(username, settings) {
  const handle = normHandle(username);
  if (!handle) return settings.globalPercent || 0;
  const raw = settings.overrides?.[handle];
  const override = Number(raw);
  if (Number.isFinite(override)) return override;
  return settings.globalPercent || 0;
}

async function updateUserIndexes(env, st) {
  if (!env.BOT_KV) return;
  const id = String(st.userId);

  const raw = await env.BOT_KV.get("users:index");
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  if (!list.includes(id)) list.push(id);
  await env.BOT_KV.put("users:index", JSON.stringify(list.slice(-2000)));

  const handle = normHandle(st.profile?.username);
  if (handle) {
    await env.BOT_KV.put(`users:by_username:${handle}`, id);
  }
}

async function getUserIdByUsername(env, username) {
  if (!env.BOT_KV) return "";
  const handle = normHandle(username);
  if (!handle) return "";
  return (await env.BOT_KV.get(`users:by_username:${handle}`)) || "";
}

async function listUsers(env, limit = 100) {
  if (!env.BOT_KV) return [];
  const raw = await env.BOT_KV.get("users:index");
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  if (!Array.isArray(list)) return [];
  const ids = list.slice(-limit);
  const users = [];
  for (const id of ids) {
    const u = await getUser(id, env);
    if (u) users.push(u);
  }
  return users;
}

async function storePayment(env, payment) {
  if (!env.BOT_KV) return;
  await env.BOT_KV.put(`payment:${payment.id}`, JSON.stringify(payment));

  const raw = await env.BOT_KV.get("payments:index");
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  if (!list.includes(payment.id)) list.push(payment.id);
  await env.BOT_KV.put("payments:index", JSON.stringify(list.slice(-500)));
}

async function listPayments(env, limit = 50) {
  if (!env.BOT_KV) return [];
  const raw = await env.BOT_KV.get("payments:index");
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  if (!Array.isArray(list)) return [];
  const ids = list.slice(-limit);
  const out = [];
  for (const id of ids) {
    const rawPay = await env.BOT_KV.get(`payment:${id}`);
    if (rawPay) {
      try { out.push(JSON.parse(rawPay)); } catch {}
    }
  }
  return out.sort((a, b) => (b?.createdAt || "").localeCompare(a?.createdAt || ""));
}

async function storeSupportTicket(env, ticket) {
  if (!env.BOT_KV) return;
  await env.BOT_KV.put(`ticket:${ticket.id}`, JSON.stringify(ticket));
  const raw = await env.BOT_KV.get("tickets:index");
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  if (!list.includes(ticket.id)) list.push(ticket.id);
  await env.BOT_KV.put("tickets:index", JSON.stringify(list.slice(-1000)));
}

async function listSupportTickets(env, limit = 100) {
  if (!env.BOT_KV) return [];
  const raw = await env.BOT_KV.get("tickets:index");
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  if (!Array.isArray(list)) return [];

  const ids = list.slice(-Number(limit));
  const out = [];
  for (const id of ids) {
    const r = await env.BOT_KV.get(`ticket:${id}`);
    if (!r) continue;
    try { out.push(JSON.parse(r)); } catch {}
  }

  return out.sort((a,b)=>(String(b?.createdAt||"")).localeCompare(String(a?.createdAt||"")));
}


async function updateSupportTicket(env, id, patch = {}) {
  if (!env.BOT_KV) throw new Error("BOT_KV missing");
  const key = `ticket:${id}`;
  const raw = await env.BOT_KV.get(key);
  if (!raw) throw new Error("ticket_not_found");
  let t = null;
  try { t = JSON.parse(raw); } catch {}
  if (!t) throw new Error("ticket_bad_json");

  const next = { ...t };
  if (typeof patch.status === "string" && patch.status) next.status = patch.status;
  if (typeof patch.reply === "string") next.reply = patch.reply;
  if (typeof patch.updatedBy === "string" && patch.updatedBy) next.updatedBy = patch.updatedBy;
  next.updatedAt = new Date().toISOString();

  await env.BOT_KV.put(key, JSON.stringify(next));

  // ensure index
  const idxRaw = await env.BOT_KV.get("tickets:index");
  let list = [];
  try { list = idxRaw ? JSON.parse(idxRaw) : []; } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  if (!list.includes(id)) list.push(id);
  await env.BOT_KV.put("tickets:index", JSON.stringify(list.slice(-1000)));

  return next;
}

async function listWithdrawals(env, limit = 50) {
  const lim = Number(limit);
  if (env.BOT_DB) {
    try {
      const rows = await env.BOT_DB.prepare("SELECT id, userId, createdAt, amount, address, status FROM withdrawals ORDER BY createdAt DESC LIMIT ?1").bind(lim).all();
      return rows?.results || [];
    } catch (e) {
      console.error("listWithdrawals db error:", e);
    }
  }

  if (!env.BOT_KV || typeof env.BOT_KV.list !== "function") return [];
  const listed = await env.BOT_KV.list({ prefix: "withdraw:", limit: lim });
  const out = [];
  for (const k of listed?.keys || []) {
    const raw = await env.BOT_KV.get(k.name);
    if (!raw) continue;
    try { out.push(JSON.parse(raw)); } catch {}
  }
  return out.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
}

async function reviewWithdrawal(env, id, decision, txHash, reviewer) {
  const reviewedAt = new Date().toISOString();
  if (env.BOT_DB) {
    await env.BOT_DB.prepare("UPDATE withdrawals SET status=?1 WHERE id=?2").bind(decision, id).run();
    const row = await env.BOT_DB.prepare("SELECT id, userId, createdAt, amount, address, status FROM withdrawals WHERE id=?1").bind(id).first();
    const data = { ...(row || {}), txHash, reviewedAt, reviewedBy: normHandle(reviewer?.username) };
    if (env.BOT_KV) await env.BOT_KV.put(`withdraw:${id}`, JSON.stringify(data));
    return data;
  }
  const raw = env.BOT_KV ? await env.BOT_KV.get(`withdraw:${id}`) : null;
  const data = raw ? JSON.parse(raw) : { id, status: "pending" };
  data.status = decision;
  data.txHash = txHash;
  data.reviewedAt = reviewedAt;
  data.reviewedBy = normHandle(reviewer?.username);
  if (env.BOT_KV) await env.BOT_KV.put(`withdraw:${id}`, JSON.stringify(data));
  return data;
}

async function storeCustomPromptRequest(env, req) {
  if (!env.BOT_KV) return;
  await env.BOT_KV.put(`custom_prompt_req:${req.id}`, JSON.stringify(req));
  const raw = await env.BOT_KV.get("custom_prompt_req:index");
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  if (!list.includes(req.id)) list.push(req.id);
  await env.BOT_KV.put("custom_prompt_req:index", JSON.stringify(list.slice(-1000)));
}

async function listCustomPromptRequests(env, limit = 200) {
  if (!env.BOT_KV) return [];
  const raw = await env.BOT_KV.get("custom_prompt_req:index");
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  if (!Array.isArray(list)) return [];

  const ids = list.slice(-Number(limit));
  const out = [];
  for (const id of ids) {
    const r = await env.BOT_KV.get(`custom_prompt_req:${id}`);
    if (!r) continue;
    try { out.push(JSON.parse(r)); } catch {}
  }

  return out.sort((a,b)=>(String(b?.createdAt||"")).localeCompare(String(a?.createdAt||"")));
}

async function getAdminFlags(env) {
  if (!env.BOT_KV) return { capitalModeEnabled: true, profileTipsEnabled: true };
  const raw = await env.BOT_KV.get("settings:admin_flags");
  try {
    const j = raw ? JSON.parse(raw) : {};
    return {
      capitalModeEnabled: typeof j.capitalModeEnabled === "boolean" ? j.capitalModeEnabled : true,
      profileTipsEnabled: typeof j.profileTipsEnabled === "boolean" ? j.profileTipsEnabled : true,
    };
  } catch {
    return { capitalModeEnabled: true, profileTipsEnabled: true };
  }
}

async function setAdminFlags(env, flags) {
  if (!env.BOT_KV) return;
  await env.BOT_KV.put("settings:admin_flags", JSON.stringify({
    capitalModeEnabled: !!flags.capitalModeEnabled,
    profileTipsEnabled: !!flags.profileTipsEnabled,
  }));
}

async function runDailyProfileNotifications(env) {
  const flags = await getAdminFlags(env);
  if (!flags.profileTipsEnabled) return;
  const users = await listUsers(env, 500);
  const hr = new Date().getUTCHours();
  if (!(hr === 8 || hr === 20)) return;
  for (const u of users) {
    const uid = Number(u?.userId || 0);
    if (!uid) continue;

    const cap = Number(u?.profile?.capital || u?.capital?.amount || 0);
    const risk = u?.risk || "متوسط";
    const msg = `🔔 پیشنهاد روزانه تحلیل
سرمایه ثبت‌شده: ${cap || "-"} ${u?.profile?.capitalCurrency || "USDT"}
ریسک: ${risk}
پیشنهاد: امروز با مدیریت سرمایه محافظه‌کارانه و تایید چند-سبکی وارد شو.`;
    try { await tgSendMessage(env, uid, msg, mainMenuKeyboard(env)); } catch {}
  }
}


async function verifyBlockchainPayment(payload, env) {
  const endpoint = (env.BLOCKCHAIN_CHECK_URL || "").toString().trim();
  if (!endpoint) return { ok: false, reason: "check_url_missing" };
  const r = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, Number(env.BLOCKCHAIN_CHECK_TIMEOUT_MS || 8000));
  const j = await r.json().catch(() => null);
  return j || { ok: false, reason: "bad_response" };
}

/* ========================== KEYBOARDS ========================== */
function kb(rows) {
  return {
    keyboard: rows,
    resize_keyboard: true,
    one_time_keyboard: false,
    input_field_placeholder: "از دکمه‌ها استفاده کن…",
  };
}

function mainMenuKeyboard(env) {
  return kb([
    [BTN.SIGNAL, BTN.SETTINGS],
    [BTN.WALLET, BTN.PROFILE],
    [BTN.INVITE, BTN.SUPPORT],
    [BTN.HOME],
  ]);
}

function signalMenuKeyboard() {
  return kb([[BTN.CAT_MAJORS, BTN.CAT_METALS], [BTN.CAT_INDICES, BTN.CAT_CRYPTO], [BTN.QUOTE, BTN.NEWS], [BTN.BACK, BTN.HOME]]);
}

function settingsMenuKeyboard() {

  return kb([[BTN.SET_TF, BTN.SET_STYLE], [BTN.SET_RISK, BTN.SET_NEWS], [BTN.SET_CAPITAL, BTN.REQUEST_CUSTOM_PROMPT], [BTN.BACK, BTN.HOME]]);
}

function walletMenuKeyboard() {
  return kb([
    [BTN.WALLET_BALANCE],
    [BTN.WALLET_DEPOSIT, BTN.WALLET_WITHDRAW],
    [BTN.HOME],
  ]);
}


function listKeyboard(items, columns = 2) {
  const rows = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  rows.push([BTN.BACK, BTN.HOME]);
  return kb(rows);
}

function optionsKeyboard(options) {
  const rows = [];
  for (let i = 0; i < options.length; i += 2) rows.push(options.slice(i, i + 2));
  rows.push([BTN.BACK, BTN.HOME]);
  return kb(rows);
}

function contactKeyboard() {
  return {
    keyboard: [[{ text: "📱 ارسال شماره تماس", request_contact: true }], [BTN.BACK, BTN.HOME]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

const DEFAULT_MINIAPP_URL = "https://sniperim.mad-pyc.workers.dev/";

function getMiniappUrl(env) {
  const configured = (env.MINIAPP_URL || env.PUBLIC_BASE_URL || "").toString().trim();
  const raw = configured || DEFAULT_MINIAPP_URL;
  try {
    const u = new URL(raw);
    u.pathname = "/";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return DEFAULT_MINIAPP_URL;
  }
}
async function miniappInlineKeyboard(env, st, from) {
  const url = getMiniappUrl(env);
  if (!url) return null;
  const token = await issueMiniappToken(env, st?.userId, from || {});
  const finalUrl = token ? appendQuery(url, { miniToken: token }) : url;
  return { inline_keyboard: [[{ text: BTN.MINIAPP, web_app: { url: finalUrl } }]] };
}

function appendQuery(url, params) {
  try {
    const u = new URL(url);
    Object.entries(params || {}).forEach(([k,v]) => { if (v != null && String(v) !== "") u.searchParams.set(k, String(v)); });
    return u.toString();
  } catch {
    return url;
  }
}



/* ========================== BOT_DB (D1) STATE ========================== */
/*
DDL (Cloudflare D1):
CREATE TABLE IF NOT EXISTS users (
  userId TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  amount REAL NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);
*/
async function dbGetUser(userId, env) {
  if (!env.BOT_DB) return null;
  try {
    const row = await env.BOT_DB.prepare("SELECT json FROM users WHERE userId=?1").bind(String(userId)).first();
    if (!row || !row.json) return null;
    return JSON.parse(row.json);
  } catch (e) {
    console.error("dbGetUser error:", e);
    return null;
  }
}

async function dbSaveUser(userId, st, env) {
  if (!env.BOT_DB) return;
  try {
    const now = new Date().toISOString();
    await env.BOT_DB.prepare(
      "INSERT INTO users (userId, json, updatedAt) VALUES (?1, ?2, ?3) " +
      "ON CONFLICT(userId) DO UPDATE SET json=excluded.json, updatedAt=excluded.updatedAt"
    ).bind(String(userId), JSON.stringify(st), now).run();
  } catch (e) {
    console.error("dbSaveUser error:", e);
  }
}
/* ========================== KV STATE ========================== */
async function getUser(userId, env) {
  // Prefer BOT_DB (D1). Fallback to KV.
  const db = await dbGetUser(userId, env);
  if (db) return db;

  if (!env.BOT_KV) return null;
  const raw = await env.BOT_KV.get(`u:${userId}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function saveUser(userId, st, env) {
  // Write-through to BOT_DB (D1) if available. Also keep KV for compatibility.
  await dbSaveUser(userId, st, env);

  if (!env.BOT_KV) return;
  await env.BOT_KV.put(`u:${userId}`, JSON.stringify(st));
  await updateUserIndexes(env, st);
}

function defaultUser(userId) {
  return {
    userId,
    createdAt: new Date().toISOString(),

    // bot state machine
    state: "idle",
    selectedSymbol: "",

    // preferences
    timeframe: "H4",
    style: "پرایس اکشن",
    risk: "متوسط",
    newsEnabled: true,
    promptMode: "style_only",

    // usage quota
    dailyDate: kyivDateString(),
    dailyUsed: 0,
    freeDailyLimit: 3,

    // onboarding/profile
    profile: {
      name: "",
      phone: "",
      username: "",
      firstName: "",
      lastName: "",
      marketExperience: "",
      preferredMarket: "",
      level: "", // beginner/intermediate/pro
      levelNotes: "",
      preferredStyle: "",
      language: "fa",
      countryCode: "IR",
      timezone: "Asia/Tehran",
      entrySource: "",
      onboardingDone: false,
      capital: 0,
      capitalCurrency: "USDT",

    },

    capital: {
      amount: 0,
      enabled: true,
    },

    // referral / points / subscription
    points: {
      balance: 0,
      spent: 0,
      earnedFromInvites: 0,
    },
    referral: {
      codes: [],            // 1 code
      referredBy: "",       // inviter userId
      referredByCode: "",   // which code
      successfulInvites: 0,
      points: 0,
      commissionTotal: 0,
      commissionBalance: 0,
      onboardingRewardDone: false,
      onboardingRewardAt: "",
    },
    subscription: {
      active: false,
      type: "free", // free/premium/gift
      expiresAt: "",
      dailyLimit: 3,
    },

    // wallet (local balance placeholder)
    wallet: {
      balance: 0,
      transactions: [],
    },

    // provider overrides
    textOrder: "",
    visionOrder: "",
    polishOrder: "",

    stats: {
      totalAnalyses: 0,
      successfulAnalyses: 0,
      lastAnalysisAt: "",
      totalPayments: 0,
      totalPaymentAmount: 0,
    },
    customPromptId: "",
    pendingCustomPromptRequestId: "",
  };
}

function patchUser(st, userId) {
  const d = defaultUser(userId);
  const merged = { ...d, ...st };
  merged.profile = { ...d.profile, ...(st?.profile || {}) };
  merged.points = { ...d.points, ...(st?.points || {}) };
  merged.referral = { ...d.referral, ...(st?.referral || {}) };
  merged.subscription = { ...d.subscription, ...(st?.subscription || {}) };
  merged.wallet = { ...d.wallet, ...(st?.wallet || {}) };
  merged.capital = { ...d.capital, ...(st?.capital || {}) };
  merged.stats = { ...d.stats, ...(st?.stats || {}) };
  merged.customPromptId = typeof merged.customPromptId === "string" ? merged.customPromptId : "";
  merged.pendingCustomPromptRequestId = typeof merged.pendingCustomPromptRequestId === "string" ? merged.pendingCustomPromptRequestId : "";
  merged.profile.capital = Number.isFinite(Number(merged.profile?.capital)) ? Number(merged.profile.capital) : 0;
  merged.profile.capitalCurrency = typeof merged.profile?.capitalCurrency === "string" ? merged.profile.capitalCurrency : "USDT";

  merged.timeframe = merged.timeframe || d.timeframe;
  merged.style = merged.style || d.style;
  merged.risk = merged.risk || d.risk;
  merged.newsEnabled = typeof merged.newsEnabled === "boolean" ? merged.newsEnabled : d.newsEnabled;

  merged.dailyDate = merged.dailyDate || d.dailyDate;
  merged.dailyUsed = Number.isFinite(Number(merged.dailyUsed)) ? Number(merged.dailyUsed) : d.dailyUsed;
  merged.freeDailyLimit = Number.isFinite(Number(merged.freeDailyLimit)) ? Number(merged.freeDailyLimit) : d.freeDailyLimit;

  merged.state = merged.state || "idle";
  merged.selectedSymbol = merged.selectedSymbol || "";

  merged.textOrder = typeof merged.textOrder === "string" ? merged.textOrder : "";
  merged.visionOrder = typeof merged.visionOrder === "string" ? merged.visionOrder : "";
  merged.polishOrder = typeof merged.polishOrder === "string" ? merged.polishOrder : "";

  return merged;
}

async function ensureUser(userId, env, from) {
  const dbExisting = await dbGetUser(userId, env);
  const kvExisting = dbExisting ? null : await getUser(userId, env);
  const existing = dbExisting || kvExisting;
  let st = patchUser(existing || {}, userId);
  // Initialize points for new users based on admin-configured base points
  const basePts = await getBasePoints(env);
  ensurePoints(st);

  if (!existing) {
    // brand-new user
    st.points.balance = Number(basePts);
    st.points.initialized = true;
  } else {
    // Backfill: if user has never received any points and balance is zero, treat as uninitialized and apply base once.
    const spent = Number(st.points.spent || 0);
    const earned = Number(st.points.earnedFromInvites || 0);
    const bal = Number(st.points.balance || 0);

    if (!st.points.initialized && bal === 0 && spent === 0 && earned === 0) {
      st.points.balance = Number(basePts);
      st.points.initialized = true;
    }
  }


  // one-way migrate KV -> D1 when BOT_DB is enabled
  if (env.BOT_DB && !dbExisting && kvExisting) {
    await dbSaveUser(userId, st, env);
  }

  if (from?.username) st.profile.username = String(from.username);
  if (from?.first_name) st.profile.firstName = String(from.first_name);
  if (from?.last_name) st.profile.lastName = String(from.last_name);
  applyLocaleFromTelegramUser(st, from || {});
  if (st.profile?.phone) applyLocaleDefaults(st);

  const today = kyivDateString();
  if (st.dailyDate !== today) {
    st.dailyDate = today;
    st.dailyUsed = 0;
  }

  if (!Array.isArray(st.referral.codes) || st.referral.codes.length < 1) {
    st.referral.codes = (st.referral.codes || []).filter(Boolean);
    while (st.referral.codes.length < 1) st.referral.codes.push(randomCode(10));
  }

  const freeLimit = await getFreeDailyLimit(env);
  st.freeDailyLimit = freeLimit;

  if (env.BOT_KV) await saveUser(userId, st, env);
  return st;
}

function dailyLimit(env, st) {
  if (st?.subscription?.active) {
    return toInt(st?.subscription?.dailyLimit, 3) || 3;
  }
  return toInt(st?.freeDailyLimit || st?.subscription?.dailyLimit || 0, 0) || 3;
}

function canAnalyzeToday(st, from, env) {
  if (isStaff(from, env)) return true;
  const today = kyivDateString();
  const used = (st.dailyDate === today) ? (st.dailyUsed || 0) : 0;
  return used < dailyLimit(env, st);
}

function consumeDaily(st, from, env) {
  if (isStaff(from, env)) return;
  const today = kyivDateString();
  if (st.dailyDate !== today) {
    st.dailyDate = today;
    st.dailyUsed = 0;
  }
  st.dailyUsed = (st.dailyUsed || 0) + 1;
}

function recordAnalysisSuccess(st) {
  st.stats = st.stats || {};
  st.stats.totalAnalyses = (st.stats.totalAnalyses || 0) + 1;
  st.stats.successfulAnalyses = (st.stats.successfulAnalyses || 0) + 1;
  st.stats.lastAnalysisAt = new Date().toISOString();
}

/* ========================== TELEGRAM API ========================== */
async function tgApi(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => null);
  if (!j || !j.ok) console.error("Telegram API error:", method, j);
  return j;
}
async function tgSendMessage(env, chatId, text, replyMarkup) {
  return tgApi(env, "sendMessage", {
    chat_id: chatId,
    text: String(text).slice(0, 3900),
    reply_markup: replyMarkup,
    disable_web_page_preview: true,
  });
}

async function tgSendLongMessage(env, chatId, text, replyMarkup) {
  const parts = chunkText(String(text || ""), 3500);
  for (const part of parts) {
    await tgSendMessage(env, chatId, part, replyMarkup);
  }
}

async function tgSendMessageHtml(env, chatId, html, replyMarkup) {
  return tgApi(env, "sendMessage", {
    chat_id: chatId,
    text: String(html).slice(0, 3900),
    parse_mode: "HTML",
    reply_markup: replyMarkup,
    disable_web_page_preview: false,
  });
}

async function tgSendPhoto(env, chatId, photoUrl, caption, replyMarkup) {
  return tgApi(env, "sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption: caption ? String(caption).slice(0, 900) : undefined,
    reply_markup: replyMarkup,
  });
}

async function tgSendPhotoUpload(env, chatId, photoBytes, filename = "chart.png", caption, replyMarkup) {
  const boundary = "----tgform" + Math.random().toString(16).slice(2);
  const CRLF = "\r\n";

  const parts = [];
  const push = (s) => parts.push(typeof s === "string" ? new TextEncoder().encode(s) : s);

  push(`--${boundary}${CRLF}`);
  push(`Content-Disposition: form-data; name="chat_id"${CRLF}${CRLF}`);
  push(String(chatId) + CRLF);

  if (caption) {
    push(`--${boundary}${CRLF}`);
    push(`Content-Disposition: form-data; name="caption"${CRLF}${CRLF}`);
    push(String(caption).slice(0, 900) + CRLF);
  }

  if (replyMarkup) {
    push(`--${boundary}${CRLF}`);
    push(`Content-Disposition: form-data; name="reply_markup"${CRLF}${CRLF}`);
    push(JSON.stringify(replyMarkup) + CRLF);
  }

  push(`--${boundary}${CRLF}`);
  push(`Content-Disposition: form-data; name="photo"; filename="${filename}"${CRLF}`);
  push(`Content-Type: image/png${CRLF}${CRLF}`);
  push(new Uint8Array(photoBytes));
  push(CRLF);

  push(`--${boundary}--${CRLF}`);

  const body = concatU8(parts);
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  const j = await r.json().catch(() => null);
  if (!j || !j.ok) console.error("Telegram sendPhoto(upload) error:", j);
  return j;
}

async function tgSendPhotoSmart(env, chatId, photoUrl, caption, replyMarkup) {
  let j = null;
  try {
    const preferUpload = String(env.TG_PHOTO_UPLOAD_FIRST || "") === "1" || String(photoUrl || "").includes("quickchart.io/chart");
    if (preferUpload) {
      const r = await fetch(photoUrl);
      if (!r.ok) return await tgSendPhoto(env, chatId, photoUrl, caption, replyMarkup);
      const buf = await r.arrayBuffer();
      const uploadRes = await tgSendPhotoUpload(env, chatId, buf, "chart.png", caption, replyMarkup);
      if (uploadRes?.ok) return uploadRes;
    }
    j = await tgSendPhoto(env, chatId, photoUrl, caption, replyMarkup);
    if (j?.ok) return j;

    const r = await fetch(photoUrl);
    if (!r.ok) return j;
    const buf = await r.arrayBuffer();
    return await tgSendPhotoUpload(env, chatId, buf, "chart.png", caption, replyMarkup);
  } catch (e) {
    console.error("tgSendPhotoSmart fallback failed:", e?.message || e);
    return j;
  }
}

async function tgSendChatAction(env, chatId, action) {
  return tgApi(env, "sendChatAction", { chat_id: chatId, action });
}
async function tgGetFilePath(env, fileId) {
  const j = await tgApi(env, "getFile", { file_id: fileId });
  return j?.result?.file_path || "";
}

// Send SVG as document (Telegram reliably shows it)
async function tgSendSvgDocument(env, chatId, svgText, filename = "zones.svg", caption = "🖼️ نقشه زون‌ها") {
  const boundary = "----tgform" + Math.random().toString(16).slice(2);
  const CRLF = "\r\n";

  const parts = [];
  const push = (s) => parts.push(typeof s === "string" ? new TextEncoder().encode(s) : s);

  push(`--${boundary}${CRLF}`);
  push(`Content-Disposition: form-data; name="chat_id"${CRLF}${CRLF}`);
  push(String(chatId) + CRLF);

  push(`--${boundary}${CRLF}`);
  push(`Content-Disposition: form-data; name="caption"${CRLF}${CRLF}`);
  push(String(caption) + CRLF);

  push(`--${boundary}${CRLF}`);
  push(`Content-Disposition: form-data; name="document"; filename="${filename}"${CRLF}`);
  push(`Content-Type: image/svg+xml${CRLF}${CRLF}`);
  push(svgText + CRLF);

  push(`--${boundary}--${CRLF}`);

  const body = concatU8(parts);
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  const j = await r.json().catch(() => null);
  if (!j || !j.ok) console.error("Telegram sendDocument error:", j);
  return j;
}

function concatU8(chunks) {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(new Uint8Array(c), off); off += c.byteLength; }
  return out;
}

/* ========================== TYPING LOOP ========================== */
function stopToken() { return { stop: false }; }
async function typingLoop(env, chatId, token) {
  while (!token.stop) {
    await tgSendChatAction(env, chatId, "typing");
    await sleep(TYPING_INTERVAL_MS);
  }
}

/* ========================== IMAGE PICKING ========================== */
function extractImageFileId(msg, env) {
  if (msg.photo && msg.photo.length) {
    const maxBytes = Number(env.VISION_MAX_BYTES || 900000);
    const sorted = [...msg.photo].sort((a, b) => (a.file_size || 0) - (b.file_size || 0));
    let best = null;
    for (const p of sorted) {
      if ((p.file_size || 0) <= maxBytes) best = p;
    }
    if (!best) best = sorted[0];
    return best?.file_id || "";
  }
  if (msg.document && msg.document.mime_type?.startsWith("image/")) {
    return msg.document.file_id || "";
  }
  return "";
}

/* ========================== PROVIDER CHAINS ========================== */

function resolveTextProviderChain(env, orderOverride, prompt = "") {
  const raw = orderOverride || env.TEXT_PROVIDER_ORDER;
  const base = [...new Set(parseOrder(raw, ["openai","openrouter","deepseek","gemini","cf"]))];
  if (base.length <= 1) return base;
  const minuteBucket = Math.floor(Date.now() / 60000);
  const promptSeed = String(prompt || "").slice(0, 64);
  return rotateBySeed(base, `text|${promptSeed}|${minuteBucket}`);
}

function providerApiKey(name, env, seed = "") {
  const key = String(name || "").toLowerCase();
  if (key === "openai") {
    const pool = parseApiKeyPool(env.OPENAI_API_KEY, env.OPENAI_API_KEYS);
    return pickApiKey(pool, `openai|${seed}`);
  }
  if (key === "openrouter") {
    const pool = parseApiKeyPool(env.OPENROUTER_API_KEY, env.OPENROUTER_API_KEYS);
    return pickApiKey(pool, `openrouter|${seed}`);
  }
  if (key === "deepseek") {
    const pool = parseApiKeyPool(env.DEEPSEEK_API_KEY, env.DEEPSEEK_API_KEYS);
    return pickApiKey(pool, `deepseek|${seed}`);
  }
  if (key === "gemini") {
    const pool = parseApiKeyPool(env.GEMINI_API_KEY, env.GEMINI_API_KEYS);
    return pickApiKey(pool, `gemini|${seed}`);
  }
  return "";
}

async function runTextProviders(prompt, env, orderOverride) {
  const chain = resolveTextProviderChain(env, orderOverride, prompt);
  let lastErr = null;
  for (const p of chain) {
    if (providerInCooldown(p)) continue;
    try {
      const out = await Promise.race([
        textProvider(p, prompt, env),
        timeoutPromise(TIMEOUT_TEXT_MS, `text_${p}_timeout`)
      ]);
      if (out && String(out).trim()) {
        markProviderSuccess(p, "text");
        return String(out).trim();
      }
      markProviderFailure(p, env, "text");
    } catch (e) {
      lastErr = e;
      markProviderFailure(p, env, "text");
      console.error("text provider failed:", p, e?.message || e);
    }
  }
  throw lastErr || new Error("all_text_providers_failed");
}

async function runPolishProviders(draft, env, orderOverride) {
  const raw = (orderOverride || env.POLISH_PROVIDER_ORDER || "").toString().trim();
  if (!raw) return draft;

  const chain = parseOrder(raw, ["openai","cf","gemini"]);
  const polishPrompt =
    `تو یک ویراستار سخت‌گیر فارسی هستی. متن زیر را فقط “سفت‌وسخت” کن:\n` +
    `- فقط فارسی\n- قالب شماره‌دار ۱ تا ۵ حفظ شود\n- لحن افشاگر/تیز\n- خیال‌بافی نکن\n\n` +
    `متن:\n${draft}`;

  for (const p of chain) {
    if (providerInCooldown(p)) continue;
    try {
      const out = await Promise.race([
        textProvider(p, polishPrompt, env),
        timeoutPromise(TIMEOUT_POLISH_MS, `polish_${p}_timeout`)
      ]);
      if (out && String(out).trim()) {
        markProviderSuccess(p, "polish");
        return String(out).trim();
      }
      markProviderFailure(p, env, "polish");
    } catch (e) {
      markProviderFailure(p, env, "polish");
      console.error("polish provider failed:", p, e?.message || e);
    }
  }
  return draft;
}

async function runVisionProviders(imageUrl, visionPrompt, env, orderOverride) {
  const chain = parseOrder(orderOverride || env.VISION_PROVIDER_ORDER, ["openai","cf","gemini","hf"]);
  const totalBudget = Number(env.VISION_TOTAL_BUDGET_MS || 20000);
  const deadline = Date.now() + totalBudget;

  let lastErr = null;
  let cached = /** @type {any} */ (null);

  for (const p of chain) {
    const remaining = deadline - Date.now();
    if (remaining <= 500) break;

    try {
      if ((p === "cf" || p === "gemini" || p === "hf") && cached && cached.tooLarge) continue;

      const out = await Promise.race([
        visionProvider(p, imageUrl, visionPrompt, env, () => cached, (c) => (cached = c)),
        timeoutPromise(Math.min(TIMEOUT_VISION_MS, remaining), `vision_${p}_timeout`)
      ]);
      if (out && String(out).trim()) return String(out).trim();
    } catch (e) {
      lastErr = e;
      console.error("vision provider failed:", p, e?.message || e);
    }
  }

  throw lastErr || new Error("all_vision_providers_failed_or_budget_exceeded");
}

async function textProvider(name, prompt, env) {
  name = String(name || "").toLowerCase();

  if (name === "cf") {
    if (!env.AI) throw new Error("AI_binding_missing");
    const out = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 900,
      temperature: 0.25,
    });
    return out?.response || out?.result || "";
  }

  if (name === "openai") {
    const pool = parseApiKeyPool(env.OPENAI_API_KEY, env.OPENAI_API_KEYS);
    if (!pool.length) throw new Error("OPENAI_API_KEY_missing");

    // ✅ Rolling keys: اگر 429/401 خورد، با کلید بعدی امتحان کن
    const minuteBucket = Math.floor(Date.now() / 60000);
    const seed = `openai|${String(prompt || "").slice(0, 64)}|${minuteBucket}`;
    const keys = rotateBySeed(pool, seed);

    let lastStatus = 0;
    let lastBody = null;
    for (const apiKey of keys) {
      const r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || "gpt-5",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.25,
        }),
      }, TIMEOUT_TEXT_MS);

      lastStatus = r.status;
      const j = await r.json().catch(() => null);
      lastBody = j;
      const out = j?.choices?.[0]?.message?.content || "";
      if (out && String(out).trim()) return out;

      // only retry on rate/auth transient issues
      if (![401, 429, 500, 502, 503, 504].includes(r.status)) break;
    }
    // include minimal error context
    throw new Error(`openai_failed_status_${lastStatus}` + (lastBody?.error?.message ? `:${lastBody.error.message}` : ""));
  }

  if (name === "openrouter") {
    const apiKey = providerApiKey("openrouter", env, prompt);
    if (!apiKey) throw new Error("OPENROUTER_API_KEY_missing");
    const r = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.25,
      }),
    }, TIMEOUT_TEXT_MS);
    const j = await r.json().catch(() => null);
    return j?.choices?.[0]?.message?.content || "";
  }

  if (name === "deepseek") {
    const apiKey = providerApiKey("deepseek", env, prompt);
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY_missing");
    const r = await fetchWithTimeout("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL || "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.25,
      }),
    }, TIMEOUT_TEXT_MS);
    const j = await r.json().catch(() => null);
    return j?.choices?.[0]?.message?.content || "";
  }

  if (name === "gemini") {
    const apiKey = providerApiKey("gemini", env, prompt);
    if (!apiKey) throw new Error("GEMINI_API_KEY_missing");
    const r = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.25, maxOutputTokens: 900 },
        }),
      },
      TIMEOUT_TEXT_MS
    );
    const j = await r.json().catch(() => null);
    return j?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
  }

  throw new Error(`unknown_text_provider:${name}`);
}

async function ensureImageCache(imageUrl, env, getCache, setCache) {
  const cur = getCache();
  if (cur?.buf && cur?.mime) return cur;

  const maxBytes = Number(env.VISION_MAX_BYTES || 900000);

  const resp = await fetchWithTimeout(imageUrl, {}, TIMEOUT_VISION_MS);

  const len = Number(resp.headers.get("content-length") || "0");
  if (len && len > maxBytes) {
    const c = { tooLarge: true, mime: "image/jpeg" };
    setCache(c);
    return c;
  }

  const mime = detectMimeFromHeaders(resp, "image/jpeg");
  const buf = await resp.arrayBuffer();

  if (buf.byteLength > maxBytes) {
    const c = { tooLarge: true, mime };
    setCache(c);
    return c;
  }

  const u8 = new Uint8Array(buf);
  const bytesArr = [...u8];
  const base64 = arrayBufferToBase64(buf);

  const c = { buf, mime, base64, bytesArr, u8, tooLarge: false };
  setCache(c);
  return c;
}

async function visionProvider(name, imageUrl, visionPrompt, env, getCache, setCache) {
  name = String(name || "").toLowerCase();

  if (name === "openai") {
    if (!providerApiKey("openai", env, imageUrl) && !env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_missing");
    const body = {
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: visionPrompt },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      }],
      temperature: 0.2,
    };
    const r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${providerApiKey("openai", env, imageUrl) || env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }, TIMEOUT_VISION_MS);
    const j = await r.json().catch(() => null);
    return j?.choices?.[0]?.message?.content || "";
  }

  if (name === "cf") {
    if (!env.AI) throw new Error("AI_binding_missing");
    const c = await ensureImageCache(imageUrl, env, getCache, setCache);
    if (c.tooLarge) return "";
    const out = await env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", { image: c.bytesArr, prompt: visionPrompt });
    return out?.description || out?.response || out?.result || "";
  }

  if (name === "gemini") {
    if (!providerApiKey("gemini", env, imageUrl) && !env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY_missing");
    const c = await ensureImageCache(imageUrl, env, getCache, setCache);
    if (c.tooLarge) return "";
    const r = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(providerApiKey("gemini", env, imageUrl) || env.GEMINI_API_KEY || "")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: visionPrompt },
              { inlineData: { mimeType: c.mime, data: c.base64 } },
            ],
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 900 },
        }),
      },
      TIMEOUT_VISION_MS
    );
    const j = await r.json().catch(() => null);
    return j?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
  }

  if (name === "hf") {
    if (!env.HF_API_KEY) throw new Error("HF_API_KEY_missing");
    const model = (env.HF_VISION_MODEL || "Salesforce/blip-image-captioning-large").toString().trim();
    const c = await ensureImageCache(imageUrl, env, getCache, setCache);
    if (c.tooLarge) return "";
    const r = await fetchWithTimeout(
      `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.HF_API_KEY}`,
          "Content-Type": "application/octet-stream",
        },
        body: c.u8,
      },
      TIMEOUT_VISION_MS
    );
    const j = await r.json().catch(() => null);
    const txt = Array.isArray(j) ? j?.[0]?.generated_text : (j?.generated_text || j?.text);
    return txt ? String(txt) : "";
  }

  throw new Error(`unknown_vision_provider:${name}`);
}

/* ========================== MARKET DATA (LIVE) ========================== */
function assetKind(symbol) {
  const s = String(symbol || "").trim().toUpperCase();
  if (!s) return "unknown";

  // Metals
  if (s === "XAUUSD" || s === "XAGUSD") return "metal";

  // Indices / CFDs
  if (INDICES.includes(s) || (EXTRA_INDICES || []).includes(s)) return "index";

  // Forex: 6 letters and both legs in FX_CODES
  if (/^[A-Z]{6}$/.test(s)) {
    const a = s.slice(0, 3), b = s.slice(3, 6);
    if ((FX_CODES || []).includes(a) && (FX_CODES || []).includes(b)) return "forex";
  }

  // Crypto: Binance-style tickers, including BTC/ETH/BNB quotes
  if (/^[A-Z0-9]{3,20}$/.test(s)) {
    for (const q of (CRYPTO_QUOTE_CODES || [])) {
      if (s.endsWith(q) && s.length > q.length) return "crypto";
    }
    // Heuristic: 6-letter non-FX pairs are usually crypto (e.g. ETHBTC)
    if (/^[A-Z]{6}$/.test(s)) return "crypto";
  }

  return "unknown";
}

function providerSupportsSymbol(provider, symbol, env) {
  const kind = assetKind(symbol);
  if (provider === "binance") return kind === "crypto";
  if (provider === "twelvedata") return !!(env.TWELVEDATA_API_KEY || env.TWELVEDATA_API_KEYS) && ["crypto", "forex", "metal"].includes(kind);
  if (provider === "alphavantage") return !!(env.ALPHAVANTAGE_API_KEY || env.ALPHAVANTAGE_API_KEYS) && ["forex", "metal"].includes(kind);
  if (provider === "finnhub") return !!(env.FINNHUB_API_KEY || env.FINNHUB_API_KEYS) && kind === "forex";
  if (provider === "yahoo") return true;
  return true;
}

function parseApiKeyPool(primary, many) {
  const arr = [];
  const one = String(primary || "").trim();
  if (one) arr.push(one);
  const list = String(many || "").split(",").map((x) => x.trim()).filter(Boolean);
  for (const k of list) if (!arr.includes(k)) arr.push(k);
  return arr;
}

function stableHashInt(s) {
  const str = String(s || "");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

function rotateBySeed(arr, seed) {
  if (!Array.isArray(arr) || arr.length <= 1) return Array.isArray(arr) ? arr.slice() : [];
  const i = stableHashInt(seed) % arr.length;
  return arr.slice(i).concat(arr.slice(0, i));
}

function pickApiKey(pool, seed) {
  if (!Array.isArray(pool) || !pool.length) return "";
  return pool[stableHashInt(seed) % pool.length];
}

function resolveMarketProviderChain(env, symbol, timeframe = "H4") {
  const desired = parseOrder(env.MARKET_DATA_PROVIDER_ORDER, ["binance","twelvedata","alphavantage","finnhub","yahoo"]);
  const filtered = desired.filter((p) => providerSupportsSymbol(p, symbol, env));
  const chain = filtered.length ? filtered : ["yahoo"];
  const minuteBucket = Math.floor(Date.now() / 60000);
  return rotateBySeed(chain, `${symbol}|${timeframe}|${minuteBucket}`);
}

function mapTimeframeToBinance(tf) {
  const m = { M15: "15m", H1: "1h", H4: "4h", D1: "1d" };
  return m[tf] || "4h";
}
function mapTimeframeToTwelve(tf) {
  const m = { M15: "15min", H1: "1h", H4: "4h", D1: "1day" };
  return m[tf] || "4h";
}
function mapForexSymbolForTwelve(symbol) {
  if (/^[A-Z]{6}$/.test(symbol)) return `${symbol.slice(0,3)}/${symbol.slice(3,6)}`;
  if (symbol === "XAUUSD") return "XAU/USD";
  if (symbol === "XAGUSD") return "XAG/USD";
  return symbol;
}

function mapTimeframeToAlphaVantage(tf) {
  const m = { M15:"15min", H1:"60min" };
  return m[tf] || "60min";
}

function toYahooSymbol(symbol) {
  if (/^[A-Z]{6}$/.test(symbol)) return `${symbol}=X`;
  if (symbol.endsWith("USDT")) return `${symbol.replace("USDT","-USD")}`;
  if (symbol === "XAUUSD") return "XAUUSD=X";
  if (symbol === "XAGUSD") return "XAGUSD=X";
  return symbol;
}
function yahooInterval(tf) {
  // Yahoo supports 15m/30m/60m/1d reliably. 240m is often unsupported -> no data.
  // We fetch 60m for H4 and downsample to 4H candles.
  const m = { M15:"15m", H1:"60m", H4:"60m", D1:"1d" };
  return m[tf] || "60m";
}

function downsampleCandles(candles, groupSize) {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const out = [];
  for (let i = 0; i < candles.length; i += groupSize) {
    const g = candles.slice(i, i + groupSize);
    if (!g.length) continue;
    const o = g[0].o;
    const c = g[g.length - 1].c;
    let h = -Infinity, l = Infinity, v = 0;
    for (const x of g) {
      if (Number.isFinite(x.h)) h = Math.max(h, x.h);
      if (Number.isFinite(x.l)) l = Math.min(l, x.l);
      if (Number.isFinite(x.v)) v += x.v;
    }
    out.push({ t: g[g.length - 1].t, o, h, l, c, v });
  }
  return out;
}

async function fetchBinanceCandles(symbol, timeframe, limit, timeoutMs) {
  if (assetKind(symbol) !== "crypto") throw new Error("binance_not_crypto");
  const interval = mapTimeframeToBinance(timeframe);
  const urls = [
    `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`,
    `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`,
    `https://api.binance.us/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`,
  ];
  let lastErr = null;
  for (const url of urls) {
    try {
      const r = await fetchWithTimeout(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
      }, timeoutMs);
      if (!r.ok) throw new Error(`binance_http_${r.status}`);
      const data = await r.json();
      return data.map(k => ({
        t: k[0],
        o: Number(k[1]),
        h: Number(k[2]),
        l: Number(k[3]),
        c: Number(k[4]),
        v: Number(k[5]),
      }));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("binance_http_failed");
}

async function fetchTwelveDataCandles(symbol, timeframe, limit, timeoutMs, env) {
  const tdPool = parseApiKeyPool(env.TWELVEDATA_API_KEY, env.TWELVEDATA_API_KEYS);
  if (!tdPool.length) throw new Error("twelvedata_key_missing");
  const kind = assetKind(symbol);
  if (kind === "unknown") throw new Error("twelvedata_unknown_symbol");

  const interval = mapTimeframeToTwelve(timeframe);
  const sym = mapForexSymbolForTwelve(symbol);
  const tdKey = pickApiKey(tdPool, `${symbol}|${timeframe}|${Math.floor(Date.now() / 60000)}`);
  const base = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(interval)}&outputsize=${limit}&apikey=${encodeURIComponent(tdKey)}`;
  const sources = [];
  if (kind === "crypto") sources.push("binance");
  if (kind === "forex" || kind === "metal") sources.push("fx");
  const urls = [base, ...sources.map((s) => `${base}&source=${encodeURIComponent(s)}`)];

  let lastErr = null;
  let j = null;
  for (const url of urls) {
    try {
      const r = await fetchWithTimeout(url, {}, timeoutMs);
      if (!r.ok) throw new Error(`twelvedata_http_${r.status}`);
      j = await r.json();
      if (j.status === "error") throw new Error(`twelvedata_err_${j.code || ""}`);
      break;
    } catch (e) {
      lastErr = e;
      j = null;
    }
  }
  if (!j) throw lastErr || new Error("twelvedata_http_failed");

  const values = Array.isArray(j.values) ? j.values : [];
  return values.reverse().map(v => ({
    t: Date.parse(v.datetime + "Z") || Date.now(),
    o: Number(v.open),
    h: Number(v.high),
    l: Number(v.low),
    c: Number(v.close),
    v: v.volume ? Number(v.volume) : null,
  }));
}

async function fetchAlphaVantageFxIntraday(symbol, timeframe, limit, timeoutMs, env) {
  const avPool = parseApiKeyPool(env.ALPHAVANTAGE_API_KEY, env.ALPHAVANTAGE_API_KEYS);
  if (!avPool.length) throw new Error("alphavantage_key_missing");
  if (!/^[A-Z]{6}$/.test(symbol) && symbol !== "XAUUSD" && symbol !== "XAGUSD") throw new Error("alphavantage_only_fx_like");

  const from = symbol.slice(0,3);
  const to = symbol.slice(3,6);
  const interval = mapTimeframeToAlphaVantage(timeframe);

  const avKey = pickApiKey(avPool, `${symbol}|${timeframe}|${Math.floor(Date.now() / 60000)}`);
  const url =
    `https://www.alphavantage.co/query?function=FX_INTRADAY` +
    `&from_symbol=${encodeURIComponent(from)}` +
    `&to_symbol=${encodeURIComponent(to)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&outputsize=compact` +
    `&apikey=${encodeURIComponent(avKey)}`;

  const r = await fetchWithTimeout(url, {}, timeoutMs);
  if (!r.ok) throw new Error(`alphavantage_http_${r.status}`);
  const j = await r.json();

  const key = Object.keys(j).find(k => k.startsWith("Time Series FX"));
  if (!key) throw new Error("alphavantage_no_timeseries");

  const ts = j[key];
  const rows = Object.entries(ts)
    .slice(0, limit)
    .map(([dt, v]) => ({
      t: Date.parse(dt + "Z") || Date.now(),
      o: Number(v["1. open"]),
      h: Number(v["2. high"]),
      l: Number(v["3. low"]),
      c: Number(v["4. close"]),
      v: null,
    }))
    .reverse();

  return rows;
}

function mapTimeframeToFinnhubResolution(tf) {
  const m = { M15:"15", H1:"60", H4:"240", D1:"D" };
  return m[tf] || "240";
}
async function fetchFinnhubForexCandles(symbol, timeframe, limit, timeoutMs, env) {
  const fhPool = parseApiKeyPool(env.FINNHUB_API_KEY, env.FINNHUB_API_KEYS);
  if (!fhPool.length) throw new Error("finnhub_key_missing");
  if (!/^[A-Z]{6}$/.test(symbol)) throw new Error("finnhub_only_forex");

  const res = mapTimeframeToFinnhubResolution(timeframe);
  const inst = `OANDA:${symbol.slice(0,3)}_${symbol.slice(3,6)}`;

  const now = Math.floor(Date.now() / 1000);
  const lookbackSec = 60 * 60 * 24 * 10;
  const from = now - lookbackSec;

  const fhKey = pickApiKey(fhPool, `${symbol}|${timeframe}|${Math.floor(Date.now() / 60000)}`);
  const url = `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(inst)}&resolution=${encodeURIComponent(res)}&from=${from}&to=${now}&token=${encodeURIComponent(fhKey)}`;

  const r = await fetchWithTimeout(url, {}, timeoutMs);
  if (!r.ok) throw new Error(`finnhub_http_${r.status}`);
  const j = await r.json();
  if (j.s !== "ok") throw new Error(`finnhub_status_${j.s}`);

  const candles = j.t.map((t, i) => ({
    t: t * 1000,
    o: Number(j.o[i]),
    h: Number(j.h[i]),
    l: Number(j.l[i]),
    c: Number(j.c[i]),
    v: j.v ? Number(j.v[i]) : null,
  }));
  return candles.slice(-limit);
}

async function fetchYahooChartCandles(symbol, timeframe, limit, timeoutMs) {
  // Yahoo can intermittently return 404 from some edges / for some symbols.
  // We try multiple hosts + richer headers, and we keep H4 as 60m + downsample.
  const interval = yahooInterval(timeframe);
  const ysym = toYahooSymbol(symbol);

  // Pick a range that gives enough bars for downsampling + analysis.
  const baseRange = (timeframe === "D1") ? "6mo" : (timeframe === "H4" ? "30d" : "10d");

  const tryIntervals = [];
  if (interval) tryIntervals.push(interval);
  if (interval !== "60m") tryIntervals.push("60m");

  const hosts = [
    "https://query1.finance.yahoo.com",
    "https://query2.finance.yahoo.com"
  ];

  const qs = `?interval={IV}&range=${encodeURIComponent(baseRange)}&includePrePost=false&events=div%7Csplit%7Cearn&lang=en-US&region=US`;

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
    "Origin": "https://finance.yahoo.com"
  };

  let lastErr = null;

  for (const iv of tryIntervals) {
    for (const host of hosts) {
      try {
        const url = `${host}/v8/finance/chart/${encodeURIComponent(ysym)}` + qs.replace("{IV}", encodeURIComponent(iv));
        const r = await fetchWithTimeout(url, { headers }, timeoutMs);
        if (!r.ok) throw new Error(`yahoo_http_${r.status}`);
        const j = await r.json();

        const result = j?.chart?.result?.[0];
        const ts = result?.timestamp || [];
        const q = result?.indicators?.quote?.[0];
        if (!ts.length || !q) throw new Error("yahoo_no_data");

        let candles = ts.map((t, i) => ({
          t: t * 1000,
          o: Number(q.open?.[i]),
          h: Number(q.high?.[i]),
          l: Number(q.low?.[i]),
          c: Number(q.close?.[i]),
          v: q.volume?.[i] != null ? Number(q.volume[i]) : null
        })).filter(x => Number.isFinite(x.c));

        if (timeframe === "H4" && iv === "60m") {
          candles = downsampleCandles(candles, 4);
        }

        return candles.slice(-limit);
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr || new Error("yahoo_no_data");
}

function marketCacheKey(symbol, timeframe) {
  return `market:${String(symbol).toUpperCase()}:${String(timeframe).toUpperCase()}`;
}

async function getMarketCache(env, key) {
  const mem = cacheGet(MARKET_CACHE, key);
  if (mem) return mem;
  const r2 = await getCachedR2Value(env.MARKET_R2, key);
  if (r2) cacheSet(MARKET_CACHE, key, r2, Number(env.MARKET_CACHE_TTL_MS || 120000));
  return r2;
}

async function getMarketCacheStale(env, key) {
  const mem = cacheGet(MARKET_CACHE, key);
  if (mem) return mem;
  const r2 = await getCachedR2ValueAllowStale(env.MARKET_R2, key);
  if (r2) cacheSet(MARKET_CACHE, key, r2, Number(env.MARKET_CACHE_TTL_MS || 120000));
  return r2;
}

async function setMarketCache(env, key, value) {
  const ttlMs = Number(env.MARKET_CACHE_TTL_MS || 120000);
  cacheSet(MARKET_CACHE, key, value, ttlMs);
  await r2PutJson(env.MARKET_R2, key, value, ttlMs);
}

async function getMarketCandlesWithFallback(env, symbol, timeframe) {
  const timeoutMs = Number(env.MARKET_DATA_TIMEOUT_MS || 12000);
  const limit = Number(env.MARKET_DATA_CANDLES_LIMIT || 120);
  const tf = String(timeframe || "H4").toUpperCase();
  const cacheKey = marketCacheKey(symbol, tf);
  const minNeed = minCandlesForTimeframe(tf);
  const cached = await getMarketCache(env, cacheKey);
  if (Array.isArray(cached) && cached.length >= Math.min(6, minNeed)) return cached;

  const chain = resolveMarketProviderChain(env, symbol, tf);
  let lastErr = null;

  for (const p of chain) {
    if (providerInCooldown(p)) continue;
    try {
      let candles = null;
      if (p === "binance") candles = await fetchBinanceCandles(symbol, tf, limit, timeoutMs);
      if (p === "twelvedata") candles = await fetchTwelveDataCandles(symbol, tf, limit, timeoutMs, env);
      if (p === "alphavantage") candles = await fetchAlphaVantageFxIntraday(symbol, tf, limit, timeoutMs, env);
      if (p === "finnhub") candles = await fetchFinnhubForexCandles(symbol, tf, limit, timeoutMs, env);
      if (p === "yahoo") candles = await fetchYahooChartCandles(symbol, tf, limit, timeoutMs);
      if (Array.isArray(candles) && candles.length) {
        await setMarketCache(env, cacheKey, candles);
        markProviderSuccess(p, "market");
        if (candles.length >= minNeed) return candles;
      } else {
        markProviderFailure(p, env, "market");
      }
    } catch (e) {
      lastErr = e;
      markProviderFailure(p, env, "market");
      console.error("market provider failed:", p, e?.message || e);
    }
  }

  const stale = await getMarketCacheStale(env, cacheKey);
  if (Array.isArray(stale) && stale.length) return stale;

  // fallback: use near timeframe source and aggregate to requested tf
  const altTimeframes = {
    M15: ["M5", "M1"],
    H1: ["M15", "M5"],
    H4: ["H1", "M15"],
    D1: ["H4", "H1"],
  };
  const candidates = altTimeframes[tf] || [];
  for (const altTf of candidates) {
    try {
      const altCandles = await getMarketCandlesWithFallbackRaw(env, symbol, altTf, timeoutMs, limit * 8);
      const mapped = aggregateCandlesToTimeframe(altCandles, altTf, tf).slice(-limit);
      if (Array.isArray(mapped) && mapped.length) {
        await setMarketCache(env, cacheKey, mapped);
        if (mapped.length >= Math.min(8, minNeed)) return mapped;
      }
    } catch (e) {
      lastErr = e;
    }
  }

  // final fallback: try stale cache from any timeframe and remap
  const remapped = await getAnyTimeframeMarketCache(env, symbol, tf, limit);
  if (Array.isArray(remapped) && remapped.length) {
    await setMarketCache(env, cacheKey, remapped.slice(-limit));
    return remapped.slice(-limit);
  }

  throw lastErr || new Error("market_data_all_failed");
}

async function getAnyTimeframeMarketCache(env, symbol, targetTf, limit) {
  const tfs = ["M15", "H1", "H4", "D1"];
  for (const sourceTf of tfs) {
    const cacheKey = marketCacheKey(symbol, sourceTf);
    const cached = await getMarketCacheStale(env, cacheKey);
    if (!Array.isArray(cached) || !cached.length) continue;
    const mapped = aggregateCandlesToTimeframe(cached, sourceTf, targetTf);
    if (Array.isArray(mapped) && mapped.length) return mapped.slice(-limit);
    if (String(sourceTf) === String(targetTf)) return cached.slice(-limit);
  }
  return [];
}

async function getMarketCandlesWithFallbackRaw(env, symbol, timeframe, timeoutMs, limit) {
  const cacheKey = marketCacheKey(symbol, timeframe);
  const cached = await getMarketCache(env, cacheKey);
  if (Array.isArray(cached) && cached.length) return cached;
  const chain = resolveMarketProviderChain(env, symbol, timeframe);
  let lastErr = null;
  for (const p of chain) {
    if (providerInCooldown(p)) continue;
    try {
      let candles = null;
      if (p === "binance") candles = await fetchBinanceCandles(symbol, timeframe, limit, timeoutMs);
      if (p === "twelvedata") candles = await fetchTwelveDataCandles(symbol, timeframe, limit, timeoutMs, env);
      if (p === "alphavantage") candles = await fetchAlphaVantageFxIntraday(symbol, timeframe, limit, timeoutMs, env);
      if (p === "finnhub") candles = await fetchFinnhubForexCandles(symbol, timeframe, limit, timeoutMs, env);
      if (p === "yahoo") candles = await fetchYahooChartCandles(symbol, timeframe, limit, timeoutMs);
      if (Array.isArray(candles) && candles.length) {
        await setMarketCache(env, cacheKey, candles);
        markProviderSuccess(p, "market");
        return candles;
      }
      markProviderFailure(p, env, "market");
    } catch (e) {
      lastErr = e;
      markProviderFailure(p, env, "market");
    }
  }
  throw lastErr || new Error("market_data_alt_failed");
}

const API_RESP_CACHE = new Map();

function apiRespCacheGet(key) {
  const it = API_RESP_CACHE.get(key);
  if (!it) return null;
  if (Date.now() > it.exp) { API_RESP_CACHE.delete(key); return null; }
  return it.val;
}
function apiRespCacheSet(key, val, ttlMs) {
  API_RESP_CACHE.set(key, { val, exp: Date.now() + Math.max(500, Number(ttlMs || 10000)) });
}

async function fetchSymbolNewsFa(symbol, env) {
  const query = symbolNewsQueryFa(symbol);
  const timeoutMs = Number(env.NEWS_TIMEOUT_MS || 9000);
  const limit = Math.min(8, Math.max(3, Number(env.NEWS_ITEMS_LIMIT || 6)));

  const urlsBase = [
    "https://news.google.com/rss/search?q=" + encodeURIComponent(query) + "&hl=fa&gl=IR&ceid=IR:fa",
    "https://news.google.com/rss/search?q=" + encodeURIComponent(symbol + " market") + "&hl=fa&gl=IR&ceid=IR:fa",
    "https://www.bing.com/news/search?q=" + encodeURIComponent(query) + "&format=rss&setlang=fa",
  ];
  const ext = String(env.NEWS_FEEDS_EXTRA || "").split(",").map((x) => x.trim()).filter(Boolean);
  const urls = urlsBase.concat(ext);
  const shift = urls.length ? (Math.floor(Date.now() / 60000) + String(symbol || "").length) % urls.length : 0;
  const rolledUrls = urls.slice(shift).concat(urls.slice(0, shift));

  let lastErr = null;
  for (const u of rolledUrls) {
    try {
      const r = await fetchWithTimeout(u, { headers: { "User-Agent": "Mozilla/5.0" } }, timeoutMs);
      if (!r.ok) throw new Error("news_http_" + r.status);
      const xml = await r.text();
      const items = parseRssItems(xml, limit);
      if (items.length) return items;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("news_failed");
}

function symbolNewsQueryFa(symbol) {
  const map = {
    BTCUSDT: "بیت کوین", ETHUSDT: "اتریوم", BNBUSDT: "بایننس کوین", SOLUSDT: "سولانا",
    XRPUSDT: "ریپل", ADAUSDT: "کاردانو", DOGEUSDT: "دوج کوین", AVAXUSDT: "آوالانچ",
    EURUSD: "یورو دلار", GBPUSD: "پوند دلار", USDJPY: "دلار ین", AUDUSD: "دلار استرالیا",
    XAUUSD: "طلا", XAGUSD: "نقره", DJI: "داوجونز", NDX: "نزدک", SPX: "اس اند پی 500"
  };
  return (map[symbol] || symbol) + " بازار مالی";
}

function stripTags(s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeXmlEntities(s) {
  return String(s || "")
    .split("&amp;").join("&")
    .split("&lt;").join("<")
    .split("&gt;").join(">")
    .split("&quot;").join('"')
    .split("&#39;").join("'");
}

function parseRssItems(xml, limit) {
  const raw = String(xml || "");
  const blocks = raw.match(/<item>[\s\S]*?<\/item>/g) || [];
  const out = [];
  for (const b of blocks.slice(0, limit * 2)) {
    const title = decodeXmlEntities(stripTags((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "")).trim();
    const link = decodeXmlEntities(((b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || "").trim());
    const source = decodeXmlEntities(stripTags((b.match(/<source[^>]*>([\s\S]*?)<\/source>/i) || [])[1] || "")).trim();
    const pubDate = decodeXmlEntities(stripTags((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || "")).trim();
    if (!title || !link) continue;
    out.push({ title: title.slice(0, 180), url: link, source: source || "Google News", publishedAt: pubDate || "" });
    if (out.length >= limit) break;
  }
  return out;
}

async function buildNewsBlockForSymbol(symbol, env, maxItems = 4) {
  try {
    const rows = await fetchSymbolNewsFa(symbol, env);
    if (!Array.isArray(rows) || !rows.length) return "";
    return rows.slice(0, maxItems).map((x, i) => {
      const src = x?.source ? (" | " + x.source) : "";
      const dt = x?.publishedAt ? (" | " + x.publishedAt) : "";
      return (i + 1) + ") " + String(x?.title || "") + src + dt;
    }).join(String.fromCharCode(10));
  } catch {
    return "";
  }
}



function parseNewsBlockRows(newsBlock) {
  return String(newsBlock || "").split("\n").map((x) => ({ title: String(x || "").replace(/^\d+\)\s*/, "").trim() })).filter((x) => x.title);
}

async function buildNewsAnalysisSummary(symbol, articles, env) {
  const rows = Array.isArray(articles) ? articles.slice(0, 5) : [];
  if (!rows.length) return "برای این نماد خبر کافی جهت جمع‌بندی خبری در دسترس نیست.";
  const top = rows.map((a, i) => `${i + 1}) ${String(a?.title || "")}`).join(String.fromCharCode(10));
  const prompt = [
    "تحلیل‌گر خبر بازار مالی هستی.",
    `نماد: ${symbol}`,
    "از تیترهای زیر، یک جمع‌بندی کوتاه فارسی در ۳ بخش بساز:",
    "۱) احساس غالب بازار (صعودی/نزولی/خنثی)",
    "۲) ریسک خبری کوتاه‌مدت",
    "۳) اثر احتمالی روی سناریوی معاملاتی",
    "خیال‌بافی نکن و فقط بر اساس تیترها بنویس.",
    "TIERS:",
    top,
  ].join(String.fromCharCode(10));
  try {
    const out = await runTextProviders(prompt, env, env.TEXT_PROVIDER_ORDER);
    return String(out || "").trim() || "جمع‌بندی خبری تولید نشد.";
  } catch {
    return "جمع‌بندی خبری موقت: تیترها نشان‌دهنده نوسان کوتاه‌مدت هستند؛ ورود فقط با تایید تکنیکال انجام شود.";
  }
}

function timeframeMinutes(tf) {
  const map = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440, W1: 10080 };
  return map[String(tf || "").toUpperCase()] || 0;
}

function aggregateCandlesToTimeframe(candles, fromTf, toTf) {
  if (!Array.isArray(candles) || candles.length < 2) return candles || [];
  const fromMin = timeframeMinutes(fromTf);
  const toMin = timeframeMinutes(toTf);
  if (!fromMin || !toMin || toMin <= fromMin || toMin % fromMin !== 0) return candles;
  const step = Math.max(1, Math.round(toMin / fromMin));
  const out = [];
  for (let i = 0; i < candles.length; i += step) {
    const chunk = candles.slice(i, i + step).filter((x) => Number.isFinite(x?.o) && Number.isFinite(x?.h) && Number.isFinite(x?.l) && Number.isFinite(x?.c));
    if (!chunk.length) continue;
    out.push({
      t: chunk[0].t,
      o: chunk[0].o,
      h: Math.max(...chunk.map((x) => x.h)),
      l: Math.min(...chunk.map((x) => x.l)),
      c: chunk[chunk.length - 1].c,
      v: chunk.reduce((s, x) => s + (Number(x.v) || 0), 0),
    });
  }
  return out;
}

function computeSnapshot(candles) {
  if (!candles?.length) return null;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] || last;

  const closes = candles.map(x => x.c);
  const sma = (arr, p) => {
    if (arr.length < p) return null;
    const s = arr.slice(-p).reduce((a,b)=>a+b,0);
    return s / p;
  };

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const trend = (sma20 && sma50) ? (sma20 > sma50 ? "صعودی" : "نزولی") : "نامشخص";

  const n = Math.min(50, candles.length);
  const recent = candles.slice(-n);
  const hi = Math.max(...recent.map(x => x.h));
  const lo = Math.min(...recent.map(x => x.l));

  const lastClose = last.c;
  const changePct = prev?.c ? ((lastClose - prev.c) / prev.c) * 100 : 0;

  return {
    lastPrice: lastClose,
    changePct: Number(changePct.toFixed(3)),
    trend,
    range50: { hi, lo },
    sma20: sma20 ? Number(sma20.toFixed(6)) : null,
    sma50: sma50 ? Number(sma50.toFixed(6)) : null,
    lastTs: last.t,
  };
}

function candlesToCompactCSV(candles, maxRows = 80) {
  const tail = candles.slice(-maxRows);
  return tail.map(x => `${x.t},${x.o},${x.h},${x.l},${x.c}`).join(String.fromCharCode(10));
}

function minCandlesForTimeframe(tf) {
  const m = { M15: 48, H1: 36, H4: 30, D1: 20 };
  return m[String(tf || "").toUpperCase()] || 24;
}

function buildLocalFallbackAnalysis(symbol, st, candles, reason = "") {
  const tf = st?.timeframe || "H4";
  const snap = computeSnapshot(Array.isArray(candles) ? candles : []);
  const levels = extractLevelsFromCandles(Array.isArray(candles) ? candles : []);
  const levelTxt = levels.length ? levels.join(" | ") : "داده کافی نیست";
  const bias = snap?.trend || "نامشخص";
  const risk =
    String(st?.risk || "").trim() ||
    (snap ? (Math.abs(Number(snap.changePct || 0)) > 2 ? "بالا" : "متوسط") : "نامشخص");

  return [
    "۱) وضعیت کلی",
    `نماد ${symbol} در تایم‌فریم ${tf} با بایاس ${bias} ارزیابی شد.`,
    snap ? `قیمت آخر: ${snap.lastPrice} | تغییر: ${snap.changePct}%` : "قیمت لحظه‌ای معتبر در دسترس نیست.",
    "",
    "۲) زون‌ها و سطوح",
    `سطوح پیشنهادی (auto): ${levelTxt}`,
    "",
    "۳) سناریوها",
    `سناریوی اصلی: ادامه ${bias === "صعودی" ? "حرکت رو به بالا" : (bias === "نزولی" ? "فشار فروش" : "نوسانی")}.`,
    "سناریوی جایگزین: شکست ساختار خلاف جهت و بازگشت به محدوده‌های میانی.",
    "",
    "۴) مدیریت ریسک",
    `ریسک پیشنهادی: ${risk}. ورود پله‌ای، حدضرر اجباری و کاهش اهرم توصیه می‌شود.`,
    "",
    "۵) وضعیت سرویس",
    `تحلیل با فالبک داخلی تولید شد (${reason || "text_provider_unavailable"}).`,
  ].join(String.fromCharCode(10));
}

/* ========================== TEXT BUILDERS ========================== */
async function buildTextPromptForSymbol(symbol, userPrompt, st, marketBlock, env, newsBlock = "") {
  const tf = st.timeframe || "H4";
  const baseRaw = await getAnalysisPrompt(env);
  const sp = await getStylePrompt(env, st.style);
  const newsAnalysisBlock = newsBlock ? await buildNewsAnalysisSummary(symbol, parseNewsBlockRows(newsBlock), env) : "";
  const base = baseRaw
     .split("{TIMEFRAME}").join(tf)
     .split("{STYLE}").join(st.style || "")
     .split("{RISK}").join(st.risk || "")
     .split("{NEWS}").join(st.newsEnabled ? "on" : "off");

  const capital = st.capital?.enabled === false
    ? "disabled"
    : (st.profile?.capital ? (st.profile.capital + " " + (st.profile.capitalCurrency || "USDT")) : (st.capital?.amount || "unknown"));

  // ✅ Style-only mode: فقط پرامپت سبک اجرا شود (بدون پرامپت پیش‌فرض/دیفالت)
  if (String(st.promptMode || "").trim() === "style_only") {
    const extraUser = (userPrompt && String(userPrompt).trim()) ? String(userPrompt).trim() : "";
    return (
      `STYLE_PROMPT_JSON:\n${sp}\n\n` +
      `CONTEXT:\nSymbol=${symbol}\nTimeframe=${tf}\nRisk=${st.risk || "متوسط"}\nCapital=${capital}\n\n` +
      `MARKET_DATA:\n${marketBlock}\n\n` +
      (newsBlock ? `NEWS_HEADLINES_FA:\n${newsBlock}\n\n` : ``) +
      (newsAnalysisBlock ? `NEWS_ANALYSIS_FA:\n${newsAnalysisBlock}\n\n` : ``) +
      `RULES:\n- فقط فارسی\n- فقط سبک انتخابی (${st.style || "پرایس اکشن"})\n- اندیکاتور اضافه ممنوع\n- خیال‌بافی ممنوع؛ فقط بر اساس OHLC\n- مدیریت ریسک براساس Risk و Capital\n\n` +
      `QCJSON_SCHEMA:\nQCJSON_SCHEMA:\nدر انتهای خروجی، یک بلاک دقیقاً با این تگ‌ها اضافه کن و هیچ متن دیگری داخل آن نگذار:\n<QCJSON>{"zones":[{"low":0,"high":0,"label":"Demand/Supply","kind":"demand|supply"}],"supports":[0],"resistances":[0],"tp":[0],"sl":0}</QCJSON>\nقوانین QCJSON:\n- فقط JSON معتبر (double quotes)\n- اعداد قیمت فقط عددی (نه متن)\n- zones: آرایه زون‌های افقی (low/high)\n- supports/resistances: خطوط S/R\n- tp: آرایه تارگت‌ها (TP1..)\n- sl: یک عدد استاپ لاس\n- اگر داده کافی نبود، آرایه‌ها را خالی بگذار و sl را 0 بگذار\n\n` +
      (extraUser ? `USER_REQUEST:\n${extraUser}\n` : ``)
    );
  }


  const userExtra = (isStaff({ username: st.profile?.username }, env) && userPrompt?.trim())
    ? userPrompt.trim()
    : "تحلیل را دقیق، مشروط و اجرایی بنویس.";

  return (
    `${base}

` +
    `STYLE_PROMPT_JSON:
${sp}

` +
    `CONTEXT:
Symbol=${symbol}
Timeframe=${tf}
Risk=${st.risk || "متوسط"}
Capital=${capital}

` +
    `MARKET_DATA:
${marketBlock}

` +
    (newsBlock ? `NEWS_HEADLINES_FA:
${newsBlock}

` : ``) +
    (newsAnalysisBlock ? `NEWS_ANALYSIS_FA:
${newsAnalysisBlock}

` : ``) +
    `RULES:
` +
    `- فقط و فقط بر اساس سبک انتخابی (${st.style || "پرایس اکشن"}) تحلیل کن.
` +
    `- خروجی نهایی حتماً فارسی باشد.
` +
    `- مدیریت سرمایه و ریسک را براساس Capital و Risk اعمال کن.
` +
    `- از داده OHLC استفاده کن و خیال‌بافی نکن.
` +
    `- quickchart_config را به شکل JSON داخلی بساز اما به کاربر نمایش نده.

` +
    `EXTRA:
${userExtra}`
  );
}

async function buildVisionPrompt(st, env) {
  const tf = st.timeframe || "H4";
  const baseRaw = await getAnalysisPrompt(env);
  const sp = await getStylePrompt(env, st.style);
  const base = baseRaw
     .split("{TIMEFRAME}").join(tf)
     .split("{STYLE}").join(st.style || "")
     .split("{RISK}").join(st.risk || "")
     .split("{NEWS}").join(st.newsEnabled ? "on" : "off");
  const capital = st.capital?.enabled === false
    ? "disabled"
    : (st.profile?.capital ? (st.profile.capital + " " + (st.profile.capitalCurrency || "USDT")) : (st.capital?.amount || "unknown"));
  

  // ✅ Style-only mode: فقط پرامپت سبک اجرا شود (بدون پرامپت پیش‌فرض/دیفالت)
  if (String(st.promptMode || "").trim() === "style_only") {
    return (
      `STYLE_PROMPT_JSON:\n${sp}\n\n` +
      `CONTEXT:\nSymbol=CHART\nTimeframe=${tf}\nRisk=${st.risk || "متوسط"}\nCapital=${capital}\n\n` +
      `TASK: این تصویر چارت را فقط با سبک انتخابی تحلیل کن و خروجی را کاملاً فارسی بده.\n` +
      `RULES: فقط فارسی، فقط سبک انتخابی، بدون اندیکاتور اضافی و بدون خیال‌بافی.`
    );
  }
return (
    `${base}

` +
    `STYLE_PROMPT_JSON:
${sp}

` +
    `CONTEXT:
Symbol=CHART
Timeframe=${tf}
Risk=${st.risk || "متوسط"}
Capital=${capital}

` +
    `TASK: این تصویر چارت را فقط با سبک انتخابی تحلیل کن و خروجی را کاملاً فارسی بده.
` +
    `RULES: فقط فارسی، فقط سبک انتخابی، بدون اندیکاتور اضافی و بدون خیال‌بافی.`
  );
}

/* ========================== WALLET (ADMIN ONLY) ========================== */
async function getWallet(env) {
  if (!env.BOT_KV) return (env.WALLET_ADDRESS || "").toString().trim();
  const v = await env.BOT_KV.get("settings:wallet");
  return (v || env.WALLET_ADDRESS || "").toString().trim();
}
async function setWallet(env, wallet) {
  if (!env.BOT_KV) throw new Error("BOT_KV_missing");
  await env.BOT_KV.put("settings:wallet", String(wallet || "").trim());
}

/* ========================== LEVELING (AI) ========================== */
const QUIZ = [
  { key: "q1", text: "۱) بیشتر دنبال چی هستی؟", options: ["اسکالپ سریع", "سوئینگ چندروزه", "هولد/سرمایه‌گذاری", "نمی‌دانم"] },
  { key: "q2", text: "۲) وقتی معامله خلاف تو رفت…", options: ["فوراً می‌بندم", "صبر می‌کنم تا ساختار مشخص شود", "میانگین کم می‌کنم", "تجربه‌ای ندارم"] },
  { key: "q3", text: "۳) ابزار تحلیل‌ات؟", options: ["پرایس‌اکشن", "اندیکاتور", "اسمارت‌مانی", "هیچکدام"] },
  { key: "q4", text: "۴) تحمل ریسک؟", options: ["کم", "متوسط", "زیاد", "نمی‌دانم"] },
  { key: "q5", text: "۵) تایم آزاد برای چک کردن بازار؟", options: ["ساعتی", "چندبار در روز", "روزانه", "هفتگی/کم"] },
];

async function evaluateLevelWithAI(env, profile, quizAnswers) {
  const prompt =
`تو یک مشاور تعیین‌سطح معامله‌گری هستی. خروجی فقط JSON باشد.
ورودی:
- تجربه بازار: ${profile.marketExperience}
- بازار مورد علاقه: ${profile.preferredMarket}
- پاسخ‌های آزمون: ${JSON.stringify(quizAnswers)}

خروجی JSON با کلیدهای:
level یکی از: beginner|intermediate|pro
recommendedMarket یکی از: crypto|forex|metals|stocks
settings: { timeframe: "M15|H1|H4|D1", style: "اسکالپ|سوئینگ|اسمارت‌مانی", risk: "کم|متوسط|زیاد" }
notes: رشته کوتاه فارسی`;

  try {
    const out = await runTextProviders(prompt, env, env.TEXT_PROVIDER_ORDER);
    const json = safeExtractJson(out);
    if (json && json.settings) return json;
  } catch (e) {
    console.error("evaluateLevelWithAI failed:", e);
  }

  const risk = (quizAnswers.q4 || "").includes("کم") ? "کم" : (quizAnswers.q4 || "").includes("زیاد") ? "زیاد" : "متوسط";
  const tf = (quizAnswers.q1 || "").includes("اسکالپ") ? "M15" : (quizAnswers.q1 || "").includes("سوئینگ") ? "H4" : "H1";
  return {
    level: "beginner",
    recommendedMarket: mapPreferredMarket(profile.preferredMarket),
    settings: { timeframe: tf, style: "اسمارت‌مانی", risk },
    notes: "تنظیمات اولیه بر اساس پاسخ‌های شما چیده شد.",
  };
}

function safeExtractJson(txt) {
  const s = String(txt || "");
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function mapPreferredMarket(s) {
  s = (s || "").toLowerCase();
  if (s.includes("کریپتو") || s.includes("crypto")) return "crypto";
  if (s.includes("فارکس") || s.includes("forex")) return "forex";
  if (s.includes("فلز") || s.includes("gold") || s.includes("xau")) return "metals";
  if (s.includes("سهام") || s.includes("stock")) return "stocks";
  return "crypto";
}

/* ========================== REFERRAL / POINTS ========================== */
async function storeReferralCodeOwner(env, code, ownerUserId) {
  if (!env.BOT_KV) return;
  await env.BOT_KV.put(`ref:${code}`, String(ownerUserId));
}
async function resolveReferralOwner(env, code) {
  if (!env.BOT_KV) return "";
  const v = await env.BOT_KV.get(`ref:${code}`);
  return (v || "").toString().trim();
}

async function hashPhone(phone) {
  const data = new TextEncoder().encode(String(phone || "").trim());
  const digest = await crypto.subtle.digest("SHA-256", data);
  const u8 = new Uint8Array(digest);
  let hex = "";
  for (const b of u8) hex += b.toString(16).padStart(2, "0");
  return hex;
}

async function isPhoneNew(env, phone) {
  if (!env.BOT_KV) return true;
  const h = await hashPhone(phone);
  const key = `phone:${h}`;
  const exists = await env.BOT_KV.get(key);
  return !exists;
}

async function markPhoneSeen(env, phone, userId) {
  if (!env.BOT_KV) return;
  const h = await hashPhone(phone);
  await env.BOT_KV.put(`phone:${h}`, String(userId));
}

async function awardReferralIfEligible(env, newUserSt) {
  // kept for backward compatibility; referral reward is finalized after full onboarding
  return finalizeOnboardingRewards(env, newUserSt);
}

function futureISO(days) {
  const d = new Date(Date.now() + days * 24 * 3600 * 1000);
  return d.toISOString();
}

/* ========================== UPDATE HANDLER ========================== */
async function handleUpdate(update, env) {
  try {
    const msg = update.message;
    if (!msg) return;

    const chatId = msg.chat?.id;
    const from = msg.from;
    const userId = from?.id;
    if (!chatId || !userId) return;

    const st = await ensureUser(userId, env, from);

    if (msg.contact && msg.contact.phone_number) {
      await handleContact(env, chatId, from, st, msg.contact);
      return;
    }

    const imageFileId = extractImageFileId(msg, env);
    if (imageFileId) {
      if (!st.profile?.name || !st.profile?.phone) {
        await tgSendMessage(env, chatId, "برای استفاده از تحلیل، ابتدا نام و شماره را ثبت کن ✅", mainMenuKeyboard(env));
        await startOnboarding(env, chatId, from, st);
        return;
      }
      await handleVisionFlow(env, chatId, from, userId, st, imageFileId);
      return;
    }

    const text = (msg.text || "").trim();

    if (text === "/start") {
      const refArg = (msg.text || "").split(" ").slice(1).join(" ").trim();
      await onStart(env, chatId, from, st, refArg);
      return;
    }

    if (text.startsWith("/setwallet")) {
      if (!isAdmin(from, env)) return tgSendMessage(env, chatId, "⛔️ فقط ادمین می‌تواند آدرس ولت را تنظیم کند.", mainMenuKeyboard(env));
      const wallet = text.split(" ").slice(1).join(" ").trim();
      if (!wallet) return tgSendMessage(env, chatId, "فرمت: /setwallet <wallet_address>", mainMenuKeyboard(env));
      await setWallet(env, wallet);
      return tgSendMessage(env, chatId, "✅ آدرس ولت ذخیره شد.", mainMenuKeyboard(env));
    }

    if (text.startsWith("/setprompt")) {
      if (!isStaff(from, env)) return tgSendMessage(env, chatId, "⛔️ فقط ادمین/اونر می‌تواند پرامپت تحلیل را تعیین کند.", mainMenuKeyboard(env));
      const p = text.split(" ").slice(1).join(" ").trim();
      if (!p) return tgSendMessage(env, chatId, "فرمت: /setprompt <prompt_text>", mainMenuKeyboard(env));
      if (!env.BOT_KV) return tgSendMessage(env, chatId, "⛔️ BOT_KV فعال نیست.", mainMenuKeyboard(env));
      await env.BOT_KV.put("settings:analysis_prompt", p);
      return tgSendMessage(env, chatId, "✅ پرامپت تحلیل ذخیره شد.", mainMenuKeyboard(env));
    }


    if (text.startsWith("/setstyleprompt")) {
      if (!isStaff(from, env)) return tgSendMessage(env, chatId, "⛔️ فقط ادمین/اونر می‌تواند پرامپت هر سبک را تعیین کند.", mainMenuKeyboard(env));
      const rest = text.replace("/setstyleprompt", "").trim();
      const sp = rest.split(" ");
      const style = (sp.shift() || "").trim();
      const prompt = sp.join(" ").trim();
      if (!style || !prompt) {
        return tgSendMessage(env, chatId, "فرمت: /setstyleprompt <style> <prompt_text>", mainMenuKeyboard(env));
      }
      if (!env.BOT_KV) return tgSendMessage(env, chatId, "⛔️ BOT_KV فعال نیست.", mainMenuKeyboard(env));
      await setStylePrompt(env, style, prompt);
      return tgSendMessage(env, chatId, `✅ پرامپت سبک «${style}» ذخیره شد.`, mainMenuKeyboard(env));
    }

    if (text.startsWith("/getstyleprompt")) {
      if (!isStaff(from, env)) return tgSendMessage(env, chatId, "⛔️ فقط ادمین/اونر.", mainMenuKeyboard(env));
      const style = text.replace("/getstyleprompt", "").trim();
      if (!style) return tgSendMessage(env, chatId, "فرمت: /getstyleprompt <style>", mainMenuKeyboard(env));
      const p = await getStylePrompt(env, style);
      return tgSendMessage(env, chatId, p ? `🎯 ${style}\n\n${p}` : "برای این سبک چیزی ثبت نشده.", mainMenuKeyboard(env));
    }


    if (text === "/signals" || text === "/signal" || text === BTN.SIGNAL) {
      if (!st.profile?.name || !st.profile?.phone) {
        await tgSendMessage(env, chatId, "برای شروع تحلیل، ابتدا پروفایل را کامل کن ✅", mainMenuKeyboard(env));
        await startOnboarding(env, chatId, from, st);
        return;
      }
      st.state = "choose_symbol";
      st.selectedSymbol = "";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "📈 دسته‌بندی سیگنال‌ها:", signalMenuKeyboard());
    }

    if (text === "/settings" || text === BTN.SETTINGS) {
      if (!st.profile?.name || !st.profile?.phone) {
        await tgSendMessage(env, chatId, "برای تنظیمات، ابتدا پروفایل را کامل کن ✅", mainMenuKeyboard(env));
        await startOnboarding(env, chatId, from, st);
        return;
      }
      return sendSettingsSummary(env, chatId, st, from);
    }


    if (text === "/wallet" || text === BTN.WALLET) {
      const wallet = await getWallet(env);
      const txs = Array.isArray(st.wallet?.transactions) ? st.wallet.transactions.slice(-5).reverse() : [];
      const txHistory = txs.length
        ? txs.map((t, i) => `${i + 1}) ${t.txHash || "-"} | ${t.amount || "-"} USDT | ${String(t.createdAt || "").slice(0, 16).replace("T", " ")}`).join(String.fromCharCode(10))
        : "—";
      const planName = `${st.profile?.username || "marketiq"}  PRO`;
      const txt =
        `💳 ولت

` +
        `پلن: ${planName}
با ارزش ۲۵ USDT

` +
        `📜 تاریخچه تراکنشات
${txHistory}

` +
        (wallet ? `🏦 آدرس ولت:
${wallet}

` : "") +
        `«واریزی فقط به آدرس  این ولت  ممکن است
در  زیر باید بعد از واریز هش واریزی را ارسال کنید.»`;
      return tgSendMessage(env, chatId, txt, walletMenuKeyboard());
    }

    if (text === BTN.WALLET_BALANCE) {
      const bal = Number(st.wallet?.balance || 0);
      return tgSendMessage(env, chatId, `💰 موجودی فعلی: ${bal}`, walletMenuKeyboard());
    }

    if (text === BTN.WALLET_DEPOSIT) {
      const wallet = await getWallet(env);
      const memo = `U${st.userId}`;
      st.state = "wallet_deposit_txid";
      await saveUser(userId, st, env);
      const txt =
        `➕ واریز

` +
        (wallet ? `آدرس ولت:
${wallet}
` : "") +
        `
Memo/Tag: ${memo}

` +
        `«واریزی فقط به آدرس ولت درگاه ممکن است
در  زیر باید از واریز هش واریزی را ارسال کنید.»

hash پرداخت را همینجا بفرست (در صورت نیاز: <hash> <amount>).`;
      return tgSendMessage(env, chatId, txt, kb([[BTN.BACK, BTN.HOME]]));
    }

    if (text === BTN.WALLET_WITHDRAW) {
      st.state = "wallet_withdraw";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "➖ برداشت\n\nفرمت را بفرست:\n<amount> <address>", kb([[BTN.HOME]]));
    }


    if (text === "/profile" || text === BTN.PROFILE) {
      return tgSendMessage(env, chatId, profileText(st, from, env), mainMenuKeyboard(env));
    }

    if (text === "/invite" || text === BTN.INVITE) {
      const { link, share } = inviteShareText(st, env);
      if (!link) return tgSendMessage(env, chatId, "لینک دعوت آماده نیست. بعداً دوباره تلاش کن.", mainMenuKeyboard(env));
      const inv = Number(st.referral?.successfulInvites || 0);
      const pts = Number(st.referral?.points || 0);
      const txt =
        `🤝 دعوت دوستان

` +
        `دعوت موفق: ${inv}
` +
        `امتیاز شما: ${pts}

` +
        `🔗 لینک رفرال قابل کپی: <code>${escapeHtml(link)}</code>
` +
        `لینک رفرال: <a href="${escapeHtml(link)}">باز کردن لینک دعوت</a>

` +
        (share ? `اشتراک‌گذاری سریع: <a href="${escapeHtml(share)}">ارسال لینک</a>

` : "") +
        `«با معرفی دوستانتان به ربات ۳ تحلیل به معنی ۶ امتباز بدست می اورید در صورت خرید اشتراک دوستانتان ۱۰ درصد از مبلغ اشتراک را دریافت میکنید
»`;
      return tgSendMessageHtml(env, chatId, txt, mainMenuKeyboard(env));
    }


    if (text === "/education" || text === BTN.EDUCATION) {
      return tgSendMessage(env, chatId, "📚 آموزش و مفاهیم بازار\n\nبه‌زودی محتوای آموزشی اضافه می‌شود.", mainMenuKeyboard(env));
    }

    if (text === "/support" || text === BTN.SUPPORT) {
      const handle = env.SUPPORT_HANDLE || "@support";
      const wallet = await getWallet(env);
      const walletLine = wallet ? `\n\n💳 آدرس ولت جهت پرداخت:\n${wallet}` : "";
      return tgSendMessage(
        env,
        chatId,
        `🆘 پشتیبانی

«با ارسال تیکت می‌توانید با کارشناسان ما نظرات خود را درمیان بگذارید.»

برای سوالات آماده یا ارسال تیکت از دکمه‌ها استفاده کن.

پیام مستقیم: ${handle}}`,
        kb([[BTN.SUPPORT_FAQ, BTN.SUPPORT_TICKET], [BTN.SUPPORT_CUSTOM_PROMPT], [BTN.HOME]])
      );
    }


    if (text === "/quote" || text === BTN.QUOTE) {
      const symbol = String(st.selectedSymbol || "BTCUSDT").toUpperCase();
      const tf = String(st.timeframe || "H4").toUpperCase();
      try {
        const candles = await getMarketCandlesWithFallback(env, symbol, tf);
        const snap = computeSnapshot(candles || []);
        if (!snap) throw new Error("quote_unavailable");
        const msgQ = `💹 قیمت لحظه‌ای

نماد: ${symbol}
TF: ${tf}
قیمت: ${snap.lastPrice}
تغییر: ${snap.changePct}%
روند: ${snap.trend || "نامشخص"}`;
        return tgSendMessage(env, chatId, msgQ, mainMenuKeyboard(env));
      } catch (e) {
        return tgSendMessage(env, chatId, "⚠️ قیمت لحظه‌ای در دسترس نیست. کمی بعد دوباره تلاش کن.", mainMenuKeyboard(env));
      }
    }

    if (text === "/news" || text === BTN.NEWS) {
      const symbol = String(st.selectedSymbol || "BTCUSDT").toUpperCase();
      try {
        const rows = await fetchSymbolNewsFa(symbol, env);
        const lines = (rows || []).slice(0, 5).map((x, i) => `${i + 1}) ${x.title || "-"}`).join("\n");
        return tgSendMessage(env, chatId, `📰 اخبار ${symbol}

${lines || "خبری پیدا نشد."}`, mainMenuKeyboard(env));
      } catch (e) {
        return tgSendMessage(env, chatId, "⚠️ خبر مرتبط در دسترس نیست.", mainMenuKeyboard(env));
      }
    }

    if (text === "/newsanalyze" || text === BTN.NEWS_ANALYSIS) {
      const symbol = String(st.selectedSymbol || "BTCUSDT").toUpperCase();
      try {
        const rows = await fetchSymbolNewsFa(symbol, env);
        const summary = await buildNewsAnalysisSummary(symbol, rows || [], env);
        return tgSendMessage(env, chatId, `🧠 تحلیل خبر ${symbol}

${summary || "تحلیل خبری در دسترس نیست."}`, mainMenuKeyboard(env));
      } catch (e) {
        return tgSendMessage(env, chatId, "⚠️ تحلیل خبر در دسترس نیست.", mainMenuKeyboard(env));
      }
    }

    if (text === "/miniapp" || text === BTN.MINIAPP) {
      const url = getMiniappUrl(env);
      if (!url) {
        return tgSendMessage(env, chatId, `⚠️ لینک مینی‌اپ تنظیم نشده.

در Wrangler / داشبورد یک متغیر ENV به نام MINIAPP_URL یا PUBLIC_BASE_URL بگذار (مثلاً https://<your-worker-domain>/ ) و دوباره Deploy کن.`, mainMenuKeyboard(env));
      }
      const token = await issueMiniappToken(env, st.userId, from);
      const finalUrl = token ? appendQuery(url, { miniToken: token }) : url;
      const kbInline = { inline_keyboard: [[{ text: BTN.MINIAPP, web_app: { url: finalUrl } }]] };
      return tgSendMessage(env, chatId, `🧩 مینی‌اپ فعال شد.

از دکمه زیر وارد شوید. اگر دکمه باز نشد، این لینک را مستقیم باز کنید:
${finalUrl}\n\nچک‌لیست سریع اتصال:
${MINIAPP_EXEC_CHECKLIST_TEXT}`, kbInline);
    }


    if (text === "/users") {
      if (!isStaff(from, env)) return tgSendMessage(env, chatId, "⛔️ فقط ادمین/اونر می‌تواند لیست کاربران را ببیند.", mainMenuKeyboard(env));
      return sendUsersList(env, chatId);
    }


    if (text === BTN.LEVELING || text === "/level") {
      if (!st.profile?.name || !st.profile?.phone) {
        await tgSendMessage(env, chatId, "برای تعیین سطح، ابتدا پروفایل را کامل کن ✅", mainMenuKeyboard(env));
        await startOnboarding(env, chatId, from, st);
        return;
      }
      await startLeveling(env, chatId, from, st);
      return;
    }
    if (text === BTN.SET_CAPITAL) {
      st.state = "set_capital";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "💼 لطفاً سرمایه قابل معامله‌ات را به عدد وارد کن (مثال: 1000)", kb([[BTN.BACK, BTN.HOME]]));
    }

    if (text === BTN.REQUEST_CUSTOM_PROMPT) {
      st.state = "request_custom_prompt";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "🧠 درخواستت برای پرامپت اختصاصی را بنویس (سبک، بازار، هدف).", kb([[BTN.BACK, BTN.HOME]]));
    }

    if (text === BTN.SUPPORT_FAQ || text === "/faq") {
      st.state = "support_faq";
      await saveUser(userId, st, env);
      const faq = getSupportFaq();
      const list = faq.map((f, i) => `${i + 1}) ${f.q}`).join(String.fromCharCode(10));
      return tgSendMessage(env, chatId, `❓ سوالات آماده\n\n${list}\n\nعدد سوال را ارسال کن تا پاسخ را ببینی.`, kb([[BTN.BACK, BTN.HOME]]));
    }

    if (text === BTN.HOME) {
      st.state = "idle";
      st.selectedSymbol = "";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "🏠 منوی اصلی:", mainMenuKeyboard(env));
    }

    if (text === BTN.BACK) {
      if (st.state.startsWith("quiz_")) {
        st.state = "idle";
        await saveUser(userId, st, env);
        return tgSendMessage(env, chatId, "🏠 برگشتی به منوی اصلی.", mainMenuKeyboard(env));
      }
      if (st.state === "await_prompt") {
        st.state = "choose_symbol";
        st.selectedSymbol = "";
        await saveUser(userId, st, env);
        return tgSendMessage(env, chatId, "📈 دسته‌بندی سیگنال‌ها:", signalMenuKeyboard());
      }
      if (st.state.startsWith("set_")) {
        st.state = "idle";
        await saveUser(userId, st, env);
        return sendSettingsSummary(env, chatId, st, from);
      }
      return tgSendMessage(env, chatId, "🏠 منوی اصلی:", mainMenuKeyboard(env));
    }

    if (st.state === "onb_name") {
      const name = text.replace(/\s+/g, " ").trim();
      if (!name || name.length < 2) return tgSendMessage(env, chatId, "نام را درست وارد کن (حداقل ۲ حرف).", contactKeyboard());
      st.profile.name = name;
      st.state = "onb_contact";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "عالی ✅ حالا لطفاً شماره تماس را با دکمه زیر ارسال کن:", contactKeyboard());
    }

    if (st.state === "onb_experience") {
      st.profile.marketExperience = text;
      st.state = "onb_market";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "بازار مورد علاقه‌ات کدام است؟", optionsKeyboard(["کریپتو", "فارکس", "فلزات", "سهام"]));
    }

    if (st.state === "onb_market") {
      st.profile.preferredMarket = text;
      st.state = "onb_style";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "🎯 سبک ترجیحی‌ات را انتخاب کن:", optionsKeyboard(ALLOWED_STYLE_LIST));
    }

    if (st.state === "onb_style") {
      const style = ALLOWED_STYLE_LIST.includes(text) ? text : "پرایس اکشن";
      st.profile.preferredStyle = style;
      st.style = style;
      await saveUser(userId, st, env);
      await startOnboarding(env, chatId, from, st);
      return;
    }

    if (st.state.startsWith("quiz_")) {
      const idx = Number(st.state.split("_")[1] || "0");
      if (!Number.isFinite(idx)) return;
      const q = QUIZ[idx];
      if (!q) return;

      st.profile.quizAnswers = st.profile.quizAnswers || {};
      st.profile.quizAnswers[q.key] = text;

      const nextIdx = idx + 1;
      if (nextIdx < QUIZ.length) {
        st.state = `quiz_${nextIdx}`;
        await saveUser(userId, st, env);
        const nq = QUIZ[nextIdx];
        return tgSendMessage(env, chatId, nq.text, optionsKeyboard(nq.options));
      }

      st.state = "idle";
      await saveUser(userId, st, env);

      await tgSendMessage(env, chatId, "⏳ در حال تحلیل پاسخ‌های آزمون و تنظیم خودکار پروفایل…", kb([[BTN.HOME]]));

      const result = await evaluateLevelWithAI(env, st.profile, st.profile.quizAnswers || {});
      st.profile.level = result.level || "";
      st.profile.levelNotes = result.notes || "";
      st.timeframe = result.settings?.timeframe || st.timeframe;
      st.style = result.settings?.style || st.style;
      st.risk = result.settings?.risk || st.risk;
      st.profile.onboardingDone = true;
      applyLocaleDefaults(st);
      await finalizeOnboardingRewards(env, st);

      await saveUser(userId, st, env);

      const marketFa = ({crypto:"کریپتو", forex:"فارکس", metals:"فلزات", stocks:"سهام"})[result.recommendedMarket] || "کریپتو";
      await tgSendMessage(
        env,
        chatId,
        `✅ تعیین سطح انجام شد.

سطح: ${st.profile.level}
پیشنهاد بازار: ${marketFa}

تنظیمات پیشنهادی:
⏱ ${st.timeframe} | 🎯 ${st.style} | ⚠️ ${st.risk}

یادداشت:
${st.profile.levelNotes || "—"}

اگر می‌خوای دوباره تعیین‌سطح انجام بدی یا تنظیماتت تغییر کنه، به پشتیبانی پیام بده (ادمین بررسی می‌کند).`,
        mainMenuKeyboard(env)
      );
      const teaserSymbol = st.profile?.preferredMarket?.includes("فارکس") ? "EURUSD" : (st.profile?.preferredMarket?.includes("فلز") ? "XAUUSD" : (st.profile?.preferredMarket?.includes("سهام") ? "US500" : "BTCUSDT"));
      const teaser = `📌 یک تحلیل کوتاه ویژه پروفایل شما:
${teaserSymbol} در ${st.timeframe} با ریسک ${st.risk} → در صورت تثبیت بالای ناحیه حمایتی اخیر، سناریوی ادامه‌دار صعودی فعال می‌شود؛ در غیر این صورت پولبک عمیق‌تر محتمل است.

برای تحلیل کامل از منوی سیگنال استفاده کن 🚀`;
      return tgSendMessage(env, chatId, teaser, mainMenuKeyboard(env));
    }

    if (text === BTN.CAT_MAJORS) return tgSendMessage(env, chatId, "💱 ماجورها:", listKeyboard(MAJORS));
    if (text === BTN.CAT_METALS) return tgSendMessage(env, chatId, "🪙 فلزات:", listKeyboard(METALS));
    if (text === BTN.CAT_INDICES) return tgSendMessage(env, chatId, "📊 شاخص‌ها:", listKeyboard(INDICES));
    if (text === BTN.CAT_CRYPTO) return tgSendMessage(env, chatId, "₿ کریپتو:", listKeyboard(CRYPTOS));

    if (text === BTN.SET_TF) {
      st.state = "set_tf";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "⏱ تایم‌فریم:", optionsKeyboard(["M15","H1","H4","D1"]));
    }
    if (text === BTN.SET_STYLE) {
      st.state = "set_style";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "🎯 سبک:", optionsKeyboard(ALLOWED_STYLE_LIST));
    }
    if (text === BTN.SET_RISK) {
      st.state = "set_risk";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "⚠️ ریسک:", optionsKeyboard(["کم","متوسط","زیاد"]));
    }
    if (text === BTN.SET_NEWS) {
      st.state = "set_news";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "📰 خبر:", optionsKeyboard(["روشن ✅","خاموش ❌"]));
    }
    if (text === BTN.SET_CAPITAL) {
      const flags = await getAdminFlags(env);
      if (!flags.capitalModeEnabled) return tgSendMessage(env, chatId, "⚠️ مدیریت سرمایه توسط ادمین غیرفعال است.", settingsMenuKeyboard());
      st.state = "set_capital";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "💼 سرمایه را وارد کن (عدد).", kb([[BTN.BACK, BTN.HOME]]));
    }

    if (text === BTN.SUPPORT_FAQ) {
      st.state = "support_faq";
      await saveUser(userId, st, env);
      const faq = getSupportFaq();
      const list = faq.map((f, i) => `${i + 1}) ${f.q}`).join(String.fromCharCode(10));
      return tgSendMessage(env, chatId, `❓ سوالات آماده\n\n${list}\n\nعدد سوال را ارسال کن تا پاسخ را ببینی.`, kb([[BTN.BACK, BTN.HOME]]));
    }

    if (text === BTN.SUPPORT_TICKET) {
      st.state = "support_ticket";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "✉️ متن تیکت را بنویس (حداکثر ۳۰۰ کاراکتر):", kb([[BTN.BACK, BTN.HOME]]));
    }

    if (text === BTN.SUPPORT_CUSTOM_PROMPT) {
      st.state = "support_custom_prompt";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "🧠 نیازت را برای پرامپت اختصاصی بنویس (حداکثر ۴۰۰ کاراکتر).", kb([[BTN.BACK, BTN.HOME]]));
    }

    if (st.state === "set_tf") { st.timeframe = text; st.state = "idle"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, `✅ تایم‌فریم: ${st.timeframe}`, mainMenuKeyboard(env)); }
    if (st.state === "set_style") {
      st.style = ALLOWED_STYLE_LIST.includes(text) ? text : st.style;
      st.state = "idle";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, `✅ سبک: ${st.style}`, mainMenuKeyboard(env));
    }
    if (st.state === "set_risk") { st.risk = text; st.state = "idle"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, `✅ ریسک: ${st.risk}`, mainMenuKeyboard(env)); }
    if (st.state === "set_news") { st.newsEnabled = text.includes("روشن"); st.state = "idle"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, `✅ خبر: ${st.newsEnabled ? "روشن ✅" : "خاموش ❌"}`, mainMenuKeyboard(env)); }
    if (st.state === "set_capital" || st.state === "onb_capital") {

      const cap = Number(String(text || "").replace(/[, ]+/g, "").trim());
      if (!Number.isFinite(cap) || cap <= 0) return tgSendMessage(env, chatId, "عدد سرمایه معتبر نیست. مثال: 1500", kb([[BTN.BACK, BTN.HOME]]));
      st.profile = st.profile || {};
      st.profile.capital = cap;
      st.profile.capitalCurrency = st.profile.capitalCurrency || "USDT";
      st.capital = st.capital || { amount: 0, enabled: true };
      st.capital.amount = cap;
      st.capital.enabled = true;
      const wasOnb = st.state === "onb_capital";
      st.state = "idle";
      await saveUser(userId, st, env);
      if (wasOnb) return startLeveling(env, chatId, from, st);

      return tgSendMessage(env, chatId, `✅ سرمایه ثبت شد: ${cap} ${st.profile.capitalCurrency || "USDT"}`, settingsMenuKeyboard());
    }

    if (st.state === "request_custom_prompt") {
      const req = String(text || "").trim();
      if (req.length < 8) {
        return tgSendMessage(env, chatId, "متن درخواست خیلی کوتاه است.", kb([[BTN.BACK, BTN.HOME]]));
      }
      const reqId = `cpr_${Date.now()}_${st.userId}`;
      const item = { id: reqId, userId: String(st.userId), username: st.profile?.username || "", text: req, status: "pending", createdAt: new Date().toISOString() };
      await storeCustomPromptRequest(env, item);
      const supportChatId = env.SUPPORT_CHAT_ID ? Number(env.SUPPORT_CHAT_ID) : 0;
      if (supportChatId) {
        await tgSendMessage(env, supportChatId, `🧠 درخواست پرامپت اختصاصی جدید #${reqId}
کاربر: ${item.username ? '@'+item.username : item.userId}
متن:
${req}`);
      }
      st.state = "idle";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "✅ درخواست ثبت شد. بعد از تایید ادمین فعال می‌شود.", settingsMenuKeyboard());
    }

    if (st.state === "support_faq") {
      const idx = Number(text.trim());
      const faq = getSupportFaq();
      const item = Number.isFinite(idx) ? faq[idx - 1] : null;
      st.state = "idle";
      await saveUser(userId, st, env);
      if (!item) return tgSendMessage(env, chatId, "عدد معتبر نیست. دوباره تلاش کن.", kb([[BTN.SUPPORT_FAQ, BTN.HOME]]));
      return tgSendMessage(env, chatId, `✅ پاسخ:\n${item.a}`, kb([[BTN.SUPPORT_FAQ, BTN.HOME]]));
    }
    if (st.state === "support_ticket") {
      const textClean = String(text || "").trim();
      if (!textClean || textClean.length < 4) {
        return tgSendMessage(env, chatId, "متن تیکت کوتاه است. لطفاً توضیح بیشتری بده.", kb([[BTN.BACK, BTN.HOME]]));
      }
      st.state = "idle";
      await saveUser(userId, st, env);
      const ticket = { id: `t_${Date.now()}_${st.userId}`, userId: String(st.userId), username: st.profile?.username || "", phone: st.profile?.phone || "", text: textClean, kind: "general", status: "pending", createdAt: new Date().toISOString() };
      await storeSupportTicket(env, ticket);

      const supportChatId = env.SUPPORT_CHAT_ID ? Number(env.SUPPORT_CHAT_ID) : 0;
      if (supportChatId) {
        await tgSendMessage(env, supportChatId, `📩 تیکت جدید
شناسه: ${ticket.id}
کاربر: ${st.profile?.username ? "@"+st.profile.username : st.userId}
شماره: ${st.profile?.phone || "-"}
متن:
${textClean}`);
      }
      return tgSendMessage(env, chatId, "✅ تیکت شما ثبت شد و در صف بررسی ادمین است.", mainMenuKeyboard(env));
    }

    if (st.state === "support_custom_prompt") {
      const textClean = String(text || "").trim();
      if (!textClean || textClean.length < 8) {
        return tgSendMessage(env, chatId, "برای درخواست پرامپت اختصاصی، توضیح کامل‌تری ارسال کن.", kb([[BTN.BACK, BTN.HOME]]));
      }
      st.state = "idle";
      const req = {
        id: `cpr_${Date.now()}_${st.userId}`,
        userId: String(st.userId),
        username: st.profile?.username || "",
        text: textClean,
        status: "pending",
        promptId: "",
        createdAt: new Date().toISOString(),
      };
      st.pendingCustomPromptRequestId = req.id;
      await saveUser(userId, st, env);
      await storeCustomPromptRequest(env, req);
      const supportChatId = env.SUPPORT_CHAT_ID ? Number(env.SUPPORT_CHAT_ID) : 0;
      if (supportChatId) {
        await tgSendMessage(env, supportChatId, `🧠 درخواست پرامپت اختصاصی
شناسه: ${req.id}
کاربر: ${st.profile?.username ? "@"+st.profile.username : st.userId}
متن:
${textClean}`);
      }
      return tgSendMessage(env, chatId, "✅ درخواست شما ثبت شد. بعد از تایید ادمین، پرامپت اختصاصی فعال می‌شود.", mainMenuKeyboard(env));
    }


    const sym = normalizeSymbol(text);
    if (isSymbol(sym)) {
      if (!st.profile?.name || !st.profile?.phone) {
        await tgSendMessage(env, chatId, "برای شروع تحلیل، ابتدا پروفایل را کامل کن ✅", mainMenuKeyboard(env));
        await startOnboarding(env, chatId, from, st);
        return;
      }

      st.selectedSymbol = sym;
      st.state = "await_prompt";
      await saveUser(userId, st, env);

      const quota = isStaff(from, env) ? "∞" : `${st.dailyUsed}/${dailyLimit(env, st)}`;
      return tgSendMessage(env, chatId, `✅ نماد: ${st.selectedSymbol}\n\nبرای شروع تحلیل روی «${BTN.ANALYZE}» بزن.\n\nسهمیه امروز: ${quota}`, kb([[BTN.ANALYZE], [BTN.BACK, BTN.HOME]]));
    }

    if (st.state === "await_prompt" && st.selectedSymbol) {
      if (env.BOT_KV && !canAnalyzeToday(st, from, env)) {
        return tgSendMessage(env, chatId, `⛔️ سهمیه امروزت تموم شده (${dailyLimit(env, st)} تحلیل در روز).`, mainMenuKeyboard(env));
      }

      const symbol = st.selectedSymbol;
      const isAnalyzeCmd = text === BTN.ANALYZE || text.replace(/\s+/g, "") === "تحلیلکن";
      if (!isAnalyzeCmd) return tgSendMessage(env, chatId, `برای شروع تحلیل روی «${BTN.ANALYZE}» بزن ✅`, kb([[BTN.ANALYZE], [BTN.BACK, BTN.HOME]]));

      st.state = "idle";
      st.selectedSymbol = "";

      const ok = await runSignalTextFlow(env, chatId, from, st, symbol, "");
      if (ok && env.BOT_KV) {
        consumeDaily(st, from, env);
        recordAnalysisSuccess(st);
        await saveUser(userId, st, env);
      }
      return;
    }


    if (st.state === "wallet_deposit_txid") {
      const parts = String(text || "").trim().split(/\s+/).filter(Boolean);
      const txid = String(parts[0] || "").trim();
      const amount = Number(parts[1] || 0);
      if (!txid || txid.length < 8) {
        return tgSendMessage(env, chatId, "hash نامعتبر است. دوباره ارسال کن.", kb([[BTN.BACK, BTN.HOME]]));
      }
      const payment = { id: `dep_${Date.now()}_${st.userId}`, userId: String(st.userId), username: st.profile?.username || "", amount: Number.isFinite(amount) ? amount : 0, txHash: txid, status: "pending", createdAt: new Date().toISOString(), source: "bot_txid" };
      await storePayment(env, payment);
      const supportChatId = env.SUPPORT_CHAT_ID ? Number(env.SUPPORT_CHAT_ID) : 0;
      if (supportChatId) {
        await tgSendMessage(env, supportChatId, `💳 درخواست واریز جدید
کاربر: ${st.profile?.username ? "@"+st.profile.username : st.userId}
TxID: ${txid}

${Number.isFinite(payment.amount) && payment.amount > 0 ? `مبلغ: ${payment.amount}` : ""}`);
      }
      st.state = "idle";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "✅ درخواست واریز ثبت شد و پس از بررسی تایید می‌شود.", walletMenuKeyboard());
    }

    if (st.state === "wallet_withdraw") {
      const parts = text.split(/\s+/).filter(Boolean);
      if (parts.length < 2) {
        return tgSendMessage(env, chatId, "فرمت درست نیست. مثال: 10 TRXxxxxxxxx", kb([[BTN.HOME]]));
      }
      const amount = Number(parts[0]);
      const address = parts.slice(1).join(" ");
      if (!Number.isFinite(amount) || amount <= 0) {
        return tgSendMessage(env, chatId, "مقدار نامعتبر است.", kb([[BTN.HOME]]));
      }

      const wid = `w_${Date.now()}_${st.userId}`;
      const createdAt = new Date().toISOString();

      // store request (D1 if available, else KV)
      if (env.BOT_DB) {
        await env.BOT_DB.prepare(
          "INSERT INTO withdrawals (id, userId, createdAt, amount, address, status) VALUES (?1, ?2, ?3, ?4, ?5, 'pending')"
        ).bind(wid, String(st.userId), createdAt, amount, address).run();
      } else if (env.BOT_KV) {
        await env.BOT_KV.put(`withdraw:${wid}`, JSON.stringify({ id: wid, userId: st.userId, createdAt, amount, address, status: "pending" }));
      }

      st.state = "idle";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "✅ درخواست برداشت ثبت شد و در انتظار بررسی است.", walletMenuKeyboard());
    }

    return tgSendMessage(env, chatId, "از منوی پایین استفاده کن ✅", mainMenuKeyboard(env));
  } catch (e) {
    console.error("handleUpdate error:", e);
  }
}

/* ========================== START / ONBOARDING ========================== */
async function onStart(env, chatId, from, st, refArg) {
  st.state = "idle";
  st.selectedSymbol = "";
  st.profile.username = from?.username ? String(from.username) : st.profile.username;

  if (env.BOT_KV) {
    for (const c of st.referral.codes || []) {
      await storeReferralCodeOwner(env, c, st.userId);
    }
  }

  if (refArg && refArg.startsWith("ref_") && !st.referral.referredBy) {
    const code = refArg.replace(/^ref_/, "").trim();
    const ownerId = await resolveReferralOwner(env, code);
    if (ownerId && String(ownerId) !== String(st.userId)) {
      st.referral.referredBy = String(ownerId);
      st.referral.referredByCode = code;
      st.profile.entrySource = `referral:${code}`;
    }
  } else if (!st.profile.entrySource) {
    st.profile.entrySource = refArg ? `start_arg:${refArg}` : "direct";
  }

  await saveUser(st.userId, st, env);

  await tgSendMessage(env, chatId, await getBotWelcomeText(env), mainMenuKeyboard(env));

  

  if (!st.profile?.name || !st.profile?.phone) {
    await startOnboarding(env, chatId, from, st);
  }
}

async function startOnboarding(env, chatId, from, st) {
  if (!st.profile?.name) {
    st.state = "onb_name";
    await saveUser(st.userId, st, env);
    return tgSendMessage(env, chatId, "👤 لطفاً نام خود را وارد کنید:", kb([[BTN.HOME]]));
  }
  if (!st.profile?.phone) {
    st.state = "onb_contact";
    await saveUser(st.userId, st, env);
    return tgSendMessage(env, chatId, "📱 برای فعال‌سازی، شماره تماس را ارسال کنید (Share Contact):", contactKeyboard());
  }
  if (!st.profile?.marketExperience) {
    st.state = "onb_experience";
    await saveUser(st.userId, st, env);
    return tgSendMessage(env, chatId, "سطح آشنایی/تجربه‌ات در بازار چقدر است؟", optionsKeyboard(["تازه‌کار","کمتر از ۶ ماه","۶ تا ۲۴ ماه","بیشتر از ۲ سال"]));
  }
  if (!st.profile?.preferredMarket) {
    st.state = "onb_market";
    await saveUser(st.userId, st, env);
    return tgSendMessage(env, chatId, "بازار مورد علاقه‌ات کدام است؟", optionsKeyboard(["کریپتو", "فارکس", "فلزات", "سهام"]));
  }
  if (!st.profile?.preferredStyle) {
    st.state = "onb_style";
    await saveUser(st.userId, st, env);
    return tgSendMessage(env, chatId, "🎯 سبک ترجیحی‌ات را انتخاب کن:", optionsKeyboard(ALLOWED_STYLE_LIST));
  }
  if (!Number(st.profile?.capital || 0)) {
    st.state = "onb_capital";
    await saveUser(st.userId, st, env);
    return tgSendMessage(env, chatId, "💼 سرمایه تقریبی‌ات را وارد کن (عدد). مثال: 1000", kb([[BTN.BACK, BTN.HOME]]));
  }
  await startLeveling(env, chatId, from, st);
}

async function handleContact(env, chatId, from, st, contact) {
  if (contact.user_id && String(contact.user_id) !== String(st.userId)) {
    return tgSendMessage(env, chatId, "⚠️ لطفاً فقط شماره خودت را با دکمه ارسال کن.", contactKeyboard());
  }

  const phone = String(contact.phone_number || "").trim();
  st.profile.phone = phone;
  st.profile.onboardingDone = false;
  applyLocaleDefaults(st);

  if (st.state === "onb_contact") st.state = "onb_experience";
  await saveUser(st.userId, st, env);

  await tgSendMessage(env, chatId, "✅ شماره ثبت شد. ممنون!", mainMenuKeyboard(env));
  return startOnboarding(env, chatId, from, st);
}

async function startLeveling(env, chatId, from, st) {
  st.profile.quizAnswers = {};
  st.state = "quiz_0";
  await saveUser(st.userId, st, env);
  return tgSendMessage(env, chatId, QUIZ[0].text, optionsKeyboard(QUIZ[0].options));
}

/* ========================== ADMIN: USERS LIST ========================== */
async function sendUsersList(env, chatId) {
  if (!env.BOT_KV || typeof env.BOT_KV.list !== "function") {
    return tgSendMessage(env, chatId, "⛔️ KV list در دسترس نیست. (BOT_KV را درست بایند کن)", mainMenuKeyboard(env));
  }

  const res = await env.BOT_KV.list({ prefix: "u:", limit: 20 });
  const keys = res?.keys || [];
  if (!keys.length) return tgSendMessage(env, chatId, "هیچ کاربری ثبت نشده.", mainMenuKeyboard(env));

  const users = [];
  for (const k of keys) {
    const raw = await env.BOT_KV.get(k.name);
    if (!raw) continue;
    try {
      const u = JSON.parse(raw);
      users.push(u);
    } catch {}
  }

  const lines = users.map(u => {
    const name = u?.profile?.name || "-";
    const phone = u?.profile?.phone ? maskPhone(u.profile.phone) : "-";
    const username = u?.profile?.username ? ("@" + u.profile.username) : "-";
    const used = `${u.dailyUsed || 0}/${dailyLimit(env, u)}`;
    const pts = u?.referral?.points || 0;
    const inv = u?.referral?.successfulInvites || 0;
    return `• ${name} | ${username} | ${phone} | استفاده: ${used} | امتیاز: ${pts} | دعوت: ${inv}`;
  });

  return tgSendMessage(env, chatId, "👥 کاربران (۲۰ تای اول):\n\n" + lines.join(String.fromCharCode(10)), mainMenuKeyboard(env));
}

function maskPhone(p) {
  const s = String(p);
  if (s.length <= 6) return s;
  return s.slice(0, 3) + "****" + s.slice(-3);
}

/* ========================== ROUTING HELPERS ========================== */
function normalizeSymbol(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.toUpperCase();
  s = s.replace(/\s+/g, "");
  // common forex format EUR/USD -> EURUSD
  s = s.replace(/\//g, "");
  return s;
}

function isSymbol(t) {
  const s = normalizeSymbol(t);
  if (!s) return false;

  // known lists
  if (MAJORS.includes(s) || METALS.includes(s) || INDICES.includes(s) || CRYPTOS.includes(s) || (EXTRA_INDICES || []).includes(s)) return true;

  // FX / metal
  if (/^[A-Z]{6}$/.test(s)) {
    const a = s.slice(0, 3), b = s.slice(3, 6);
    if ((FX_CODES || []).includes(a) && (FX_CODES || []).includes(b)) return true;
  }
  if (s === "XAUUSD" || s === "XAGUSD") return true;

  // crypto (binance-like)
  if (/^[A-Z0-9]{3,20}$/.test(s) && assetKind(s) === "crypto") return true;

  // yahoo / stocks / indices (safe ticker charset)
  if (/^[A-Z0-9^=._\-]{1,24}$/.test(s)) return true;

  return false;
}

/* ========================== TEXTS ========================== */
function getSupportFaq() {
  return [
    { q: "چطور سهمیه روزانه شارژ می‌شود؟", a: "سهمیه هر روز (Tehran) صفر می‌شود و مجدداً قابل استفاده است." },
    { q: "چرا تحلیل ناموفق شد؟", a: "اتصال دیتا یا مدل ممکن است موقتاً قطع باشد. چند دقیقه بعد دوباره تلاش کن." },
    { q: "چطور اشتراک فعال کنم؟", a: "پرداخت را انجام بده و هش تراکنش را برای ادمین ارسال کن تا تأیید و فعال شود." },
    { q: "چطور رفرال کار می‌کند؟", a: "هر دعوت موفق با شماره جدید ۳ امتیاز دارد. هر ۵۰۰ امتیاز = ۳۰ روز اشتراک هدیه." },
  ];
}

async function sendSettingsSummary(env, chatId, st, from) {
  const quota = isStaff(from, env) ? "∞" : `${st.dailyUsed}/${dailyLimit(env, st)}`;
  const wallet = await getWallet(env);
  const txt =
    `⚙️ تنظیمات:\n\n` +
    `⏱ تایم‌فریم: ${st.timeframe}\n` +
    `🎯 سبک: ${st.style}\n` +
    `🧩 پرامپت اختصاصی: ${st.customPromptId || "پیش‌فرض"}\n` +
    `⚠️ ریسک: ${st.risk}\n` +
    `📰 خبر: ${st.newsEnabled ? "روشن ✅" : "خاموش ❌"}\n\n` +
    `سهمیه امروز: ${quota}\n` 
     return tgSendMessage(env, chatId, txt, settingsMenuKeyboard());
}

function profileText(st, from, env) {
  const quota = isStaff(from, env) ? "∞" : `${st.dailyUsed}/${dailyLimit(env, st)}`;
  const adminTag = isStaff(from, env) ? "✅ ادمین/اونر" : "👤 کاربر";
  const level = st.profile?.level ? `\nسطح: ${st.profile.level}` : "";
  const pts = st.referral?.points || 0;
  const inv = st.referral?.successfulInvites || 0;

  const botUser = env.BOT_USERNAME ? String(env.BOT_USERNAME).replace(/^@/, "") : "";
  const code = (st.referral?.codes || [])[0] || "";
  const deep = code ? (botUser ? `https://t.me/${botUser}?start=ref_${code}` : `ref_${code}`) : "-";

  return `👤 پروفایل\n\nوضعیت: ${adminTag}\n🆔 ID: ${st.userId}\nنام: ${st.profile?.name || "-"}\nیوزرنیم: ${st.profile?.username ? "@"+st.profile.username : "-"}\nشماره: ${st.profile?.phone ? maskPhone(st.profile.phone) : "-"}${level}\n\n📅 امروز(Tehran): ${kyivDateString()}\nسهمیه امروز: ${quota}\n\n🎁 امتیاز: ${pts}\n👥 دعوت موفق: ${inv}\n\n🔗 لینک رفرال اختصاصی:\n${deep}\n\nℹ️ هر دعوت موفق ۳ امتیاز.\nهر ۵۰۰ امتیاز = ۳۰ روز اشتراک هدیه.`;
}

function inviteShareText(st, env) {
  const botUser = env.BOT_USERNAME ? String(env.BOT_USERNAME).replace(/^@/, "") : "";
  const code = (st.referral?.codes || [])[0] || "";
  const link = code ? (botUser ? `https://t.me/${botUser}?start=ref_${code}` : `ref_${code}`) : "";
  const share = link ? `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("  لینک من عضو شو و اشتراک هدیه بگیر ✅")}` : "";
  return { link, share };
}

/* ========================== FLOWS ========================== */

/* ========================== QUICKCHART IMAGE (CANDLESTICK) ==========================
QuickChart renders Chart.js configs as images via https://quickchart.io/chart .
Financial (candlestick/OHLC) charts are supported via chartjs-chart-financial plugin.
*/

function buildQcAnnotations(items, levels = [], qcSpec = null) {
  const ann = [];

  const addLine = (value, label, color, dash = [6, 4], width = 1.6) => {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return;
    ann.push({
      type: "line",
      scaleID: "y",
      value: v,
      borderColor: color,
      borderWidth: width,
      borderDash: dash,
      label: { enabled: true, content: label },
    });
  };

  const minX = items?.length ? items[0].x : undefined;
  const maxX = items?.length ? items[items.length - 1].x : undefined;

  const addZone = (low, high, label, kind) => {
    const yMin = Number(low);
    const yMax = Number(high);
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMin <= 0 || yMax <= 0) return;
    const lo = Math.min(yMin, yMax);
    const hi = Math.max(yMin, yMax);
    ann.push({
      type: "box",
      xMin: minX,
      xMax: maxX,
      yMin: lo,
      yMax: hi,
      backgroundColor: kind === "supply" ? "rgba(255,77,77,0.10)" : "rgba(47,227,165,0.10)",
      borderColor: kind === "supply" ? "rgba(255,77,77,0.35)" : "rgba(47,227,165,0.35)",
      borderWidth: 1,
      label: { enabled: !!label, content: label || "" },
    });
  };

  // fallback "levels" -> treat as generic zones/lines
  (Array.isArray(levels) ? levels : []).slice(0, 8).forEach((lvl, idx) => {
    addLine(lvl, `L${idx + 1}`, idx % 2 === 0 ? "#00d1ff" : "#ff8a65");
  });

  if (qcSpec && typeof qcSpec === "object") {
    const supports = Array.isArray(qcSpec.supports) ? qcSpec.supports : [];
    const resistances = Array.isArray(qcSpec.resistances) ? qcSpec.resistances : [];
    const tp = Array.isArray(qcSpec.tp) ? qcSpec.tp : [];
    const sl = Number(qcSpec.sl || 0);
    const zones = Array.isArray(qcSpec.zones) ? qcSpec.zones : [];

    supports.slice(0, 6).forEach((v, i) => addLine(v, `S${i + 1}`, "#00d1ff"));
    resistances.slice(0, 6).forEach((v, i) => addLine(v, `R${i + 1}`, "#ff8a65"));
    tp.slice(0, 4).forEach((v, i) => addLine(v, `TP${i + 1}`, "#f7c948", [2, 0], 2));
    if (Number.isFinite(sl) && sl > 0) addLine(sl, "SL", "#FF4D4D", [2, 0], 2);

    zones.slice(0, 6).forEach((z, i) => addZone(z.low, z.high, z.label || `Z${i + 1}`, (z.kind || "").includes("supply") ? "supply" : "demand"));
  }

  return ann;
}

function buildQuickChartSpec(candles, symbol, tf, levels = [], qcSpec = null) {
  const items = (candles || []).slice(-80).map((c) => ({
    x: Number(c.t || c.time || c.ts || c.timestamp || Date.now()),
    o: Number(c.o),
    h: Number(c.h),
    l: Number(c.l),
    c: Number(c.c),
  })).filter((x) => Number.isFinite(x.x) && Number.isFinite(x.o) && Number.isFinite(x.h) && Number.isFinite(x.l) && Number.isFinite(x.c));

  const annotations = buildQcAnnotations(items, levels, qcSpec);

  return {
    type: "candlestick",
    data: {
      datasets: [
        {
          label: `${symbol} ${tf}`,
          data: items,
          color: { up: "#2FE3A5", down: "#FF4D4D", unchanged: "#888" },
        },
      ],
    },
    options: {
      parsing: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: `${symbol} · ${tf}` },
        annotation: { annotations },
      },
      scales: { x: { ticks: { maxRotation: 0, autoSkip: true } } },
    },
  };
}

function buildQuickChartCandlestickUrl(candles, symbol, tf, levels = [], qcSpec = null) {
  const cfg = buildQuickChartSpec(candles, symbol, tf, levels, qcSpec);
  const encoded = encodeURIComponent(JSON.stringify(cfg));
  return `https://quickchart.io/chart?version=4&format=png&w=900&h=450&devicePixelRatio=2&plugins=chartjs-chart-financial,chartjs-plugin-annotation&c=${encoded}`;
}


function buildQuickChartLevelsOnlyUrl(symbol, tf, levels = []) {
  const lv = levels.map(Number).filter(Number.isFinite).slice(0, 12);
  const labels = lv.map((_, i) => `L${i + 1}`);
  const cfg = {
    type: "line",
    data: {
      labels,
      datasets: [{ label: `${symbol} ${tf} levels`, data: lv, borderColor: "#22d3ee", backgroundColor: "rgba(34,211,238,.15)", fill: true, tension: 0.2 }],
    },
    options: {
      plugins: { legend: { display: true }, title: { display: true, text: `${symbol} · ${tf} · levels` } },
      scales: { y: { grid: { color: "rgba(148,163,184,.25)" } }, x: { grid: { color: "rgba(148,163,184,.15)" } } },
    },
  };
  const encoded = encodeURIComponent(JSON.stringify(cfg));
  return `https://quickchart.io/chart?version=4&format=png&w=900&h=450&devicePixelRatio=2&c=${encoded}`;
}

function stripHiddenModelOutput(text) {
  let out = String(text || "");
  out = out.replace(/\*\*?\s*quickchart_config\s*\*\*?/gi, "");
  out = out.replace(/```\s*json[\s\S]*?quickchart[\s\S]*?```/gi, "");
  out = out.replace(/quickchart_config\s*:\s*\{[\s\S]*?\}/gi, "");
  return out.trim();
}

function buildAdminReportLines(users, payments, withdrawals, tickets) {
  const u = Array.isArray(users) ? users : [];
  const p = Array.isArray(payments) ? payments : [];
  const w = Array.isArray(withdrawals) ? withdrawals : [];
  const t = Array.isArray(tickets) ? tickets : [];
  const head = [
    `Admin Report | ${new Date().toISOString()}`,
    `users=${u.length} payments=${p.length} withdrawals=${w.length} tickets=${t.length}`,
    "------------------------------------------------------------",
  ];
  const usersBlock = u.slice(0, 80).map((x) => {
    const user = x?.profile?.username ? `@${String(x.profile.username).replace(/^@/, "")}` : x?.userId;
    return `USER ${user || "-"} | analyses=${x?.stats?.successfulAnalyses || 0} | used=${x?.dailyUsed || 0}/${dailyLimit({}, x || {})} | sub=${x?.subscription?.type || "free"}`;
  });
  const payBlock = p.slice(0, 60).map((x) => `PAY ${x.username || x.userId || "-"} | amount=${x.amount || 0} | status=${x.status || "-"} | tx=${x.txHash || "-"}`);
  const wdBlock = w.slice(0, 60).map((x) => `WD ${x.userId || "-"} | amount=${x.amount || 0} | status=${x.status || "pending"} | addr=${x.address || "-"}`);
  const tkBlock = t.slice(0, 60).map((x) => `TICKET ${x.id || "-"} | ${x.username || x.userId || "-"} | ${x.status || "pending"} | ${String(x.text || "").slice(0, 80)}`);
  return [
    ...head,
    "USERS", ...(usersBlock.length ? usersBlock : ["-"]),
    "",
    "PAYMENTS", ...(payBlock.length ? payBlock : ["-"]),
    "",
    "WITHDRAWALS", ...(wdBlock.length ? wdBlock : ["-"]),
    "",
    "TICKETS", ...(tkBlock.length ? tkBlock : ["-"]),
  ];
}

function buildSimplePdfFromText(text) {
  const content = String(text || "").replace(/\r/g, "");
  const lines = content.split("\n").slice(0, 500);
  const escaped = lines.map((l) => String(l || "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^	\x20-\x7E]/g, " "));
  const streamLines = ["BT", "/F1 10 Tf", "36 800 Td", "12 TL"];
  for (let i = 0; i < escaped.length; i++) {
    if (i === 0) streamLines.push(`(${escaped[i]}) Tj`);
    else streamLines.push(`T* (${escaped[i]}) Tj`);
  }
  streamLines.push("ET");
  const stream = streamLines.join(String.fromCharCode(10));

  const objects = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n");
  objects.push("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n");
  objects.push("3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n");
  objects.push("4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Courier >> endobj\n");
  objects.push(`5 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\n`);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

async function runSignalTextFlow(env, chatId, from, st, symbol, userPrompt) {
  await tgSendMessage(env, chatId, `⏳ جمع‌آوری داده و تحلیل ${symbol}...`, kb([[BTN.HOME]]));

  const t = stopToken();
  const typingTask = typingLoop(env, chatId, t);

  try {
    const flowTimeoutMs = Math.max(15000, Number(env.SIGNAL_FLOW_TIMEOUT_MS || 70000));
    const result = await Promise.race([
      runSignalTextFlowReturnText(env, from, st, symbol, userPrompt),
      timeoutPromise(flowTimeoutMs, "signal_text_flow_timeout"),
    ]);

    // 📸 QuickChart candlestick image
    if (String(env.QUICKCHART || "1") !== "0") {
      try {
        let candles = [];
        try {
          candles = await getMarketCandlesWithFallback(env, symbol, st.timeframe || "H4");
        } catch (e) {
          console.error("market provider failed (all)", e?.message || e);
          candles = [];
        }
        if (!Array.isArray(candles) || candles.length === 0) {
          const cacheKey = marketCacheKey(symbol, st.timeframe || "H4");
          candles = await getMarketCacheStale(env, cacheKey);
        }
        if (!Array.isArray(candles) || candles.length === 0) {
          // اگر دیتا نداریم، عکس ارسال نکن
          await tgSendMessage(env, chatId, "⚠️ برای این نماد در این تایم‌فریم دیتای کافی پیدا نشد؛ چارت ارسال نشد.", kb([[BTN.HOME]]));
        } else {
          const levels = extractLevels(result);
          const chartUrl = buildQuickChartCandlestickUrl(candles, symbol, st.timeframe || "H4", levels);
          const caption = candles.length < 5
            ? `📈 چارت ${symbol} (${st.timeframe || "H4"}) — داده محدود`
            : `📈 چارت ${symbol} (${st.timeframe || "H4"})`;
          const pj = await tgSendPhotoSmart(env, chatId, chartUrl, caption, kb([[BTN.HOME]]));
          if (!pj || !pj.ok) {
            console.error("chart send failed:", pj);
            if (String(env.RENDER_ZONES || "") === "1") {
              const svg = buildZonesSvgFromAnalysis(result, symbol, st.timeframe || "H4");
              await tgSendSvgDocument(env, chatId, svg, "zones.svg", `🖼️ نقشه زون‌ها: ${symbol} (${st.timeframe || "H4"})`);
            } else {
              await tgSendMessage(env, chatId, "⚠️ ارسال چارت ناموفق بود.", kb([[BTN.HOME]]));
            }
          }
}
      } catch (e) {
        console.error("quickchart error:", e);
      }
    }

    if (String(env.RENDER_ZONES || "") === "1") {
      const svg = buildZonesSvgFromAnalysis(result, symbol, st.timeframe || "H4");
      await tgSendSvgDocument(env, chatId, svg, "zones.svg", `🖼️ نقشه زون‌ها: ${symbol} (${st.timeframe || "H4"})`);
    }

    t.stop = true;
    await Promise.race([typingTask, sleep(10)]).catch(() => {});

    for (const part of chunkText(result, 3500)) {
      await tgSendMessage(env, chatId, part, mainMenuKeyboard(env));
    }
    return true;
  } catch (e) {
    console.error("runSignalTextFlow error:", e);
    t.stop = true;
    const msg = String(e?.message || e || "");
    if (msg.includes("timeout") || msg.includes("text_")) {
      let candles = [];
      try { candles = await getMarketCandlesWithFallback(env, symbol, st.timeframe || "H4"); } catch {}
      const fallback = buildLocalFallbackAnalysis(symbol, st, candles, msg || "signal_timeout");
      await tgSendLongMessage(env, chatId, fallback, kb([[BTN.HOME]]));
      return false;
    }
    await tgSendMessage(env, chatId, "⚠️ فعلاً امکان انجام این عملیات نیست. لطفاً بعداً دوباره تلاش کن.", mainMenuKeyboard(env));
    return false;
  }
}

function analysisCacheKey(symbol, st) {
  const tf = st.timeframe || "H4";
  const style = st.style || "";
  const risk = st.risk || "";
  const news = st.newsEnabled ? "1" : "0";
  return `analysis:${String(symbol).toUpperCase()}:${tf}:${style}:${risk}:${news}`;
}

async function getAnalysisCache(env, key) {
  const mem = cacheGet(ANALYSIS_CACHE, key);
  if (mem) return mem;
  const r2 = await getCachedR2Value(env.MARKET_R2, key);
  if (r2) cacheSet(ANALYSIS_CACHE, key, r2, Number(env.ANALYSIS_CACHE_TTL_MS || 120000));
  return r2;
}

async function setAnalysisCache(env, key, value) {
  const ttlMs = Number(env.ANALYSIS_CACHE_TTL_MS || 120000);
  cacheSet(ANALYSIS_CACHE, key, value, ttlMs);
  await r2PutJson(env.MARKET_R2, key, value, ttlMs);
}

function buildMarketBlock(candles, maxRows) {
  const snap = computeSnapshot(candles);
  const ohlc = candlesToCompactCSV(candles, maxRows);
  return (
    `lastPrice=${snap?.lastPrice}\n` +
    `changePct=${snap?.changePct}%\n` +
    `trend=${snap?.trend}\n` +
    `range50_hi=${snap?.range50?.hi} range50_lo=${snap?.range50?.lo}\n` +
    `sma20=${snap?.sma20} sma50=${snap?.sma50}\n` +
    `lastTs=${snap?.lastTs}\n\n` +
    `OHLC_CSV(t,o,h,l,c):\n${ohlc}`
  );
}

async function runSignalTextFlowReturnText(env, from, st, symbol, userPrompt) {
  const useCache = !userPrompt && !isStaff(from, env);
  const cacheKey = useCache ? analysisCacheKey(symbol, st) : "";
  if (useCache) {
    const cached = await getAnalysisCache(env, cacheKey);
    if (cached) return cached;
  }

  let candles = [];
  try {
    candles = await getMarketCandlesWithFallback(env, symbol, st.timeframe || "H4");
  } catch (e) {
    console.error("market provider failed (all)", e?.message || e);
    candles = [];
  }
  const marketBlock = buildMarketBlock(candles, 80);
  const newsBlock = st.newsEnabled ? (await buildNewsBlockForSymbol(symbol, env, 5)) : "";
  const prompt = await buildTextPromptForSymbol(symbol, userPrompt, st, marketBlock, env, newsBlock);
  let draft = "";
  try {
    draft = await runTextProviders(prompt, env, st.textOrder);
  } catch (e) {
    console.error("text providers failed (retry compact):", e?.message || e);
    try {
      const compactBlock = buildMarketBlock(candles, 40);
      const compactPrompt = await buildTextPromptForSymbol(symbol, userPrompt, st, compactBlock, env, newsBlock);
      draft = await runTextProviders(compactPrompt, env, st.textOrder);
    } catch (e2) {
      console.error("text providers failed (fallback local):", e2?.message || e2);
      draft = buildLocalFallbackAnalysis(symbol, st, candles, e2?.message || "text_provider_timeout");
    }
  }
  let polished = draft;
  try {
    polished = await runPolishProviders(draft, env, st.polishOrder);
  } catch (e) {
    console.error("polish flow failed:", e?.message || e);
    polished = draft;
  }
  const clean = stripHiddenModelOutput(polished || draft);
  if (useCache && clean) await setAnalysisCache(env, cacheKey, clean);
  return clean;
}


async function handleVisionFlow(env, chatId, from, userId, st, fileId) {
  if (env.BOT_KV && !canAnalyzeToday(st, from, env)) {
    await tgSendMessage(env, chatId, `⛔️ سهمیه امروزت تموم شده (${dailyLimit(env, st)} تحلیل در روز).`, mainMenuKeyboard(env));
    return;
  }

  await tgSendMessage(env, chatId, "🖼️ عکس دریافت شد… در حال تحلیل 🔍", kb([[BTN.HOME]]));

  const t = stopToken();
  const typingTask = typingLoop(env, chatId, t);

  try {
    const filePath = await tgGetFilePath(env, fileId);
    if (!filePath) throw new Error("no_file_path");
    const imageUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;

    const vPrompt = await buildVisionPrompt(st, env);
    const visionRaw = await runVisionProviders(imageUrl, vPrompt, env, st.visionOrder);

    const tf = st.timeframe || "H4";
    const baseRaw = await getAnalysisPrompt(env);
    const base = baseRaw .split("{TIMEFRAME}").join(tf);

    const finalPrompt =
      `${base}\n\n` +
      `ورودی ویژن (مشاهدات تصویر):\n${visionRaw}\n\n` +
      `وظیفه: بر اساس همین مشاهده‌ها خروجی دقیق ۱ تا ۵ بده. سطح‌ها را مشخص کن.\n` +
      `قوانین: فقط فارسی، لحن افشاگر، خیال‌بافی نکن.\n` ;

    const draft = await runTextProviders(finalPrompt, env, st.textOrder);
    const polished = await runPolishProviders(draft, env, st.polishOrder);

    if (String(env.RENDER_ZONES || "") === "1") {
      const svg = buildZonesSvgFromAnalysis(polished, "CHART", tf);
      await tgSendSvgDocument(env, chatId, svg, "zones.svg", `🖼️ نقشه زون‌ها (${tf})`);
    }

    t.stop = true;
    await Promise.race([typingTask, sleep(10)]).catch(() => {});

    for (const part of chunkText(polished, 3500)) {
      await tgSendMessage(env, chatId, part, mainMenuKeyboard(env));
    }
    if (env.BOT_KV) {
      consumeDaily(st, from, env);
      recordAnalysisSuccess(st);
      await saveUser(userId, st, env);
    }
  } catch (e) {
    console.error("handleVisionFlow error:", e);
    t.stop = true;
    await tgSendMessage(env, chatId, "⚠️ فعلاً امکان تحلیل تصویر نیست. لطفاً بعداً دوباره تلاش کن.", mainMenuKeyboard(env));
  }
}

/* ========================== ZONES RENDER (SVG) ========================== */


async function renderQuickChartPng(env, candles, symbol, tf, levels = [], qcSpec = null) {
  const chartUrl = buildQuickChartCandlestickUrl(candles, symbol, tf, levels, qcSpec);
  const r = await fetch(chartUrl, { cf: { cacheTtl: 60, cacheEverything: true } });
  if (!r.ok) throw new Error(`quickchart_fetch_failed_${r.status}`);
  return await r.arrayBuffer();
}

function buildLevelsOnlySvg(symbol, timeframe, levels = []) {
  const clean = (Array.isArray(levels) ? levels : []).filter((x) => Number.isFinite(Number(x))).map(Number).slice(0, 8);
  const rows = clean.length ? clean : [0, 1, 2];
  const width = 1200;
  const height = 700;
  const pad = 70;
  const innerH = height - pad * 2;
  const sorted = [...rows].sort((a, b) => b - a);
  const max = Math.max(...sorted, 1);
  const min = Math.min(...sorted, 0);
  const den = Math.max(1e-9, max - min);
  const yFor = (p) => pad + ((max - p) / den) * innerH;
  const lines = sorted.map((p, i) => {
    const y = yFor(p);
    const c = i % 2 === 0 ? "#2FE3A5" : "#FFB020";
    return `<line x1="${pad}" y1="${y}" x2="${width-pad}" y2="${y}" stroke="${c}" stroke-width="2" stroke-dasharray="6 6"/><text x="${width-pad-8}" y="${y-6}" fill="${c}" font-size="22" text-anchor="end">${p}</text>`;
  }).join(String.fromCharCode(10));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#0B0F17"/>
  <text x="${pad}" y="42" fill="#E6F0FF" font-size="30" font-family="Arial">${escapeXml(symbol)} - ${escapeXml(timeframe)} (Internal Fallback)</text>
  <rect x="${pad}" y="${pad}" width="${width-pad*2}" height="${innerH}" rx="14" fill="#101827" stroke="#223047"/>
  ${lines}
</svg>`;
}

function extractLevels(text) {
  const src = String(text || "");
  const lines = src.split(/\r?\n/);
  const weighted = [];
  const plain = [];

  const scoreLine = (ln) => {
    const l = ln.toLowerCase();
    let score = 0;
    if (/زون|zone|support|resistance|sr|flip|entry|tp|sl|target/.test(l)) score += 4;
    if (/\d/.test(l)) score += 1;
    return score;
  };

  for (const ln of lines) {
    const nums = (ln.match(/\b\d{1,6}(?:\.\d{1,8})?\b/g) || [])
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!nums.length) continue;
    const sc = scoreLine(ln);
    for (const n of nums) {
      if (sc >= 4) weighted.push(n);
      else plain.push(n);
    }
  }

  const all = [...weighted, ...plain]
    .filter((n) => Number.isFinite(n))
    .filter((n) => n >= 0.00001 && n <= 1_000_000)
    .sort((a, b) => a - b);

  const dedup = [];
  for (const n of all) {
    const prev = dedup[dedup.length - 1];
    if (prev == null || Math.abs(prev - n) > Math.max(1e-6, Math.abs(prev) * 0.0005)) {
      dedup.push(Number(n.toFixed(6)));
    }
  }
  return dedup.slice(0, 8);
}

function extractQcJsonAndStrip(text) {
  const src = String(text || "");
  const re = /<QCJSON>\s*([\s\S]*?)\s*<\/QCJSON>/i;
  const m = src.match(re);
  if (!m) return { cleaned: src.trim(), qc: null };

  const raw = String(m[1] || "").trim();
  let qc = null;
  try {
    qc = JSON.parse(raw);
  } catch {
    qc = null;
  }

  const cleaned = src.replace(re, "").replace(/\n{3,}/g, "\n\n").trim();
  return { cleaned, qc };
}

function normalizeQcSpec(qc, levelsFallback = []) {
  const out = { zones: [], supports: [], resistances: [], tp: [], sl: 0 };
  if (!qc || typeof qc !== "object") {
    return { ...out, supports: levelsFallback, resistances: [], tp: [], sl: 0 };
  }
  const numArr = (a) => (Array.isArray(a) ? a.map(Number).filter((n) => Number.isFinite(n) && n > 0) : []);
  out.supports = numArr(qc.supports || qc.support || qc.s);
  out.resistances = numArr(qc.resistances || qc.resistance || qc.r);
  out.tp = numArr(qc.tp || qc.targets || qc.takeProfit);
  out.sl = Number(qc.sl || qc.stopLoss || 0);
  if (!Number.isFinite(out.sl)) out.sl = 0;

  const zones = Array.isArray(qc.zones) ? qc.zones : [];
  out.zones = zones.map((z) => ({
    low: Number(z?.low),
    high: Number(z?.high),
    label: String(z?.label || "").slice(0, 24),
    kind: String(z?.kind || z?.type || "").toLowerCase(),
  })).filter((z) => Number.isFinite(z.low) && Number.isFinite(z.high) && z.low > 0 && z.high > 0 && z.high !== z.low)
    .map((z) => ({ ...z, low: Math.min(z.low, z.high), high: Math.max(z.low, z.high) }))
    .slice(0, 6);

  // fallback: if no supports/resistances provided, use extracted levels
  const fallback = numArr(levelsFallback);
  if (!out.supports.length && !out.resistances.length) out.supports = fallback.slice(0, 6);
  return out;
}


function extractLevelsFromCandles(candles) {
  if (!Array.isArray(candles) || !candles.length) return [];
  const tail = candles.slice(-60);
  const highs = tail.map((x) => Number(x?.h)).filter((n) => Number.isFinite(n));
  const lows = tail.map((x) => Number(x?.l)).filter((n) => Number.isFinite(n));
  if (!highs.length || !lows.length) return [];
  const hi = Math.max(...highs);
  const lo = Math.min(...lows);
  const mid = (hi + lo) / 2;
  const q1 = lo + (hi - lo) * 0.25;
  const q3 = lo + (hi - lo) * 0.75;
  return [lo, q1, mid, q3, hi].map((n) => Number(n.toFixed(6)));
}

function buildZonesSvgFromAnalysis(analysisText, symbol, timeframe) {
  const levels = extractLevels(analysisText);
  const W = 900, H = 520;
  const pad = 60;

  const bg = `
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0B0F17"/>
        <stop offset="100%" stop-color="#090D14"/>
      </linearGradient>
      <linearGradient id="a" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#6D5EF6" stop-opacity="0.65"/>
        <stop offset="100%" stop-color="#00D1FF" stop-opacity="0.35"/>
      </linearGradient>
      <style>
        .t{ font: 700 20px ui-sans-serif,system-ui; fill:#ffffff; }
        .s{ font: 500 14px ui-sans-serif,system-ui; fill:rgba(255,255,255,.75); }
        .l{ stroke: rgba(255,255,255,.20); stroke-width: 2; }
        .z{ fill:url(#a); opacity:0.18; }
        .p{ font: 700 14px ui-monospace,monospace; fill: rgba(255,255,255,.92); }
      </style>
    </defs>
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#g)"/>
    <rect x="${pad}" y="${pad}" width="${W-2*pad}" height="${H-2*pad}" rx="24" fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.10)"/>
  `;

  const header = `
    <text class="t" x="${pad}" y="${pad-18}">MarketiQ • Zones</text>
    <text class="s" x="${pad}" y="${pad-0}">${escapeXml(symbol)} — ${escapeXml(timeframe)} — (auto)</text>
  `;

  const plotX = pad + 30;
  const plotY = pad + 30;
  const plotW = W - 2*pad - 60;
  const plotH = H - 2*pad - 80;

  let lines = "";
  if (levels.length >= 2) {
    const min = levels[0], max = levels[levels.length-1];
    const toY = (v) => plotY + plotH - ((v - min) / (max - min || 1)) * plotH;

    for (let i = 0; i < Math.min(levels.length-1, 4); i++) {
      const y1 = toY(levels[i+1]);
      const y2 = toY(levels[i]);
      lines += `<rect class="z" x="${plotX}" y="${Math.min(y1,y2)}" width="${plotW}" height="${Math.abs(y2-y1)}" rx="14"/>`;
      lines += `<line class="l" x1="${plotX}" y1="${y1}" x2="${plotX+plotW}" y2="${y1}"/>`;
      lines += `<text class="p" x="${plotX+plotW+10}" y="${y1+5}">${levels[i+1]}</text>`;
    }
    const y0 = toY(levels[0]);
    lines += `<line class="l" x1="${plotX}" y1="${y0}" x2="${plotX+plotW}" y2="${y0}"/>`;
    lines += `<text class="p" x="${plotX+plotW+10}" y="${y0+5}">${levels[0]}</text>`;
  } else {
    lines += `<text class="s" x="${plotX}" y="${plotY+30}">Level یافت نشد. برای رندر بهتر، خروجی مدل باید شامل چند عدد سطح باشد.</text>`;
  }

  const footer = `
    <text class="s" x="${pad}" y="${H-18}">Generated by MarketiQ (SVG) — Educational use only</text>
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bg}${header}${lines}${footer}</svg>`;
}

function escapeXml(s) {
  return String(s || "")
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;")
    .split("'").join("&apos;");
}
function escapeHtml(s) {
  return String(s || "")
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;");
}

/* ========================== MINI APP INLINE ASSETS ========================== */
function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, no-cache, max-age=0, must-revalidate", "pragma":"no-cache", "expires":"0" } });
}
function jsResponse(js, status = 200) {
  return new Response(js, { status, headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store, no-cache, max-age=0, must-revalidate", "pragma":"no-cache", "expires":"0" } });
}
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function pathEndsWith(pathname, suffix) {
  const p = String(pathname || "");
  const s = String(suffix || "");
  return p === s || p.endsWith(s);
}
function pathIncludes(pathname, needle) {
  const p = String(pathname || "");
  const n = String(needle || "");
  return !!n && p.includes(n);
}


function miniappGuestEnabled(env) {
  const v = String(env.MINIAPP_GUEST_READONLY || "1").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no");
}


async function fetchBinanceSymbolList(env) {
  const cacheKey = "binance_exchangeInfo_symbols_v1";
  const cached = apiRespCacheGet(cacheKey);
  if (cached) return cached;

  const timeoutMs = Number(env.BINANCE_INFO_TIMEOUT_MS || 9000);
  const urls = [
    "https://api.binance.com/api/v3/exchangeInfo",
    "https://data-api.binance.vision/api/v3/exchangeInfo",
    "https://api.binance.us/api/v3/exchangeInfo",
  ];

  let lastErr = null;
  for (const url of urls) {
    try {
      const r = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" } }, timeoutMs);
      if (!r.ok) throw new Error("binance_exinfo_http_" + r.status);
      const j = await r.json().catch(() => null);
      const arr = (j && Array.isArray(j.symbols)) ? j.symbols : [];
      const list = arr
        .filter(x => x && (x.status === "TRADING" || x.status === "BREAK"))
        .filter(x => (x.isSpotTradingAllowed !== false))
        .filter(x => (Array.isArray(x.permissions) ? x.permissions.includes("SPOT") : true))
        .map(x => String(x.symbol || "").toUpperCase())
        .filter(Boolean);

      apiRespCacheSet(cacheKey, list, Number(env.BINANCE_SYMBOLS_CACHE_MS || (6 * 60 * 60 * 1000)));
      return list;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("binance_exinfo_failed");
}

async function getMiniappSymbolUniverse(env) {
  const cacheKey = "miniapp_symbols_all_v2";
  const cached = apiRespCacheGet(cacheKey);
  if (cached) return cached;

  let binance = [];
  try { binance = await fetchBinanceSymbolList(env); } catch { binance = []; }

  const base = [...MAJORS, ...METALS, ...INDICES, ...(EXTRA_INDICES || []), ...CRYPTOS];
  const set = new Set();
  for (const s of base.concat(binance)) {
    const v = normalizeSymbol(s);
    if (v) set.add(v);
  }

  const out = Array.from(set);
  out.sort();
  apiRespCacheSet(cacheKey, out, Number(env.SYMBOLS_CACHE_MS || (6 * 60 * 60 * 1000)));
  return out;
}

async function buildMiniappGuestPayload(env) {
  const st = defaultUser("guest");
  const symbols = await getMiniappSymbolUniverse(env);
  const styles = await getStyleList(env);
  return {
    ok: true,
    guest: true,
    welcome: await getMiniappWelcomeText(env),
    state: st,
    quota: "guest",
    symbols,
    styles,
    offerBanner: await getOfferBanner(env),
    customPrompts: await getCustomPrompts(env),
    role: "user",
    isStaff: false,
    wallet: "",
  };
}

async function issueMiniappToken(env, userId, fromLike = {}) {
  if (!env.BOT_KV) return "";
  const raw = crypto.getRandomValues(new Uint8Array(24));
  const token = Array.from(raw).map((b) => b.toString(16).padStart(2, "0")).join("");
  const payload = {
    userId: String(userId || ""),
    username: String(fromLike?.username || ""),
    createdAt: Date.now(),
  };
  await env.BOT_KV.put(`miniapp_token:${token}`, JSON.stringify(payload), { expirationTtl: Math.max(300, Number(env.MINIAPP_TOKEN_TTL_SEC || 86400)) });
  return token;
}

async function verifyMiniappToken(token, env) {
  if (!env.BOT_KV || !token) return { ok: false, reason: "token_missing" };
  const raw = await env.BOT_KV.get(`miniapp_token:${String(token).trim()}`);
  if (!raw) return { ok: false, reason: "token_invalid" };
  try {
    const j = JSON.parse(raw);
    const userId = String(j?.userId || "").trim();
    if (!userId) return { ok: false, reason: "token_user_missing" };
    return { ok: true, userId, fromLike: { username: String(j?.username || "") }, via: "mini_token" };
  } catch {
    return { ok: false, reason: "token_bad_json" };
  }
}

async function verifyMiniappAuth(body, env) {
  // 1) Web access tokens (برای باز شدن پنل ادمین/اونر در مرورگر)
  const webToken = String(body?.webToken || "").trim();
  if (webToken) {
    const ownerTok = String(env.WEB_OWNER_TOKEN || "").trim();
    const adminTok = String(env.WEB_ADMIN_TOKEN || "").trim();
    if (ownerTok && timingSafeEqual(webToken, ownerTok)) {
      const username = firstHandleFromCsv(env.OWNER_HANDLES) || "owner";
      return { ok: true, userId: 999000001, fromLike: { username } };
    }
    if (adminTok && timingSafeEqual(webToken, adminTok)) {
      const username = firstHandleFromCsv(env.ADMIN_HANDLES) || firstHandleFromCsv(env.OWNER_HANDLES) || "admin";
      return { ok: true, userId: 999000002, fromLike: { username } };
    }
  }

  // 2) Standard Telegram MiniApp auth (initData)
  const initData = body?.initData;
  const v = await verifyTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN, env.INITDATA_MAX_AGE_SEC, env.MINIAPP_AUTH_LENIENT);
  if (v.ok) return v;

  // 3) MiniToken fallback (issued by bot)
  const token = String(body?.miniToken || "").trim();
  if (!token) return v;
  const tv = await verifyMiniappToken(token, env);
  if (tv.ok) return tv;
  return v;
}


/* ========================== TELEGRAM MINI APP initData verification ========================== */
async function verifyTelegramInitData(initData, botToken, maxAgeSecRaw, lenientRaw) {
  if (!initData || typeof initData !== "string") return { ok: false, reason: "initData_missing" };
  const lenient = String(lenientRaw || "").trim() === "1" || String(lenientRaw || "").toLowerCase() === "true";
  const initRaw = String(initData || "").trim();
  if (lenient && initRaw.startsWith("dev:")) {
    const devId = Number(initRaw.split(":")[1] || "0") || 999001;
    return { ok: true, userId: devId, fromLike: { username: "dev_user" } };
  }
  if (!botToken && !lenient) return { ok: false, reason: "bot_token_missing" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash && !lenient) return { ok: false, reason: "hash_missing" };
  params.delete("hash");

  const authDate = Number(params.get("auth_date") || "0");
  if ((!Number.isFinite(authDate) || authDate <= 0) && !lenient) return { ok: false, reason: "auth_date_invalid" };
  const now = Math.floor(Date.now() / 1000);
  const maxAgeSec = Math.max(60, Number(maxAgeSecRaw || 0) || (7 * 24 * 60 * 60));
  if (Number.isFinite(authDate) && authDate > 0 && (now - authDate > maxAgeSec) && !lenient) return { ok: false, reason: "initData_expired" };

  const pairs = [];
  params.forEach((v, k) => pairs.push([k, v]));
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join(String.fromCharCode(10));

  const secretKey = await hmacSha256Raw(utf8("WebAppData"), utf8(botToken));
  const sigHex = await hmacSha256Hex(secretKey, utf8(dataCheckString));

  if (hash && !timingSafeEqualHex(sigHex, hash) && !lenient) return { ok: false, reason: "hash_mismatch" };

  const user = safeJsonParse(params.get("user") || "") || {};
  const userId = user?.id || Number(params.get("user_id") || "0");
  if (!userId) return { ok: false, reason: "user_missing" };

  const fromLike = { username: user?.username || "", first_name: user?.first_name || "", last_name: user?.last_name || "", language_code: user?.language_code || "" };
  return { ok: true, userId, fromLike };
}

function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }
function utf8(s) { return new TextEncoder().encode(String(s)); }

async function hmacSha256Raw(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, msgBytes);
  return new Uint8Array(sig);
}
async function hmacSha256Hex(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, msgBytes);
  return toHex(new Uint8Array(sig));
}
function toHex(u8) { let out=""; for (const b of u8) out += b.toString(16).padStart(2,"0"); return out; }
function timingSafeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function timingSafeEqualHex(a, b) {
  a = String(a || "").toLowerCase();
  b = String(b || "").toLowerCase();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ========================== MINI APP UI (MODERN TRADING) ========================== */
const MINI_APP_HTML = String.raw`<!doctype html>
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
    .offer{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap: 12px;
      padding: 16px;
      border-radius: 20px;
      background: linear-gradient(135deg, rgba(109,94,246,.24), rgba(0,209,255,.12));
      border: 1px solid rgba(109,94,246,.35);
    }
    .offer h3{ margin:0; font-size: 15px; }
    .offer p{ margin:6px 0 0; font-size: 12px; color: var(--muted); }
    .offer-media{ margin-top:10px; border-radius:14px; overflow:hidden; border:1px solid rgba(255,255,255,.12); display:none; }
    .offer-media.show{ display:block; }
    .offer-media img{ display:block; width:100%; max-height:160px; object-fit:cover; }
    .offer .tag{
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 12px;
      border: 1px solid rgba(255,255,255,.14);
      background: rgba(255,255,255,.08);
    }
    .offer .offer-media{ width:72px; height:72px; border-radius:14px; object-fit:cover; border:1px solid rgba(255,255,255,.2); display:none; }
    .tabs{ display:flex; gap:8px; overflow:auto; margin: 10px 0 14px; }
    .tab-btn{ border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.04); color:var(--muted); border-radius:999px; padding:8px 12px; font-size:12px; cursor:pointer; white-space:nowrap; }
    .tab-btn.active{ background: linear-gradient(135deg, rgba(109,94,246,.85), rgba(0,209,255,.35)); color:#fff; border-color: rgba(109,94,246,.7); }
    .tab-section{ display:none; }
    .tab-section.active{ display:block; }
    .admin-card{ display:none; }
    .admin-card.show{ display:block; }
    .owner-hide.hidden{ display:none; }
    .admin-grid{ display:grid; gap: 10px; }
    .admin-tab.hidden{ display:none !important; }
    .admin-row{ display:flex; gap:8px; flex-wrap:wrap; }
    .admin-row .control{ flex:1; min-width: 140px; }
    .toggle{ display:flex; align-items:center; gap:8px; padding: 8px 10px; border: 1px solid rgba(255,255,255,.12); border-radius: 12px; }
    .toggle input{ width:18px; height:18px; }
    textarea.control{ min-height: 120px; resize: vertical; }
    .mini-list{ font-size: 12px; color: var(--muted); white-space: pre-wrap; }
    .quote-grid{ display:grid; grid-template-columns: repeat(auto-fit,minmax(160px,1fr)); gap:10px; }
    .quote-item{ border:1px solid rgba(255,255,255,.12); border-radius:14px; padding:10px; background:rgba(255,255,255,.04); }
    .quote-item .k{ font-size:11px; color:var(--muted); }
    .quote-item .v{ font-size:16px; font-weight:800; margin-top:4px; }
    .q-up{ color: var(--good); }
    .q-down{ color: var(--bad); }
    .q-flat{ color: var(--warn); }
    .tabs{ display:flex; gap:8px; overflow:auto; padding-bottom:4px; margin-bottom:10px; }
    .tab-btn{ border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.06); color:var(--text); border-radius:999px; padding:8px 12px; font-size:12px; cursor:pointer; white-space:nowrap; }
    .tab-btn.active{ background:linear-gradient(135deg,var(--primary),var(--accent)); border-color:transparent; color:#fff; }
    .tab-panel{ display:none; }
    .tab-panel.active{ display:block; }
    .energy{ display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:12px; color:var(--muted); margin-top:8px; }
    .energy-bar{ height:8px; width:100%; border-radius:999px; background:rgba(255,255,255,.08); overflow:hidden; }
    .energy-fill{ height:100%; width:0%; background:linear-gradient(90deg,var(--accent),var(--primary)); transition:width .25s ease; }
    .offer-media{ margin-top:10px; border-radius:16px; overflow:hidden; border:1px solid rgba(255,255,255,.12); display:none; }
    .offer-media.show{ display:block; }
    .offer-media img{ width:100%; display:block; }
  </style>
</head>
<body>
  <div class="shell">
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

    <div class="tabs" id="mainTabs">
      <button class="tab-btn active" data-tab="dashboard">داشبورد</button>
      <button class="tab-btn" data-tab="analysis">تحلیل</button>
      <button class="tab-btn" data-tab="news">اخبار</button>
      <button class="tab-btn" data-tab="admin">پنل مدیریت</button>
      <button class="tab-btn" data-tab="owner">پنل اونر</button>
    </div>

    <div class="grid">
      <div class="card tab-section active" data-tab-section="dashboard">
        <div class="card-b offer" id="offerCard">
          <div>
            <h3>🎁 پیشنهاد ویژه</h3>
            <p id="offerText">فعال‌سازی اشتراک ویژه با تخفیف محدود.</p>
            <div class="offer-media" id="offerMedia"><img id="offerImg" alt="offer" /></div>
          </div>
          <img id="offerImage" class="offer-media" alt="offer" />
          <div class="tag" id="offerTag">Special</div>
          <div class="offer-media" id="offerMedia"><img id="offerImg" alt="offer" /></div>
        </div>
      </div>
      <div class="card tab-section active" id="quoteCard" data-tab-section="dashboard">
        <div class="card-h">
          <strong>داشبورد قیمت لحظه‌ای</strong>
          <span id="quoteStamp">—</span>
        </div>
        <div class="card-b">
          <div class="quote-grid">
            <div class="quote-item"><div class="k">نماد</div><div class="v" id="quoteSymbol">—</div></div>
            <div class="quote-item"><div class="k">قیمت</div><div class="v" id="quotePrice">—</div></div>
            <div class="quote-item"><div class="k">تغییر</div><div class="v" id="quoteChange">—</div></div>
            <div class="quote-item"><div class="k">روند</div><div class="v" id="quoteTrend">—</div></div>
          </div>
          <div class="muted" style="font-size:12px; margin-top:8px;" id="quoteMeta">در حال دریافت داده…</div>
        </div>
      </div>

      <div class="card tab-section" id="newsCard" data-tab-section="news">
        <div class="card-h">
          <strong>📰 اخبار فارسی نماد</strong>
          <button id="refreshNews" class="btn ghost" style="min-width:unset; padding:6px 10px;">بروزرسانی</button>
        </div>
        <div class="card-b">
          <div class="mini-list" id="newsList">در حال دریافت خبر…</div>
          <div class="muted" style="margin-top:10px; font-size:12px;">تحلیل خبری:</div>
          <div class="mini-list" id="newsAnalysis">در حال تولید تحلیل خبری…</div>
        </div>
      </div>
      <div class="card tab-section" id="analysisCard" data-tab-section="analysis">
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
              <select id="style" class="control"></select>
            </div>
            <div class="field">
              <div class="label">پرامپت اختصاصی</div>
              <select id="customPrompt" class="control"></select>
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
            <div class="field">
              <div class="label">حالت پرامپت</div>
              <select id="promptMode" class="control">
                <option value="style_plus_custom" selected>سبک + اختصاصی</option>
                <option value="style_only">فقط سبک</option>
                <option value="custom_only">فقط اختصاصی</option>
                <option value="combined_all">ترکیب همه سبک‌ها</option>
              </select>
            </div>
          </div>

          <div style="height:12px"></div>

          <div class="actions">
            <button id="save" class="btn">💾 ذخیره</button>
            <button id="analyze" class="btn primary">⚡ تحلیل</button>
            <button id="reconnect" class="btn ghost">🔄 اتصال مجدد</button>
            <button id="close" class="btn ghost">✖ بستن</button>
          </div>

          <div style="height:10px"></div>
          <div class="muted" style="font-size:12px; line-height:1.6;" id="welcome"></div>
          <div class="energy">
            <span id="energyText">انرژی: —</span>
            <span id="remainingText">تحلیل باقی‌مانده: —</span>
          </div>
          <div class="energy-bar"><div class="energy-fill" id="energyFill"></div></div>
        </div>

        <div class="out" id="out">آماده…</div>

        <div class="card" id="chartCard" style="display:none; margin-top:12px;">
          <div class="card-h">
            <strong>چارت</strong>
            <span class="muted" id="chartMeta">QuickChart</span>
          </div>
          <div class="card-b">
            <img id="chartImg" alt="chart" style="width:100%; border-radius:16px; display:block;" />
          </div>
        </div>
      </div>

      <div class="card tab-panel" id="supportCard" data-panel="support">
        <div class="card-h">
          <strong>پشتیبانی</strong>
          <span>ارسال تیکت</span>
        </div>
        <div class="card-b">
          <div class="chips" id="adminTabs">
            <button type="button" class="chip on" data-tab="overview">مرور</button>
            <button type="button" class="chip" data-tab="content">محتوا</button>
            <button type="button" class="chip" data-tab="operations">عملیات</button>
            <button type="button" class="chip" data-tab="support">پشتیبانی</button>
            <button type="button" class="chip" data-tab="reports">گزارش</button>
          </div>
          <div class="field admin-tab" data-tab="overview">
            <div class="label">متن تیکت</div>
            <textarea id="supportTicketText" class="control" placeholder="مشکل یا درخواست خود را بنویسید..." maxlength="300"></textarea>
          </div>
          <div class="actions">
            <button id="sendSupportTicket" class="btn">✉️ ارسال تیکت</button>
          </div>
          <div class="muted" style="font-size:12px; line-height:1.6;">پاسخ از طریق پشتیبانی تلگرام ارسال می‌شود.</div>
        </div>
      </div>

      <div class="card admin-card tab-section" id="adminCard" data-tab-section="admin">
        <div class="card-h">
          <strong id="adminTitle">پنل ادمین</strong>
          <span>مدیریت پرامپت، سبک‌ها، پرداخت، برداشت و تیکت‌ها</span>
        </div>
        <div class="card-b admin-grid">
          <div class="field">
            <div class="label">پرامپت اصلی تحلیل</div>
            <textarea id="adminPrompt" class="control" placeholder="پرامپت اصلی تحلیل..."></textarea>
            <div class="actions">
              <button id="savePrompt" class="btn primary">ذخیره پرامپت</button>
            </div>
          </div>

          <div class="field">
            <div class="label">پرامپت سبک‌ها (JSON)</div>
            <textarea id="stylePromptJson" class="control" placeholder='{"پرایس_اکشن":"...","ict":"...","atr":"..."}'></textarea>
            <div class="actions">
              <button id="saveStylePrompts" class="btn">ذخیره JSON سبک‌ها</button>
            </div>
          </div>

          <div class="field">
            <div class="label">مدیریت سبک‌ها</div>
            <div class="admin-row">
              <input id="newStyle" class="control" placeholder="سبک جدید" />
              <button id="addStyle" class="btn">افزودن سبک</button>
            </div>
            <div class="admin-row">
              <input id="removeStyleName" class="control" placeholder="نام سبک برای حذف" />
              <button id="removeStyle" class="btn ghost">حذف سبک</button>
            </div>
            <div class="mini-list" id="styleList">—</div>
          </div>

          <div class="field">
            <div class="label">کمیسیون دعوت</div>
            <div class="admin-row">
              <input id="globalCommission" class="control" placeholder="درصد کمیسیون کلی (مثلاً 5)" />
              <button id="saveGlobalCommission" class="btn">ذخیره کلی</button>
            </div>
            <div class="admin-row">
              <input id="commissionUser" class="control" placeholder="یوزرنیم خاص (@user)" />
              <input id="commissionPercent" class="control" placeholder="درصد برای کاربر خاص" />
              <button id="saveUserCommission" class="btn">ذخیره کاربر</button>
            </div>
            <div class="mini-list" id="commissionList">—</div>
          </div>

          <div class="field">
            <div class="label">سهمیه رایگان روزانه</div>
            <div class="admin-row">
              <input id="freeDailyLimit" class="control" placeholder="مثلاً 3" />
              <button id="saveFreeLimit" class="btn">ذخیره سهمیه</button>
            </div>
          </div>

          <div class="field">
            <div class="label">امتیاز پایه کاربران</div>
            <div class="admin-row">
              <input id="basePoints" class="control" placeholder="مثلاً 100" />
              <button id="saveBasePoints" class="btn">ذخیره امتیاز پایه</button>
            </div>
          </div>

          <div class="field">
            <div class="label">پرامپت‌های اختصاصی (JSON)</div>
            <textarea id="customPromptsJson" class="control" placeholder='[{"id":"p1","title":"VIP","text":"..."}]'></textarea>
            <div class="admin-row">
              <input id="customPromptsJsonFile" type="file" accept="application/json,.json" class="control" />
            </div>
            <div class="actions">
              <button id="saveCustomPrompts" class="btn">ذخیره پرامپت‌های اختصاصی</button>
            </div>
            <div class="admin-row">
              <input id="customPromptUser" class="control" placeholder="یوزرنیم کاربر" />
              <input id="customPromptId" class="control" placeholder="شناسه پرامپت" />
              <button id="sendCustomPrompt" class="btn ghost">ارسال به کاربر</button>
            </div>
          </div>

          <div class="field">
            <div class="label">تأیید پرداخت و فعال‌سازی اشتراک</div>
            <div class="admin-row">
              <input id="payUsername" class="control" placeholder="یوزرنیم خریدار" />
              <input id="payAmount" class="control" placeholder="مبلغ" />
              <input id="payDays" class="control" placeholder="روزهای اشتراک" />
              <input id="payDailyLimit" class="control" placeholder="سهمیه روزانه اشتراک" />
            </div>
            <div class="admin-row">
              <input id="payTx" class="control" placeholder="هش تراکنش" />
              <button id="approvePayment" class="btn primary">تأیید و فعال‌سازی</button>
              <button id="checkPayment" class="btn ghost">چک بلاک‌چین</button>
              <button id="activateSubscription" class="btn">فعال‌سازی دستی</button>
            </div>
            <div class="muted" style="font-size:12px; line-height:1.8;">برای استفاده ساده: فقط یوزرنیم + مبلغ + یکی از پلن‌ها را انتخاب کنید. TxHash اختیاری است.</div>
            <div class="chips" id="paymentPresets">
              <button type="button" class="chip" data-days="7" data-amount="9">پلن شروع ۷ روزه</button>
              <button type="button" class="chip" data-days="30" data-amount="19">پلن ماهانه</button>
              <button type="button" class="chip" data-days="90" data-amount="49">پلن حرفه‌ای ۹۰ روزه</button>
            </div>
            <div class="mini-list" id="paymentList">—</div>
          </div>

          
          <div class="field admin-tab" data-tab="content">
            <div class="label">بنر پیشنهاد (نمایش داخل مینی‌اپ)</div>
            <textarea id="offerBannerInput" class="control" placeholder="متن بنر پیشنهاد..."></textarea>
            <input id="offerImageFile" type="file" accept="image/*" class="control" />
            <div class="muted" style="font-size:12px;">برای حذف تصویر، فایل را خالی بگذار و ذخیره کن.</div>
            <div class="actions">
              <button id="saveOfferBanner" class="btn">ذخیره بنر</button>
            </div>
            <div class="admin-row">
              <input id="offerBannerImageUrlInput" class="control" placeholder="یا لینک تصویر بنر..." />
              <button id="clearOfferImage" class="btn ghost">حذف تصویر</button>
            </div>
          </div>

          <div class="field admin-tab" data-tab="content">
            <div class="label">متن خوش‌آمدگویی (قابل تنظیم از پنل)</div>
            <textarea id="welcomeBotInput" class="control" placeholder="متن خوش‌آمدگویی بات..."></textarea>
            <textarea id="welcomeMiniappInput" class="control" placeholder="متن خوش‌آمدگویی مینی‌اپ..."></textarea>
            <div class="actions">
              <button id="saveWelcomeTexts" class="btn">ذخیره متن خوش‌آمدگویی</button>
            </div>
          </div>

          <div class="field owner-hide admin-tab" data-tab="operations" id="featureFlagsBlock">
            <div class="label">ویژگی‌ها (فقط اونر)</div>
            <div class="admin-row">
              <label class="toggle">
                <input type="checkbox" id="flagCapitalMode" />
                <span>حالت سرمایه (Capital Mode)</span>
              </label>
              <label class="toggle">
                <input type="checkbox" id="flagProfileTips" />
                <span>نوتیف پیشنهاد روزانه</span>
              </label>
              <button id="saveFeatureFlags" class="btn">ذخیره</button>
            </div>
            <div class="muted" style="font-size:12px; line-height:1.6;">این تنظیمات روی همه کاربران اثر دارد.</div>
          </div>

          <div class="field owner-hide admin-tab" data-tab="operations" id="walletSettingsBlock">
            <div class="label">تنظیم آدرس ولت (فقط اونر)</div>
            <textarea id="walletAddressInput" class="control" placeholder="آدرس ولت جهت پرداخت (مثلاً TRC20)..."></textarea>
            <div class="actions">
              <button id="saveWallet" class="btn">ذخیره آدرس</button>
            </div>
          </div>

          <div class="field admin-tab" data-tab="support">
            <div class="label">مدیریت تیکت‌ها</div>
            <div class="actions">
              <button id="refreshTickets" class="btn">بروزرسانی</button>
              <button id="ticketQuickPending" class="btn ghost">فقط pending</button>
              <button id="ticketQuickAnswered" class="btn ghost">فقط answered</button>
            </div>
            <select id="ticketSelect" class="control"></select>
            <select id="ticketReplyTemplate" class="control">
              <option value="">تمپلیت پاسخ…</option>
              <option value="درخواست شما ثبت شد و در حال بررسی تیم پشتیبانی است. نتیجه به‌زودی ارسال می‌شود.">در حال بررسی</option>
              <option value="مشکل اتصال مینی‌اپ برطرف شد. لطفاً یک‌بار اپ را ببندید و دوباره باز کنید.">حل مشکل اتصال</option>
              <option value="برای این مورد به اطلاعات بیشتری نیاز داریم. لطفاً اسکرین‌شات و زمان دقیق خطا را ارسال کنید.">نیاز به اطلاعات بیشتر</option>
              <option value="درخواست شما انجام شد و تیکت بسته می‌شود. در صورت نیاز تیکت جدید ثبت کنید.">بستن با موفقیت</option>
            </select>
            <textarea id="ticketReply" class="control" placeholder="پاسخ به کاربر (اختیاری)"></textarea>
            <div class="admin-row">
              <select id="ticketStatus" class="control">
                <option value="pending">pending</option>
                <option value="answered">answered</option>
                <option value="closed">closed</option>
              </select>
              <button id="updateTicket" class="btn primary">ثبت وضعیت / ارسال پاسخ</button>
            </div>
            <div class="mini-list" id="ticketsList">—</div>
          </div>

          <div class="field admin-tab" data-tab="operations">
            <div class="label">مدیریت برداشت‌ها</div>
            <div class="actions">
              <button id="refreshWithdrawals" class="btn">بروزرسانی</button>
            </div>
            <select id="withdrawSelect" class="control"></select>
            <div class="admin-row">
              <select id="withdrawDecision" class="control">
                <option value="approved">approved</option>
                <option value="rejected">rejected</option>
              </select>
              <input id="withdrawTxHash" class="control" placeholder="TxHash (برای approved)" />
              <button id="reviewWithdrawalBtn" class="btn primary">ثبت</button>
            </div>
            <div class="mini-list" id="withdrawalsList">—</div>
          </div>

          <div class="field admin-tab" data-tab="operations">
            <div class="label">درخواست‌های پرامپت اختصاصی</div>
            <div class="actions">
              <button id="refreshPromptReqs" class="btn">بروزرسانی</button>
            </div>
            <select id="promptReqSelect" class="control"></select>
            <div class="admin-row">
              <input id="promptReqPromptId" class="control" placeholder="Prompt ID برای فعال‌سازی (در صورت approve)" />
              <select id="promptReqDecision" class="control">
                <option value="approved">approve</option>
                <option value="rejected">reject</option>
              </select>
              <button id="decidePromptReqBtn" class="btn primary">ثبت</button>
            </div>
            <div class="mini-list" id="promptReqList">—</div>
          </div>

          <div class="field admin-tab" data-tab="operations">
            <div class="label">فعال/غیرفعال کردن سرمایه برای کاربر</div>
            <div class="admin-row">
              <input id="capitalToggleUser" class="control" placeholder="یوزرنیم (@user)" />
              <select id="capitalToggleEnabled" class="control">
                <option value="true">enabled</option>
                <option value="false">disabled</option>
              </select>
              <button id="saveCapitalToggle" class="btn">ثبت</button>
            </div>
          </div>
<div class="field owner-hide admin-tab" data-tab="reports" id="reportBlock">
            <div class="label">گزارش کامل کاربران (فقط اونر)</div>
            <div class="actions">
              <button id="loadUsers" class="btn">دریافت گزارش</button>
              <button id="downloadReportPdf" class="btn primary">دانلود PDF</button>
            </div>
            <div class="mini-list" id="usersReport">—</div>
          </div>
        </div>
      </div>

      <div class="toast" id="toast">
        <div class="spin" id="spin" style="display:none"></div>
        <div style="min-width:0; flex:1;">
          <div class="t" id="toastT">—</div>
          <div class="s" id="toastS">—</div>
        </div>
        <div class="badge" id="toastB">—</div>
      </div>

      <script src="app.v20260215b.js"></script>
</body>
</html>`;

const MINI_APP_JS = String.raw`var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16;
const tg = (_a = window.Telegram) === null || _a === void 0 ? void 0 : _a.WebApp;
if (tg)
    tg.ready();
if (tg === null || tg === void 0 ? void 0 : tg.expand)
    tg.expand();
const out = document.getElementById("out");
const meta = document.getElementById("meta");
const sub = document.getElementById("sub");
const pillTxt = document.getElementById("pillTxt");
const welcome = document.getElementById("welcome");
const offerText = document.getElementById("offerText");
const offerTag = document.getElementById("offerTag");
const offerImage = document.getElementById("offerImage");
const adminCard = document.getElementById("adminCard");
const adminTitle = document.getElementById("adminTitle");
const reportBlock = document.getElementById("reportBlock");
const roleLabel = document.getElementById("roleLabel");
const energyToday = document.getElementById("energyToday");
const remainingAnalyses = document.getElementById("remainingAnalyses");
const remainingText = document.getElementById("remainingText");
const energyText = document.getElementById("energyText");
const energyFill = document.getElementById("energyFill");
const offerMedia = document.getElementById("offerMedia");
const offerImg = document.getElementById("offerImg");
function el(id) { return document.getElementById(id); }
function val(id) { return el(id).value; }
function setVal(id, v) { el(id).value = v; }
const toast = el("toast");
const toastT = el("toastT");
const toastS = el("toastS");
const toastB = el("toastB");
const spin = el("spin");
let ALL_SYMBOLS = [];
let INIT_DATA = "";
let MINI_TOKEN = "";
let IS_STAFF = false;
let IS_OWNER = false;
let IS_GUEST = false;
let OFFLINE_MODE = false;
const LOCAL_KEYS = {
    initData: "miniapp_init_data",
    miniToken: "miniapp_auth_token",
    userState: "miniapp_cached_user_state_v1",
    quoteCache: "miniapp_quote_cache_v1",
    newsCache: "miniapp_news_cache_v1",
    newsAnalysisCache: "miniapp_news_analysis_cache_v1",
    analyzeCache: "miniapp_analyze_cache_v1",
};
const ORIGIN = window.location.origin;
const ROOT_PREFIX = (() => {
    const p0 = window.location.pathname || "";
    const p = p0.endsWith("/") ? p0.slice(0, -1) : p0;
    const marker = "/miniapp";
    const i = p.indexOf(marker);
    if (i >= 0)
        return p.slice(0, i);
    return "";
})();
function apiUrl(path) {
    let p = String(path || "");
    if (!p.startsWith("/"))
        p = "/" + p;
    return ORIGIN + ROOT_PREFIX + p;
}
let ADMIN_TICKETS = [];
let ADMIN_TICKETS_ALL = [];
let ADMIN_WITHDRAWALS = [];
let ADMIN_PROMPT_REQS = [];
let QUOTE_TIMER = null;
let QUOTE_BUSY = false;
let NEWS_TIMER = null;
const CONNECTION_HINT = "\u0645\u06CC\u0646\u06CC\u200C\u0627\u067E \u0631\u0627 \u062F\u0627\u062E\u0644 \u062A\u0644\u06AF\u0631\u0627\u0645 \u0628\u0627\u0632 \u06A9\u0646\u06CC\u062F. \u062F\u0631 \u0635\u0648\u0631\u062A \u062E\u0637\u0627\u060C \u06CC\u06A9\u200C\u0628\u0627\u0631 \u0628\u0628\u0646\u062F\u06CC\u062F \u0648 \u062F\u0648\u0628\u0627\u0631\u0647 \u0627\u062C\u0631\u0627 \u06A9\u0646\u06CC\u062F.";
const MINIAPP_EXEC_CHECKLIST = [
    "1) \u0645\u06CC\u0646\u06CC\u200C\u0627\u067E \u0631\u0627 \u0641\u0642\u0637 \u0627\u0632 \u062F\u0627\u062E\u0644 \u062A\u0644\u06AF\u0631\u0627\u0645 \u0628\u0627\u0632 \u06A9\u0646\u06CC\u062F.",
    "2) \u062A\u0627\u0631\u06CC\u062E/\u0633\u0627\u0639\u062A \u06AF\u0648\u0634\u06CC \u0631\u0627 \u0631\u0648\u06CC \u062D\u0627\u0644\u062A \u062E\u0648\u062F\u06A9\u0627\u0631 \u0628\u06AF\u0630\u0627\u0631\u06CC\u062F.",
    "3) VPN/Proxy \u0631\u0627 \u06CC\u06A9\u200C\u0628\u0627\u0631 \u062E\u0627\u0645\u0648\u0634/\u0631\u0648\u0634\u0646 \u0648 \u062F\u0648\u0628\u0627\u0631\u0647 \u062A\u0633\u062A \u06A9\u0646\u06CC\u062F.",
    "4) \u0627\u067E \u062A\u0644\u06AF\u0631\u0627\u0645 \u0631\u0627 \u0622\u067E\u062F\u06CC\u062A \u06A9\u0646\u06CC\u062F \u0648 Mini App cache \u0631\u0627 \u067E\u0627\u06A9 \u06A9\u0646\u06CC\u062F.",
    "5) \u0627\u06AF\u0631 \u062E\u0637\u0627\u06CC 401 \u0628\u0648\u062F\u060C \u0627\u067E \u0631\u0627 \u06A9\u0627\u0645\u0644 \u0628\u0628\u0646\u062F\u06CC\u062F \u0648 \u0627\u0632 \u062F\u06A9\u0645\u0647 /miniapp \u062F\u0648\u0628\u0627\u0631\u0647 \u0648\u0627\u0631\u062F \u0634\u0648\u06CC\u062F.",
    "6) \u0627\u06AF\u0631 \u0647\u0646\u0648\u0632 \u0648\u0635\u0644 \u0646\u0634\u062F\u060C \u0644\u0627\u06AF /health \u0648 \u067E\u0627\u0633\u062E /api/user \u0631\u0627 \u0628\u0631\u0627\u06CC \u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u06CC \u0627\u0631\u0633\u0627\u0644 \u06A9\u0646\u06CC\u062F."
].join("\n");
const MINIAPP_EXEC_CHECKLIST_TEXT = MINIAPP_EXEC_CHECKLIST;
function isSignedInitData(v) {
    const s = String(v || "");
    return /(^|[?&])hash=/.test(s);
}
function getFreshInitData() {
    const latestTg = ((tg === null || tg === void 0 ? void 0 : tg.initData) || "").trim();
    const latestOk = latestTg && isSignedInitData(latestTg);
    const currentOk = INIT_DATA && isSignedInitData(INIT_DATA);
    if (latestOk) {
        INIT_DATA = latestTg;
        try {
            localStorage.setItem(LOCAL_KEYS.initData, latestTg);
        }
        catch (_a) { }
    }
    const out = (currentOk ? INIT_DATA : "") || (latestOk ? latestTg : "") || "";
    return out;
}
function buildAuthBody(extra = {}) {
    const webToken = getParamEverywhere("access") || getParamEverywhere("webToken") || "";
    return Object.assign({ initData: getFreshInitData(), miniToken: MINI_TOKEN || localStorage.getItem(LOCAL_KEYS.miniToken) || "", webToken }, extra);
}
function parseMiniTokenStartParam(raw) {
    const v = String(raw || "").trim();
    if (!v)
        return "";
    try {
        const qp = new URLSearchParams(v);
        const t = String(qp.get("miniToken") || qp.get("token") || "").trim();
        if (t)
            return t;
    }
    catch (_a) { }
    const m = v.match(/(?:^|[?&])(?:miniToken|token)=([^&]+)/i);
    if (m === null || m === void 0 ? void 0 : m[1]) {
        try {
            return decodeURIComponent(m[1]).trim();
        }
        catch (_b) {
            return String(m[1] || "").trim();
        }
    }
    if (/^[a-f0-9]{24,96}$/i.test(v))
        return v;
    return "";
}
function getParamEverywhere(name) {
    const n = String(name || "").trim();
    if (!n)
        return "";
    const q = new URLSearchParams(window.location.search).get(n) || "";
    if (q)
        return q;
    const hash = String(window.location.hash || "").replace(/^#/, "");
    const h = new URLSearchParams(hash).get(n) || "";
    return h || "";
}
function showToast(title, subline = "", badge = "", loading = false) {
    if (!toast || !toastT || !toastS || !toastB || !spin)
        return;
    toastT.textContent = title || "";
    toastS.textContent = subline || "";
    toastB.textContent = badge || "";
    spin.style.display = loading ? "inline-block" : "none";
    toast.classList.add("show");
}
function hideToast() { if (toast)
    toast.classList.remove("show"); }
function applyTab(tab) {
    const raw = tab || "dashboard";
    const section = (raw === "owner") ? "admin" : raw;
    document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tab === raw);
    });
    document.querySelectorAll(".tab-section").forEach((sec) => {
        sec.classList.toggle("active", sec.dataset.tabSection === section);
    });
    // If owner opens the owner panel, force admin card to present owner view.
    if (raw === "owner" && adminTitle)
        adminTitle.textContent = "\u067E\u0646\u0644 \u0627\u0648\u0646\u0631";
    if (raw === "admin" && adminTitle)
        adminTitle.textContent = IS_OWNER ? "\u067E\u0646\u0644 \u0627\u0648\u0646\u0631" : "\u067E\u0646\u0644 \u0627\u062F\u0645\u06CC\u0646";
}
function setupTabs() {
    const tabs = el("mainTabs");
    if (!tabs)
        return;
    tabs.addEventListener("click", (e) => {
        var _a, _b;
        const b = (_b = (_a = e.target) === null || _a === void 0 ? void 0 : _a.closest) === null || _b === void 0 ? void 0 : _b.call(_a, ".tab-btn");
        if (!b)
            return;
        applyTab(b.dataset.tab || "dashboard");
    });
}
async function fileToDataUrl(file) {
    return await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = () => reject(new Error("file_read_failed"));
        r.readAsDataURL(file);
    });
}
function fillSymbols(list) {
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
    if (cur && ALL_SYMBOLS.includes(cur))
        sel.value = cur;
}
function fillStyles(list) {
    const styles = Array.isArray(list) ? list.slice() : [];
    const sel = el("style");
    const cur = sel.value;
    sel.innerHTML = "";
    for (const s of styles) {
        const opt = document.createElement("option");
        opt.value = s;
        opt.textContent = s;
        sel.appendChild(opt);
    }
    if (cur && styles.includes(cur))
        sel.value = cur;
}
function fillCustomPrompts(list) {
    const prompts = Array.isArray(list) ? list.slice() : [];
    const sel = el("customPrompt");
    const cur = sel.value;
    sel.innerHTML = "";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "\u067E\u06CC\u0634\u200C\u0641\u0631\u0636";
    sel.appendChild(defaultOpt);
    for (const p of prompts) {
        const opt = document.createElement("option");
        opt.value = String((p === null || p === void 0 ? void 0 : p.id) || "");
        opt.textContent = (p === null || p === void 0 ? void 0 : p.title) ? String(p.title) : String((p === null || p === void 0 ? void 0 : p.id) || "");
        sel.appendChild(opt);
    }
    if (cur)
        sel.value = cur;
}
function filterSymbols(q) {
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
    if (cur && list.includes(cur))
        sel.value = cur;
}
function setTf(tf) {
    var _a;
    setVal("timeframe", tf);
    const chips = ((_a = el("tfChips")) === null || _a === void 0 ? void 0 : _a.querySelectorAll(".chip")) || [];
    for (const c of chips)
        c.classList.toggle("on", c.dataset.tf === tf);
}
async function api(path, body) {
    let lastErr = null;
    const quickBoot = path === "/api/user" && !!(body === null || body === void 0 ? void 0 : body.allowGuest);
    const attempts = quickBoot ? 2 : 2;
    for (let i = 0; i < attempts; i++) {
        try {
            const ac = new AbortController();
            const quickMs = i === 0 ? 4500 : 9000;
            const tm = setTimeout(() => ac.abort("timeout"), quickBoot ? quickMs : (12000 + (i * 4000)));
            const r = await fetch(apiUrl(path), { method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
                signal: ac.signal,
            });
            clearTimeout(tm);
            const j = await r.json().catch(() => null);
            return { status: r.status, json: j };
        }
        catch (e) {
            lastErr = e;
            await new Promise((res) => setTimeout(res, 350 * (i + 1)));
        }
    }
    return { status: 599, json: { ok: false, error: String((lastErr === null || lastErr === void 0 ? void 0 : lastErr.message) || lastErr || "network_error") } };
}
async function adminApi(path, body) {
    if (!IS_STAFF)
        return { status: 403, json: { ok: false, error: "forbidden" } };
    return api(path, buildAuthBody(body));
}
function prettyErr(j, status) {
    const e = (j === null || j === void 0 ? void 0 : j.error) || "\u0646\u0627\u0645\u0634\u062E\u0635";
    if (status === 429 && String(e).startsWith("quota_exceeded"))
        return "\u0633\u0647\u0645\u06CC\u0647 \u0627\u0645\u0631\u0648\u0632 \u062A\u0645\u0627\u0645 \u0634\u062F.";
    if (status === 403 && String(e) === "onboarding_required")
        return "\u0644\u0637\u0641\u0627\u064B \u0622\u0646\u0628\u0648\u0631\u062F\u06CC\u0646\u06AF \u0631\u0627 \u06A9\u0627\u0645\u0644 \u06A9\u0646: \u0646\u0627\u0645\u060C \u0634\u0645\u0627\u0631\u0647\u060C \u0633\u0631\u0645\u0627\u06CC\u0647\u060C \u062A\u0639\u06CC\u06CC\u0646\u200C\u0633\u0637\u062D \u0648 \u0633\u0628\u06A9.";
    if (status === 403 && String(e) === "forbidden")
        return "\u062F\u0633\u062A\u0631\u0633\u06CC \u0627\u06CC\u0646 \u0628\u062E\u0634 \u0628\u0631\u0627\u06CC \u0646\u0642\u0634 \u0641\u0639\u0644\u06CC \u0634\u0645\u0627 \u0645\u062C\u0627\u0632 \u0646\u06CC\u0633\u062A.";
    if (status === 401) {
        if (String(e).includes("initData"))
            return "\u0627\u062A\u0635\u0627\u0644 \u0645\u06CC\u0646\u06CC\u200C\u0627\u067E \u0645\u0646\u0642\u0636\u06CC \u0634\u062F\u0647\u061B \u0627\u067E \u0631\u0627 \u0645\u062C\u062F\u062F \u0627\u0632 \u062F\u0627\u062E\u0644 \u062A\u0644\u06AF\u0631\u0627\u0645 \u0628\u0627\u0632 \u06A9\u0646\u06CC\u062F.";
        return "\u0627\u062D\u0631\u0627\u0632 \u0647\u0648\u06CC\u062A \u062A\u0644\u06AF\u0631\u0627\u0645 \u0646\u0627\u0645\u0648\u0641\u0642 \u0627\u0633\u062A.\n\n" + MINIAPP_EXEC_CHECKLIST_TEXT;
    }
    return "\u0645\u0634\u06A9\u0644\u06CC \u067E\u06CC\u0634 \u0622\u0645\u062F. \u0644\u0637\u0641\u0627\u064B \u062F\u0648\u0628\u0627\u0631\u0647 \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F.";
}
function fmtPrice(v) {
    const n = Number(v);
    if (!Number.isFinite(n))
        return "\u2014";
    const digits = n >= 1000 ? 2 : (n >= 1 ? 4 : 6);
    return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}
function setQuoteUi(data, errMsg = "") {
    const qSym = el("quoteSymbol");
    const qPrice = el("quotePrice");
    const qChange = el("quoteChange");
    const qTrend = el("quoteTrend");
    const qStamp = el("quoteStamp");
    const qMeta = el("quoteMeta");
    if (!qSym || !qPrice || !qChange || !qTrend || !qStamp || !qMeta)
        return;
    if (!(data === null || data === void 0 ? void 0 : data.ok)) {
        qMeta.textContent = errMsg || "\u062F\u0627\u062F\u0647 \u0642\u06CC\u0645\u062A \u062F\u0631 \u062F\u0633\u062A\u0631\u0633 \u0646\u06CC\u0633\u062A.";
        qStamp.textContent = "\u2014";
        return;
    }
    const cp = Number(data.changePct || 0);
    qSym.textContent = data.symbol || "\u2014";
    qPrice.textContent = fmtPrice(data.price);
    qChange.textContent = (cp > 0 ? "+" : "") + cp.toFixed(3) + "%";
    qTrend.textContent = data.trend || "\u0646\u0627\u0645\u0634\u062E\u0635";
    qChange.classList.remove("q-up", "q-down", "q-flat");
    qChange.classList.add(data.status === "up" ? "q-up" : (data.status === "down" ? "q-down" : "q-flat"));
    const dt = data.lastTs ? new Date(Number(data.lastTs)) : new Date();
    qStamp.textContent = dt.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    qMeta.textContent = "TF: " + (data.timeframe || "-") + " | candles: " + (data.candles || 0) + " | \u06A9\u06CC\u0641\u06CC\u062A: " + (data.quality === "full" ? "\u06A9\u0627\u0645\u0644" : "\u0645\u062D\u062F\u0648\u062F");
}
async function refreshLiveQuote(force = false) {
    if (QUOTE_BUSY)
        return;
    if (!force && document.hidden)
        return;
    QUOTE_BUSY = true;
    try {
        const symbol = val("symbol") || "";
        const timeframe = val("timeframe") || "H4";
        if (!symbol)
            return;
        const ck = quoteCacheKey(symbol, timeframe);
        if (OFFLINE_MODE) {
            const cached = readByKey(LOCAL_KEYS.quoteCache, ck);
            setQuoteUi(cached, "\u0642\u06CC\u0645\u062A \u0644\u062D\u0638\u0647\u200C\u0627\u06CC \u0627\u0632 \u06A9\u0634 \u0645\u062D\u0644\u06CC");
            return;
        }
        const { json } = await api("/api/quote", buildAuthBody({ symbol, timeframe, allowGuest: true }));
        if (json === null || json === void 0 ? void 0 : json.ok) {
            cacheByKey(LOCAL_KEYS.quoteCache, ck, json);
            setQuoteUi(json, "");
            return;
        }
        const cached = readByKey(LOCAL_KEYS.quoteCache, ck);
        setQuoteUi(cached || json, cached ? "\u0642\u06CC\u0645\u062A \u0627\u0632 \u06A9\u0634 \u0646\u0645\u0627\u06CC\u0634 \u062F\u0627\u062F\u0647 \u0634\u062F" : "\u062E\u0637\u0627 \u062F\u0631 \u062F\u0631\u06CC\u0627\u0641\u062A \u0642\u06CC\u0645\u062A \u0644\u062D\u0638\u0647\u200C\u0627\u06CC");
    }
    finally {
        QUOTE_BUSY = false;
    }
}
function setupLiveQuotePolling() {
    if (QUOTE_TIMER)
        clearInterval(QUOTE_TIMER);
    refreshLiveQuote(true);
    QUOTE_TIMER = setInterval(() => { refreshLiveQuote(false); }, 12000);
}
function renderNewsList(json) {
    const target = el("newsList");
    if (!target)
        return;
    if (!(json === null || json === void 0 ? void 0 : json.ok) || !Array.isArray(json.articles) || !json.articles.length) {
        target.textContent = "\u0641\u0639\u0644\u0627\u064B \u062E\u0628\u0631 \u0645\u0631\u062A\u0628\u0637\u06CC \u067E\u06CC\u062F\u0627 \u0646\u0634\u062F.";
        return;
    }
    target.innerHTML = "";
    for (const a of json.articles.slice(0, 6)) {
        const row = document.createElement("div");
        const title = document.createElement("a");
        title.href = a.url || "#";
        title.target = "_blank";
        title.rel = "noopener noreferrer";
        title.textContent = "\u2022 " + String(a.title || "\u0628\u062F\u0648\u0646 \u0639\u0646\u0648\u0627\u0646");
        title.style.color = "#c7d2fe";
        title.style.textDecoration = "none";
        const meta = document.createElement("div");
        meta.className = "muted";
        meta.style.fontSize = "11px";
        meta.textContent = (a.source || "") + (a.publishedAt ? (" | " + a.publishedAt) : "");
        row.appendChild(title);
        row.appendChild(meta);
        row.style.marginBottom = "8px";
        target.appendChild(row);
    }
}
async function refreshSymbolNews(force = false) {
    if (!force && document.hidden)
        return;
    const symbol = val("symbol") || "";
    if (!symbol)
        return;
    const target = el("newsList");
    if (target && force)
        target.textContent = "\u062F\u0631 \u062D\u0627\u0644 \u062F\u0631\u06CC\u0627\u0641\u062A \u062E\u0628\u0631\u2026";
    const ck = newsCacheKey(symbol);
    if (OFFLINE_MODE) {
        const cached = readByKey(LOCAL_KEYS.newsCache, ck);
        renderNewsList(cached || { ok: false, articles: [] });
        return;
    }
    const { json } = await api("/api/news", buildAuthBody({ symbol, allowGuest: true }));
    if (json === null || json === void 0 ? void 0 : json.ok) {
        cacheByKey(LOCAL_KEYS.newsCache, ck, json);
        renderNewsList(json);
        return;
    }
    const cached = readByKey(LOCAL_KEYS.newsCache, ck);
    renderNewsList(cached || json);
}
async function refreshNewsAnalysis(force = false) {
    if (!force && document.hidden)
        return;
    const symbol = val("symbol") || "";
    if (!symbol)
        return;
    const target = el("newsAnalysis");
    if (target && force)
        target.textContent = "\u062F\u0631 \u062D\u0627\u0644 \u062A\u062D\u0644\u06CC\u0644 \u062E\u0628\u0631\u2026";
    const ck = newsCacheKey(symbol);
    if (OFFLINE_MODE) {
        const cached = readByKey(LOCAL_KEYS.newsAnalysisCache, ck);
        if (target)
            target.textContent = (cached === null || cached === void 0 ? void 0 : cached.summary) || "\u062A\u062D\u0644\u06CC\u0644 \u062E\u0628\u0631\u06CC \u0622\u0641\u0644\u0627\u06CC\u0646 \u0645\u0648\u062C\u0648\u062F \u0646\u06CC\u0633\u062A.";
        return;
    }
    const { json } = await api("/api/news/analyze", buildAuthBody({ symbol, allowGuest: true }));
    if (!target)
        return;
    if (json === null || json === void 0 ? void 0 : json.ok) {
        cacheByKey(LOCAL_KEYS.newsAnalysisCache, ck, json);
        target.textContent = json.summary || "\u2014";
        return;
    }
    const cached = readByKey(LOCAL_KEYS.newsAnalysisCache, ck);
    target.textContent = (cached === null || cached === void 0 ? void 0 : cached.summary) || "\u062A\u062D\u0644\u06CC\u0644 \u062E\u0628\u0631\u06CC \u062F\u0631 \u062F\u0633\u062A\u0631\u0633 \u0646\u06CC\u0633\u062A.";
}
function setupNewsPolling() {
    if (NEWS_TIMER)
        clearInterval(NEWS_TIMER);
    refreshSymbolNews(true);
    refreshNewsAnalysis(true);
    NEWS_TIMER = setInterval(() => { refreshSymbolNews(false); refreshNewsAnalysis(false); }, 60000);
}
function renderChartFallbackSvg(svgText) {
    const chartCard = el("chartCard");
    const chartImg = el("chartImg");
    if (!chartCard || !chartImg || !svgText)
        return;
    const svgUrl = "data:image/svg+xml;utf8," + encodeURIComponent(svgText);
    chartImg.src = svgUrl;
    chartCard.style.display = "block";
    const cm = el("chartMeta");
    if (cm)
        cm.textContent = "Internal Zones Renderer";
}
function pickTicketReplyTemplate() {
    var _a;
    const tpl = ((_a = el("ticketReplyTemplate")) === null || _a === void 0 ? void 0 : _a.value) || "";
    if (!tpl)
        return;
    const input = el("ticketReply");
    if (!input)
        return;
    if (!input.value.trim())
        input.value = tpl;
}
function updateMeta(state, quota) {
    const qRaw = String(quota || "-");
    let energy = "\u2014";
    let remainTxt = "\u221E";
    const m = qRaw.match(/^(\d+)\/(\d+)$/);
    if (m) {
        const used = Number(m[1] || 0);
        const lim = Math.max(1, Number(m[2] || 1));
        const remain = Math.max(0, lim - used);
        const pct = Math.max(0, Math.min(100, Math.round((remain / lim) * 100)));
        energy = pct + "%";
        remainTxt = String(remain);
    }
    else if (qRaw === "\u221E") {
        energy = "100%";
        remainTxt = "\u221E";
    }
    meta.textContent = "\u0627\u0646\u0631\u0698\u06CC: " + energy + " | \u062A\u062D\u0644\u06CC\u0644 \u0628\u0627\u0642\u06CC\u200C\u0645\u0627\u0646\u062F\u0647: " + remainTxt + " | \u0633\u0647\u0645\u06CC\u0647: " + qRaw;
    sub.textContent = "ID: " + ((state === null || state === void 0 ? void 0 : state.userId) || "-") + " | \u0627\u0645\u0631\u0648\u0632(Tehran): " + ((state === null || state === void 0 ? void 0 : state.dailyDate) || "-");
    const q = String(quota || "");
    const m2 = q.match(/(\d+)\s*\/\s*(\d+)/);
    let used = 0;
    let limit = 0;
    if (m2) {
        used = Number(m2[1] || 0);
        limit = Number(m2[2] || 0);
    }
    const remaining = Math.max(0, limit - used);
    const pct = limit > 0 ? Math.max(0, Math.min(100, Math.round((remaining / limit) * 100))) : 100;
    if (remainingText)
        remainingText.textContent = "\u062A\u062D\u0644\u06CC\u0644 \u0628\u0627\u0642\u06CC\u200C\u0645\u0627\u0646\u062F\u0647: " + (limit > 0 ? String(remaining) : "\u221E");
    if (energyText)
        energyText.textContent = "\u0627\u0646\u0631\u0698\u06CC: " + (limit > 0 ? (pct + "%") : "\u0646\u0627\u0645\u062D\u062F\u0648\u062F");
    if (energyFill)
        energyFill.style.width = (limit > 0 ? pct : 100) + "%";
}
function updateDashboardStats(role, quota) {
    const raw = String(quota || "0/0");
    let used = 0, limit = 0;
    if (raw.includes("/")) {
        const [u, l] = raw.split("/");
        used = Number(u) || 0;
        limit = Number(l) || 0;
    }
    const remain = (Number.isFinite(limit) && limit > 0) ? Math.max(0, limit - used) : (raw === "\u221E" ? "\u221E" : 0);
    if (roleLabel)
        roleLabel.textContent = role || "user";
    if (energyToday)
        energyToday.textContent = raw === "\u221E" ? "\u0646\u0627\u0645\u062D\u062F\u0648\u062F" : String(used);
    if (remainingAnalyses)
        remainingAnalyses.textContent = String(remain);
}
function setOfferImage(url) {
    const clean = String(url || "").trim();
    if (!offerMedia || !offerImg)
        return;
    if (!clean) {
        offerImg.removeAttribute("src");
        offerMedia.classList.remove("show");
        return;
    }
    offerImg.src = clean;
    offerMedia.classList.add("show");
}
function renderStyleList(styles) {
    const target = el("styleList");
    if (!target)
        return;
    target.textContent = Array.isArray(styles) && styles.length ? styles.join(" \u2022 ") : "\u2014";
}
function renderCommissionList(commission) {
    var _a;
    const target = el("commissionList");
    if (!target)
        return;
    const global = (_a = commission === null || commission === void 0 ? void 0 : commission.globalPercent) !== null && _a !== void 0 ? _a : 0;
    const overrides = (commission === null || commission === void 0 ? void 0 : commission.overrides) || {};
    const lines = ["\u06A9\u0644\u06CC: " + global + "%"];
    for (const [k, v] of Object.entries(overrides))
        lines.push(String(k) + ": " + String(v) + "%");
    target.textContent = lines.join("\\n");
}
function renderPayments(list) {
    const target = el("paymentList");
    if (!target)
        return;
    if (!Array.isArray(list) || !list.length) {
        target.textContent = "\u2014";
        return;
    }
    target.textContent = list.slice(0, 8).map((p) => {
        const who = p.username || p.userId;
        return "\u2022 " + who + " | " + p.amount + " | " + p.status + " | " + (p.txHash || "\u2014");
    }).join("\\n");
}
function shortText(s, n = 80) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? (s.slice(0, n) + "\u2026") : s;
}
function renderTickets(list, keepMaster = false) {
    ADMIN_TICKETS = Array.isArray(list) ? list.slice() : [];
    if (!keepMaster)
        ADMIN_TICKETS_ALL = ADMIN_TICKETS.slice();
    const sel = el("ticketSelect");
    const target = el("ticketsList");
    if (sel)
        sel.innerHTML = "";
    if (!ADMIN_TICKETS.length) {
        if (sel) {
            const o = document.createElement("option");
            o.value = "";
            o.textContent = "\u2014";
            sel.appendChild(o);
        }
        if (target)
            target.textContent = "\u2014";
        return;
    }
    const items = ADMIN_TICKETS.slice().sort((a, b) => String((b === null || b === void 0 ? void 0 : b.createdAt) || "").localeCompare(String((a === null || a === void 0 ? void 0 : a.createdAt) || "")));
    if (sel) {
        for (const t of items) {
            const o = document.createElement("option");
            o.value = t.id || "";
            const who = t.username ? ("@" + String(t.username).replace(/^@/, "")) : (t.userId || "-");
            o.textContent = String(t.id || "-") + " | " + who + " | " + String(t.status || "pending");
            sel.appendChild(o);
        }
    }
    if (target) {
        target.textContent = items.slice(0, 25).map((t) => {
            const who = t.username ? ("@" + String(t.username).replace(/^@/, "")) : (t.userId || "-");
            return "\u2022 " + t.id + " | " + who + " | " + (t.status || "pending") + " | " + shortText(t.text, 80);
        }).join(String.fromCharCode(10));
    }
}
function renderWithdrawals(list) {
    ADMIN_WITHDRAWALS = Array.isArray(list) ? list.slice() : [];
    const sel = el("withdrawSelect");
    const target = el("withdrawalsList");
    if (sel)
        sel.innerHTML = "";
    if (!ADMIN_WITHDRAWALS.length) {
        if (sel) {
            const o = document.createElement("option");
            o.value = "";
            o.textContent = "\u2014";
            sel.appendChild(o);
        }
        if (target)
            target.textContent = "\u2014";
        return;
    }
    const items = ADMIN_WITHDRAWALS.slice().sort((a, b) => String((b === null || b === void 0 ? void 0 : b.createdAt) || "").localeCompare(String((a === null || a === void 0 ? void 0 : a.createdAt) || "")));
    if (sel) {
        for (const w of items) {
            const o = document.createElement("option");
            o.value = w.id || "";
            o.textContent = String(w.id || "-") + " | " + String(w.userId || "-") + " | " + String(w.amount || 0) + " | " + String(w.status || "pending");
            sel.appendChild(o);
        }
    }
    if (target) {
        target.textContent = items.slice(0, 25).map((w) => {
            return "\u2022 " + w.id + " | " + (w.userId || "-") + " | " + (w.amount || 0) + " | " + (w.status || "pending") + " | " + shortText(w.address, 32);
        }).join(String.fromCharCode(10));
    }
}
function renderPromptReqs(list) {
    ADMIN_PROMPT_REQS = Array.isArray(list) ? list.slice() : [];
    const sel = el("promptReqSelect");
    const target = el("promptReqList");
    if (sel)
        sel.innerHTML = "";
    if (!ADMIN_PROMPT_REQS.length) {
        if (sel) {
            const o = document.createElement("option");
            o.value = "";
            o.textContent = "\u2014";
            sel.appendChild(o);
        }
        if (target)
            target.textContent = "\u2014";
        return;
    }
    const items = ADMIN_PROMPT_REQS.slice().sort((a, b) => String((b === null || b === void 0 ? void 0 : b.createdAt) || "").localeCompare(String((a === null || a === void 0 ? void 0 : a.createdAt) || "")));
    if (sel) {
        for (const r of items) {
            const o = document.createElement("option");
            o.value = r.id || "";
            const who = r.username ? ("@" + String(r.username).replace(/^@/, "")) : (r.userId || "-");
            o.textContent = String(r.id || "-") + " | " + who + " | " + String(r.status || "pending");
            sel.appendChild(o);
        }
    }
    if (target) {
        target.textContent = items.slice(0, 25).map((r) => {
            const who = r.username ? ("@" + String(r.username).replace(/^@/, "")) : (r.userId || "-");
            const pid = r.promptId ? (" | prompt:" + r.promptId) : "";
            return "\u2022 " + r.id + " | " + who + " | " + (r.status || "pending") + pid;
        }).join(String.fromCharCode(10));
    }
}
async function refreshTickets() {
    const { json } = await adminApi("/api/admin/tickets/list", { limit: 100 });
    if (json === null || json === void 0 ? void 0 : json.ok)
        renderTickets(json.tickets || []);
}
function applyTicketFilter(status) {
    if (!status)
        return renderTickets(ADMIN_TICKETS_ALL || [], true);
    const filtered = (ADMIN_TICKETS_ALL || []).filter((x) => String((x === null || x === void 0 ? void 0 : x.status) || "pending") === status);
    renderTickets(filtered, true);
}
function setAdminTab(tab) {
    const tabs = Array.from(document.querySelectorAll('#adminTabs .chip'));
    const panes = Array.from(document.querySelectorAll('.admin-tab'));
    for (const t of tabs)
        t.classList.toggle('on', t.dataset.tab === tab);
    for (const p of panes) {
        const pt = p.dataset.tab || 'overview';
        p.classList.toggle('hidden', pt !== tab);
    }
}
async function refreshWithdrawals() {
    const { json } = await adminApi("/api/admin/withdrawals/list", {});
    if (json === null || json === void 0 ? void 0 : json.ok)
        renderWithdrawals(json.withdrawals || []);
}
async function refreshPromptReqs() {
    const { json } = await adminApi("/api/admin/custom-prompts/requests", {});
    if (json === null || json === void 0 ? void 0 : json.ok)
        renderPromptReqs(json.requests || []);
}
function renderUsers(list) {
    const target = el("usersReport");
    if (!target)
        return;
    if (!Array.isArray(list) || !list.length) {
        target.textContent = "\u2014";
        return;
    }
    target.textContent = list.map((u) => {
        const user = u.username ? ("@" + u.username.replace(/^@/, "")) : u.userId;
        return "\u2022 " + user + " | \u062A\u0644\u0641\u0646: " + (u.phone || "\u2014") + " | \u0645\u062F\u062A: " + u.usageDays + " \u0631\u0648\u0632 | \u062A\u062D\u0644\u06CC\u0644 \u0645\u0648\u0641\u0642: " + u.totalAnalyses + " | \u0622\u062E\u0631\u06CC\u0646 \u062A\u062D\u0644\u06CC\u0644: " + (u.lastAnalysisAt || "\u2014") + " | \u067E\u0631\u062F\u0627\u062E\u062A: " + u.paymentCount + " (" + (u.paymentTotal || 0) + ") | \u0627\u0634\u062A\u0631\u0627\u06A9: " + (u.subscriptionType || "free") + " | \u0627\u0646\u0642\u0636\u0627: " + (u.subscriptionExpiresAt || "\u2014") + " | \u0633\u0647\u0645\u06CC\u0647: " + u.dailyUsed + "/" + u.dailyLimit + " | \u0631\u0641\u0631\u0627\u0644: " + u.referralInvites + " | TX: " + (u.lastTxHash || "\u2014") + " | \u067E\u0631\u0627\u0645\u067E\u062A: " + (u.customPromptId || "\u2014");
    }).join("\\n");
}
function renderFullAdminReport(users, payments, withdrawals, tickets) {
    const target = el("usersReport");
    if (!target)
        return;
    const u = Array.isArray(users) ? users : [];
    const p = Array.isArray(payments) ? payments : [];
    const w = Array.isArray(withdrawals) ? withdrawals : [];
    const t = Array.isArray(tickets) ? tickets : [];
    const head = [
        "\uD83D\uDCCA \u06AF\u0632\u0627\u0631\u0634 \u06A9\u0627\u0645\u0644 \u0627\u062F\u0645\u06CC\u0646 (Asia/Tehran)",
        "\u06A9\u0627\u0631\u0628\u0631\u0627\u0646: " + u.length + " | \u067E\u0631\u062F\u0627\u062E\u062A\u200C\u0647\u0627: " + p.length + " | \u0628\u0631\u062F\u0627\u0634\u062A\u200C\u0647\u0627: " + w.length + " | \u062A\u06CC\u06A9\u062A\u200C\u0647\u0627: " + t.length,
        "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    ];
    const usersBlock = u.slice(0, 80).map((x) => {
        const user = x.username ? ("@" + x.username.replace(/^@/, "")) : x.userId;
        return "\u2022 " + user + " | \u062A\u062D\u0644\u06CC\u0644 \u0645\u0648\u0641\u0642: " + (x.totalAnalyses || 0) + " | \u0633\u0647\u0645\u06CC\u0647: " + (x.dailyUsed || 0) + "/" + (x.dailyLimit || 0) + " | \u0627\u0634\u062A\u0631\u0627\u06A9: " + (x.subscriptionType || "free") + " | TX: " + (x.lastTxHash || "\u2014");
    });
    const payBlock = p.slice(0, 40).map((x) => "\u2022 " + (x.username || x.userId) + " | " + (x.amount || 0) + " | " + (x.status || "-") + " | " + (x.txHash || "\u2014"));
    const wdBlock = w.slice(0, 40).map((x) => "\u2022 " + (x.userId || "-") + " | " + (x.amount || 0) + " | " + (x.status || "pending") + " | " + (x.address || "\u2014"));
    const tkBlock = t.slice(0, 40).map((x) => "\u2022 " + (x.username || x.userId || "-") + " | " + (x.status || "pending") + " | " + String(x.text || "").slice(0, 80));
    target.textContent = [
        ...head,
        "\uD83D\uDC65 \u06A9\u0627\u0631\u0628\u0631\u0627\u0646:", ...(usersBlock.length ? usersBlock : ["\u2014"]),
        "",
        "\uD83D\uDCB3 \u067E\u0631\u062F\u0627\u062E\u062A\u200C\u0647\u0627:", ...(payBlock.length ? payBlock : ["\u2014"]),
        "",
        "\u2796 \u0628\u0631\u062F\u0627\u0634\u062A\u200C\u0647\u0627:", ...(wdBlock.length ? wdBlock : ["\u2014"]),
        "",
        "\uD83C\uDFAB \u062A\u06CC\u06A9\u062A\u200C\u0647\u0627:", ...(tkBlock.length ? tkBlock : ["\u2014"]),
    ].join(String.fromCharCode(10));
}
function safeJsonParse(text, fallback) {
    try {
        return JSON.parse(text);
    }
    catch (_a) {
        return fallback;
    }
}
function cacheUserSnapshot(json) {
    try {
        const data = {
            welcome: (json === null || json === void 0 ? void 0 : json.welcome) || "",
            state: (json === null || json === void 0 ? void 0 : json.state) || {},
            quota: (json === null || json === void 0 ? void 0 : json.quota) || "",
            symbols: (json === null || json === void 0 ? void 0 : json.symbols) || [],
            styles: (json === null || json === void 0 ? void 0 : json.styles) || [],
            customPrompts: (json === null || json === void 0 ? void 0 : json.customPrompts) || [],
            offerBanner: (json === null || json === void 0 ? void 0 : json.offerBanner) || "",
            offerBannerImage: (json === null || json === void 0 ? void 0 : json.offerBannerImage) || "",
            role: (json === null || json === void 0 ? void 0 : json.role) || "user",
            isStaff: !!(json === null || json === void 0 ? void 0 : json.isStaff),
            wallet: (json === null || json === void 0 ? void 0 : json.wallet) || "",
            cachedAt: Date.now(),
        };
        localStorage.setItem(LOCAL_KEYS.userState, JSON.stringify(data));
    }
    catch (_a) { }
}
function readCachedUserSnapshot() {
    try {
        return safeJsonParse(localStorage.getItem(LOCAL_KEYS.userState) || "", null);
    }
    catch (_a) {
        return null;
    }
}
function applyUserState(json) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    welcome.textContent = json.welcome || "";
    fillSymbols(json.symbols || []);
    const styleList = json.styles || [];
    fillStyles(styleList);
    fillCustomPrompts(json.customPrompts || []);
    if ((_a = json.state) === null || _a === void 0 ? void 0 : _a.timeframe)
        setTf(json.state.timeframe);
    if (((_b = json.state) === null || _b === void 0 ? void 0 : _b.style) && styleList.includes(json.state.style)) {
        setVal("style", json.state.style);
    }
    else if (styleList.length) {
        setVal("style", styleList[0]);
    }
    if ((_c = json.state) === null || _c === void 0 ? void 0 : _c.risk)
        setVal("risk", json.state.risk);
    if (typeof ((_d = json.state) === null || _d === void 0 ? void 0 : _d.customPromptId) === "string")
        setVal("customPrompt", json.state.customPromptId);
    setVal("newsEnabled", String(!!((_e = json.state) === null || _e === void 0 ? void 0 : _e.newsEnabled)));
    setVal("promptMode", ((_f = json.state) === null || _f === void 0 ? void 0 : _f.promptMode) || "style_only");
    if (((_g = json.state) === null || _g === void 0 ? void 0 : _g.selectedSymbol) && (json.symbols || []).includes(json.state.selectedSymbol)) {
        setVal("symbol", json.state.selectedSymbol);
    }
    else if ((_h = json.symbols) === null || _h === void 0 ? void 0 : _h.length)
        setVal("symbol", json.symbols[0]);
    if (offerText)
        offerText.textContent = json.offerBanner || "\u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0627\u0634\u062A\u0631\u0627\u06A9 \u0648\u06CC\u0698\u0647 \u0628\u0627 \u062A\u062E\u0641\u06CC\u0641 \u0645\u062D\u062F\u0648\u062F.";
    if (offerTag)
        offerTag.textContent = json.role === "owner" ? "Owner" : "Special";
    if (offerImage) {
        const img = String(json.offerBannerImage || "").trim();
        offerImage.style.display = img ? "block" : "none";
        if (img)
            offerImage.src = img;
    }
    updateMeta(json.state, json.quota);
}
function storageGetObj(key, fallback = {}) {
    try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : fallback;
        return parsed && typeof parsed === "object" ? parsed : fallback;
    }
    catch (_a) {
        return fallback;
    }
}
function storageSetObj(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value || {}));
    }
    catch (_a) { }
}
function cacheByKey(key, itemKey, value) {
    const bag = storageGetObj(key, {});
    bag[itemKey] = Object.assign(Object.assign({}, (value || {})), { cachedAt: Date.now() });
    storageSetObj(key, bag);
}
function readByKey(key, itemKey) {
    const bag = storageGetObj(key, {});
    return bag[itemKey] || null;
}
function quoteCacheKey(symbol, timeframe) {
    return String(symbol || "").toUpperCase() + "|" + String(timeframe || "H4").toUpperCase();
}
function newsCacheKey(symbol) {
    return String(symbol || "").toUpperCase();
}
function analyzeCacheKey(symbol) {
    return String(symbol || "").toUpperCase();
}
async function boot() {
    var _a, _b;
    out.textContent = "\u23F3 \u062F\u0631 \u062D\u0627\u0644 \u0622\u0645\u0627\u062F\u0647\u200C\u0633\u0627\u0632\u06CC\u2026";
    pillTxt.textContent = "Connecting\u2026";
    showToast("\u062F\u0631 \u062D\u0627\u0644 \u0627\u062A\u0635\u0627\u0644\u2026", "\u062F\u0631\u06CC\u0627\u0641\u062A \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u0648 \u062A\u0646\u0638\u06CC\u0645\u0627\u062A", "API", true);
    const preCached = readCachedUserSnapshot();
    if (preCached) {
        applyUserState(preCached);
        out.textContent = "\u23F3 \u062F\u0631 \u062D\u0627\u0644 \u0647\u0645\u06AF\u0627\u0645\u200C\u0633\u0627\u0632\u06CC \u0628\u0627 \u0633\u0631\u0648\u0631\u2026";
        pillTxt.textContent = "Syncing\u2026";
        setupLiveQuotePolling();
        setupNewsPolling();
    }
    const isTelegramRuntime = !!((_a = window.Telegram) === null || _a === void 0 ? void 0 : _a.WebApp);
    const qsInitData = (() => {
        const v = getParamEverywhere("initData") || "";
        return v && isSignedInitData(v) ? v : "";
    })();
    const savedInitData = (() => {
        const v = localStorage.getItem(LOCAL_KEYS.initData) || "";
        if (v && !isSignedInitData(v)) {
            try {
                localStorage.removeItem(LOCAL_KEYS.initData);
            }
            catch (_a) { }
            return "";
        }
        return v;
    })();
    const qsMiniToken = getParamEverywhere("miniToken") || getParamEverywhere("token") || "";
    const startParamToken = parseMiniTokenStartParam(((_b = tg === null || tg === void 0 ? void 0 : tg.initDataUnsafe) === null || _b === void 0 ? void 0 : _b.start_param) || "");
    const savedMiniToken = localStorage.getItem(LOCAL_KEYS.miniToken) || "";
    const resolvedMiniToken = qsMiniToken || startParamToken || savedMiniToken || "";
    if (resolvedMiniToken) {
        MINI_TOKEN = resolvedMiniToken;
        try {
            localStorage.setItem(LOCAL_KEYS.miniToken, resolvedMiniToken);
        }
        catch (_c) { }
    }
    let initData = ((tg === null || tg === void 0 ? void 0 : tg.initData) || "").trim();
    if (initData && !isSignedInitData(initData))
        initData = "";
    // Telegram WebApp may populate initData with a slight delay.
    if (isTelegramRuntime && !initData) {
        for (const d of [350, 700, 1200]) {
            await new Promise((r) => setTimeout(r, d));
            initData = ((tg === null || tg === void 0 ? void 0 : tg.initData) || "").trim();
            if (initData && isSignedInitData(initData))
                break;
            initData = "";
        }
    }
    if (initData && isSignedInitData(initData)) {
        INIT_DATA = initData;
        localStorage.setItem(LOCAL_KEYS.initData, initData);
    }
    else if (qsInitData) {
        INIT_DATA = qsInitData;
        localStorage.setItem(LOCAL_KEYS.initData, qsInitData);
    }
    else if (savedInitData) {
        INIT_DATA = savedInitData;
    }
    else if (!isTelegramRuntime) {
        const devInit = "dev:999001";
        INIT_DATA = devInit;
        localStorage.setItem(LOCAL_KEYS.initData, devInit);
        showToast("\u062D\u0627\u0644\u062A \u0622\u0633\u0627\u0646 \u0641\u0639\u0627\u0644 \u0634\u062F", "\u0648\u0631\u0648\u062F \u0645\u0648\u0642\u062A \u0628\u0631\u0627\u06CC \u062A\u0633\u062A \u0645\u06CC\u0646\u06CC\u200C\u0627\u067E", "DEV", false);
    }
    else {
        INIT_DATA = "";
        showToast("\u062D\u0627\u0644\u062A \u0645\u0647\u0645\u0627\u0646", "\u0627\u062A\u0635\u0627\u0644 \u0627\u062D\u0631\u0627\u0632 \u0646\u0634\u062F\u0647\u061B \u0627\u062C\u0631\u0627\u06CC \u0645\u062D\u062F\u0648\u062F \u0628\u0627 \u062F\u0627\u062F\u0647 \u0639\u0645\u0648\u0645\u06CC", "GUEST", false);
    }
    let { status, json } = await api("/api/user", buildAuthBody({ allowGuest: true }));
    if ((json === null || json === void 0 ? void 0 : json.guest) && (json === null || json === void 0 ? void 0 : json.authError)) {
        const ae = String(json.authError || "");
        if (ae === "hash_missing" || ae === "initData_missing") {
            try {
                localStorage.removeItem(LOCAL_KEYS.initData);
            }
            catch (_c) { }
        }
    }
    if (!(json === null || json === void 0 ? void 0 : json.ok) && status === 401 && (MINI_TOKEN || localStorage.getItem(LOCAL_KEYS.miniToken))) {
        const initBackup = INIT_DATA;
        INIT_DATA = "";
        const retry = await api("/api/user", buildAuthBody({ allowGuest: true }));
        status = retry.status;
        json = retry.json;
        if (!(json === null || json === void 0 ? void 0 : json.ok))
            INIT_DATA = initBackup;
    }
    if (!(json === null || json === void 0 ? void 0 : json.ok)) {
        if (status === 401) {
            try {
                localStorage.removeItem(LOCAL_KEYS.initData);
            }
            catch (_d) { }
        }
        const cached = readCachedUserSnapshot();
        if (!cached) {
            const fallback = {
                welcome: "\u0646\u0633\u062E\u0647 \u0645\u062D\u062F\u0648\u062F \u0645\u06CC\u0646\u06CC\u200C\u0627\u067E \u0641\u0639\u0627\u0644 \u0634\u062F.",
                state: { timeframe: "H4", style: "\u067E\u0631\u0627\u06CC\u0633 \u0627\u06A9\u0634\u0646", risk: "\u0645\u062A\u0648\u0633\u0637", newsEnabled: true, promptMode: "style_only", selectedSymbol: "BTCUSDT" },
                quota: "guest",
                symbols: ["BTCUSDT", "ETHUSDT", "XAUUSD", "EURUSD"],
                styles: ["\u067E\u0631\u0627\u06CC\u0633 \u0627\u06A9\u0634\u0646", "ICT", "ATR"],
                offerBanner: "\u0627\u062A\u0635\u0627\u0644 \u0645\u062D\u062F\u0648\u062F\u061B \u0628\u0631\u062E\u06CC \u0627\u0645\u06A9\u0627\u0646\u0627\u062A \u0646\u06CC\u0627\u0632\u0645\u0646\u062F \u0627\u062D\u0631\u0627\u0632 \u062A\u0644\u06AF\u0631\u0627\u0645 \u0627\u0633\u062A.",
                offerBannerImage: "",
                role: "user",
                isStaff: false,
                customPrompts: [],
            };
            OFFLINE_MODE = true;
            IS_GUEST = true;
            applyUserState(fallback);
            pillTxt.textContent = "Offline (Guest)";
            out.textContent = "\u062D\u0627\u0644\u062A \u0645\u062D\u062F\u0648\u062F \u0641\u0639\u0627\u0644 \u0634\u062F \u2705 \u062F\u0627\u062F\u0647\u200C\u0647\u0627\u06CC \u067E\u0627\u06CC\u0647 \u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC \u0634\u062F\u0646\u062F.";
            showToast("\u062D\u0627\u0644\u062A \u0645\u062D\u062F\u0648\u062F", "\u0628\u0631\u0627\u06CC \u0647\u0645\u0647 \u0627\u0645\u06A9\u0627\u0646\u0627\u062A\u060C \u0645\u06CC\u0646\u06CC\u200C\u0627\u067E \u0631\u0627 \u0627\u0632 \u062F\u0627\u062E\u0644 \u062A\u0644\u06AF\u0631\u0627\u0645 \u0628\u0627\u0632 \u06A9\u0646\u06CC\u062F.", "GUEST", false);
            if (status === 401)
                out.textContent = "\u0627\u062A\u0635\u0627\u0644 \u06A9\u0627\u0645\u0644 \u0628\u0631\u0642\u0631\u0627\u0631 \u0646\u0634\u062F.\n\n" + MINIAPP_EXEC_CHECKLIST_TEXT;
            setupLiveQuotePolling();
            setupNewsPolling();
            return;
        }
        OFFLINE_MODE = !navigator.onLine;
        IS_GUEST = true;
        applyUserState(cached);
        out.textContent = OFFLINE_MODE
            ? "\u062D\u0627\u0644\u062A \u0622\u0641\u0644\u0627\u06CC\u0646 \u0641\u0639\u0627\u0644 \u0634\u062F \u2705 \u0627\u0645\u06A9\u0627\u0646\u0627\u062A \u0627\u0632 \u06A9\u0634 \u0645\u062D\u0644\u06CC \u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC \u0645\u06CC\u200C\u0634\u0648\u062F."
            : "\u062D\u0627\u0644\u062A \u0645\u062D\u062F\u0648\u062F \u0641\u0639\u0627\u0644 \u0634\u062F \u2705 \u062F\u0627\u062F\u0647\u200C\u0647\u0627\u06CC \u0630\u062E\u06CC\u0631\u0647\u200C\u0634\u062F\u0647 \u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC \u0634\u062F \u0648 \u0627\u062A\u0635\u0627\u0644 \u062E\u0648\u0627\u0646\u062F\u0646\u06CC \u062F\u0631 \u062D\u0627\u0644 \u062A\u0644\u0627\u0634 \u0627\u0633\u062A.";
        pillTxt.textContent = OFFLINE_MODE ? "Offline (Cached)" : "Limited (Guest)";
        hideToast();
        showToast(OFFLINE_MODE ? "\u0622\u0641\u0644\u0627\u06CC\u0646" : "\u062D\u0627\u0644\u062A \u0645\u062D\u062F\u0648\u062F", OFFLINE_MODE ? "\u062F\u0627\u062F\u0647\u200C\u0647\u0627\u06CC \u0630\u062E\u06CC\u0631\u0647\u200C\u0634\u062F\u0647 \u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC \u0634\u062F" : "\u0627\u062A\u0635\u0627\u0644 \u062E\u0648\u0627\u0646\u062F\u0646\u06CC \u0645\u0647\u0645\u0627\u0646 \u0641\u0639\u0627\u0644 \u0634\u062F", OFFLINE_MODE ? "CACHE" : "GUEST", false);
        setupLiveQuotePolling();
        setupNewsPolling();
        return;
    }
    OFFLINE_MODE = false;
    if (json === null || json === void 0 ? void 0 : json.miniToken) {
        MINI_TOKEN = String(json.miniToken || "").trim();
        try {
            localStorage.setItem(LOCAL_KEYS.miniToken, MINI_TOKEN);
        }
        catch (_e) { }
    }
    cacheUserSnapshot(json);
    applyUserState(json);
    out.textContent = "\u0622\u0645\u0627\u062F\u0647 \u2705";
    pillTxt.textContent = "Online";
    hideToast();
    setupLiveQuotePolling();
    setupNewsPolling();
    IS_STAFF = !!json.isStaff;
    IS_OWNER = json.role === "owner";
    IS_GUEST = !!json.guest;
    if (IS_GUEST) {
        const ae = String(json.authError || "").trim();
        if (ae) {
            out.textContent = "\u062D\u0627\u0644\u062A \u0645\u0647\u0645\u0627\u0646 \u0641\u0639\u0627\u0644 \u0634\u062F. \u062E\u0637\u0627\u06CC \u0627\u062D\u0631\u0627\u0632: " + ae + "\n\n" + MINIAPP_EXEC_CHECKLIST_TEXT;
            showToast("\u062D\u0627\u0644\u062A \u0645\u0647\u0645\u0627\u0646", "Auth: " + ae, "GUEST", false);
        }
    }
    const adminTabBtn = document.querySelector('.tab-btn[data-tab="admin"]');
    const ownerTabBtn = document.querySelector('.tab-btn[data-tab="owner"]');
    if (adminTabBtn)
        adminTabBtn.style.display = IS_STAFF ? "inline-flex" : "none";
    if (ownerTabBtn)
        ownerTabBtn.style.display = IS_OWNER ? "inline-flex" : "none";
    if (IS_STAFF && adminCard) {
        adminCard.classList.add("show");
        setAdminTab("overview");
        if (adminTitle)
            adminTitle.textContent = IS_OWNER ? "\u067E\u0646\u0644 \u0627\u0648\u0646\u0631" : "\u067E\u0646\u0644 \u0627\u062F\u0645\u06CC\u0646";
        // Owner-only blocks
        document.querySelectorAll(".owner-hide").forEach((x) => {
            x.classList.toggle("hidden", !IS_OWNER);
        });
        if (el("offerBannerInput"))
            el("offerBannerInput").value = json.offerBanner || "";
        if (el("offerBannerImageUrlInput"))
            el("offerBannerImageUrlInput").value = json.offerBannerImage || "";
        if (IS_OWNER && el("walletAddressInput"))
            el("walletAddressInput").value = json.wallet || "";
        await loadAdminBootstrap();
    }
    else {
        applyTab("dashboard");
    }
}
async function loadAdminBootstrap() {
    var _a, _b;
    const { json } = await adminApi("/api/admin/bootstrap", {});
    if (!(json === null || json === void 0 ? void 0 : json.ok))
        return;
    if (el("adminPrompt"))
        el("adminPrompt").value = json.prompt || "";
    if (el("stylePromptJson"))
        el("stylePromptJson").value = JSON.stringify(json.stylePrompts || {}, null, 2);
    if (el("customPromptsJson"))
        el("customPromptsJson").value = JSON.stringify(json.customPrompts || [], null, 2);
    if (el("freeDailyLimit"))
        el("freeDailyLimit").value = String((_a = json.freeDailyLimit) !== null && _a !== void 0 ? _a : "");
    if (el("basePoints"))
        el("basePoints").value = String((_b = json.basePoints) !== null && _b !== void 0 ? _b : "");
    if (el("offerBannerInput"))
        el("offerBannerInput").value = json.offerBanner || "";
    if (el("offerBannerImageUrlInput"))
        el("offerBannerImageUrlInput").value = json.offerBannerImage || "";
    if (el("welcomeBotInput"))
        el("welcomeBotInput").value = json.welcomeBot || "";
    if (el("welcomeMiniappInput"))
        el("welcomeMiniappInput").value = json.welcomeMiniapp || "";
    if (json.adminFlags) {
        if (el("flagCapitalMode"))
            el("flagCapitalMode").checked = !!json.adminFlags.capitalModeEnabled;
        if (el("flagProfileTips"))
            el("flagProfileTips").checked = !!json.adminFlags.profileTipsEnabled;
    }
    renderStyleList(json.styles || []);
    renderCommissionList(json.commission || {});
    renderPayments(json.payments || []);
    renderTickets(json.tickets || []);
    renderWithdrawals(json.withdrawals || []);
    if (offerText)
        offerText.textContent = json.offerBanner || (offerText.textContent || "");
    if (offerImage) {
        const img = String(json.offerBannerImage || "").trim();
        offerImage.style.display = img ? "block" : "none";
        if (img)
            offerImage.src = img;
    }
    // load prompt requests
    if (el("promptReqSelect"))
        await refreshPromptReqs();
}
setupTabs();
applyTab("dashboard");
el("q").addEventListener("input", (e) => filterSymbols(e.target.value));
(_b = el("symbol")) === null || _b === void 0 ? void 0 : _b.addEventListener("change", () => { refreshLiveQuote(true); refreshSymbolNews(true); refreshNewsAnalysis(true); });
(_c = el("timeframe")) === null || _c === void 0 ? void 0 : _c.addEventListener("change", () => refreshLiveQuote(true));
(_d = el("refreshNews")) === null || _d === void 0 ? void 0 : _d.addEventListener("click", () => { refreshSymbolNews(true); refreshNewsAnalysis(true); });
el("tfChips").addEventListener("click", (e) => {
    var _a, _b, _c;
    const chip = (_b = (_a = e.target) === null || _a === void 0 ? void 0 : _a.closest) === null || _b === void 0 ? void 0 : _b.call(_a, ".chip");
    const tf = (_c = chip === null || chip === void 0 ? void 0 : chip.dataset) === null || _c === void 0 ? void 0 : _c.tf;
    if (!tf)
        return;
    setTf(tf);
    refreshLiveQuote(true);
});
el("save").addEventListener("click", async () => {
    if (OFFLINE_MODE || IS_GUEST) {
        showToast("\u0645\u062D\u062F\u0648\u062F", "\u062F\u0631 \u062D\u0627\u0644\u062A \u0622\u0641\u0644\u0627\u06CC\u0646/\u0645\u0647\u0645\u0627\u0646 \u0630\u062E\u06CC\u0631\u0647 \u0631\u0648\u06CC \u0633\u0631\u0648\u0631 \u0645\u0645\u06A9\u0646 \u0646\u06CC\u0633\u062A.", "SET", false);
        return;
    }
    showToast("\u062F\u0631 \u062D\u0627\u0644 \u0630\u062E\u06CC\u0631\u0647\u2026", "\u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u0630\u062E\u06CC\u0631\u0647 \u0645\u06CC\u200C\u0634\u0648\u062F", "SET", true);
    out.textContent = "\u23F3 \u0630\u062E\u06CC\u0631\u0647 \u062A\u0646\u0638\u06CC\u0645\u0627\u062A\u2026";
    const payload = buildAuthBody({
        timeframe: val("timeframe"),
        style: val("style"),
        risk: val("risk"),
        newsEnabled: val("newsEnabled") === "true",
        promptMode: val("promptMode") || "style_plus_custom",
        selectedSymbol: val("symbol") || "",
        customPromptId: val("customPrompt") || "",
    });
    const { status, json } = await api("/api/settings", payload);
    if (!(json === null || json === void 0 ? void 0 : json.ok)) {
        out.textContent = "\u26A0\uFE0F \u062E\u0637\u0627: " + prettyErr(json, status);
        showToast("\u062E\u0637\u0627", prettyErr(json, status), "SET", false);
        return;
    }
    out.textContent = "\u2705 \u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u0630\u062E\u06CC\u0631\u0647 \u0634\u062F.";
    updateMeta(json.state, json.quota);
    showToast("\u0630\u062E\u06CC\u0631\u0647 \u0634\u062F \u2705", "\u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u0627\u0639\u0645\u0627\u0644 \u0634\u062F", "OK", false);
    setTimeout(hideToast, 1200);
});
el("analyze").addEventListener("click", async () => {
    var _a, _b;
    if (OFFLINE_MODE || IS_GUEST) {
        const symbol = val("symbol") || "";
        const cached = readByKey(LOCAL_KEYS.analyzeCache, analyzeCacheKey(symbol));
        if (cached === null || cached === void 0 ? void 0 : cached.result) {
            out.textContent = cached.result;
            if (cached === null || cached === void 0 ? void 0 : cached.zonesSvg)
                renderChartFallbackSvg(cached.zonesSvg);
            showToast("\u0622\u0641\u0644\u0627\u06CC\u0646", "\u0622\u062E\u0631\u06CC\u0646 \u062A\u062D\u0644\u06CC\u0644 \u0630\u062E\u06CC\u0631\u0647\u200C\u0634\u062F\u0647 \u0646\u0645\u0627\u06CC\u0634 \u062F\u0627\u062F\u0647 \u0634\u062F.", "AI", false);
        }
        else {
            out.textContent = "\u26A0\uFE0F \u062A\u062D\u0644\u06CC\u0644 \u0622\u0646\u0644\u0627\u06CC\u0646 \u062F\u0631 \u062D\u0627\u0644\u062A \u0622\u0641\u0644\u0627\u06CC\u0646/\u0645\u0647\u0645\u0627\u0646 \u063A\u06CC\u0631\u0641\u0639\u0627\u0644 \u0627\u0633\u062A. \u0628\u0631\u0627\u06CC \u0627\u062F\u0627\u0645\u0647 \u0627\u0632 \u062F\u0627\u062E\u0644 \u062A\u0644\u06AF\u0631\u0627\u0645 \u0645\u062A\u0635\u0644 \u0634\u0648\u06CC\u062F.";
            showToast("\u0645\u062D\u062F\u0648\u062F", "\u062A\u062D\u0644\u06CC\u0644 \u0646\u06CC\u0627\u0632 \u0628\u0647 \u0627\u062A\u0635\u0627\u0644 \u0648 \u0627\u062D\u0631\u0627\u0632 \u062A\u0644\u06AF\u0631\u0627\u0645 \u062F\u0627\u0631\u062F.", "AI", false);
        }
        return;
    }
    showToast("\u062F\u0631 \u062D\u0627\u0644 \u062A\u062D\u0644\u06CC\u0644\u2026", "\u062C\u0645\u0639\u200C\u0622\u0648\u0631\u06CC \u062F\u06CC\u062A\u0627 + \u062A\u0648\u0644\u06CC\u062F \u062E\u0631\u0648\u062C\u06CC", "AI", true);
    out.textContent = "\u23F3 \u062F\u0631 \u062D\u0627\u0644 \u062A\u062D\u0644\u06CC\u0644\u2026";
    const payload = buildAuthBody({ symbol: val("symbol"), userPrompt: "" });
    const { status, json } = await api("/api/analyze", payload);
    if (!(json === null || json === void 0 ? void 0 : json.ok)) {
        const msg = prettyErr(json, status);
        out.textContent = "\u26A0\uFE0F " + msg;
        showToast("\u062E\u0637\u0627", msg, status === 429 ? "Quota" : "AI", false);
        return;
    }
    out.textContent = json.result || "\u26A0\uFE0F \u0628\u062F\u0648\u0646 \u062E\u0631\u0648\u062C\u06CC";
    cacheByKey(LOCAL_KEYS.analyzeCache, analyzeCacheKey(val("symbol") || ""), {
        result: json.result || "",
        chartUrl: json.chartUrl || "",
        zonesSvg: json.zonesSvg || "",
        state: json.state || {},
        quota: json.quota || "",
    });
    await refreshLiveQuote(true);
    await refreshSymbolNews(true);
    // Render chart if available
    const chartCard = el("chartCard");
    const chartImg = el("chartImg");
    if (chartCard && chartImg) {
        const u = json.chartUrl || "";
        const fallbackSvg = json.zonesSvg || "";
        const tf = ((_a = json === null || json === void 0 ? void 0 : json.quickchartConfig) === null || _a === void 0 ? void 0 : _a.timeframe) || val("timeframe") || "H4";
        const zones = Array.isArray(json === null || json === void 0 ? void 0 : json.levels) ? json.levels.length : 0;
        const candleCount = Number(((_b = json === null || json === void 0 ? void 0 : json.chartMeta) === null || _b === void 0 ? void 0 : _b.candles) || 0);
        const cm = el("chartMeta");
        if (u) {
            chartImg.onerror = () => {
                chartImg.onerror = null;
                if (fallbackSvg) {
                    renderChartFallbackSvg(fallbackSvg);
                    const cmFallback = el("chartMeta");
                    if (cmFallback)
                        cmFallback.textContent = "Zones SVG | TF: " + tf + " | zones: " + zones;
                    return;
                }
                chartImg.removeAttribute("src");
                chartCard.style.display = "none";
            };
            chartImg.src = u;
            chartCard.style.display = "block";
            if (cm)
                cm.textContent = "Candlestick | TF: " + tf + " | candles: " + candleCount + " | zones: " + zones;
        }
        else if (fallbackSvg) {
            renderChartFallbackSvg(fallbackSvg);
            if (cm)
                cm.textContent = "Zones SVG | TF: " + tf + " | zones: " + zones;
        }
        else {
            chartImg.removeAttribute("src");
            chartCard.style.display = "none";
        }
    }
    updateMeta(json.state, json.quota);
    showToast("\u0622\u0645\u0627\u062F\u0647 \u2705", "\u062E\u0631\u0648\u062C\u06CC \u062F\u0631\u06CC\u0627\u0641\u062A \u0634\u062F", "OK", false);
    setTimeout(hideToast, 1200);
});
(_e = el("sendSupportTicket")) === null || _e === void 0 ? void 0 : _e.addEventListener("click", async () => {
    var _a;
    if (OFFLINE_MODE || IS_GUEST) {
        showToast("\u0645\u062D\u062F\u0648\u062F", "\u0627\u0631\u0633\u0627\u0644 \u062A\u06CC\u06A9\u062A \u062F\u0631 \u062D\u0627\u0644\u062A \u0622\u0641\u0644\u0627\u06CC\u0646/\u0645\u0647\u0645\u0627\u0646 \u0645\u0645\u06A9\u0646 \u0646\u06CC\u0633\u062A.", "SUP", false);
        return;
    }
    const text = (((_a = el("supportTicketText")) === null || _a === void 0 ? void 0 : _a.value) || "").trim();
    if (!text || text.length < 4) {
        showToast("\u062E\u0637\u0627", "\u0645\u062A\u0646 \u062A\u06CC\u06A9\u062A \u062E\u06CC\u0644\u06CC \u06A9\u0648\u062A\u0627\u0647 \u0627\u0633\u062A.", "SUP", false);
        return;
    }
    if (text.length > 300) {
        showToast("\u062E\u0637\u0627", "\u062D\u062F\u0627\u06A9\u062B\u0631 \u06F3\u06F0\u06F0 \u06A9\u0627\u0631\u0627\u06A9\u062A\u0631 \u0645\u062C\u0627\u0632 \u0627\u0633\u062A.", "SUP", false);
        return;
    }
    showToast("\u062F\u0631 \u062D\u0627\u0644 \u0627\u0631\u0633\u0627\u0644\u2026", "\u062A\u06CC\u06A9\u062A \u062F\u0631 \u062D\u0627\u0644 \u062B\u0628\u062A \u0627\u0633\u062A", "SUP", true);
    const { status, json } = await api("/api/support/ticket", buildAuthBody({ text }));
    if (!(json === null || json === void 0 ? void 0 : json.ok)) {
        const msg = (json === null || json === void 0 ? void 0 : json.error) === "support_unavailable"
            ? "\u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u06CC \u062F\u0631 \u062F\u0633\u062A\u0631\u0633 \u0646\u06CC\u0633\u062A."
            : "\u0627\u0631\u0633\u0627\u0644 \u062A\u06CC\u06A9\u062A \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F.";
        showToast("\u062E\u0637\u0627", msg, "SUP", false);
        return;
    }
    if (el("supportTicketText"))
        el("supportTicketText").value = "";
    showToast("\u0627\u0631\u0633\u0627\u0644 \u0634\u062F \u2705", "\u062A\u06CC\u06A9\u062A \u0634\u0645\u0627 \u062B\u0628\u062A \u0634\u062F", "SUP", false);
    setTimeout(hideToast, 1200);
});
el("close").addEventListener("click", () => tg === null || tg === void 0 ? void 0 : tg.close());
(_f = el("savePrompt")) === null || _f === void 0 ? void 0 : _f.addEventListener("click", async () => {
    var _a;
    const prompt = ((_a = el("adminPrompt")) === null || _a === void 0 ? void 0 : _a.value) || "";
    const { json } = await adminApi("/api/admin/prompt", { prompt });
    if (json === null || json === void 0 ? void 0 : json.ok)
        showToast("\u0630\u062E\u06CC\u0631\u0647 \u0634\u062F \u2705", "\u067E\u0631\u0627\u0645\u067E\u062A \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F", "ADM", false);
});
(_g = el("saveStylePrompts")) === null || _g === void 0 ? void 0 : _g.addEventListener("click", async () => {
    var _a;
    const raw = ((_a = el("stylePromptJson")) === null || _a === void 0 ? void 0 : _a.value) || "{}";
    const stylePrompts = safeJsonParse(raw, {});
    const { json } = await adminApi("/api/admin/style-prompts", { stylePrompts });
    if (json === null || json === void 0 ? void 0 : json.ok)
        showToast("\u0630\u062E\u06CC\u0631\u0647 \u0634\u062F \u2705", "JSON \u0633\u0628\u06A9\u200C\u0647\u0627 \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F", "ADM", false);
});
(_h = el("addStyle")) === null || _h === void 0 ? void 0 : _h.addEventListener("click", async () => {
    var _a;
    const style = ((_a = el("newStyle")) === null || _a === void 0 ? void 0 : _a.value) || "";
    const { json } = await adminApi("/api/admin/styles", { action: "add", style });
    if (json === null || json === void 0 ? void 0 : json.ok) {
        renderStyleList(json.styles || []);
        fillStyles(json.styles || []);
    }
});
(_j = el("removeStyle")) === null || _j === void 0 ? void 0 : _j.addEventListener("click", async () => {
    var _a;
    const style = ((_a = el("removeStyleName")) === null || _a === void 0 ? void 0 : _a.value) || "";
    const { json } = await adminApi("/api/admin/styles", { action: "remove", style });
    if (json === null || json === void 0 ? void 0 : json.ok) {
        renderStyleList(json.styles || []);
        fillStyles(json.styles || []);
    }
});
(_k = el("saveGlobalCommission")) === null || _k === void 0 ? void 0 : _k.addEventListener("click", async () => {
    var _a;
    const percent = Number(((_a = el("globalCommission")) === null || _a === void 0 ? void 0 : _a.value) || 0);
    const { json } = await adminApi("/api/admin/commissions", { action: "setGlobal", percent });
    if (json === null || json === void 0 ? void 0 : json.ok)
        renderCommissionList(json.commission || {});
});
(_l = el("saveUserCommission")) === null || _l === void 0 ? void 0 : _l.addEventListener("click", async () => {
    var _a, _b;
    const username = ((_a = el("commissionUser")) === null || _a === void 0 ? void 0 : _a.value) || "";
    const percent = Number(((_b = el("commissionPercent")) === null || _b === void 0 ? void 0 : _b.value) || 0);
    const { json } = await adminApi("/api/admin/commissions", { action: "setOverride", username, percent });
    if (json === null || json === void 0 ? void 0 : json.ok)
        renderCommissionList(json.commission || {});
});
(_m = el("saveFreeLimit")) === null || _m === void 0 ? void 0 : _m.addEventListener("click", async () => {
    var _a;
    const limit = Number(((_a = el("freeDailyLimit")) === null || _a === void 0 ? void 0 : _a.value) || 3);
    const { json } = await adminApi("/api/admin/free-limit", { limit });
    if (json === null || json === void 0 ? void 0 : json.ok)
        showToast("\u0630\u062E\u06CC\u0631\u0647 \u0634\u062F \u2705", "\u0633\u0647\u0645\u06CC\u0647 \u0631\u0627\u06CC\u06AF\u0627\u0646 \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F", "ADM", false);
});
(_o = el("saveBasePoints")) === null || _o === void 0 ? void 0 : _o.addEventListener("click", async () => {
    var _a;
    const basePoints = Number(((_a = el("basePoints")) === null || _a === void 0 ? void 0 : _a.value) || 0);
    const { json } = await adminApi("/api/admin/points/base", { basePoints });
    if (json === null || json === void 0 ? void 0 : json.ok)
        showToast("\u0630\u062E\u06CC\u0631\u0647 \u0634\u062F \u2705", "\u0627\u0645\u062A\u06CC\u0627\u0632 \u067E\u0627\u06CC\u0647 \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F", "ADM", false);
});
(_p = el("saveOfferBanner")) === null || _p === void 0 ? void 0 : _p.addEventListener("click", async () => {
    var _a, _b, _c, _d;
    const offerBanner = ((_a = el("offerBannerInput")) === null || _a === void 0 ? void 0 : _a.value) || "";
    let offerBannerImage = undefined;
    const file = (_c = (_b = el("offerImageFile")) === null || _b === void 0 ? void 0 : _b.files) === null || _c === void 0 ? void 0 : _c[0];
    const imageUrl = String(((_d = el("offerBannerImageUrlInput")) === null || _d === void 0 ? void 0 : _d.value) || "").trim();
    if (file) {
        offerBannerImage = await fileToDataUrl(file);
    }
    else if (imageUrl) {
        offerBannerImage = imageUrl;
    }
    const { json } = await adminApi("/api/admin/offer", { offerBanner, offerBannerImage });
    if (json === null || json === void 0 ? void 0 : json.ok) {
        if (offerText)
            offerText.textContent = json.offerBanner || offerBanner;
        if (offerImage) {
            const img = String(json.offerBannerImage || "").trim();
            offerImage.style.display = img ? "block" : "none";
            if (img)
                offerImage.src = img;
        }
        showToast("\u0630\u062E\u06CC\u0631\u0647 \u0634\u062F \u2705", "\u0628\u0646\u0631 \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F", "ADM", false);
        setTimeout(hideToast, 1200);
    }
    else {
        showToast("\u062E\u0637\u0627", "\u0630\u062E\u06CC\u0631\u0647 \u0628\u0646\u0631 \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F", "ADM", false);
    }
});
(_q = el("offerImageFile")) === null || _q === void 0 ? void 0 : _q.addEventListener("change", async (ev) => {
    var _a, _b;
    const file = (_b = (_a = ev === null || ev === void 0 ? void 0 : ev.target) === null || _a === void 0 ? void 0 : _a.files) === null || _b === void 0 ? void 0 : _b[0];
    if (!file)
        return;
    if (file.size > 1024 * 1024) {
        showToast("\u062E\u0637\u0627", "\u062D\u062C\u0645 \u062A\u0635\u0648\u06CC\u0631 \u0628\u0627\u06CC\u062F \u06A9\u0645\u062A\u0631 \u0627\u0632 1MB \u0628\u0627\u0634\u062F", "ADM", false);
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        if (el("offerBannerImageUrlInput"))
            el("offerBannerImageUrlInput").value = dataUrl;
        if (offerImg)
            offerImg.src = dataUrl;
        if (offerMedia)
            offerMedia.classList.toggle("show", !!dataUrl);
    };
    reader.readAsDataURL(file);
});
(_r = el("clearOfferImage")) === null || _r === void 0 ? void 0 : _r.addEventListener("click", async () => {
    var _a;
    const offerBanner = ((_a = el("offerBannerInput")) === null || _a === void 0 ? void 0 : _a.value) || "";
    const { json } = await adminApi("/api/admin/offer", { offerBanner, clearOfferBannerImage: true });
    if (el("offerBannerImageUrlInput"))
        el("offerBannerImageUrlInput").value = "";
    if (el("offerImageFile"))
        el("offerImageFile").value = "";
    if (offerImg)
        offerImg.src = "";
    if (offerMedia)
        offerMedia.classList.remove("show");
    if (json === null || json === void 0 ? void 0 : json.ok)
        showToast("\u0627\u0646\u062C\u0627\u0645 \u0634\u062F \u2705", "\u062A\u0635\u0648\u06CC\u0631 \u0628\u0646\u0631 \u062D\u0630\u0641 \u0634\u062F", "ADM", false);
});
(_s = el("saveWelcomeTexts")) === null || _s === void 0 ? void 0 : _s.addEventListener("click", async () => {
    var _a, _b;
    const welcomeBot = ((_a = el("welcomeBotInput")) === null || _a === void 0 ? void 0 : _a.value) || "";
    const welcomeMiniapp = ((_b = el("welcomeMiniappInput")) === null || _b === void 0 ? void 0 : _b.value) || "";
    const { json } = await adminApi("/api/admin/welcome", { welcomeBot, welcomeMiniapp });
    if (json === null || json === void 0 ? void 0 : json.ok) {
        if (el("welcomeBotInput"))
            el("welcomeBotInput").value = json.welcomeBot || welcomeBot;
        if (el("welcomeMiniappInput"))
            el("welcomeMiniappInput").value = json.welcomeMiniapp || welcomeMiniapp;
        if (welcome)
            welcome.textContent = json.welcomeMiniapp || welcome.textContent;
        showToast("\u0630\u062E\u06CC\u0631\u0647 \u0634\u062F \u2705", "\u0645\u062A\u0646 \u062E\u0648\u0634\u200C\u0622\u0645\u062F\u06AF\u0648\u06CC\u06CC \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F", "ADM", false);
        setTimeout(hideToast, 1200);
    }
    else {
        showToast("\u062E\u0637\u0627", "\u0630\u062E\u06CC\u0631\u0647 \u0645\u062A\u0646 \u062E\u0648\u0634\u200C\u0622\u0645\u062F\u06AF\u0648\u06CC\u06CC \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F", "ADM", false);
    }
});
(_t = el("saveFeatureFlags")) === null || _t === void 0 ? void 0 : _t.addEventListener("click", async () => {
    var _a, _b;
    const capitalModeEnabled = !!((_a = el("flagCapitalMode")) === null || _a === void 0 ? void 0 : _a.checked);
    const profileTipsEnabled = !!((_b = el("flagProfileTips")) === null || _b === void 0 ? void 0 : _b.checked);
    const { json } = await adminApi("/api/admin/features", { capitalModeEnabled, profileTipsEnabled });
    if (json === null || json === void 0 ? void 0 : json.ok) {
        showToast("\u0630\u062E\u06CC\u0631\u0647 \u0634\u062F \u2705", "\u0648\u06CC\u0698\u06AF\u06CC\u200C\u0647\u0627 \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F", "OWN", false);
        setTimeout(hideToast, 1200);
    }
    else {
        showToast("\u062E\u0637\u0627", "\u0630\u062E\u06CC\u0631\u0647 \u0648\u06CC\u0698\u06AF\u06CC\u200C\u0647\u0627 \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F", "OWN", false);
    }
});
(_u = el("saveWallet")) === null || _u === void 0 ? void 0 : _u.addEventListener("click", async () => {
    var _a;
    const wallet = ((_a = el("walletAddressInput")) === null || _a === void 0 ? void 0 : _a.value) || "";
    const { json } = await adminApi("/api/admin/wallet", { wallet });
    if (json === null || json === void 0 ? void 0 : json.ok) {
        showToast("\u0630\u062E\u06CC\u0631\u0647 \u0634\u062F \u2705", "\u0622\u062F\u0631\u0633 \u0648\u0644\u062A \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F", "OWN", false);
        setTimeout(hideToast, 1200);
    }
    else {
        showToast("\u062E\u0637\u0627", "\u0630\u062E\u06CC\u0631\u0647 \u0622\u062F\u0631\u0633 \u0648\u0644\u062A \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F", "OWN", false);
    }
});
(_v = el("refreshTickets")) === null || _v === void 0 ? void 0 : _v.addEventListener("click", async () => {
    showToast("\u062F\u0631 \u062D\u0627\u0644 \u062F\u0631\u06CC\u0627\u0641\u062A\u2026", "\u0644\u06CC\u0633\u062A \u062A\u06CC\u06A9\u062A\u200C\u0647\u0627", "TICKET", true);
    await refreshTickets();
    showToast("\u0622\u0645\u0627\u062F\u0647 \u2705", "\u062A\u06CC\u06A9\u062A\u200C\u0647\u0627 \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F", "TICKET", false);
    setTimeout(hideToast, 1000);
});
(_w = el("updateTicket")) === null || _w === void 0 ? void 0 : _w.addEventListener("click", async () => {
    var _a, _b, _c;
    const id = ((_a = el("ticketSelect")) === null || _a === void 0 ? void 0 : _a.value) || "";
    const status = ((_b = el("ticketStatus")) === null || _b === void 0 ? void 0 : _b.value) || "pending";
    const reply = (((_c = el("ticketReply")) === null || _c === void 0 ? void 0 : _c.value) || "").trim();
    if (!id) {
        showToast("\u062E\u0637\u0627", "\u06CC\u06A9 \u062A\u06CC\u06A9\u062A \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646\u06CC\u062F.", "TICKET", false);
        return;
    }
    showToast("\u062F\u0631 \u062D\u0627\u0644 \u062B\u0628\u062A\u2026", "\u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u062A\u06CC\u06A9\u062A", "TICKET", true);
    const { json } = await adminApi("/api/admin/tickets/update", { id, status, reply });
    if (json === null || json === void 0 ? void 0 : json.ok) {
        if (el("ticketReply"))
            el("ticketReply").value = "";
        await refreshTickets();
        showToast("\u062B\u0628\u062A \u0634\u062F \u2705", "\u062A\u06CC\u06A9\u062A \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F", "TICKET", false);
        setTimeout(hideToast, 1200);
    }
    else {
        showToast("\u062E\u0637\u0627", "\u062B\u0628\u062A \u062A\u06CC\u06A9\u062A \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F", "TICKET", false);
    }
});
(_x = el("ticketSelect")) === null || _x === void 0 ? void 0 : _x.addEventListener("change", () => {
    var _a;
    const id = ((_a = el("ticketSelect")) === null || _a === void 0 ? void 0 : _a.value) || "";
    const t = ADMIN_TICKETS.find((x) => x.id === id);
    if (t && el("ticketStatus"))
        el("ticketStatus").value = t.status || "pending";
});
(_y = el("ticketReplyTemplate")) === null || _y === void 0 ? void 0 : _y.addEventListener("change", pickTicketReplyTemplate);
(_z = el("ticketQuickPending")) === null || _z === void 0 ? void 0 : _z.addEventListener("click", () => applyTicketFilter("pending"));
(_0 = el("ticketQuickAnswered")) === null || _0 === void 0 ? void 0 : _0.addEventListener("click", () => applyTicketFilter("answered"));
(_1 = el("refreshWithdrawals")) === null || _1 === void 0 ? void 0 : _1.addEventListener("click", async () => {
    showToast("\u062F\u0631 \u062D\u0627\u0644 \u062F\u0631\u06CC\u0627\u0641\u062A\u2026", "\u0644\u06CC\u0633\u062A \u0628\u0631\u062F\u0627\u0634\u062A\u200C\u0647\u0627", "WD", true);
    await refreshWithdrawals();
    showToast("\u0622\u0645\u0627\u062F\u0647 \u2705", "\u0628\u0631\u062F\u0627\u0634\u062A\u200C\u0647\u0627 \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F", "WD", false);
    setTimeout(hideToast, 1000);
});
(_2 = el("reviewWithdrawalBtn")) === null || _2 === void 0 ? void 0 : _2.addEventListener("click", async () => {
    var _a, _b, _c;
    const id = ((_a = el("withdrawSelect")) === null || _a === void 0 ? void 0 : _a.value) || "";
    const decision = ((_b = el("withdrawDecision")) === null || _b === void 0 ? void 0 : _b.value) || "rejected";
    const txHash = (((_c = el("withdrawTxHash")) === null || _c === void 0 ? void 0 : _c.value) || "").trim();
    if (!id) {
        showToast("\u062E\u0637\u0627", "\u06CC\u06A9 \u0628\u0631\u062F\u0627\u0634\u062A \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646\u06CC\u062F.", "WD", false);
        return;
    }
    showToast("\u062F\u0631 \u062D\u0627\u0644 \u062B\u0628\u062A\u2026", "\u0628\u0631\u0631\u0633\u06CC \u0628\u0631\u062F\u0627\u0634\u062A", "WD", true);
    const { json } = await adminApi("/api/admin/withdrawals/review", { id, decision, txHash });
    if (json === null || json === void 0 ? void 0 : json.ok) {
        if (el("withdrawTxHash"))
            el("withdrawTxHash").value = "";
        await refreshWithdrawals();
        showToast("\u062B\u0628\u062A \u0634\u062F \u2705", "\u0628\u0631\u062F\u0627\u0634\u062A \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F", "WD", false);
        setTimeout(hideToast, 1200);
    }
    else {
        showToast("\u062E\u0637\u0627", "\u062B\u0628\u062A \u0628\u0631\u062F\u0627\u0634\u062A \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F", "WD", false);
    }
});
(_3 = el("refreshPromptReqs")) === null || _3 === void 0 ? void 0 : _3.addEventListener("click", async () => {
    showToast("\u062F\u0631 \u062D\u0627\u0644 \u062F\u0631\u06CC\u0627\u0641\u062A\u2026", "\u062F\u0631\u062E\u0648\u0627\u0633\u062A\u200C\u0647\u0627\u06CC \u067E\u0631\u0627\u0645\u067E\u062A", "PR", true);
    await refreshPromptReqs();
    showToast("\u0622\u0645\u0627\u062F\u0647 \u2705", "\u0644\u06CC\u0633\u062A \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F", "PR", false);
    setTimeout(hideToast, 1000);
});
(_4 = el("decidePromptReqBtn")) === null || _4 === void 0 ? void 0 : _4.addEventListener("click", async () => {
    var _a, _b, _c;
    const requestId = ((_a = el("promptReqSelect")) === null || _a === void 0 ? void 0 : _a.value) || "";
    const status = ((_b = el("promptReqDecision")) === null || _b === void 0 ? void 0 : _b.value) || "rejected";
    const promptId = (((_c = el("promptReqPromptId")) === null || _c === void 0 ? void 0 : _c.value) || "").trim();
    if (!requestId) {
        showToast("\u062E\u0637\u0627", "\u06CC\u06A9 \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0631\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646\u06CC\u062F.", "PR", false);
        return;
    }
    if (status === "approved" && !promptId) {
        showToast("\u062E\u0637\u0627", "\u0628\u0631\u0627\u06CC \u062A\u0627\u06CC\u06CC\u062F \u0628\u0627\u06CC\u062F Prompt ID \u0648\u0627\u0631\u062F \u06A9\u0646\u06CC\u062F.", "PR", false);
        return;
    }
    showToast("\u062F\u0631 \u062D\u0627\u0644 \u062B\u0628\u062A\u2026", "\u0628\u0631\u0631\u0633\u06CC \u062F\u0631\u062E\u0648\u0627\u0633\u062A", "PR", true);
    const { json } = await adminApi("/api/admin/custom-prompts/requests", { action: "decide", requestId, status, promptId });
    if (json === null || json === void 0 ? void 0 : json.ok) {
        await refreshPromptReqs();
        showToast("\u062B\u0628\u062A \u0634\u062F \u2705", "\u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F", "PR", false);
        setTimeout(hideToast, 1200);
    }
    else {
        showToast("\u062E\u0637\u0627", "\u062B\u0628\u062A \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F", "PR", false);
    }
});
(_5 = el("promptReqSelect")) === null || _5 === void 0 ? void 0 : _5.addEventListener("change", () => {
    var _a;
    const id = ((_a = el("promptReqSelect")) === null || _a === void 0 ? void 0 : _a.value) || "";
    const r = ADMIN_PROMPT_REQS.find((x) => x.id === id);
    if (r && el("promptReqPromptId"))
        el("promptReqPromptId").value = r.promptId || "";
    if (r && el("promptReqDecision"))
        el("promptReqDecision").value = (r.status === "approved" ? "approved" : (r.status === "rejected" ? "rejected" : "rejected"));
});
(_6 = el("saveCapitalToggle")) === null || _6 === void 0 ? void 0 : _6.addEventListener("click", async () => {
    var _a, _b;
    const username = (((_a = el("capitalToggleUser")) === null || _a === void 0 ? void 0 : _a.value) || "").trim();
    const enabled = (((_b = el("capitalToggleEnabled")) === null || _b === void 0 ? void 0 : _b.value) || "true") === "true";
    if (!username) {
        showToast("\u062E\u0637\u0627", "\u06CC\u0648\u0632\u0631\u0646\u06CC\u0645 \u0631\u0627 \u0648\u0627\u0631\u062F \u06A9\u0646\u06CC\u062F.", "CAP", false);
        return;
    }
    const { json } = await adminApi("/api/admin/capital/toggle", { username, enabled });
    if (json === null || json === void 0 ? void 0 : json.ok) {
        showToast("\u062B\u0628\u062A \u0634\u062F \u2705", "\u062A\u0646\u0638\u06CC\u0645 \u0633\u0631\u0645\u0627\u06CC\u0647 \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F", "CAP", false);
        setTimeout(hideToast, 1200);
    }
    else {
        showToast("\u062E\u0637\u0627", "\u062B\u0628\u062A \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F", "CAP", false);
    }
});
(_7 = el("customPromptsJsonFile")) === null || _7 === void 0 ? void 0 : _7.addEventListener("change", async (ev) => {
    var _a, _b;
    const file = (_b = (_a = ev === null || ev === void 0 ? void 0 : ev.target) === null || _a === void 0 ? void 0 : _a.files) === null || _b === void 0 ? void 0 : _b[0];
    if (!file)
        return;
    try {
        const txt = await file.text();
        const parsed = safeJsonParse(txt, null);
        if (!Array.isArray(parsed)) {
            showToast("\u062E\u0637\u0627", "\u0641\u0627\u06CC\u0644 JSON \u0628\u0627\u06CC\u062F \u0622\u0631\u0627\u06CC\u0647 \u0628\u0627\u0634\u062F", "ADM", false);
            return;
        }
        if (el("customPromptsJson"))
            el("customPromptsJson").value = JSON.stringify(parsed, null, 2);
        showToast("\u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC \u0634\u062F \u2705", "JSON \u067E\u0631\u0627\u0645\u067E\u062A \u0622\u0645\u0627\u062F\u0647 \u0630\u062E\u06CC\u0631\u0647 \u0627\u0633\u062A", "ADM", false);
    }
    catch (_c) {
        showToast("\u062E\u0637\u0627", "\u062E\u0648\u0627\u0646\u062F\u0646 \u0641\u0627\u06CC\u0644 JSON \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F", "ADM", false);
    }
});
(_8 = el("saveCustomPrompts")) === null || _8 === void 0 ? void 0 : _8.addEventListener("click", async () => {
    var _a;
    const raw = ((_a = el("customPromptsJson")) === null || _a === void 0 ? void 0 : _a.value) || "[]";
    const customPrompts = safeJsonParse(raw, []);
    const { json } = await adminApi("/api/admin/custom-prompts", { customPrompts });
    if (json === null || json === void 0 ? void 0 : json.ok) {
        showToast("\u0630\u062E\u06CC\u0631\u0647 \u0634\u062F \u2705", "\u067E\u0631\u0627\u0645\u067E\u062A\u200C\u0647\u0627\u06CC \u0627\u062E\u062A\u0635\u0627\u0635\u06CC \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F", "ADM", false);
        fillCustomPrompts(json.customPrompts || []);
    }
});
(_9 = el("sendCustomPrompt")) === null || _9 === void 0 ? void 0 : _9.addEventListener("click", async () => {
    var _a, _b;
    const username = ((_a = el("customPromptUser")) === null || _a === void 0 ? void 0 : _a.value) || "";
    const promptId = ((_b = el("customPromptId")) === null || _b === void 0 ? void 0 : _b.value) || "";
    const { json } = await adminApi("/api/admin/custom-prompts/send", { username, promptId });
    if (json === null || json === void 0 ? void 0 : json.ok)
        showToast("\u0627\u0631\u0633\u0627\u0644 \u0634\u062F \u2705", "\u067E\u0631\u0627\u0645\u067E\u062A \u0628\u0631\u0627\u06CC \u06A9\u0627\u0631\u0628\u0631 \u0627\u0631\u0633\u0627\u0644 \u0634\u062F", "ADM", false);
});
(_10 = el("approvePayment")) === null || _10 === void 0 ? void 0 : _10.addEventListener("click", async () => {
    var _a, _b, _c, _d;
    const payload = {
        username: (((_a = el("payUsername")) === null || _a === void 0 ? void 0 : _a.value) || "").trim(),
        amount: Number(((_b = el("payAmount")) === null || _b === void 0 ? void 0 : _b.value) || 0),
        days: Number(((_c = el("payDays")) === null || _c === void 0 ? void 0 : _c.value) || 30),
        txHash: (((_d = el("payTx")) === null || _d === void 0 ? void 0 : _d.value) || "").trim(),
    };
    if (!payload.username || !Number.isFinite(payload.amount) || payload.amount <= 0) {
        showToast("\u062E\u0637\u0627", "\u06CC\u0648\u0632\u0631\u0646\u06CC\u0645 \u0648 \u0645\u0628\u0644\u063A \u0645\u0639\u062A\u0628\u0631 \u0631\u0627 \u0648\u0627\u0631\u062F \u06A9\u0646\u06CC\u062F.", "PAY", false);
        return;
    }
    if (!Number.isFinite(payload.days) || payload.days <= 0)
        payload.days = 30;
    const { json } = await adminApi("/api/admin/payments/approve", payload);
    if (json === null || json === void 0 ? void 0 : json.ok) {
        showToast("\u067E\u0631\u062F\u0627\u062E\u062A \u062A\u0627\u06CC\u06CC\u062F \u0634\u062F \u2705", "\u0627\u0634\u062A\u0631\u0627\u06A9 \u0641\u0639\u0627\u0644 \u0634\u062F", "PAY", false);
        renderPayments([json.payment].filter(Boolean));
    }
    else {
        showToast("\u062E\u0637\u0627", "\u062A\u0627\u06CC\u06CC\u062F \u067E\u0631\u062F\u0627\u062E\u062A \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F", "PAY", false);
    }
});
(_11 = el("checkPayment")) === null || _11 === void 0 ? void 0 : _11.addEventListener("click", async () => {
    var _a, _b;
    const payload = {
        txHash: ((_a = el("payTx")) === null || _a === void 0 ? void 0 : _a.value) || "",
        amount: Number(((_b = el("payAmount")) === null || _b === void 0 ? void 0 : _b.value) || 0),
        address: "",
    };
    const { json } = await adminApi("/api/admin/payments/check", payload);
    if (json === null || json === void 0 ? void 0 : json.ok)
        showToast("\u0646\u062A\u06CC\u062C\u0647 \u0628\u0644\u0627\u06A9\u200C\u0686\u06CC\u0646", JSON.stringify(json.result || {}), "CHAIN", false);
});
(_12 = el("activateSubscription")) === null || _12 === void 0 ? void 0 : _12.addEventListener("click", async () => {
    var _a, _b, _c;
    const payload = {
        username: ((_a = el("payUsername")) === null || _a === void 0 ? void 0 : _a.value) || "",
        days: Number(((_b = el("payDays")) === null || _b === void 0 ? void 0 : _b.value) || 30),
        dailyLimit: Number(((_c = el("payDailyLimit")) === null || _c === void 0 ? void 0 : _c.value) || 50),
    };
    const { json } = await adminApi("/api/admin/subscription/activate", payload);
    if (json === null || json === void 0 ? void 0 : json.ok)
        showToast("\u0627\u0634\u062A\u0631\u0627\u06A9 \u0641\u0639\u0627\u0644 \u0634\u062F \u2705", "\u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u062F\u0633\u062A\u06CC \u0627\u0646\u062C\u0627\u0645 \u0634\u062F", "ADM", false);
});
(_13 = el("loadUsers")) === null || _13 === void 0 ? void 0 : _13.addEventListener("click", async () => {
    const [{ json: usersJson }, { json: bootJson }] = await Promise.all([
        adminApi("/api/admin/users", { limit: 200 }),
        adminApi("/api/admin/bootstrap", {}),
    ]);
    if ((usersJson === null || usersJson === void 0 ? void 0 : usersJson.ok) && (bootJson === null || bootJson === void 0 ? void 0 : bootJson.ok)) {
        renderFullAdminReport(usersJson.users || [], bootJson.payments || [], bootJson.withdrawals || [], bootJson.tickets || []);
    }
    else if (usersJson === null || usersJson === void 0 ? void 0 : usersJson.ok) {
        renderUsers(usersJson.users || []);
    }
});
(_14 = el("downloadReportPdf")) === null || _14 === void 0 ? void 0 : _14.addEventListener("click", async () => {
    try {
        showToast("\u062F\u0631 \u062D\u0627\u0644 \u0633\u0627\u062E\u062A PDF\u2026", "\u06AF\u0632\u0627\u0631\u0634 \u06A9\u0627\u0645\u0644", "PDF", true);
        const r = await fetch(apiUrl("/api/admin/report/pdf"), { method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ initData: INIT_DATA, limit: 250 }),
        });
        if (!r.ok)
            throw new Error("http_" + r.status);
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "admin-report-" + Date.now() + ".pdf";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast("\u062F\u0627\u0646\u0644\u0648\u062F \u0634\u062F \u2705", "\u06AF\u0632\u0627\u0631\u0634 PDF \u0622\u0645\u0627\u062F\u0647 \u0627\u0633\u062A", "PDF", false);
        setTimeout(hideToast, 1200);
    }
    catch (e) {
        showToast("\u062E\u0637\u0627", "\u0633\u0627\u062E\u062A PDF \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F", "PDF", false);
    }
});
(_15 = el("reconnect")) === null || _15 === void 0 ? void 0 : _15.addEventListener("click", async () => {
    OFFLINE_MODE = false;
    await boot();
});
window.addEventListener("online", () => {
    if (pillTxt && pillTxt.textContent.toLowerCase().includes("offline"))
        pillTxt.textContent = "Online";
});
window.addEventListener("offline", () => {
    if (pillTxt)
        pillTxt.textContent = "Offline";
});
(_16 = el("paymentPresets")) === null || _16 === void 0 ? void 0 : _16.addEventListener("click", (e) => {
    var _a, _b;
    const btn = (_b = (_a = e.target) === null || _a === void 0 ? void 0 : _a.closest) === null || _b === void 0 ? void 0 : _b.call(_a, "[data-days]");
    if (!btn)
        return;
    const days = Number(btn.getAttribute("data-days") || 30);
    const amount = Number(btn.getAttribute("data-amount") || 0);
    if (el("payDays"))
        el("payDays").value = String(days);
    if (el("payAmount"))
        el("payAmount").value = String(amount);
    if (el("payDailyLimit") && !el("payDailyLimit").value)
        el("payDailyLimit").value = "50";
    showToast("\u067E\u0644\u0646 \u0627\u0646\u062A\u062E\u0627\u0628 \u0634\u062F \u2705", "\u0631\u0648\u0632: " + days + " | \u0645\u0628\u0644\u063A: " + amount, "PAY", false);
});
boot();
`;


async function runDailySuggestions(env) {
  if (!env.BOT_KV) return;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Kyiv", hour: "2-digit", hour12: false }).format(new Date()));
  // exactly two pushes per day (09:00 and 18:00 Kyiv)
  if (![9, 18].includes(hour)) return;
  const users = await listUsers(env, 400);
  for (const u of users) {
    if (!u?.userId || !u?.profile?.phone) continue;
    const market = u.profile?.preferredMarket || "بازار";
    const style = u.style || "پرایس اکشن";
    const symbol = String(u?.selectedSymbol || u?.profile?.preferredSymbol || "BTCUSDT").toUpperCase();
    const cap = u.capital?.enabled === false ? "" : (u.capital?.amount ? (" | سرمایه: " + u.capital.amount) : "");
    const articles = await fetchSymbolNewsFa(symbol, env).catch(() => []);
    const newsBlock = Array.isArray(articles) && articles.length
      ? articles.slice(0, 2).map((x, i) => `${i + 1}) ${x?.title || ""}`).join(String.fromCharCode(10))
      : "";
    const newsLine = newsBlock
      ? ("\n\n📰 خبر مرتبط " + symbol + ":\n" + newsBlock)
      : "\n\n📰 فعلاً خبر مرتبطی برای این نماد پیدا نشد.";
    const newsSummary = await buildNewsAnalysisSummary(symbol, articles, env);
    const msg =
      "🔔 نوتیف تحلیلی روزانه (۱/۲ یا ۲/۲)\n" +
      "بر اساس پروفایل شما (" + market + " / " + style + cap + ")، برای " + symbol + " امروز ۲ تحلیل برنامه‌ریزی کن: یکی روندی، یکی برگشتی." +
      newsLine +
      "\n\n🧠 جمع‌بندی خبری:\n" + String(newsSummary || "-");
    await tgSendMessage(env, Number(u.userId), msg, mainMenuKeyboard(env));
  }
}