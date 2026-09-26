import { generate, isBusy } from "@/server/gemini";

const NAMES = { es: "Spanish" } as const;
type Target = keyof typeof NAMES;

/** Narration sentences repeat a lot (same reef, same month); keep each translation for the server's lifetime. */
const cache = new Map<string, string>();

/** Body: { text, lang }. Returns { text } translated for speech. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { text?: unknown; lang?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const lang = body?.lang as Target;
  if (!text || text.length > 1200) return Response.json({ error: "Send 1–1200 characters of text." }, { status: 400 });
  if (!(lang in NAMES)) return Response.json({ error: `lang must be one of ${Object.keys(NAMES).join(", ")}.` }, { status: 400 });

  const key = `${lang}:${text}`;
  const hit = cache.get(key);
  if (hit) return Response.json({ text: hit });

  try {
    const { res } = await generate({
      contents: [{ role: "user", parts: [{ text }] }],
      config: {
        temperature: 0,
        systemInstruction: `Translate the user's text into natural ${NAMES[lang]} for being read aloud. Keep numbers, dates, reef and storm names, and agency names (NOAA, USGS) as they are. Return only the translation.`,
      },
    });
    const out = res.text?.trim() || text;
    cache.set(key, out);
    return Response.json({ text: out });
  } catch (e) {
    console.error("[voice/translate]", e);
    if (isBusy(e)) return Response.json({ error: "Gemini is busy right now." }, { status: 503 });
    return Response.json({ error: "Translation failed." }, { status: 502 });
  }
}
