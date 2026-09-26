import { generate, isBusy } from "@/server/gemini";

/** About 5 minutes of 16 kHz mono WAV; far more than one question needs. */
const MAX_BYTES = 10 * 1024 * 1024;

/** Body: raw audio (the client sends 16 kHz mono WAV). Returns { text }. */
export async function POST(req: Request) {
  const mimeType = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!mimeType.startsWith("audio/")) return Response.json({ error: "Send audio with an audio/* content-type." }, { status: 415 });
  const audio = Buffer.from(await req.arrayBuffer());
  if (!audio.length) return Response.json({ error: "Empty audio." }, { status: 400 });
  if (audio.length > MAX_BYTES) return Response.json({ error: "Audio too long." }, { status: 413 });

  try {
    const { res } = await generate({
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: audio.toString("base64") } },
            {
              text: "Transcribe this speech in the language it is spoken (English or Spanish); do not translate. It is a question or command about Florida coral reefs (sites like Looe Key, Molasses Reef, Carysfort Reef, Sombrero Key, Fowey Rocks). Drop filler words (um, uh, like) and false starts; keep every real word otherwise. Return only the transcript. If there is no speech, return nothing.",
            },
          ],
        },
      ],
      config: { temperature: 0 },
    });
    return Response.json({ text: res.text?.trim() ?? "" });
  } catch (e) {
    console.error("[voice/transcribe]", e);
    if (isBusy(e)) return Response.json({ error: "Gemini is busy right now. Try again in a moment." }, { status: 503 });
    return Response.json({ error: "Transcription failed." }, { status: 502 });
  }
}
