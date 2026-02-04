import type { Env } from "../env";
import { parseFloatSafe, parseIntSafe } from "./utils";
import { getPublicWallet } from "./storage";

/**
 * Verify a BEP20 (ERC20) transfer tx on BSC using BscScan "proxy" APIs.
 * We decode ERC20 transfer input: a9059cbb + to + value
 */
export interface VerifyResult {
  ok: boolean;
  network: string;
  reason?: string;
  toWallet?: string;
  tokenContract?: string;
  amount?: number;
  amountRaw?: string;
  confirmations?: number;
  txTo?: string;
  status?: "SUCCESS" | "FAILED" | "UNKNOWN";
  hash?: string;
  blockNumber?: number;
}

const ERC20_TRANSFER_METHOD = "0xa9059cbb";

function strip0x(s: string) {
  return s.startsWith("0x") ? s.slice(2) : s;
}

function hexToInt(hex: string): number {
  return Number.parseInt(strip0x(hex), 16);
}

function hexToBigInt(hex: string): bigint {
  return BigInt(hex);
}

function padTo40(hexNo0x: string) {
  return hexNo0x.padStart(40, "0");
}

function normalizeAddress(addr: string) {
  const a = addr.toLowerCase();
  return a.startsWith("0x") ? a : "0x" + a;
}

function decodeErc20TransferInput(input: string): { to: string; value: bigint } | null {
  if (!input || input.length < 10) return null;
  const low = input.toLowerCase();
  if (!low.startsWith(ERC20_TRANSFER_METHOD)) return null;
  const data = strip0x(low).slice(8); // drop method id (4 bytes => 8 hex chars)
  if (data.length < 64 * 2) return null;
  const toPart = data.slice(0, 64);
  const valuePart = data.slice(64, 128);
  const to = "0x" + toPart.slice(24); // last 40 hex chars
  const value = BigInt("0x" + valuePart);
  return { to: normalizeAddress(to), value };
}

async function bscProxy(env: Env, action: string, params: Record<string, string>) {
  const apiKey = env.BSCSCAN_API_KEY;
  const qs = new URLSearchParams({ module: "proxy", action, ...params });
  if (apiKey) qs.set("apikey", apiKey);
  const url = `https://api.bscscan.com/api?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`BscScan HTTP ${res.status}`);
  const data = await res.json() as any;
  // proxy API returns {jsonrpc, id, result} or error
  if (data?.result == null) throw new Error(`BscScan invalid response: ${JSON.stringify(data).slice(0, 160)}`);
  return data.result;
}

export async function verifyPaymentTx(env: Env, txid: string, expectedMinUsdt?: number): Promise<VerifyResult> {
  const network = (env.PAYMENT_NETWORK || "BSC").toUpperCase();
  if (network === "OFF") return { ok: false, network, reason: "verification disabled" };
  if (network !== "BSC") return { ok: false, network, reason: "only BSC supported in this build" };

  const tokenContract = normalizeAddress(env.PAYMENT_TOKEN_CONTRACT || "");
  if (!tokenContract || tokenContract === "0x") return { ok: false, network, reason: "PAYMENT_TOKEN_CONTRACT missing" };

  const wallet = await getPublicWallet(env);
  if (!wallet) return { ok: false, network, reason: "public wallet not set" };
  const walletNorm = normalizeAddress(wallet);

  const tx = await bscProxy(env, "eth_getTransactionByHash", { txhash: txid });
  const txTo = tx?.to ? normalizeAddress(tx.to) : "";
  const input = String(tx?.input || "");

  // verify it is a token transfer to token contract
  if (!txTo || txTo === "0x0000000000000000000000000000000000000000") return { ok: false, network, reason: "tx.to missing", tokenContract, toWallet: walletNorm, txTo };
  if (txTo !== tokenContract) {
    // sometimes people send BNB directly, not token
    return { ok: false, network, reason: "tx is not sent to token contract", tokenContract, toWallet: walletNorm, txTo };
  }

  const decoded = decodeErc20TransferInput(input);
  if (!decoded) return { ok: false, network, reason: "cannot decode ERC20 transfer input", tokenContract, toWallet: walletNorm, txTo };

  if (decoded.to !== walletNorm) {
    return { ok: false, network, reason: "recipient wallet mismatch", tokenContract, toWallet: walletNorm, txTo, amountRaw: decoded.value.toString() };
  }

  // USDT decimals = 18 on BSC for this contract
  const amount = Number(decoded.value) / 1e18;

  // receipt status
  let status: VerifyResult["status"] = "UNKNOWN";
  try {
    const receipt = await bscProxy(env, "eth_getTransactionReceipt", { txhash: txid });
    if (receipt?.status) status = receipt.status === "0x1" ? "SUCCESS" : "FAILED";
  } catch {}

  // confirmations
  let confirmations: number | undefined;
  let blockNumber: number | undefined;
  try {
    const bnHex = tx?.blockNumber;
    if (bnHex) blockNumber = hexToInt(bnHex);
    const latestHex = await bscProxy(env, "eth_blockNumber", {});
    const latest = hexToInt(latestHex);
    if (blockNumber != null) confirmations = Math.max(0, latest - blockNumber);
  } catch {}

  const min = expectedMinUsdt ?? parseFloatSafe(env.SUB_PRICE_USDT, 29);
  const minConf = parseIntSafe(env.MIN_CONFIRMATIONS, 3);

  if (status === "FAILED") return { ok: false, network, reason: "tx failed", tokenContract, toWallet: walletNorm, txTo, amount, amountRaw: decoded.value.toString(), confirmations, status, hash: txid, blockNumber };
  if (confirmations != null && confirmations < minConf) return { ok: false, network, reason: `not enough confirmations (${confirmations}/${minConf})`, tokenContract, toWallet: walletNorm, txTo, amount, amountRaw: decoded.value.toString(), confirmations, status, hash: txid, blockNumber };
  if (amount + 1e-9 < min) return { ok: false, network, reason: `amount too low (${amount} < ${min})`, tokenContract, toWallet: walletNorm, txTo, amount, amountRaw: decoded.value.toString(), confirmations, status, hash: txid, blockNumber };

  return { ok: true, network, tokenContract, toWallet: walletNorm, txTo, amount, amountRaw: decoded.value.toString(), confirmations, status, hash: txid, blockNumber };
}
