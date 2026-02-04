import type { Env } from "../env";

/**
 * Text AI with provider fallback.
 * Default chain: openai -> gemini -> cloudflare
 * Override with: AI_CHAIN="openai,gemini,cloudflare"
 */
export async function callAI(env: Env, prompt: string, opts?: { temperature?: number }): Promise<string> {
  const chain = (env.AI_CHAIN ?? (env.AI_PROVIDER ? env.AI_PROVIDER : "openai,gemini,cloudflare"))
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const errors: string[] = [];
  for (const provider of chain) {
    try {
      if (provider === "openai") {
        if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
        return await callOpenAIResponses(env, prompt, opts);
      }
      if (provider === "gemini") {
        if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
        return await callGemini(env, prompt, opts);
      }
      if (provider === "cloudflare" || provider === "workersai" || provider === "cf") {
        return await callCloudflareWorkersAI(env, prompt);
      }
    } catch (e: any) {
      errors.push(`${provider}: ${e?.message ?? "error"}`);
    }
  }

  throw new Error("All AI providers failed: " + errors.join(" | "));
}

export async function callAIWithImage(
  env: Env,
  prompt: string,
  imageDataUrl: string,
  opts?: { temperature?: number }
): Promise<string> {
  // Vision is implemented via OpenAI only; others fallback to text.
  if (!env.OPENAI_API_KEY) return callAI(env, prompt, opts);
  return callOpenAIResponsesVision(env, prompt, imageDataUrl, opts);
}

async function callCloudflareWorkersAI(env: Env, prompt: string): Promise<string> {
  if (!env.AI) throw new Error("Cloudflare AI binding (env.AI) missing");
  const model = env.CLOUDFLARE_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct";
  const out: any = await env.AI.run(model, { prompt });
  if (typeof out === "string") return out.trim();
  const txt = (out?.response ?? out?.result ?? out?.text ?? "").toString().trim();
  if (!txt) throw new Error("Workers AI returned empty output");
  return txt;
}

// OpenAI Responses API
async function callOpenAIResponses(env: Env, prompt: string, opts?: { temperature?: number }): Promise<string> {
  const model = env.OPENAI_MODEL || "gpt-4.1-mini";
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      input: prompt,
      temperature: opts?.temperature ?? 0.2,
    }),
  });

  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
  const data: any = await res.json();

  const parts: string[] = [];
  const output = data.output ?? [];
  for (const item of output) {
    const content = item.content ?? [];
    for (const c of content) {
      if (c.type === "output_text" && typeof c.text === "string") parts.push(c.text);
    }
  }
  const text = parts.join("\n").trim();
  if (!text) throw new Error("OpenAI returned empty output");
  return text;
}

async function callOpenAIResponsesVision(
  env: Env,
  prompt: string,
  imageDataUrl: string,
  opts?: { temperature?: number }
): Promise<string> {
  const model = env.OPENAI_MODEL || "gpt-4.1-mini";
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageDataUrl },
          ],
        },
      ],
      temperature: opts?.temperature ?? 0.2,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
  const data: any = await res.json();

  const parts: string[] = [];
  const output = data.output ?? [];
  for (const item of output) {
    const content = item.content ?? [];
    for (const c of content) {
      if (c.type === "output_text" && typeof c.text === "string") parts.push(c.text);
    }
  }
  const text = parts.join("\n").trim();
  if (!text) throw new Error("OpenAI returned empty output");
  return text;
}

async function callGemini(env: Env, prompt: string, opts?: { temperature?: number }): Promise<string> {
  const model = env.GEMINI_MODEL || "gemini-1.5-pro";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(
    env.GEMINI_API_KEY
  )}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: opts?.temperature ?? 0.2 },
    }),
  });

  if (!res.ok) throw new Error(`Gemini error: ${res.status} ${await res.text()}`);
  const data: any = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text)
      .filter(Boolean)
      .join("\n") ??
    "";
  if (!text.trim()) throw new Error("Gemini returned empty output");
  return text.trim();
}

export function extractJsonBlock(text: string): any | null {
  // tries ```json ... ``` or { ... } at end
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      /* ignore */
    }
  }
  const tailObj = text.match(/(\{[\s\S]*\})\s*$/);
  if (tailObj) {
    try {
      return JSON.parse(tailObj[1]);
    } catch {
      /* ignore */
    }
  }
  return null;
}
