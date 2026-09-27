import { runAgent } from "@/server/agent/runAgent";
import { isBusy } from "@/server/gemini";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/**
 * Body: { question, view?, siteId?, date?, layers?, lang? }.
 * Returns { answer, trace, actions }: trace lists the tools the agent ran; actions are page moves for the browser.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const question = str(body?.question)?.trim() ?? "";
  if (!question) return Response.json({ error: "Missing question." }, { status: 400 });

  try {
    const out = await runAgent(question, {
      view: body?.view === "reef" || body?.view === "flagship" || body?.view === "world" ? body.view : "map",
      siteId: str(body?.siteId),
      flagshipId: str(body?.flagshipId),
      flagshipDate: str(body?.flagshipDate),
      date: str(body?.date),
      layers: Array.isArray(body?.layers) ? body.layers.filter((l): l is string => typeof l === "string") : undefined,
      lang: body?.lang === "es" ? "es" : "en",
    });
    return Response.json(out);
  } catch (e) {
    console.error("[voice/ask]", e);
    if (isBusy(e)) return Response.json({ error: "Gemini is busy right now. Try again in a moment." }, { status: 503 });
    return Response.json({ error: "The agent failed to answer." }, { status: 502 });
  }
}
