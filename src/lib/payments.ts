import type { Env } from "../env";
import type { PaymentRecord } from "../types";
import { getPayment, getUser, putPayment, putUser, getPlans } from "./storage";
import { nowIso, parseIntSafe } from "./utils";
import { fmtDateIso } from "./utils";
import { verifyBep20UsdtPayment } from "./paymentVerify";

async function tg(env: Env, method: string, body: any) {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function approvePaymentCore(env: Env, reviewerId: number, txid: string, approve: boolean) {
  const p = await getPayment(env, txid);
  if (!p) return { ok: false, reason: "payment not found" };
  if (p.status !== "PENDING") return { ok: false, reason: "already reviewed" };

  p.status = approve ? "APPROVED" : "REJECTED";
  p.reviewedAt = nowIso();
  p.reviewerId = reviewerId;
  await putPayment(env, p);

  if (approve) {
    const user = await getUser(env, p.userId);
    if (!user) return { ok: true };
    const now = Date.now();
    const days = p.planDays ?? parseIntSafe(env.SUB_DURATION_DAYS, 30);
    const base = user.subscription.expiresAt && Date.parse(user.subscription.expiresAt) > now ? Date.parse(user.subscription.expiresAt) : now;
    const expires = new Date(base + days * 24 * 3600 * 1000).toISOString();
    user.subscription.active = true;
    user.subscription.expiresAt = expires;
    user.subscription.lastTxId = txid;

    user.points += parseIntSafe(env.POINTS_PER_SUB_PURCHASE, 1000);
    await putUser(env, user);

    await tg(env, "sendMessage", { chat_id: user.id, text: `✅ پرداخت تایید شد.\nاشتراک فعال شد تا: ${fmtDateIso(expires, env.TZ)}` }).catch(() => {});
  }

  return { ok: true };
}

export async function autoVerifyPendingPayment(env: Env, p: PaymentRecord) {
  const plans = await getPlans(env);
  const expected = p.amountUsdt ?? (plans[0]?.priceUsdt ?? Number(env.SUB_PRICE_USDT || "25"));
  const v = await verifyBep20UsdtPayment(env, p.txid, expected);
  if (!v.ok) return { ok: false, reason: v.reason };
  return approvePaymentCore(env, 0, p.txid, true);
}
