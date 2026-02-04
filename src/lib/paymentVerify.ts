import type { Env } from "../env";
import { getPublicWallet } from "./storage";

const TRANSFER_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const DEFAULT_USDT_BSC = "0x55d398326f99059fF775485246999027B3197955";

function topicToAddress(topic: string): string {
  return "0x" + topic.slice(-40);
}

function hexToBigInt(hex: string): bigint {
  try {
    return BigInt(hex);
  } catch {
    return 0n;
  }
}

export async function verifyBep20UsdtPayment(
  env: Env,
  txid: string,
  expectedUsdt: number
): Promise<{ ok: boolean; reason?: string; amountUsdt?: number }> {
  if (!env.BSCSCAN_API_KEY) return { ok: false, reason: "BSCSCAN_API_KEY not set" };

  const wallet = await getPublicWallet(env);
  if (!wallet) return { ok: false, reason: "public wallet not set" };

  const contract = (env.USDT_BSC_CONTRACT || DEFAULT_USDT_BSC).toLowerCase();
  const decimals = parseInt(env.USDT_DECIMALS || "18", 10);
  const minConf = parseInt(env.AUTO_VERIFY_MIN_CONF || "1", 10);

  const receiptUrl = new URL("https://api.bscscan.com/api");
  receiptUrl.searchParams.set("module", "proxy");
  receiptUrl.searchParams.set("action", "eth_getTransactionReceipt");
  receiptUrl.searchParams.set("txhash", txid);
  receiptUrl.searchParams.set("apikey", env.BSCSCAN_API_KEY);

  const receiptRes = await fetch(receiptUrl.toString());
  const receiptJs: any = await receiptRes.json().catch(() => null);
  const r = receiptJs?.result;
  if (!r) return { ok: false, reason: "receipt not found yet" };

  if (r.status && String(r.status).toLowerCase() !== "0x1") return { ok: false, reason: "tx failed" };

  // confirmations
  if (r.blockNumber) {
    const latestUrl = new URL("https://api.bscscan.com/api");
    latestUrl.searchParams.set("module", "proxy");
    latestUrl.searchParams.set("action", "eth_blockNumber");
    latestUrl.searchParams.set("apikey", env.BSCSCAN_API_KEY);
    const latestRes = await fetch(latestUrl.toString());
    const latestJs: any = await latestRes.json().catch(() => null);
    if (latestJs?.result) {
      const conf = Number(hexToBigInt(latestJs.result) - hexToBigInt(r.blockNumber));
      if (conf < minConf) return { ok: false, reason: `not enough confirmations (${conf}/${minConf})` };
    }
  }

  const logs = Array.isArray(r.logs) ? r.logs : [];
  const wantTo = wallet.toLowerCase();
  const expected = BigInt(Math.floor(expectedUsdt * Math.pow(10, decimals)));
  let best = 0n;

  for (const log of logs) {
    const addr = String(log.address || "").toLowerCase();
    if (addr != contract) continue;

    const topics = log.topics;
    if (!Array.isArray(topics) || topics.length < 3) continue;
    if (String(topics[0]).toLowerCase() !== TRANSFER_TOPIC0) continue;

    const to = topicToAddress(String(topics[2])).toLowerCase();
    if (to !== wantTo) continue;

    const value = hexToBigInt(String(log.data || "0x0"));
    if (value > best) best = value;
  }

  if (best === 0n) return { ok: false, reason: "no usdt transfer to wallet found" };
  if (best < expected) return { ok: false, reason: "amount too low" };

  return { ok: true, amountUsdt: Number(best) / Math.pow(10, decimals) };
}
