import { ApiError, GoogleGenAI, type GenerateContentParameters } from "@google/genai";

/** "gemini-flash-latest" follows Google's current Flash model; pin an exact id in .env.local if you need stability. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";
/** Used when the main model is overloaded. Lite models usually have spare capacity. */
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-flash-lite-latest";

let client: GoogleGenAI | null = null;

export function gemini() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set. Add it to apps/web/.env.local.");
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

/** 503 = model overloaded, 429 = rate limited, 500 = transient server error. Worth another try. */
export const isBusy = (e: unknown) => e instanceof ApiError && [429, 500, 503].includes(e.status);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * generateContent with retries: main model twice, then the fallback model twice.
 * Returns the model that answered so a multi-turn caller can stay on it.
 */
export async function generate(params: Omit<GenerateContentParameters, "model">, preferred = GEMINI_MODEL) {
  const plan = preferred === FALLBACK_MODEL ? [preferred, preferred] : [preferred, preferred, FALLBACK_MODEL, FALLBACK_MODEL];
  let last: unknown;
  for (let i = 0; i < plan.length; i++) {
    try {
      const res = await gemini().models.generateContent({ ...params, model: plan[i] });
      return { res, model: plan[i] };
    } catch (e) {
      if (!isBusy(e)) throw e;
      last = e;
      console.warn(`[gemini] ${plan[i]} busy (${(e as ApiError).status}), attempt ${i + 1}/${plan.length}`);
      if (i < plan.length - 1) await sleep(400 * (i + 1));
    }
  }
  throw last;
}
