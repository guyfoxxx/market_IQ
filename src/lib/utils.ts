export function nowIso() {
  return new Date().toISOString();
}

export function todayUtc(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export function monthUtc(): string {
  const d = new Date();
  return d.toISOString().slice(0, 7);
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function parseIntSafe(s: string | undefined, fallback: number) {
  const n = Number.parseInt(String(s ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function parseFloatSafe(s: string | undefined, fallback: number) {
  const n = Number.parseFloat(String(s ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function randomCode(len = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function isValidTxid(txid: string) {
  // TxID می‌تواند الگوهای مختلف داشته باشد؛ فقط حداقل طول و کاراکترها را چک می‌کنیم.
  return /^[a-zA-Z0-9_-]{10,120}$/.test(txid);
}

export function fmtDateIso(iso?: string, tz = "UTC") {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("fa-IR", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
  } catch {
    return iso;
  }
}
