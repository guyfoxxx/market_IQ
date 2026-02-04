import type { Market } from '../types';
import type { Storage } from '../storage';

export interface NewsItem {
  title: string;
  link: string;
  pubDate?: number; // epoch ms
  source: string;
  kind: 'news' | 'calendar';
}

/**
 * News digest with caching in KV.
 * - For stocks/forex/metals we primarily use Yahoo Finance ticker RSS.
 * - For crypto we additionally use CoinDesk RSS.
 * - For forex we additionally use ForexFactory calendar RSS.
 *
 * Sources:
 * - Yahoo Finance RSS headline feed format: feeds.finance.yahoo.com/rss/2.0/headline?s=SYMBOL&region=US&lang=en-US
 * - CoinDesk RSS: https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml
 * - ForexFactory calendar RSS: https://www.forexfactory.com/calendar/rss
 */
export async function getNewsDigest(opts: {
  storage: Storage;
  market: Market;
  symbol: string;
  maxItems?: number;
  cacheTtlSec?: number;
}): Promise<{ text: string; items: NewsItem[] }> {
  const maxItems = opts.maxItems ?? 5;
  const cacheTtlSec = opts.cacheTtlSec ?? 600;

  const cacheKey = `news:cache:${opts.market}:${opts.symbol}`;
  const cached = await opts.storage.cacheGet<{ fetchedAt: number; items: NewsItem[] }>(cacheKey);
  const now = Date.now();
  if (cached?.fetchedAt && now - cached.fetchedAt < cacheTtlSec * 1000 && Array.isArray(cached.items)) {
    return { text: formatDigest(cached.items, maxItems), items: cached.items };
  }

  const urls = buildSources(opts.market, opts.symbol);
  const results = await Promise.allSettled(urls.map(u => fetchRss(u.url, u.source, u.kind)));

  const items: NewsItem[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') items.push(...r.value);
  }

  const dedup = dedupe(items)
    .sort((a, b) => (b.pubDate || 0) - (a.pubDate || 0))
    .slice(0, Math.max(8, maxItems * 2)); // keep a bit more for later formatting

  await opts.storage.cachePut(cacheKey, { fetchedAt: now, items: dedup }, cacheTtlSec);

  return { text: formatDigest(dedup, maxItems), items: dedup };
}

function buildSources(market: Market, symbol: string): Array<{ url: string; source: string; kind: 'news' | 'calendar' }> {
  const out: Array<{ url: string; source: string; kind: 'news' | 'calendar' }> = [];

  const yahooSym = toYahooSymbol(market, symbol);
  if (yahooSym) {
    out.push({
      url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(yahooSym)}&region=US&lang=en-US`,
      source: 'YahooFinance',
      kind: 'news',
    });
  }

  if (market === 'crypto') {
    out.push({
      url: `https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml`,
      source: 'CoinDesk',
      kind: 'news',
    });
  }

  if (market === 'forex') {
    out.push({
      url: `https://www.forexfactory.com/calendar/rss`,
      source: 'ForexFactory',
      kind: 'calendar',
    });
  }

  return out;
}

function toYahooSymbol(market: Market, raw: string): string | null {
  const s0 = String(raw || '').trim().toUpperCase();
  if (!s0) return null;

  // forex user input like EUR/USD
  if (s0.includes('/')) {
    const parts = s0.split('/').map(p => p.trim()).filter(Boolean);
    if (parts.length === 2) return `${parts[0]}${parts[1]}=X`;
  }

  // metals like XAUUSD / XAGUSD
  if (s0.startsWith('XAU') || s0.startsWith('XAG')) {
    if (s0.endsWith('=X')) return s0;
    if (s0.length === 6) return `${s0}=X`;
  }

  if (market === 'crypto') {
    // BTCUSDT => BTC-USD
    if (s0.endsWith('USDT') && s0.length > 4) return `${s0.slice(0, -4)}-USD`;
    if (s0.endsWith('USD') && !s0.includes('-')) return `${s0.slice(0, -3)}-USD`;
    if (s0.includes('-USD')) return s0;
  }

  if (market === 'forex') {
    // EURUSD => EURUSD=X
    if (!s0.includes('=') && /^[A-Z]{6}$/.test(s0)) return `${s0}=X`;
    if (s0.endsWith('=X')) return s0;
  }

  // stocks: AAPL, TSLA, ...
  return s0;
}

async function fetchRss(url: string, source: string, kind: 'news' | 'calendar'): Promise<NewsItem[]> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'ValinafBot/1.0 (+https://example.invalid)',
      'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
  });

  if (!res.ok) return [];
  const xml = await res.text();
  return parseRss(xml, source, kind);
}

function parseRss(xml: string, source: string, kind: 'news' | 'calendar'): NewsItem[] {
  // Lightweight RSS/XML parser (Worker-safe, no DOMParser dependency)
  const items: string[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) && items.length < 25) items.push(m[1]);

  return items
    .map(block => {
      const title = decodeHtml(extractTag(block, 'title') || '');
      const link = decodeHtml(extractTag(block, 'link') || '');
      const pub = extractTag(block, 'pubDate') || extractTag(block, 'dc:date') || '';
      const pubDate = pub ? Date.parse(pub) : undefined;

      return {
        title: (title || '').trim(),
        link: (link || '').trim(),
        pubDate: Number.isFinite(pubDate as any) ? (pubDate as any) : undefined,
        source,
        kind,
      } as NewsItem;
    })
    .filter(x => x.title && x.link);
}

function extractTag(block: string, tag: string): string | null {
  // Matches <tag>...</tag> or <tag ...>...</tag>
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return null;
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/i, '$1').trim();
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}


function dedupe(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const it of items) {
    const key = `${it.source}|${it.link}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function formatDigest(items: NewsItem[], maxItems: number): string {
  const news = items.filter(i => i.kind === 'news').slice(0, maxItems);
  const cal = items.filter(i => i.kind === 'calendar').slice(0, Math.max(0, Math.floor(maxItems / 2)));

  const parts: string[] = [];
  if (news.length) {
    parts.push('📰 خبرهای مرتبط:');
    news.forEach((n, i) => {
      const dt = n.pubDate ? new Date(n.pubDate).toISOString().slice(0, 16).replace('T', ' ') : '';
      parts.push(`${i + 1}) ${n.title}${dt ? ` (${dt}Z)` : ''} — ${n.source}\n${n.link}`);
    });
  }

  if (cal.length) {
    parts.push('\n📅 تقویم اقتصادی (RSS):');
    cal.forEach((n, i) => {
      const dt = n.pubDate ? new Date(n.pubDate).toISOString().slice(0, 16).replace('T', ' ') : '';
      parts.push(`${i + 1}) ${n.title}${dt ? ` (${dt}Z)` : ''} — ${n.source}\n${n.link}`);
    });
  }

  return parts.join('\n');
}
