import { openaiChat } from './openai';
import { geminiGenerate } from './gemini';

export interface AiEnv {
  AI_PROVIDER?: string;

  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_BASE_URL?: string;

  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;

  AI_COMPAT_BASE_URL?: string;
  AI_COMPAT_API_KEY?: string;
  AI_COMPAT_MODEL?: string;
}

export async function generateText(env: AiEnv, input: { system?: string; user: string; temperature?: number }) {
  const provider = (env.AI_PROVIDER || 'openai').toLowerCase();

  if (provider === 'gemini') {
    if (!env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');
    const model = env.GEMINI_MODEL || 'gemini-2.0-flash';
    return geminiGenerate({
      apiKey: env.GEMINI_API_KEY,
      model,
      system: input.system,
      user: input.user,
      temperature: input.temperature,
    });
  }

  if (provider === 'openai_compat') {
    if (!env.AI_COMPAT_API_KEY) throw new Error('Missing AI_COMPAT_API_KEY');
    const baseUrl = env.AI_COMPAT_BASE_URL || 'https://api.openai.com/v1';
    const model = env.AI_COMPAT_MODEL || 'gpt-4o-mini';
    return openaiChat({
      apiKey: env.AI_COMPAT_API_KEY,
      baseUrl,
      model,
      system: input.system,
      user: input.user,
      temperature: input.temperature,
    });
  }

  // default: openai
  if (!env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
  const baseUrl = env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = env.OPENAI_MODEL || 'gpt-4o-mini';
  return openaiChat({
    apiKey: env.OPENAI_API_KEY,
    baseUrl,
    model,
    system: input.system,
    user: input.user,
    temperature: input.temperature,
  });
}
