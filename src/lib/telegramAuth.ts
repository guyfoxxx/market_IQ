/**
 * Verify Telegram WebApp initData.
 * Ref: https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 */
function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

export async function verifyInitData(initData: string, botToken: string): Promise<{ ok: boolean; userId?: number; user?: any }> {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { ok: false };

    params.delete("hash");

    // build data-check-string
    const entries: string[] = [];
    for (const [k, v] of Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      entries.push(`${k}=${v}`);
    }
    const dataCheckString = entries.join("\n");

    const secretKey = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(botToken));
    const sig = await hmacSha256(secretKey, dataCheckString);
    const computed = toHex(sig);

    if (computed !== hash) return { ok: false };

    const userJson = params.get("user");
    const user = userJson ? JSON.parse(userJson) : null;
    const userId = user?.id ? Number(user.id) : undefined;
    return { ok: true, userId, user };
  } catch {
    return { ok: false };
  }
}
