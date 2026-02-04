import { fetchWithTimeout } from '../utils';
export async function geminiGenerate(opts: {
  apiKey: string;
  model: string;
  user: string;
  system?: string;
  temperature?: number;
}) {
  // طبق مستندات رسمی Gemini API (generateContent)، احراز هویت با x-goog-api-key انجام می‌شود.
  // https://ai.google.dev/api/generate-content
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`;
  const body = {
    contents: [
      ...(opts.system
        ? [{ role: 'user', parts: [{ text: `SYSTEM:\n${opts.system}` }] }]
        : []),
      { role: 'user', parts: [{ text: opts.user }] },
    ],
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
    },
  };

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': opts.apiKey,
    },
    body: JSON.stringify(body),
  }, 15_000);

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini error: ${res.status} ${t}`);
  }
  const data = await res.json() as any;
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('')?.trim();
  if (!text) throw new Error('Gemini: empty response');
  return text;
}
