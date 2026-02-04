/**
 * Verify Telegram WebApp initData according to Telegram docs:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 *
 * Returns parsed data if valid; otherwise null.
 */
export async function verifyWebAppInitData(initData: string, botToken: string): Promise<Record<string, any> | null> {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const pairs: Array<[string, string]> = [];
    params.forEach((value, key) => {
      pairs.push([key, value]);
    });

    pairs.sort((a, b) => a[0].localeCompare(b[0]));
    const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');

    // secret_key = HMAC_SHA256("WebAppData", bot_token)
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const secretKey = await crypto.subtle.sign('HMAC', keyMaterial, enc.encode(botToken));
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      secretKey,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(dataCheckString));
    const sigHex = buf2hex(sig);
    if (sigHex !== hash) return null;

    const out: Record<string, any> = {};
    for (const [k, v] of pairs) {
      try {
        out[k] = k === 'user' ? JSON.parse(v) : v;
      } catch {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return null;
  }
}

function buf2hex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
}
