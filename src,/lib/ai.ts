import type { Env } from "../env";

export async function callAI(env: Env, prompt: string, opts?: { temperature?: number }): Promise<string> {
  const provider = (env.AI_PROVIDER ?? "openai").toLowerCase();
  if (provider === "gemini") return callGemini(env, prompt);
  return callOpenAIResponses(env, prompt, opts);
}

// OpenAI Responses API (recommended for new projects)
async function callOpenAIResponses(env: Env, prompt: string, opts?: { temperature?: number }): Promise<string> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing");
  const model = env.OPENAI_MODEL || "gpt-4.1-mini";

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      input: prompt,
      temperature: opts?.temperature ?? 0.2,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${t}`);
  }
  const data = await res.json() as any;

  // Responses API returns an output array; we extract all text segments.
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

async function callGemini(env: Env, prompt: string): Promise<string> {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");
  const model = env.GEMINI_MODEL || "gemini-1.5-pro";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini error: ${res.status} ${t}`);
  }
  const data = await res.json() as any;
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("\n") ?? "";
  if (!text.trim()) throw new Error("Gemini returned empty output");
  return text.trim();
}

export function extractJsonBlock(text: string): any | null {
  // tries ```json ... ``` or { ... } at end
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch { /* ignore */ }
  }
  const tailObj = text.match(/(\{[\s\S]*\})\s*$/);
  if (tailObj) {
    try { return JSON.parse(tailObj[1]); } catch { /* ignore */ }
  }
  return null;
}


export async function callAIWithImage(env: Env, prompt: string, imageDataUrl: string, opts?: { temperature?: number }): Promise<string> {
  const provider = (env.AI_PROVIDER ?? "openai").toLowerCase();
  if (provider !== "openai") {
    // Gemini vision could be added similarly; for now fallback to text only.
    return callAI(env, prompt, opts);
  }
  return callOpenAIResponsesVision(env, prompt, imageDataUrl, opts);
}

async function callOpenAIResponsesVision(env: Env, prompt: string, imageDataUrl: string, opts?: { temperature?: number }): Promise<string> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing");
  const model = env.OPENAI_MODEL || "gpt-4.1-mini";

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageDataUrl }
          ]
        }
      ],
      temperature: opts?.temperature ?? 0.2,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${t}`);
  }
  const data = await res.json() as any;

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
