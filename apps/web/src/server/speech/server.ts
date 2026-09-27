import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { ElevenLabsClient, SpeechEngine } from "@elevenlabs/elevenlabs-js";
import { streamAgent, type AgentContext, type AgentResult } from "../agent/runAgent";

const apiKey = process.env.ELEVENLABS_API_KEY;
const engineId = process.env.ELEVENLABS_SPEECH_ENGINE_ID;
if (!apiKey || !engineId?.startsWith("seng_")) throw new Error("Set ELEVENLABS_API_KEY and ELEVENLABS_SPEECH_ENGINE_ID (seng_…).");
const elevenlabs = new ElevenLabsClient({ apiKey });
type State = {
  key: string; context: AgentContext; expires: number; session?: SpeechEngine.Session;
  thinking: boolean; turn: number; sequence: number;
  events: { id: number; result: AgentResult }[]; error?: string;
  narration?: { marker: string; text: string };
};
const conversations = new Map<string, State>();
const browsers = new Map<string, State>();
function remove(state: State) {
  state.session?.close();
  browsers.delete(state.key);
  for (const [id, value] of conversations) if (value === state) conversations.delete(id);
}
setInterval(() => {
  for (const state of browsers.values()) if (state.expires < Date.now()) remove(state);
}, 60_000).unref();

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 32_768) throw new Error("Request too large");
  }
  const value = JSON.parse(text || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid body");
  return value;
}
function context(value: unknown): AgentContext {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const str = (key: string) => typeof v[key] === "string" ? (v[key] as string).slice(0, 200) : undefined;
  return {
    view: v.view === "reef" || v.view === "flagship" || v.view === "world" ? v.view : "map",
    siteId: str("siteId"), flagshipId: str("flagshipId"), flagshipDate: str("flagshipDate"), date: str("date"),
    layers: Array.isArray(v.layers) ? v.layers.filter((x): x is string => typeof x === "string").slice(0, 10) : [],
    lang: v.lang === "es" ? "es" : "en",
  };
}
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  const reply = (status: number, value: unknown) => { res.writeHead(status); res.end(JSON.stringify(value)); };
  const url = new URL(req.url ?? "/", "http://speech");
  if (url.pathname === "/health") return reply(200, { ok: true });
  if (url.pathname !== "/session") return reply(404, { error: "Not found" });
  try {
    if (req.method === "POST") {
      const input = await body(req);
      const token = await elevenlabs.conversationalAi.conversations.getWebrtcToken({ agentId: engineId });
      const state: State = { key: randomUUID(), context: context(input.context), expires: Date.now() + 120_000, thinking: false, turn: 0, sequence: 0, events: [] };
      conversations.set(token.conversationId, state);
      browsers.set(state.key, state);
      return reply(200, { token: token.token, key: state.key });
    }
    const key = req.headers.authorization?.replace(/^Bearer /, "");
    const state = key ? browsers.get(key) : undefined;
    if (!state || state.expires < Date.now()) return reply(404, { error: "Voice session expired. Start again." });
    state.expires = Date.now() + 120_000;
    if (req.method === "DELETE") { remove(state); return reply(200, { ok: true }); }
    if (req.method === "PATCH") {
      const input = await body(req);
      if (input.context) state.context = context(input.context);
      if (typeof input.narration === "string") {
        state.narration = { marker: `[scene:${randomUUID()}]`, text: input.narration.slice(0, 8000) };
        return reply(200, { marker: state.narration.marker });
      }
      return reply(200, { ok: true });
    }
    if (req.method === "GET") {
      const after = Number(url.searchParams.get("after") ?? 0);
      state.events = state.events.filter((e) => e.id > after);
      return reply(200, { events: state.events, thinking: state.thinking, error: state.error });
    }
    reply(405, { error: "Method not allowed" });
  } catch (error) {
    console.error("[speech/http]", error instanceof Error ? error.message : "Request failed");
    reply(502, { error: "Speech Engine unavailable. You can still type a question." });
  }
});

async function main() {
  // The SDK verifies ElevenLabs' signed upgrade JWT and handles ping/pong and event IDs.
  await elevenlabs.speechEngine.attach(engineId!, server, "/ws", {
    onInit(id, session) {
      const state = conversations.get(id);
      if (!state) { session.close(); return; }
      state.session = session;
    },
    onTranscript(transcript, signal, session) {
      const state = conversations.get(session.conversationId ?? "");
      if (!state) { session.close(); return; }
      const turn = ++state.turn;
      state.thinking = true;
      state.error = undefined;
      const narration = state.narration;
      state.narration = undefined;
      // Call sendResponse immediately: it captures this transcript's event ID before any await.
      return session.sendResponse((async function* () {
        try {
          signal.throwIfAborted();
          if (narration && transcript.at(-1)?.content === narration.marker) {
            yield narration.text;
            return;
          }
          const history = transcript.map((m) => ({ role: m.role === "agent" ? "model" : "user", parts: [{ text: m.content }] }));
          for await (const event of streamAgent(history, state.context, signal)) {
            signal.throwIfAborted();
            if (event.type === "text") yield event.text;
            else {
              state.events.push({ id: ++state.sequence, result: event.result });
              state.events = state.events.slice(-50);
            }
          }
        } catch (error) {
          if (signal.aborted) return;
          console.error("[speech/agent]", error instanceof Error ? error.message : "Agent failed");
          state.error = "The agent failed to answer. Try again or type your question.";
          yield "Sorry, I could not answer that. Please try again.";
        } finally {
          if (state.turn === turn) state.thinking = false;
        }
      })());
    },
    onClose(session) { const state = conversations.get(session.conversationId ?? ""); if (state) remove(state); },
    onDisconnect(session) { const state = conversations.get(session.conversationId ?? ""); if (state) remove(state); },
    onError(error, session) {
      console.error("[speech]", error.message);
      const state = conversations.get(session.conversationId ?? "");
      if (state) state.error = "Voice connection failed. You can still type a question.";
    },
  });
  server.listen(Number(process.env.SPEECH_PORT ?? 3001), "0.0.0.0", () => console.log("Speech Engine listening on /ws"));
}
main().catch((error) => { console.error(error); process.exit(1); });
