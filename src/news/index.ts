import type { Market } from '../types';
import type { Storage } from '../storage';
import { stableHash } from '../utils';
import { generateText } from '../ai';

export interface NewsItem {
  title: string;
  link: string;
  pubDate?: number; // epoch ms
  source: string;
  kind: 'news' | 'calendar';
  description?: string;
  categories?: string[];
  impact?: 'high' | 'medium' | 'low' | 'unknown';
  currency?: string; // for calendar

  // optional ranking metadata (filled when available)
  relevance?: number; // 0..1
  impactScore?: number; // 0..1
  why?: string; // short reason
  fa?: string;  // short Persian bullet
}

export interface NewsDigest {
  text: string;          // فارسی (خلاصه/ترجمه)
  items: NewsItem[];     // آیتم‌های انتخاب‌شده (Top impact & relevant)
  keywords: string[];
}

/**
 * News digest with caching in KV + stricter relevance filtering + optional AI ranking.
 *
 * Sources:
 * - Yahoo Finance RSS (per symbol)
 * - CoinDesk RSS (crypto)
 * - Cointelegraph RSS (crypto)
 * - ForexFactory calendar RSS (forex)
 */
export async function getNewsDigest(opts: {
  storage: Storage;
  market: Market;
  symbol: string;
  maxItems?: number;
  cacheTtlSec?: number;

  env?: any;
  summarize?: boolean; // if false => no AI (and no Persian summarization)
}): Promise<NewsDigest> {
  const maxItems = clampInt(opts.maxItems ?? 6, 1, 12);
  const cacheTtlSec = clampInt(opts.cacheTtlSec ?? 600, 60, 3600);
  const summarize = opts.summarize ?? true;

  const normSymbol = normalizeSymbol(opts.symbol);
  const keywords = deriveKeywords(opts.market, normSymbol);

  // cache raw items (fetched)
  const cacheKey = `news:cache:v3:${opts.market}:${normSymbol}`;
  const cached = await opts.storage.cacheGet<{ fetchedAt: number; items: NewsItem[]; keywords: string[] }>(cacheKey);
  const now = Date.now();
  if (cached?.fetchedAt && now - cached.fetchedAt < cacheTtlSec * 1000 && Array.isArray(cached.items)) {
    const built = await buildDigestAndSelection({ ...opts, summarize }, cached.items, cached.keywords, maxItems);
    return { text: built.text, items: built.items, keywords: cached.keywords };
  }

  const sources = buildSources(opts.market, normSymbol);
  const results = await Promise.allSettled(sources.map(s => fetchRss(s.url, s.source, s.kind)));

  const all: NewsItem[] = [];
  for (const r of results) if (r.status === 'fulfilled') all.push(...r.value);

  const dedup = dedupe(all).sort((a, b) => (b.pubDate || 0) - (a.pubDate || 0));

  // Heuristic filter first (fast)
  const heuristic = smartFilter(dedup, keywords, opts.market);

  // keep a bit more for AI ranking / fallbacks
  const kept = heuristic.slice(0, Math.max(maxItems * 4, 22));

  await opts.storage.cachePut(cacheKey, { fetchedAt: now, items: kept, keywords }, cacheTtlSec);

  const built = await buildDigestAndSelection({ ...opts, summarize }, kept, keywords, maxItems);
  return { text: built.text, items: built.items, keywords };
}

function clampInt(n: number, min: number, max: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function normalizeSymbol(s: string) {
  return String(s || '').trim().toUpperCase().replace(/\s+/g, '');
}

function deriveKeywords(market: Market, symbol: string): string[] {
  const out = new Set<string>();

  const add = (x?: string) => {
    if (!x) return;
    const t = x.trim();
    if (!t) return;
    out.add(t);
  };

  // Forex like EUR/USD
  if (symbol.includes('/')) {
    const [a, b] = symbol.split('/').map(x => x.trim()).filter(Boolean);
    add(a); add(b);
  }

  // normalize separators
  let sym = symbol.replace(':', '').replace('-', '').replace('_', '');

  if (market === 'crypto') {
    // strip common quote currencies (NOT BTC/ETH)
    const quoteRe = /(USDT|USDC|BUSD|USD|EUR|TRY|GBP|JPY|AUD|CAD|CHF|BRL)$/i;
    let base = sym;
    const m = base.match(quoteRe);
    if (m) base = base.slice(0, base.length - m[0].length);
    if (base.length >= 2) add(base);

    const map: Record<string, string[]> = {
      BTC: ['Bitcoin'],
      ETH: ['Ethereum'],
      SOL: ['Solana'],
      BNB: ['BNB', 'Binance Coin'],
      XRP: ['Ripple', 'XRP'],
      ADA: ['Cardano'],
      DOGE: ['Dogecoin'],
      TON: ['Toncoin'],
      AVAX: ['Avalanche'],
      MATIC: ['Polygon'],
      LINK: ['Chainlink'],
    };
    const key = base.toUpperCase();
    (map[key] || []).forEach(add);

    add('crypto');
    // avoid always adding bitcoin; it lowers precision for non-BTC symbols
    if (key === 'BTC') add('bitcoin');
  }

  if (market === 'metals') {
    if (sym.startsWith('XAU')) { add('XAU'); add('Gold'); add('gold'); }
    if (sym.startsWith('XAG')) { add('XAG'); add('Silver'); add('silver'); }
    add('metals');
  }

  if (market === 'stocks') {
    add(symbol.replace(/[^A-Z.]/g, ''));
    add('stock');
    add('earnings');
    add('guidance');
  }

  if (market === 'forex') {
    if (/^[A-Z]{6}$/.test(sym)) {
      add(sym.slice(0, 3));
      add(sym.slice(3, 6));
    }
    add('forex');
    add('fx');
    add('rate');
    add('inflation');
    add('central bank');
  }

  return Array.from(out).map(s => s.trim()).filter(s => s.length >= 2);
}

function smartFilter(items: NewsItem[], keywords: string[], market: Market): NewsItem[] {
  if (!items.length) return [];

  const kw = keywords.map(k => k.toLowerCase());
  const isMatch = (it: NewsItem) => {
    const hay = `${it.title} ${it.description || ''} ${(it.categories || []).join(' ')}`.toLowerCase();
    // match with basic word boundary when possible
    return kw.some(k => (k.length <= 3 ? hay.includes(k) : new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(hay)));
  };

  const isGeneric = (it: NewsItem) => {
    const t = it.title.toLowerCase();
    // drop very generic / listicle style items to increase precision
    return (
      t.includes('top ') ||
      t.includes('price prediction') ||
      t.includes('weekly recap') ||
      t.includes('what to watch') ||
      t.includes('market wrap') ||
      t.includes('newsletter') ||
      t.includes('sponsored')
    );
  };

  const news = items.filter(i => i.kind === 'news' && !isGeneric(i));
  const cal = items.filter(i => i.kind === 'calendar');

  let matchedNews = news.filter(isMatch);
  // if too strict, keep some freshest items (but still avoid generic)
  if (matchedNews.length < 3) {
    matchedNews = [...matchedNews, ...news.filter(n => !matchedNews.includes(n)).slice(0, 8)];
  }

  let matchedCal = cal.filter(i => {
    if (market !== 'forex') return false;
    if (!isMatch(i)) return false;
    const impact = i.impact || 'unknown';
    return impact === 'high' || impact === 'medium' || impact === 'unknown';
  });

  matchedCal.sort((a, b) => impactScore(b.impact) - impactScore(a.impact));

  return dedupe([...matchedCal, ...matchedNews]).sort((a, b) => (b.pubDate || 0) - (a.pubDate || 0));
}

function impactScore(i?: string) {
  if (i === 'high') return 3;
  if (i === 'medium') return 2;
  if (i === 'low') return 1;
  return 0;
}

// ---------- v3: accuracy-focused digest ----------

async function buildDigestAndSelection(
  opts: { env?: any; summarize?: boolean; market: Market; symbol: string; storage: Storage },
  items: NewsItem[],
  keywords: string[],
  maxItems: number
): Promise<{ text: string; items: NewsItem[] }> {
  const subset = items.slice(0, 24);
  const candidates = subset.slice(0, 18);

  // heuristic scoring (fast)
  const scored = candidates.map(it => {
    const rel = heuristicRelevance(it, keywords);
    const imp = heuristicImpact(it, opts.market);
    const rec = recencyFactor(it.pubDate);
    const score = (0.62 * rel + 0.38 * imp) * rec;
    return { it, rel, imp, score };
  }).sort((a, b) => b.score - a.score);

  const preselect = scored.slice(0, Math.max(10, Math.min(14, maxItems * 3))).map(s => ({
    ...s.it,
    relevance: s.rel,
    impactScore: s.imp,
  })) as NewsItem[];

  // if AI disabled/unavailable => purely heuristic
  if (!opts.env || opts.summarize === false) {
    const selected = finalizeSelection(preselect, maxItems);
    const text = formatDigestFromSelected({ market: opts.market, symbol: opts.symbol, keywords, selected });
    return { text, items: selected };
  }

  // cache ranked result by content hash (stable)
  const keyHash = stableHash(JSON.stringify(preselect.map(i => [i.source, i.title, i.link, i.kind, i.impact || ''])));
  const sumKey = `news:rank:v3:${opts.market}:${normalizeSymbol(opts.symbol)}:${keyHash}`;

  const cached = await opts.storage.cacheGet<{ text: string; selectedLinks: string[]; meta?: any }>(sumKey);
  if (cached?.text && Array.isArray(cached.selectedLinks)) {
    const sel = cached.selectedLinks.map(l => preselect.find(i => i.link === l)).filter(Boolean) as NewsItem[];
    const selected = finalizeSelection(sel.length ? sel : preselect, maxItems);
    return { text: cached.text, items: selected };
  }

  // AI ranking + Persian bullets
  let ranked: { text: string; selected: NewsItem[] } | null = null;
  try {
    ranked = await aiRankAndDigest(opts.env, opts.market, opts.symbol, keywords, preselect, maxItems);
  } catch {
    ranked = null;
  }

  if (!ranked) {
    const selected = finalizeSelection(preselect, maxItems);
    const text = formatDigestFromSelected({ market: opts.market, symbol: opts.symbol, keywords, selected });
    await opts.storage.cachePut(sumKey, { text, selectedLinks: selected.map(i => i.link) }, 600);
    return { text, items: selected };
  }

  await opts.storage.cachePut(sumKey, { text: ranked.text, selectedLinks: ranked.selected.map(i => i.link) }, 600);
  return { text: ranked.text, items: ranked.selected };
}

function finalizeSelection(items: NewsItem[], maxItems: number): NewsItem[] {
  const minRel = 0.35;
  const withScores = items.map(it => ({
    it,
    rel: clamp01(it.relevance ?? 0),
    imp: clamp01(it.impactScore ?? (it.kind === 'calendar' ? calImpactToScore(it.impact) : 0.5)),
    rec: recencyFactor(it.pubDate),
  })).map(x => ({
    ...x,
    score: (0.55 * x.imp + 0.45 * x.rel) * x.rec,
  })).sort((a, b) => b.score - a.score);

  const selected = withScores.filter(x => x.rel >= minRel).slice(0, maxItems).map(x => x.it);

  // fill if too few
  if (selected.length < Math.min(3, maxItems)) {
    for (const x of withScores) {
      if (selected.length >= Math.min(3, maxItems)) break;
      if (!selected.includes(x.it)) selected.push(x.it);
    }
  }

  // dedupe again by link
  return dedupe(selected);
}

function formatDigestFromSelected(opts: { market: Market; symbol: string; keywords: string[]; selected: NewsItem[] }) {
  const parts: string[] = [];
  parts.push(`📰 خبرهای با اثر بالاتر برای <b>${escapeHtml(normalizeSymbol(opts.symbol))}</b> (${escapeHtml(opts.market)})`);
  if (opts.keywords.length) parts.push(`کلیدواژه‌ها: <code>${escapeHtml(opts.keywords.slice(0, 6).join(', '))}</code>`);

  const cal = opts.selected.filter(i => i.kind === 'calendar').slice(0, 5);
  const news = opts.selected.filter(i => i.kind === 'news').slice(0, 10);

  if (cal.length) {
    parts.push(`\n⚡ رویدادهای مهم تقویم:`);
    for (const it of cal) {
      const tag = it.impact === 'high' ? '🔥' : it.impact === 'medium' ? '✨' : '';
      parts.push(`• ${tag} <a href="${it.link}">${escapeHtml(it.title)}</a>`);
    }
  }

  if (news.length) {
    parts.push(`\n🗞️ تیترهای منتخب:`);
    for (const it of news) {
      parts.push(`• <a href="${it.link}">${escapeHtml(it.title)}</a> <i>(${escapeHtml(it.source)})</i>`);
    }
  }

  parts.push(`\n⚠️ این محتوا توصیه مالی نیست.`);
  return parts.join('\n');
}

function clamp01(x: number) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function calImpactToScore(i?: string) {
  if (i === 'high') return 1.0;
  if (i === 'medium') return 0.72;
  if (i === 'low') return 0.45;
  return 0.55;
}

function recencyFactor(pubDate?: number) {
  if (!pubDate) return 0.8;
  const ageH = (Date.now() - pubDate) / 36e5;
  if (ageH <= 6) return 1.0;
  if (ageH <= 24) return 0.88;
  if (ageH <= 72) return 0.72;
  return 0.58;
}

function heuristicRelevance(it: NewsItem, keywords: string[]) {
  const hay = `${it.title} ${it.description || ''} ${(it.categories || []).join(' ')}`.toLowerCase();
  const kw = keywords.map(k => k.toLowerCase()).filter(Boolean);

  let hits = 0;
  let strongHits = 0;

  for (const k of kw) {
    if (!k) continue;
    const re = k.length <= 3 ? null : new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i');
    const ok = re ? re.test(hay) : hay.includes(k);
    if (ok) {
      hits++;
      if (it.title.toLowerCase().includes(k)) strongHits++;
    }
  }

  // calendar should require currency match at least
  if (it.kind === 'calendar') {
    const cur = (it.currency || '').toUpperCase();
    const hasCur = cur ? kw.some(k => k.toUpperCase() === cur) : false;
    if (!hasCur && hits === 0) return 0.05;
  }

  // normalize
  const score = Math.min(1, (hits * 0.18) + (strongHits * 0.25));
  return Math.max(0, Math.min(1, score));
}

function heuristicImpact(it: NewsItem, market: Market) {
  if (it.kind === 'calendar') {
    return calImpactToScore(it.impact);
  }

  const t = `${it.title} ${it.description || ''}`.toLowerCase();

  const high = [
    'fomc', 'fed', 'interest rate', 'rate decision', 'inflation', 'cpi', 'ppi', 'nfp', 'jobs report',
    'gdp', 'central bank', 'sec', 'etf', 'lawsuit', 'hack', 'exploit', 'bankruptcy', 'default',
    'earnings', 'guidance', 'downgrade', 'upgrade', 'merger', 'acquisition', 'approval', 'ban', 'sanction'
  ];
  const medium = [
    'regulation', 'policy', 'whale', 'liquidation', 'outage', 'network', 'upgrade', 'fork',
    'reserve', 'yield', 'bond', 'treasury', 'cftc', 'court', 'settlement'
  ];

  let s = 0.35; // base
  for (const k of high) if (t.includes(k)) s += 0.18;
  for (const k of medium) if (t.includes(k)) s += 0.09;

  // market-specific bump
  if (market === 'crypto' && (t.includes('etf') || t.includes('sec'))) s += 0.12;
  if (market === 'stocks' && (t.includes('earnings') || t.includes('guidance'))) s += 0.12;
  if (market === 'forex' && (t.includes('central bank') || t.includes('rate'))) s += 0.12;

  return clamp01(s);
}

async function aiRankAndDigest(env: any, market: Market, symbol: string, keywords: string[], items: NewsItem[], maxItems: number): Promise<{ text: string; selected: NewsItem[] }> {
  const payload = {
    schema_version: 'news_input_v1',
    market,
    symbol: normalizeSymbol(symbol),
    keywords,
    items: items.map((it, idx) => ({
      id: `I${idx + 1}`,
      kind: it.kind,
      source: it.source,
      title: it.title,
      description: it.description ? it.description.slice(0, 240) : '',
      impact: it.impact || 'unknown',
      currency: it.currency || null,
      published_at: it.pubDate ? new Date(it.pubDate).toISOString() : null,
      link: it.link,
    })),
    selection_rules: {
      max_selected: Math.min(10, Math.max(maxItems + 2, 6)),
      min_relevance: 0.35,
      prioritize: ['high_impact', 'symbol_relevance', 'recency'],
    }
  };

  const system = `You are a strict market-news relevance & impact ranker and Persian summarizer.
Rules:
- Use ONLY the provided JSON input. Do NOT add facts.
- Select only items that are clearly relevant to the symbol/market.
- Output MUST be valid JSON only (no markdown, no extra text).
- Each selected item must reference an input item by its link EXACTLY.
- relevance and impact must be numbers in [0,1].
- 'fa' is a Persian bullet <= 140 characters describing the news/event accurately.
- 'why' <= 120 characters: why it's relevant/impactful.
- Prefer fewer but more relevant items over many generic ones.`;

  const user = `INPUT_JSON:\n${JSON.stringify(payload, null, 2)}\n\nReturn JSON with schema:\n{
  "schema_version":"news_rank_v1",
  "selected":[
    {"link":"...", "relevance":0.0, "impact":0.0, "fa":"...", "why":"..."}
  ],
  "note_fa":"یک جمله خیلی کوتاه اگر خبرها عمومی/کم‌ربط بودند"
}`;

  const raw = await generateText(env, { system, user, temperature: 0.15 });

  let obj: any;
  try {
    obj = JSON.parse(raw.trim());
  } catch {
    // sometimes model returns code block; try extracting
    const m = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/({[\s\S]*})/);
    if (m) obj = JSON.parse((m[1] || m[0]).trim());
    else throw new Error('news rank parse failed');
  }

  if (obj?.schema_version !== 'news_rank_v1' || !Array.isArray(obj?.selected)) {
    throw new Error('news rank schema mismatch');
  }

  const byLink = new Map<string, NewsItem>();
  for (const it of items) byLink.set(it.link, it);

  const selected: NewsItem[] = [];
  for (const s of obj.selected.slice(0, 14)) {
    const link = String(s?.link || '');
    const base = byLink.get(link);
    if (!base) continue;

    const rel = clamp01(Number(s?.relevance));
    const imp = clamp01(Number(s?.impact));
    const fa = String(s?.fa || '').trim();
    if (fa.length < 4) continue;

    selected.push({
      ...base,
      relevance: rel,
      impactScore: imp,
      fa: fa.slice(0, 180),
      why: String(s?.why || '').slice(0, 160),
    });
  }

  const finalSelected = finalizeSelection(selected.length ? selected : items, maxItems);

  // Build formatted digest (deterministic, no hallucination)
  const parts: string[] = [];
  parts.push(`📰 خبرهای با اثر بالاتر برای <b>${escapeHtml(normalizeSymbol(symbol))}</b> (${escapeHtml(market)})`);
  if (keywords.length) parts.push(`کلیدواژه‌ها: <code>${escapeHtml(keywords.slice(0, 6).join(', '))}</code>`);

  const cal = finalSelected.filter(i => i.kind === 'calendar').slice(0, 5);
  const news = finalSelected.filter(i => i.kind === 'news').slice(0, 10);

  if (cal.length) {
    parts.push(`\n⚡ رویدادهای مهم تقویم:`);
    for (const it of cal) {
      const impTag = (it.impactScore ?? 0) >= 0.78 ? '🔥' : (it.impactScore ?? 0) >= 0.6 ? '✨' : '';
      const line = it.fa ? it.fa : it.title;
      parts.push(`• ${impTag} ${escapeHtml(line)} — <a href="${it.link}">لینک</a>`);
    }
  }
  if (news.length) {
    parts.push(`\n🗞️ خبرهای منتخب:`);
    for (const it of news) {
      const impTag = (it.impactScore ?? 0) >= 0.78 ? '🔥' : (it.impactScore ?? 0) >= 0.6 ? '✨' : '';
      const line = it.fa ? it.fa : it.title;
      parts.push(`• ${impTag} ${escapeHtml(line)} — <a href="${it.link}">${escapeHtml(it.source)}</a>`);
    }
  }

  const note = String(obj?.note_fa || '').trim();
  if (note) parts.push(`\nℹ️ ${escapeHtml(note.slice(0, 200))}`);

  parts.push(`\n⚠️ این محتوا توصیه مالی نیست.`);
  const text = parts.join('\n');

  return { text, selected: finalSelected };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- RSS plumbing ----------

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
    out.push({ url: `https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml`, source: 'CoinDesk', kind: 'news' });
    out.push({ url: `https://cointelegraph.com/rss`, source: 'Cointelegraph', kind: 'news' });
  }

  if (market === 'forex') {
    out.push({ url: `https://www.forexfactory.com/calendar/rss`, source: 'ForexFactory', kind: 'calendar' });
  }

  return out;
}

function toYahooSymbol(market: Market, raw: string): string | null {
  const s0 = String(raw || '').trim().toUpperCase();
  if (!s0) return null;

  if (s0.includes('/')) {
    const parts = s0.split('/').map(p => p.trim()).filter(Boolean);
    if (parts.length === 2) return `${parts[0]}${parts[1]}=X`;
  }

  if (s0.startsWith('XAU') || s0.startsWith('XAG')) {
    if (s0.endsWith('=X')) return s0;
    if (s0.length === 6) return `${s0}=X`;
  }

  if (market === 'crypto') {
    // Yahoo uses COIN-USD pairs
    if (s0.endsWith('USDT') && s0.length > 4) return `${s0.slice(0, -4)}-USD`;
    if (s0.endsWith('USD') && !s0.includes('-')) return `${s0.slice(0, -3)}-USD`;
    if (s0.includes('-USD')) return s0;
  }

  if (market === 'forex') {
    if (!s0.includes('=') && /^[A-Z]{6}$/.test(s0)) return `${s0}=X`;
    if (s0.endsWith('=X')) return s0;
  }

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

  const items: NewsItem[] = [];
  const blocks = Array.from(xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)).map(m => m[1]);

  for (const b of blocks) {
    const title = decodeXml(extractTag(b, 'title'));
    const link = decodeXml(extractTag(b, 'link')) || decodeXml(extractTag(b, 'guid'));
    const pub = parseDate(decodeXml(extractTag(b, 'pubDate'))) || parseDate(decodeXml(extractTag(b, 'updated')));
    const descRaw = decodeXml(extractTag(b, 'description') || extractTag(b, 'content:encoded'));
    const desc = stripHtml(descRaw);

    if (!title || !link) continue;

    const cats = Array.from(b.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi))
      .map(x => stripHtml(decodeXml(x[1] || '')).trim())
      .filter(Boolean)
      .slice(0, 6);

    const it: NewsItem = { title: title.trim(), link: link.trim(), pubDate: pub || undefined, source, kind, description: desc, categories: cats };

    if (kind === 'calendar') {
      const meta = parseCalendarMeta(it);
      it.impact = meta.impact;
      it.currency = meta.currency;
    }

    items.push(it);
  }

  return items;
}

function parseCalendarMeta(it: NewsItem): { impact: 'high' | 'medium' | 'low' | 'unknown'; currency?: string } {
  const s = `${it.title} ${(it.description || '')} ${(it.categories || []).join(' ')}`.toLowerCase();

  let impact: 'high' | 'medium' | 'low' | 'unknown' = 'unknown';
  if (s.includes('high')) impact = 'high';
  else if (s.includes('medium')) impact = 'medium';
  else if (s.includes('low')) impact = 'low';

  const m = it.title.match(/\b([A-Z]{3})\b/);
  const currency = m ? m[1] : undefined;

  return { impact, currency };
}

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  let v = m[1] || '';
  v = v.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');
  return v.trim();
}

function parseDate(s: string): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function stripHtml(s: string) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeXml(s: string) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function escapeHtml(s: string) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function dedupe(items: NewsItem[]) {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const it of items) {
    const key = `${it.kind}|${it.link}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}
