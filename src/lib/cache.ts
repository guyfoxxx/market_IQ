import type { Env } from "../env";

function kv(env: Env): KVNamespace {
  // @ts-ignore
  return (env as any).CACHE_KV || (env as any).USERS_KV;
}

export function analysisCacheKey(args: {
  market: string;
  symbol: string;
  tf: string;
  style: string;
  risk: string;
  news: boolean;
}) {
  const sym = args.symbol.trim().toUpperCase();
  const n = args.news ? "1" : "0";
  return `cache:analysis:${args.market}:${sym}:${args.tf}:${args.style}:${args.risk}:${n}`;
}

export async function getJson<T>(env: Env, key: string): Promise<T | null> {
  try {
    const v = await kv(env).get(key, "json") as any;
    return v ?? null;
  } catch {
    return null;
  }
}

export async function putJson(env: Env, key: string, value: any, ttlSeconds: number) {
  try {
    await kv(env).put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  } catch {
    // ignore
  }
}
