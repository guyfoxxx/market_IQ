export function json(data: any, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function html(body: string, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(body, { ...init, headers });
}

export function text(body: string, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  return new Response(body, { ...init, headers });
}

export function nowMs() {
  return Date.now();
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function asInt(v: string | undefined, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function asBool(v: string | undefined, fallback: boolean) {
  if (v === undefined) return fallback;
  const s = v.toLowerCase().trim();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return fallback;
}

export function parseCommand(text?: string) {
  if (!text) return null;
  if (!text.startsWith('/')) return null;
  const [cmdRaw, ...rest] = text.trim().split(/\s+/);
  const cmd = cmdRaw.split('@')[0].toLowerCase(); // remove @bot
  return { cmd, args: rest };
}

export function formatDateTime(ms: number, timeZone: string) {
  const d = new Date(ms);
  return new Intl.DateTimeFormat('fa-IR', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

export function getTZDateKeys(timeZone: string, whenMs = Date.now()) {
  const d = new Date(whenMs);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const y = get('year');
  const m = get('month');
  const day = get('day');
  const ymd = `${y}-${m}-${day}`;
  const ym = `${y}-${m}`;
  return { ymd, ym };
}

export function stableHash(input: string) {
  // Simple non-crypto stable hash for short codes
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
