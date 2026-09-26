import type { Content } from "@google/genai";
import type { Lang, UiAction } from "@/lib/voiceActions";
import { generate, GEMINI_MODEL } from "@/server/gemini";
import { getReefData } from "@/server/reef";
import { isPageTool, pageToolDeclarations, toAction } from "./pageTools";
import { runTool, toolDeclarations } from "./tools";

/** Hard stop so a confused model cannot loop forever. */
const MAX_TURNS = 6;

export interface AgentContext {
  /** "map" (all reefs) or "reef" (underwater at one site). */
  view?: "map" | "reef";
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

async function systemPrompt(ctx: AgentContext) {
  const sites = await getReefData().listSites();
  const current = sites.find((s) => s.id === ctx.siteId);
  const lang = LANG_NAME[ctx.lang ?? "en"];
  return [
    "You are Reef Atlas, a voice guide to Florida's Coral Reef. Your answer is spoken aloud, often to people who cannot see the screen.",
    "Rules:",
    "- Answer only from tool results. Never invent numbers. If the tools cannot answer, say so.",
    "- Call tools before answering any question about data. Call several in one turn when they are independent.",
    "- Activity data (fishing, vessels, SAR) is simulated. Say that when you use it.",
    "- Reply in 2 to 4 short spoken sentences. No markdown, lists, or symbols. Say units in words (\"degree heating weeks\", \"kilometers\").",
    "- Say numbers exactly as the tools give them; never round (14.4 is \"fourteen point four\", \"catorce coma cuatro\").",
    "- Data covers 2016-01-01 to 2024-12-31.",
    "- Name the time window you used, in words (\"in the twelve months to August 2023\").",
    "- Degree heating weeks (DHW) and bleaching alert levels are different measures. weeksDhwAtLeast4 means weeks with DHW of 4 or more, not an alert level.",
    `- Reply in the language of the question. If unclear, reply in ${lang}. Keep reef and storm names as they are.`,
    "Navigation:",
    "- To move the page, call a page tool: go_to_reef, go_to_map, set_date, set_layer, set_playing. You may use data tools first, e.g. find the hottest reef, then go_to_reef.",
    "- After a page tool, confirm in one short sentence what is happening (\"Taking you to Looe Key.\"). The page describes the new scene itself, so do not describe it.",
    "- \"Where am I?\": say the view, reef, and date from the context below, plus one key fact from a data tool if a reef is open.",
    "- \"What can I say?\" / help: say they can name a reef to dive in, say a month and year to move in time, turn hurricanes, lionfish, or sea temperature on or off, say play or pause, say go back up, or ask about the data.",
    `Sites (id: name, region): ${sites.map((s) => `${s.id}: ${s.name}, ${s.region}`).join("; ")}.`,
    "Current page:",
    ctx.view === "reef" && current
      ? `- Underwater at ${current.name} (${current.id}), ${current.region}. "This reef" means this site.`
      : "- On the map of all nine reefs. No reef is open.",
    ctx.date ? `- Timeline at ${ctx.date}. "Now" means this date; when no range is given, use the 12 months before it.` : "",
    ctx.layers ? `- Map layers on: ${ctx.layers.length ? ctx.layers.join(", ") : "none"}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Question in, spoken answer + page actions out. Gemini asks for tools; we run them and feed results back until it answers. */
export async function runAgent(question: string, ctx: AgentContext) {
  const contents: Content[] = [{ role: "user", parts: [{ text: question }] }];
  const trace: ToolTrace[] = [];
  const actions: UiAction[] = [];
  const config = {
    systemInstruction: await systemPrompt(ctx),
    tools: [{ functionDeclarations: [...toolDeclarations, ...pageToolDeclarations] }],
  };
  // Once a turn falls back to another model, stay on it so the conversation's thought signatures match.
  let model = GEMINI_MODEL;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const out = await generate({ contents, config }, model);
    const res = out.res;
    model = out.model;
    const calls = res.functionCalls ?? [];
    if (!calls.length) return { answer: res.text?.trim() || "Sorry, I could not find an answer.", trace, actions };

    // Keep the model's turn as-is (it can carry thought signatures the next call needs).
    const modelTurn = res.candidates?.[0]?.content;
    if (modelTurn) contents.push(modelTurn);

    const results = await Promise.all(
      calls.map(async (c) => {
        const name = c.name ?? "";
        const args = (c.args ?? {}) as Record<string, unknown>;
        let result: unknown;
        if (isPageTool(name)) {
          const action = toAction(name, args);
          if ("error" in action) result = action;
          else {
            actions.push(action);
            result = { ok: true, note: "The page will do this when you reply." };
          }
        } else {
          result = await runTool(name, args);
        }
        trace.push({ name, args, result });
        return { functionResponse: { id: c.id, name, response: { result } } };
      }),
    );
    contents.push({ role: "user", parts: results });
  }
  return { answer: "Sorry, that question needed too many steps. Try asking something narrower.", trace, actions };
}
