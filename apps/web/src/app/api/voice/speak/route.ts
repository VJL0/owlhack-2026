/** A GET so an <audio src> can stream it and start playing before the whole file arrives. */
const MAX_CHARS = 1200;

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const text = params.get("text")?.trim() ?? "";
  // ISO 639-1 code; Flash v2.5 uses it to lock the spoken language (stops Spanish being read with English rules).
  const lang = params.get("lang");
  if (!text) return Response.json({ error: "Missing text." }, { status: 400 });
  if (text.length > MAX_CHARS) return Response.json({ error: "Text too long." }, { status: 413 });
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return Response.json({ error: "ELEVENLABS_API_KEY is not set." }, { status: 500 });
  // Read per request so edits to .env.local apply without a restart.
  // Defaults: "George" (an ElevenLabs premade voice) and Flash, the low-latency model.
  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";
  const modelId = process.env.ELEVENLABS_MODEL_ID ?? "eleven_flash_v2_5";

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: modelId, ...(lang === "en" || lang === "es" ? { language_code: lang } : {}) }),
    },
  );
  if (!upstream.ok || !upstream.body) {
    console.error("[voice/speak]", upstream.status, await upstream.text().catch(() => ""));
    return Response.json({ error: "Speech synthesis failed." }, { status: 502 });
  }
  return new Response(upstream.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
}
