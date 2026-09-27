import type { Content, Part } from "@google/genai";
import type { Lang, UiAction } from "@/lib/voiceActions";
import { generateStream, GEMINI_MODEL } from "@/server/gemini";
import { getReefData, type SiteInfo } from "@/server/reef";
import { isPageTool, pageToolDeclarations, toAction } from "./pageTools";
import { runTool, toolDeclarations } from "./tools";

/** Hard stop so a confused model cannot loop forever. */
const MAX_TURNS = 6;

export interface AgentContext {
  /** "world" (globe), "flagship" (a flagship dossier), "map" (Florida's nine reefs) or "reef" (underwater at one site). */
  view?: "world" | "flagship" | "map" | "reef";
  /** The flagship dossier on screen. */
  flagshipId?: string;
  /** Cursor on the flagship evidence timeline, YYYY-MM-DD. */
  flagshipDate?: string;
  /** The reef on screen, so "this reef" has a meaning. */
  siteId?: string;
  /** The date on the timeline, YYYY-MM-DD, so "now" has a meaning. */
  date?: string;
  /** Map layers currently shown. */
  layers?: string[];
  /** Default reply language when the question's language is unclear. */
  lang?: Lang;
}

export interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

const LANG_NAME: Record<Lang, string> = { en: "English", es: "Spanish" };

function systemPrompt(ctx: AgentContext, sites: SiteInfo[]) {
  const current = sites.find((s) => s.id === ctx.siteId);
  const lang = LANG_NAME[ctx.lang ?? "en"];
  return [
    "You are Reef Atlas, a voice guide to coral reefs. Your answer is spoken aloud, often to people who cannot see the screen.",
    "The atlas has three flagship reefs with long field records (moorea: Moorea, French Polynesia; lizard-island: Lizard Island, Great Barrier Reef; soneva-fushi: Soneva Fushi, Maldives) and Florida's Coral Reef with nine sites.",
    "Rules:",
    "- Answer only from tool results. Never invent numbers. If the tools cannot answer, say so.",
    "- Call tools before answering any question about data. Call several in one turn when they are independent.",
    "- Activity data (fishing, vessels, SAR) is simulated. Say that when you use it.",
    "- Reply in 2 to 4 short spoken sentences. No markdown, lists, or symbols. Say units in words (\"degree heating weeks\", \"kilometers\").",
    "- Say numbers exactly as the tools give them; never round (14.4 is \"fourteen point four\", \"catorce coma cuatro\").",
    "- Florida data covers 2016-01-01 to 2024-12-31. For Moorea, Lizard Island or Soneva Fushi, use get_flagship_evidence (its own years).",
    "- For flagships, say what kind of evidence each number is (field survey, reef sensor, satellite, storm track, reported cause, derived). Never say a pressure caused a change: say what was present in the same interval, and say what was not measured.",
    "- Name the time window you used, in words (\"in the twelve months to August 2023\").",
    "- Degree heating weeks (DHW) and bleaching alert levels are different measures. weeksDhwAtLeast4 means weeks with DHW of 4 or more, not an alert level.",
    `- Reply in the language of the question. If unclear, reply in ${lang}. Keep reef and storm names as they are.`,
    "Navigation:",
    "- To move the page, call a page tool: go_to_flagship, go_to_world, set_flagship_date, go_to_reef, go_to_map, set_date, set_layer, set_playing. You may use data tools first, e.g. find the hottest reef, then go_to_reef.",
    "- After a page tool, confirm in one short sentence what is happening (\"Taking you to Looe Key.\"). The page describes the new scene itself, so do not describe it.",
    "- \"Where am I?\": say the view, reef, and date from the context below, plus one key fact from a data tool if a reef is open.",
    "- \"What can I say?\" / help: say they can name a reef to dive in, say a month and year to move in time, turn hurricanes, lionfish, or sea temperature on or off, say play or pause, say go back up, or ask about the data.",
    `Sites (id: name, region): ${sites.map((s) => `${s.id}: ${s.name}, ${s.region}`).join("; ")}.`,
    "Current page:",
    ctx.view === "reef" && current
      ? `- Underwater at ${current.name} (${current.id}), ${current.region}. "This reef" means this site.`
      : ctx.view === "flagship" && ctx.flagshipId
        ? `- Viewing the ${ctx.flagshipId} flagship dossier. "Here" and "this reef" mean ${ctx.flagshipId}.${ctx.flagshipDate ? ` Its timeline cursor is at ${ctx.flagshipDate}.` : ""}`
        : ctx.view === "world"
          ? "- On the globe with all flagship reefs. No reef is open."
          : "- On the map of Florida's nine reefs. No reef is open.",
    ctx.date && (ctx.view === "map" || ctx.view === "reef") ? `- Florida timeline at ${ctx.date}. "Now" means this date; when no range is given, use the 12 months before it.` : "",
    ctx.layers && ctx.view === "map" ? `- Map layers on: ${ctx.layers.length ? ctx.layers.join(", ") : "none"}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Question in, spoken answer + page actions out. Gemini asks for tools; we run them and feed results back until it answers. */
export interface AgentResult { answer: string; trace: ToolTrace[]; actions: UiAction[] }
export type AgentEvent = { type: "text"; text: string } | { type: "result"; result: AgentResult };

export async function runAgent(question: string, ctx: AgentContext) {
  for await (const event of streamAgent([{ role: "user", parts: [{ text: question }] }], ctx)) {
    if (event.type === "result") return event.result;
  }
  throw new Error("Agent ended without a result.");
}

/** The same tool loop serves typed questions and Speech Engine transcripts. */
export async function* streamAgent(history: Content[], ctx: AgentContext, signal?: AbortSignal): AsyncGenerator<AgentEvent, void> {
  signal?.throwIfAborted();
  const contents: Content[] = [...history];
  const trace: ToolTrace[] = [];
  const actions: UiAction[] = [];
  const sites = await getReefData().listSites();
  const siteIds = sites.map((s) => s.id);
  const config = {
    systemInstruction: systemPrompt(ctx, sites),
    tools: [{ functionDeclarations: [...toolDeclarations, ...pageToolDeclarations(siteIds)] }],
  };
  // Once a turn falls back to another model, stay on it so the conversation's thought signatures match.
  let model = GEMINI_MODEL;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    signal?.throwIfAborted();
    const parts: Part[] = [];
    let answer = "";
    for await (const out of generateStream({ contents, config: { ...config, abortSignal: signal } }, model)) {
      signal?.throwIfAborted();
      model = out.model;
      const chunkParts = out.res.candidates?.[0]?.content?.parts ?? [];
      // Preserve function calls and thought signatures exactly for the next model turn.
      parts.push(...chunkParts);
      for (const part of chunkParts) {
        if (part.text && !part.thought) {
          answer += part.text;
          yield { type: "text", text: part.text };
        }
      }
    }
    const calls = parts.flatMap((p) => p.functionCall ? [p.functionCall] : []);
    if (!calls.length) {
      if (!answer.trim()) {
        answer = "Sorry, I could not find an answer.";
        yield { type: "text", text: answer };
      }
      yield { type: "result", result: { answer: answer.trim(), trace, actions } };
      return;
    }
    contents.push({ role: "model", parts });

    const results = await Promise.all(
      calls.map(async (c) => {
        signal?.throwIfAborted();
        const name = c.name ?? "";
        const args = (c.args ?? {}) as Record<string, unknown>;
        let result: unknown;
        if (isPageTool(name)) {
          const action = toAction(name, args, siteIds);
          if ("error" in action) result = action;
          else {
            actions.push(action);
            result = { ok: true, note: "The page will do this when you reply." };
          }
        } else {
          result = await runTool(name, args);
        }
        signal?.throwIfAborted();
        trace.push({ name, args, result });
        return { functionResponse: { id: c.id, name, response: { result } } };
      }),
    );
    contents.push({ role: "user", parts: results });
  }
  signal?.throwIfAborted();
  const answer = "Sorry, that question needed too many steps. Try asking something narrower.";
  yield { type: "text", text: answer };
  yield { type: "result", result: { answer, trace, actions } };
}
