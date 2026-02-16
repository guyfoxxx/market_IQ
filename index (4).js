/* eslint-disable no-console */
/**
 * Telegram Market Analysis Bot (Cloudflare Workers) — single-file deploy
 * ---------------------------------------------------------------
 * Features:
 * - Telegram inline-button UI (style, timeframe, signal, max tokens, data source, reasoning effort)
 * - Live market data: Binance (crypto), Alpha Vantage (stocks/forex/crypto-daily), CryptoCompare (crypto)
 * - GPT-5.1 analysis via OpenAI Responses API
 * - Automatic message chunking for Telegram 4096-char limit
 *
 * ENV Vars (Cloudflare Worker > Settings > Variables):
 * - TELEGRAM_BOT_TOKEN         (required)
 * - TELEGRAM_SECRET_TOKEN      (optional; verify X-Telegram-Bot-Api-Secret-Token)
 * - OPENAI_API_KEY             (required)
 * - OPENAI_MODEL               (optional, default: gpt-5.1)
 * - ALPHAVANTAGE_API_KEY       (optional; needed for Alpha Vantage sources)
 * - CRYPTOCOMPARE_API_KEY      (optional; for CryptoCompare paid/limited endpoints)
 *
 * KV Binding (recommended):
 * - BOT_KV  (KV Namespace binding name) — used to persist per-chat settings.
 *
 * Webhook:
 * - Set your webhook to: https://<your-worker-domain>/telegram
 * - (Optional) include TELEGRAM_SECRET_TOKEN as the webhook secret_token.
 */

const PROMPT_TEMPLATES = {
  PA: "{\n  \"role\": \"system\",\n  \"description\": \"Professional Price Action Market Analysis Prompt\",\n  \"constraints\": {\n    \"analysis_style\": \"Pure Price Action Only\",\n    \"indicators\": \"Forbidden unless explicitly requested\",\n    \"focus\": \"High-probability setups only\",\n    \"language\": \"Professional, clear, step-by-step\"\n  },\n  \"required_sections\": {\n    \"market_structure\": {\n      \"items\": [\n        \"Trend identification (Uptrend / Downtrend / Range)\",\n        \"HH, HL, LH, LL labeling\",\n        \"Structure status (Intact / BOS / MSS)\"\n      ]\n    },\n    \"key_levels\": {\n      \"items\": [\n        \"Strong Support zones\",\n        \"Strong Resistance zones\",\n        \"Flip zones (SR to Resistance / Resistance to Support)\",\n        \"Psychological levels (if relevant)\"\n      ]\n    },\n    \"candlestick_behavior\": {\n      \"items\": [\n        \"Pin Bar\",\n        \"Engulfing\",\n        \"Inside Bar\",\n        \"Explanation of buyer/seller intent\"\n      ]7\n    },\n    \"entry_scenarios\": {\n      \"requirements\": [\n        \"Clear entry zone\",\n        \"Logical structure-based Stop Loss\",\n        \"TP1 and TP2 targets\",\n        \"Minimum Risk:Reward of 1:2\"\n      ]\n    },\n    \"bias_and_scenarios\": {\n      \"items\": [\n        \"Main bias (Bullish / Bearish / Neutral)\",\n        \"Alternative scenario upon invalidation\"\n      ]\n    },\n    \"execution_plan\": {\n      \"items\": [\n        \"Continuation or Reversal trade\",\n        \"Required confirmation before entry\"\n      ]\n    }\n  },\n  \"instructions\": [\n    \"Explain everything step-by-step\",\n    \"Use structure-based logic\",\n    \"Avoid overtrading\",\n    \"Execution-focused explanations\"\n  ]\n}",
  ICT: "{\n  \"role\": \"system\",\n  \"identity\": {\n    \"title\": \"ICT & Smart Money Analyst\",\n    \"methodology\": [\n      \"ICT (Inner Circle Trader)\",\n      \"Smart Money Concepts\"\n    ],\n    \"restrictions\": [\n      \"No indicators\",\n      \"No retail concepts\",\n      \"ICT & Smart Money concepts ONLY\"\n    ]\n  },\n  \"task\": {\n    \"description\": \"Analyze the requested market (Symbol, Timeframe) using ICT & Smart Money Concepts ONLY.\"\n  },\n  \"analysis_requirements\": {\n    \"1_higher_timeframe_bias\": {\n      \"timeframes\": [\n        \"Daily\",\n        \"H4\"\n      ],\n      \"elements\": [\n        \"Overall HTF bias (Bullish / Bearish / Neutral)\",\n        \"Premium zone\",\n        \"Discount zone\",\n        \"Equilibrium level (50%)\",\n        \"Imbalance vs Balance state\"\n      ]\n    },\n    \"2_liquidity_mapping\": {\n      \"identify\": [\n        \"Equal Highs (EQH)\",\n        \"Equal Lows (EQL)\",\n        \"Buy-side liquidity\",\n        \"Sell-side liquidity\",\n        \"Stop-loss pools\"\n      ],\n      \"objective\": \"Determine where liquidity is resting and likely to be engineered toward\"\n    },\n    \"3_market_structure\": {\n      \"elements\": [\n        \"BOS (Break of Structure)\",\n        \"MSS / CHoCH (Market Structure Shift)\"\n      ],\n      \"clarification\": [\n        \"Manipulation phase\",\n        \"Expansion phase\"\n      ]\n    },\n    \"4_pd_arrays\": {\n      \"arrays\": [\n        \"Bullish Order Blocks\",\n        \"Bearish Order Blocks\",\n        \"Fair Value Gaps (FVG)\",\n        \"Liquidity Voids\",\n        \"Previous Day High (PDH)\",\n        \"Previous Day Low (PDL)\",\n        \"Previous Week High (PWH)\",\n        \"Previous Week Low (PWL)\"\n      ]\n    },\n    \"5_kill_zones\": {\n      \"condition\": \"Intraday only\",\n      \"zones\": [\n        \"London Kill Zone\",\n        \"New York Kill Zone\"\n      ],\n      \"explanation\": \"Explain why timing matters for this setup\"\n    },\n    \"6_entry_model\": {\n      \"model_examples\": [\n        \"Liquidity Sweep \u2192 MSS \u2192 FVG Entry\",\n        \"Liquidity Sweep \u2192 Order Block Entry\"\n      ],\n      \"must_include\": [\n        \"Entry price\",\n        \"Stop Loss location (above/below OB or swing)\",\n        \"Take Profit targets based on liquidity\"\n      ]\n    },\n    \"7_narrative\": {\n      \"storytelling\": [\n        \"Who is trapped?\",\n        \"Where did smart money enter?\",\n        \"Where is price likely engineered to go?\"\n      ]\n    }\n  },\n  \"execution_plan\": {\n    \"bias\": \"Bullish or Bearish\",\n    \"entry_conditions\": \"Clear confirmation rules\",\n    \"targets\": \"Liquidity-based targets\",\n    \"invalidation_point\": \"Price level that invalidates the idea\"\n  },\n  \"output_style\": {\n    \"tone\": \"Professional, precise, educational\",\n    \"structure\": \"Step-by-step, clearly labeled sections\",\n    \"language\": \"Clear and technical ICT terminology\"\n  }\n}",
  ATR: "{\n  \"role\": \"quantitative_trading_assistant\",\n  \"strategy\": \"ATR-based volatility trading\",\n  \"analysis_requirements\": {\n    \"volatility_state\": [\n      \"Current ATR value\",\n      \"Comparison with historical ATR average\",\n      \"Volatility expansion or contraction\"\n    ],\n    \"market_condition\": [\n      \"Trending or Ranging\",\n      \"Breakout vs Mean Reversion suitability\"\n    ],\n    \"trade_setup\": {\n      \"entry\": \"Based on price structure\",\n      \"stop_loss\": \"SL = Entry \u00b1 (ATR \u00d7 Multiplier)\",\n      \"take_profit\": [\n        \"TP1 based on ATR expansion\",\n        \"TP2 based on ATR expansion\"\n      ]\n    },\n    \"position_sizing\": [\n      \"Risk per trade (%)\",\n      \"Position size based on SL distance\"\n    ],\n    \"trade_filtering\": [\n      \"When NOT to trade based on ATR\",\n      \"High-risk volatility conditions (news, spikes)\"\n    ],\n    \"risk_management\": [\n      \"Max daily loss\",\n      \"Max consecutive losses\",\n      \"ATR-based trailing stop logic\"\n    ],\n    \"summary\": [\n      \"Statistical justification\",\n      \"Expected trade duration\",\n      \"Risk classification (Low/Medium/High)\"\n    ]\n  }\n}",
};

const DEFAULT_STATE = {
  symbol: "BTCUSDT",
  timeframe: "4h",
  signal: "neutral",        // buy | sell | neutral
  style: "PA",              // PA | ICT | ATR
  maxTokens: 2048,          // OpenAI max_output_tokens
  source: "auto",           // auto | binance | alphavantage | cryptocompare
  effort: "low",            // none | low | medium | high (gpt-5.* reasoning.effort)
  awaiting: null,           // "symbol" | null
  menuMessageId: null,
};

const TELEGRAM_API_BASE = "https://api.telegram.org";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const TF_OPTIONS = [
  ["15m", "15m"],
  ["30m", "30m"],
  ["1h", "1h"],
  ["4h", "4h"],
  ["1d", "1d"],
];

const STYLE_OPTIONS = [
  ["PA", "🕯️ Price Action"],
  ["ICT", "🧠 ICT / SMC"],
  ["ATR", "📏 ATR"],
];

const SIGNAL_OPTIONS = [
  ["buy", "🟢 Buy/Long"],
  ["sell", "🔴 Sell/Short"],
  ["neutral", "⚪️ Neutral"],
];

const TOK_OPTIONS = [
  [512, "512"],
  [1024, "1024"],
  [2048, "2048"],
  [4096, "4096"],
  [8192, "8192"],
];

const SRC_OPTIONS = [
  ["auto", "✨ Auto"],
  ["binance", "🟡 Binance"],
  ["alphavantage", "🟦 AlphaVantage"],
  ["cryptocompare", "🟧 CryptoCompare"],
];

const EFFORT_OPTIONS = [
  ["none", "⚡ none"],
  ["low", "🟩 low"],
  ["medium", "🟨 medium"],
  ["high", "🟥 high"],
];

const memState = new Map(); // fallback if BOT_KV not bound

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET") {
      return new Response(
        "OK — Telegram bot is running. POST updates to /telegram",
        { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname !== "/telegram") {
      return new Response("Not found", { status: 404 });
    }

    // Optional secret token verification
    if (env.TELEGRAM_SECRET_TOKEN) {
      const got = request.headers.get("x-telegram-bot-api-secret-token");
      if (got !== env.TELEGRAM_SECRET_TOKEN) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    // Acknowledge Telegram immediately; do the work async.
    ctx.waitUntil(handleUpdate(update, env));
    return new Response("ok", { status: 200 });
  },
};

async function handleUpdate(update, env) {
  try {
    if (update.message) {
      await handleMessage(update.message, env);
      return;
    }
    if (update.callback_query) {
      await handleCallback(update.callback_query, env);
      return;
    }
  } catch (err) {
    console.error("handleUpdate error:", err);
    // best-effort notify user
    const chatId =
      update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id;
    if (chatId) {
      await sendMessage(
        env,
        chatId,
        "❌ خطا رخ داد. دوباره تلاش کن. (لاگ Worker رو هم چک کن)"
      );
    }
  }
}

async function handleMessage(message, env) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();

  let state = await getState(env, chatId);

  // Commands
  if (text.startsWith("/start")) {
    state = { ...DEFAULT_STATE, ...state, awaiting: "symbol" };
    await setState(env, chatId, state);
    await sendMessage(
      env,
      chatId,
      "سلام 👋\n\nبرای شروع، نماد رو بفرست (مثال: BTCUSDT یا EURUSD)."
    );
    await sendMenu(env, chatId, state);
    return;
  }

  if (text.startsWith("/help")) {
    await sendHelp(env, chatId);
    await sendMenu(env, chatId, state);
    return;
  }

  if (text.startsWith("/symbol")) {
    const sym = text.replace("/symbol", "").trim();
    if (!sym) {
      await sendMessage(
        env,
        chatId,
        "نماد رو بعد از /symbol بنویس. مثال: /symbol BTCUSDT"
      );
      return;
    }
    state = { ...state, symbol: normalizeSymbol(sym), awaiting: null };
    await setState(env, chatId, state);
    await sendMessage(env, chatId, `✅ نماد تنظیم شد: ${state.symbol}`);
    await sendMenu(env, chatId, state);
    return;
  }

  // If we are waiting for the symbol input
  if (state.awaiting === "symbol" && text) {
    state = { ...state, symbol: normalizeSymbol(text), awaiting: null };
    await setState(env, chatId, state);
    await sendMessage(env, chatId, `✅ نماد تنظیم شد: ${state.symbol}`);
    await sendMenu(env, chatId, state);
    return;
  }

  // Power-user: one-line analyze (optional)
  // Example: BTCUSDT 4h buy PA 2048
  if (/^[A-Za-z0-9/:-]+\s+\S+/i.test(text)) {
    const parsed = parseQuickLine(text);
    if (parsed) {
      state = { ...state, ...parsed, awaiting: null };
      await setState(env, chatId, state);
      await runAnalysis(env, chatId, state);
      return;
    }
  }

  // Default: show menu
  await sendMenu(env, chatId, state);
}

async function handleCallback(cb, env) {
  const chatId = cb.message.chat.id;
  const data = cb.data || "";
  let state = await getState(env, chatId);

  // Always answer callback quickly (removes Telegram loading spinner)
  await telegram(env, "answerCallbackQuery", {
    callback_query_id: cb.id,
    text: "✅",
    show_alert: false,
  });

  const [kind, key, val] = data.split(":");

  if (kind === "set") {
    if (key === "tf") state.timeframe = val;
    if (key === "style") state.style = val;
    if (key === "sig") state.signal = val;
    if (key === "tok") state.maxTokens = clampInt(val, 256, 128000);
    if (key === "src") state.source = val;
    if (key === "eff") state.effort = val;

    state.awaiting = null;
    await setState(env, chatId, state);
    await editMenu(env, cb.message, state);
    return;
  }

  if (kind === "act") {
    if (key === "symbol") {
      state.awaiting = "symbol";
      await setState(env, chatId, state);
      await sendMessage(
        env,
        chatId,
        "✍️ نماد رو همینجا بفرست (مثال: BTCUSDT یا EURUSD یا BTC/USD)."
      );
      return;
    }
    if (key === "analyze") {
      state.awaiting = null;
      await setState(env, chatId, state);
      await runAnalysis(env, chatId, state);
      return;
    }
    if (key === "help") {
      await sendHelp(env, chatId);
      await sendMenu(env, chatId, state);
      return;
    }
  }

  // fallback
  await sendMenu(env, chatId, state);
}

function menuText(state) {
  const styleLabel = STYLE_OPTIONS.find(([k]) => k === state.style)?.[1] || state.style;
  const srcLabel = SRC_OPTIONS.find(([k]) => k === state.source)?.[1] || state.source;
  const sigLabel = SIGNAL_OPTIONS.find(([k]) => k === state.signal)?.[1] || state.signal;

  return [
    "🎛 تنظیمات تحلیل",
    "",
    `• نماد: ${state.symbol}`,
    `• تایم‌فریم: ${state.timeframe}`,
    `• سیگنال: ${sigLabel}`,
    `• سبک: ${styleLabel}`,
    `• منبع دیتا: ${srcLabel}`,
    `• reasoning effort: ${state.effort}`,
    `• max tokens: ${state.maxTokens}`,
    "",
    "👇 با دکمه‌ها تنظیم کن و بعد «تحلیل کن» رو بزن.",
    "برای تغییر نماد هم «نماد» رو بزن یا /symbol استفاده کن.",
  ].join("\n");
}

function menuKeyboard(state) {
  const tfRow = TF_OPTIONS.map(([k, label]) => ({
    text: (state.timeframe === k ? "✅ " : "") + label,
    callback_data: `set:tf:${k}`,
  }));

  const styleRow = STYLE_OPTIONS.map(([k, label]) => ({
    text: (state.style === k ? "✅ " : "") + label,
    callback_data: `set:style:${k}`,
  }));

  const sigRow = SIGNAL_OPTIONS.map(([k, label]) => ({
    text: (state.signal === k ? "✅ " : "") + label,
    callback_data: `set:sig:${k}`,
  }));

  const tokRows = chunk(TOK_OPTIONS, 3).map((row) =>
    row.map(([k, label]) => ({
      text: (state.maxTokens === k ? "✅ " : "") + label,
      callback_data: `set:tok:${k}`,
    }))
  );

  const srcRows = chunk(SRC_OPTIONS, 2).map((row) =>
    row.map(([k, label]) => ({
      text: (state.source === k ? "✅ " : "") + label,
      callback_data: `set:src:${k}`,
    }))
  );

  const effortRow = EFFORT_OPTIONS.map(([k, label]) => ({
    text: (state.effort === k ? "✅ " : "") + label,
    callback_data: `set:eff:${k}`,
  }));

  return {
    inline_keyboard: [
      tfRow,
      styleRow,
      sigRow,
      ...tokRows,
      ...srcRows,
      effortRow,
      [
        { text: "✍️ نماد", callback_data: "act:symbol:1" },
        { text: "📈 تحلیل کن", callback_data: "act:analyze:1" },
      ],
      [{ text: "❓ راهنما", callback_data: "act:help:1" }],
    ],
  };
}

async function sendMenu(env, chatId, state) {
  // If we have previous menu message, try editing instead of sending new ones
  if (state.menuMessageId) {
    try {
      await telegram(env, "editMessageText", {
        chat_id: chatId,
        message_id: state.menuMessageId,
        text: menuText(state),
        reply_markup: menuKeyboard(state),
      });
      return;
    } catch {
      // fall-through to sending a fresh menu
    }
  }

  const res = await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: menuText(state),
    reply_markup: menuKeyboard(state),
  });

  if (res?.ok && res?.result?.message_id) {
    await setState(env, chatId, { ...state, menuMessageId: res.result.message_id });
  }
}

async function editMenu(env, telegramMessage, state) {
  const chatId = telegramMessage.chat.id;
  const messageId = telegramMessage.message_id;

  await telegram(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: menuText(state),
    reply_markup: menuKeyboard(state),
  });

  // keep latest
  await setState(env, chatId, { ...state, menuMessageId: messageId });
}

async function sendHelp(env, chatId) {
  const txt = [
    "🧩 راهنما",
    "",
    "1) «نماد» رو بزن و نماد رو بفرست (BTCUSDT / EURUSD / BTC/USD ...)",
    "2) تایم‌فریم، سبک تحلیل، سیگنال و max tokens رو با دکمه‌ها انتخاب کن.",
    "3) «تحلیل کن» رو بزن.",
    "",
    "می‌تونی سریع هم بنویسی:",
    "BTCUSDT 4h buy PA 2048",
    "",
    "نکته: اگر AlphaVantage/ CryptoCompare API key نداشته باشی، بعضی نمادها/منابع جواب نمی‌دن.",
  ].join("\n");

  await sendMessage(env, chatId, txt);
}

async function runAnalysis(env, chatId, state) {
  await telegram(env, "sendChatAction", { chat_id: chatId, action: "typing" });

  const header = [
    "⏳ در حال آماده‌سازی تحلیل…",
    `نماد: ${state.symbol} | TF: ${state.timeframe} | سبک: ${state.style} | سیگنال: ${state.signal}`,
  ].join("\n");

  const statusMsg = await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: header,
  });

  const statusMessageId = statusMsg?.result?.message_id;

  let market;
  try {
    market = await fetchMarketBundle(env, state.symbol, state.timeframe, state.source);
  } catch (e) {
    console.error("market fetch error:", e);
    const msg = "❌ خطا در دریافت دیتای بازار. منبع/نماد رو چک کن یا بعداً دوباره بزن.";
    if (statusMessageId) {
      await telegram(env, "editMessageText", { chat_id: chatId, message_id: statusMessageId, text: msg });
    } else {
      await sendMessage(env, chatId, msg);
    }
    return;
  }

  // Build system instructions from your prompt templates
  const stylePrompt = PROMPT_TEMPLATES[state.style] || PROMPT_TEMPLATES.PA;
  const systemInstructions = [
    "تو یک تحلیل‌گر حرفه‌ای بازار هستی.",
    "خروجی را کاملاً به فارسی بنویس.",
    "قالب خروجی باید خوانا برای تلگرام باشد (خط‌به‌خط، بدون جدول‌های طولانی).",
    "اگر دیتای کافی نیست، صریح بگو و با همین دیتا تحلیل بده.",
    "",
    "----- قالب/قوانین سبک انتخاب‌شده -----",
    stylePrompt,
  ].join("\n");

  const payload = {
    request: {
      symbol: state.symbol,
      timeframe: state.timeframe,
      signal: state.signal,
      style: state.style,
      source: market.meta.source,
      updated_at_utc: market.meta.updatedAt,
    },
    market,
    notes: {
      telegram_limit: 4096,
      max_tokens: state.maxTokens,
      reasoning_effort: state.effort,
    },
  };

  let analysisText;
  try {
    analysisText = await callOpenAI(env, systemInstructions, payload, state.maxTokens, state.effort);
  } catch (e) {
    console.error("openai error:", e);
    const msg = "❌ خطا در تحلیل GPT. کلید OpenAI / مدل / محدودیت‌ها رو چک کن.";
    if (statusMessageId) {
      await telegram(env, "editMessageText", { chat_id: chatId, message_id: statusMessageId, text: msg });
    } else {
      await sendMessage(env, chatId, msg);
    }
    return;
  }

  const chunks = chunkTelegramText(analysisText);

  if (statusMessageId) {
    await telegram(env, "editMessageText", {
      chat_id: chatId,
      message_id: statusMessageId,
      text: chunks[0] || "⚠️ خروجی خالی بود.",
    });
  } else {
    if (chunks[0]) await sendMessage(env, chatId, chunks[0]);
  }

  for (let i = 1; i < chunks.length; i++) {
    await sendMessage(env, chatId, chunks[i]);
  }

  await sendMenu(env, chatId, state);
}

async function callOpenAI(env, systemInstructions, payload, maxTokens, effort) {
  if (!env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  const model = env.OPENAI_MODEL || "gpt-5.1";

  const body = {
    model,
    instructions: systemInstructions,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(payload) }],
      },
    ],
    max_output_tokens: maxTokens,
    temperature: 0.2,
    text: { format: { type: "text" } },
    reasoning: { effort: effort || "low" },
    store: false,
  };

  const res = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${res.status}: ${t.slice(0, 500)}`);
  }

  const data = await res.json();
  return extractResponseText(data) || "";
}

function extractResponseText(resp) {
  const out = resp?.output;
  if (!Array.isArray(out)) return "";
  const parts = [];
  for (const item of out) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
      }
    }
  }
  return parts.join("\n").trim();
}

async function fetchMarketBundle(env, symbolRaw, timeframe, source) {
  const symbol = normalizeSymbol(symbolRaw);

  const base = await fetchMarketData(env, symbol, timeframe, source);

  let higher = null;
  if (timeframe !== "1d") {
    try {
      higher = await fetchMarketData(env, symbol, "1d", source === "auto" ? "auto" : source);
    } catch {
      higher = null;
    }
  }

  const atr = computeATRBundle(base.candles);

  return {
    meta: {
      source: base.meta.source,
      symbol,
      timeframe,
      updatedAt: base.meta.updatedAt,
    },
    price: base.price,
    candles: base.candles,
    higher_timeframe: higher
      ? {
          meta: higher.meta,
          candles: higher.candles,
        }
      : null,
    atr,
  };
}

async function fetchMarketData(env, symbol, timeframe, source) {
  const guessed = guessAssetType(symbol);
  const want = source || "auto";

  if (want === "auto") {
    if (guessed.type === "crypto_binance") return fetchBinance(guessed.symbolBinance, timeframe);
    if (guessed.type === "crypto_pair") return fetchCryptoCompare(env, guessed.base, guessed.quote, timeframe);
    return fetchAlphaVantage(env, guessed, timeframe);
  }

  if (want === "binance") {
    const sym = guessed.type === "crypto_binance" ? guessed.symbolBinance : normalizeBinanceSymbol(symbol);
    return fetchBinance(sym, timeframe);
  }

  if (want === "cryptocompare") {
    const { base, quote } = guessed.type === "crypto_pair" ? guessed : splitCryptoPair(symbol);
    return fetchCryptoCompare(env, base, quote, timeframe);
  }

  if (want === "alphavantage") {
    return fetchAlphaVantage(env, guessed, timeframe);
  }

  return fetchAlphaVantage(env, guessed, timeframe);
}

async function fetchBinance(symbol, timeframe) {
  const interval = mapTfToBinance(timeframe);
  const klinesUrl = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=200`;

  const klines = await cachedJson(klinesUrl, 12);
  if (!Array.isArray(klines) || klines.length === 0) {
    throw new Error("Binance: empty klines");
  }

  const candles = klines.map((k) => ({
    t: new Date(k[0]).toISOString(),
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
  }));

  // 24h stats (best-effort)
  let change24h = null;
  try {
    const tickerUrl = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
    const t = await cachedJson(tickerUrl, 8);
    if (t && t.lastPrice) {
      change24h = {
        lastPrice: Number(t.lastPrice),
        priceChangePercent: Number(t.priceChangePercent),
        highPrice: Number(t.highPrice),
        lowPrice: Number(t.lowPrice),
        volume: Number(t.volume),
      };
    }
  } catch {
    change24h = null;
  }

  const last = candles[candles.length - 1];
  return {
    meta: { source: "binance", symbol, timeframe, updatedAt: last.t },
    price: { last: last.c, change24h },
    candles,
  };
}

async function fetchCryptoCompare(env, base, quote, timeframe) {
  const tf = mapTfToCryptoCompare(timeframe);
  const apiKey = env.CRYPTOCOMPARE_API_KEY;
  const keyParam = apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : "";

  const url = `https://min-api.cryptocompare.com/data/v2/${tf.endpoint}?fsym=${encodeURIComponent(base)}&tsym=${encodeURIComponent(quote)}&limit=${tf.limit}&aggregate=${tf.aggregate}${keyParam}`;

  const data = await cachedJson(url, 20);
  const arr = data?.Data?.Data;
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("CryptoCompare: empty data");

  const candles = arr.map((x) => ({
    t: new Date(x.time * 1000).toISOString(),
    o: Number(x.open),
    h: Number(x.high),
    l: Number(x.low),
    c: Number(x.close),
    v: Number(x.volumefrom ?? 0),
  }));

  const last = candles[candles.length - 1];

  let current = null;
  try {
    const pUrl = `https://min-api.cryptocompare.com/data/price?fsym=${encodeURIComponent(base)}&tsyms=${encodeURIComponent(quote)}${keyParam}`;
    const p = await cachedJson(pUrl, 10);
    if (p && p[quote]) current = Number(p[quote]);
  } catch {
    current = null;
  }

  return {
    meta: { source: "cryptocompare", symbol: `${base}/${quote}`, timeframe, updatedAt: last.t },
    price: { last: current ?? last.c, change24h: null },
    candles,
  };
}

async function fetchAlphaVantage(env, guessed, timeframe) {
  if (!env.ALPHAVANTAGE_API_KEY) {
    throw new Error("Missing ALPHAVANTAGE_API_KEY");
  }

  const key = env.ALPHAVANTAGE_API_KEY;
  const av = mapTfToAlphaVantage(timeframe);

  let url;
  let parse;

  // Alpha Vantage crypto is typically available as DAILY series (DIGITAL_CURRENCY_DAILY).
  // If you need intraday crypto, prefer Binance/CryptoCompare.
  if (guessed.type === "crypto_pair") {
    if (timeframe !== "1d") {
      throw new Error("AlphaVantage crypto: intraday not supported. Choose Binance/CryptoCompare or TF=1d.");
    }
    const market = normalizeAvMarket(guessed.quote);
    url = `https://www.alphavantage.co/query?function=DIGITAL_CURRENCY_DAILY&symbol=${encodeURIComponent(
      guessed.base
    )}&market=${encodeURIComponent(market)}&apikey=${encodeURIComponent(key)}`;
    parse = parseAlphaVantageCryptoDaily;
  } else if (guessed.type === "forex") {
    url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${encodeURIComponent(guessed.from)}&to_symbol=${encodeURIComponent(guessed.to)}&interval=${encodeURIComponent(av.interval)}&outputsize=${encodeURIComponent(av.outputsize)}&apikey=${encodeURIComponent(key)}`;
    parse = parseAlphaVantageFX;
  } else if (guessed.type === "stock") {
    url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${encodeURIComponent(guessed.symbol)}&interval=${encodeURIComponent(av.interval)}&outputsize=${encodeURIComponent(av.outputsize)}&apikey=${encodeURIComponent(key)}`;
    parse = parseAlphaVantageStock;
  } else if (guessed.type === "crypto_daily") {
    const market = guessed.market || "USD";
    url = `https://www.alphavantage.co/query?function=DIGITAL_CURRENCY_DAILY&symbol=${encodeURIComponent(guessed.base)}&market=${encodeURIComponent(market)}&apikey=${encodeURIComponent(key)}`;
    parse = parseAlphaVantageCryptoDaily;
  } else {
    url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${encodeURIComponent(guessed.symbol || guessed.raw)}&interval=${encodeURIComponent(av.interval)}&outputsize=${encodeURIComponent(av.outputsize)}&apikey=${encodeURIComponent(key)}`;
    parse = parseAlphaVantageStock;
  }

  const raw = await cachedJson(url, 30);

  if (raw?.Note) throw new Error(`AlphaVantage rate limit: ${raw.Note}`);
  if (raw?.["Error Message"]) throw new Error(`AlphaVantage error: ${raw["Error Message"]}`);

  let candles = parse(raw);

  if (av.aggregateHours) {
    candles = aggregateCandles(candles, av.aggregateHours);
  }

  if (!candles?.length) throw new Error("AlphaVantage: no candles");

  const last = candles[candles.length - 1];
  return {
    meta: { source: "alphavantage", symbol: guessed.display || guessed.raw || guessed.symbol, timeframe, updatedAt: last.t },
    price: { last: last.c, change24h: null },
    candles,
  };
}

function parseAlphaVantageFX(raw) {
  const key = Object.keys(raw).find((k) => k.startsWith("Time Series FX"));
  const series = raw[key];
  if (!series) return [];
  const items = Object.entries(series).map(([ts, ohlc]) => ({
    t: new Date(ts + "Z").toISOString(),
    o: Number(ohlc["1. open"]),
    h: Number(ohlc["2. high"]),
    l: Number(ohlc["3. low"]),
    c: Number(ohlc["4. close"]),
    v: 0,
  }));
  items.sort((a, b) => a.t.localeCompare(b.t));
  return items.slice(-200);
}

function parseAlphaVantageStock(raw) {
  const key = Object.keys(raw).find((k) => k.startsWith("Time Series"));
  const series = raw[key];
  if (!series) return [];
  const items = Object.entries(series).map(([ts, ohlc]) => ({
    t: new Date(ts + "Z").toISOString(),
    o: Number(ohlc["1. open"]),
    h: Number(ohlc["2. high"]),
    l: Number(ohlc["3. low"]),
    c: Number(ohlc["4. close"]),
    v: Number(ohlc["5. volume"] || 0),
  }));
  items.sort((a, b) => a.t.localeCompare(b.t));
  return items.slice(-200);
}

function parseAlphaVantageCryptoDaily(raw) {
  const series = raw["Time Series (Digital Currency Daily)"];
  if (!series) return [];
  const items = Object.entries(series).map(([ts, ohlc]) => ({
    t: new Date(ts + "T00:00:00Z").toISOString(),
    o: Number(ohlc["1a. open (USD)"] || 0),
    h: Number(ohlc["2a. high (USD)"] || 0),
    l: Number(ohlc["3a. low (USD)"] || 0),
    c: Number(ohlc["4a. close (USD)"] || 0),
    v: Number(ohlc["5. volume"] || 0),
  }));
  items.sort((a, b) => a.t.localeCompare(b.t));
  return items.slice(-200);
}

function aggregateCandles(candles, hours) {
  const ms = hours * 60 * 60 * 1000;
  const out = [];
  let bucket = null;

  for (const c of candles) {
    const t = Date.parse(c.t);
    const start = Math.floor(t / ms) * ms;
    if (!bucket || bucket._start !== start) {
      if (bucket) out.push(finalizeBucket(bucket));
      bucket = {
        _start: start,
        o: c.o,
        h: c.h,
        l: c.l,
        c: c.c,
        v: c.v || 0,
        t: new Date(start).toISOString(),
      };
    } else {
      bucket.h = Math.max(bucket.h, c.h);
      bucket.l = Math.min(bucket.l, c.l);
      bucket.c = c.c;
      bucket.v += c.v || 0;
    }
  }
  if (bucket) out.push(finalizeBucket(bucket));

  return out.slice(-200);

  function finalizeBucket(b) {
    return { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
  }
}

function computeATRBundle(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 2) return null;

  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    const tr = Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c));
    trs.push(tr);
  }

  const atrs = [];
  for (let i = period - 1; i < trs.length; i++) {
    let sum = 0;
    for (let j = i - (period - 1); j <= i; j++) sum += trs[j];
    atrs.push(sum / period);
  }

  const lastATR = atrs[atrs.length - 1];
  const last50 = atrs.slice(-50);
  const avg50 = last50.reduce((a, b) => a + b, 0) / Math.max(1, last50.length);
  const lastPrice = candles[candles.length - 1].c;

  return {
    period,
    last: lastATR,
    avg50,
    pct_of_price: lastPrice ? (lastATR / lastPrice) * 100 : null,
  };
}

function guessAssetType(symbolRaw) {
  const raw = normalizeSymbol(symbolRaw);

  if (raw.includes("/") || raw.includes("-") || raw.includes(":")) {
    const { base, quote } = splitCryptoPair(raw);
    return { type: "crypto_pair", base, quote, raw, display: `${base}/${quote}` };
  }

  // Binance-like: BTCUSDT
  if (/^[A-Z0-9]{6,20}$/.test(raw) && /(USDT|BUSD|USDC|USD)$/.test(raw)) {
    return { type: "crypto_binance", symbolBinance: raw, raw, display: raw };
  }

  // Forex like EURUSD
  if (/^[A-Z]{6}$/.test(raw)) {
    return { type: "forex", from: raw.slice(0, 3), to: raw.slice(3, 6), raw, display: `${raw.slice(0, 3)}/${raw.slice(3, 6)}` };
  }

  return { type: "stock", symbol: raw, raw, display: raw };
}

function splitCryptoPair(s) {
  const raw = normalizeSymbol(s).replace(":", "/");
  const sep = raw.includes("/") ? "/" : raw.includes("-") ? "-" : "/";
  const parts = raw.split(sep).filter(Boolean);
  const base = (parts[0] || "BTC").toUpperCase();
  const quote = (parts[1] || "USD").toUpperCase();
  return { base, quote };
}

function normalizeSymbol(s) {
  return String(s || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeBinanceSymbol(s) {
  const { base, quote } = splitCryptoPair(s);
  return (base + quote).toUpperCase();
}

function normalizeAvMarket(q) {
  const s = String(q || "").toUpperCase();
  // Alpha Vantage uses fiat currency codes like USD/EUR.
  if (s === "USDT" || s === "USDC" || s === "BUSD") return "USD";
  return s;
}

function mapTfToBinance(tf) {
  const t = tf.toLowerCase();
  if (["15m", "30m", "1h", "4h", "1d"].includes(t)) return t;
  return "4h";
}

function mapTfToCryptoCompare(tf) {
  const t = tf.toLowerCase();
  if (t === "15m") return { endpoint: "histominute", aggregate: 15, limit: 200 };
  if (t === "30m") return { endpoint: "histominute", aggregate: 30, limit: 200 };
  if (t === "1h") return { endpoint: "histohour", aggregate: 1, limit: 200 };
  if (t === "4h") return { endpoint: "histohour", aggregate: 4, limit: 200 };
  if (t === "1d") return { endpoint: "histoday", aggregate: 1, limit: 200 };
  return { endpoint: "histohour", aggregate: 4, limit: 200 };
}

function mapTfToAlphaVantage(tf) {
  const t = tf.toLowerCase();
  if (t === "15m") return { interval: "15min", outputsize: "compact", aggregateHours: null };
  if (t === "30m") return { interval: "30min", outputsize: "compact", aggregateHours: null };
  if (t === "1h") return { interval: "60min", outputsize: "compact", aggregateHours: null };
  if (t === "4h") return { interval: "60min", outputsize: "compact", aggregateHours: 4 };
  if (t === "1d") return { interval: "60min", outputsize: "full", aggregateHours: 24 };
  return { interval: "60min", outputsize: "compact", aggregateHours: 4 };
}

function chunkTelegramText(text, maxLen = 3800) {
  const s = String(text || "").trim();
  if (!s) return [""];
  const paras = s.split(/\n\n+/);
  const chunks = [];
  let cur = "";

  for (const p of paras) {
    const part = p.trim();
    if (!part) continue;

    if (part.length > maxLen) {
      if (cur) {
        chunks.push(cur.trim());
        cur = "";
      }
      for (let i = 0; i < part.length; i += maxLen) {
        chunks.push(part.slice(i, i + maxLen));
      }
      continue;
    }

    if ((cur + "\n\n" + part).length > maxLen) {
      chunks.push(cur.trim());
      cur = part;
    } else {
      cur = cur ? cur + "\n\n" + part : part;
    }
  }

  if (cur) chunks.push(cur.trim());
  return chunks.length ? chunks : [s.slice(0, maxLen)];
}

function parseQuickLine(text) {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) return null;

  const out = {};
  out.symbol = normalizeSymbol(parts[0]);

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i].toLowerCase();
    if (["15m", "30m", "1h", "4h", "1d"].includes(p)) out.timeframe = p;
    if (["buy", "sell", "neutral"].includes(p)) out.signal = p;
    if (["pa", "ict", "atr"].includes(p)) out.style = p.toUpperCase();
    if (/^\d+$/.test(p)) out.maxTokens = clampInt(p, 256, 128000);
    if (p.startsWith("src=")) out.source = p.slice(4);
    if (p.startsWith("eff=")) out.effort = p.slice(4);
  }

  return out.symbol ? out : null;
}

async function telegram(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");

  const url = `${TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.ok) {
    console.error("Telegram API error", method, res.status, data);
  }
  return data;
}

async function sendMessage(env, chatId, text, extra = {}) {
  return telegram(env, "sendMessage", { chat_id: chatId, text, ...extra });
}

async function cachedJson(url, ttlSeconds = 10) {
  const cache = caches.default;
  const cacheKey = new Request(url, { method: "GET", headers: { accept: "application/json" } });

  const hit = await cache.match(cacheKey);
  if (hit) return hit.json();

  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

  const cloned = res.clone();
  const headers = new Headers(cloned.headers);
  headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
  const cachedRes = new Response(cloned.body, { status: cloned.status, statusText: cloned.statusText, headers });
  await cache.put(cacheKey, cachedRes);

  return res.json();
}

async function getState(env, chatId) {
  const key = `state:${chatId}`;
  if (env.BOT_KV?.get) {
    const raw = await env.BOT_KV.get(key);
    if (raw) {
      try {
        return { ...DEFAULT_STATE, ...JSON.parse(raw) };
      } catch {
        return { ...DEFAULT_STATE };
      }
    }
    return { ...DEFAULT_STATE };
  }
  const s = memState.get(key);
  return { ...DEFAULT_STATE, ...(s || {}) };
}

async function setState(env, chatId, state) {
  const key = `state:${chatId}`;
  const clean = { ...DEFAULT_STATE, ...state };

  if (env.BOT_KV?.put) {
    await env.BOT_KV.put(key, JSON.stringify(clean));
    return;
  }
  memState.set(key, clean);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function clampInt(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
