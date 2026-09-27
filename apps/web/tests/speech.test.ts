import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { ApiError, GenerateContentResponse, type GenerateContentParameters, type Part } from "@google/genai";
import { SpeechEngine } from "@elevenlabs/elevenlabs-js";
import { gemini, generateStream } from "../src/server/gemini";
import { streamAgent, runAgent, type AgentEvent } from "../src/server/agent/runAgent";

process.env.GEMINI_API_KEY = "unit-test-key";
const question = [{ role: "user", parts: [{ text: "Take me to Moorea and tell me about it" }] }];
const chunk = (parts: Part[]) => Object.assign(new GenerateContentResponse(), { candidates: [{ content: { role: "model", parts } }] });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("streams before completion and retains data/page tools and thought signatures", async () => {
  const requests: GenerateContentParameters[] = [];
  const toolParts: Part[] = [
    { functionCall: { id: "nav", name: "go_to_flagship", args: { flagship_id: "moorea" } }, thoughtSignature: "opaque-signature" },
    { functionCall: { id: "data", name: "get_flagship_evidence", args: { flagship_id: "moorea" } } },
  ];
  const stub = mock.method(gemini().models, "generateContentStream", async (request: GenerateContentParameters) => {
    requests.push(structuredClone({ ...request, config: { ...request.config, abortSignal: undefined } }));
    const n = requests.length;
    return (async function* () {
      if (n === 1) { yield chunk(toolParts); return; }
      yield chunk([{ text: "Taking you " }]);
      yield chunk([{ text: "to Moorea." }]);
    })();
  });
  try {
    const iterator = streamAgent(question, { view: "world" });
    assert.deepEqual((await iterator.next()).value, { type: "text", text: "Taking you " });
    assert.deepEqual((await iterator.next()).value, { type: "text", text: "to Moorea." });
    const final = (await iterator.next()).value;
    assert.equal(final?.type, "result");
    if (final?.type !== "result") throw new Error("Missing result");
    assert.deepEqual(final.result.actions, [{ type: "go_to_flagship", flagshipId: "moorea" }]);
    assert.deepEqual(final.result.trace.map((t) => t.name), ["go_to_flagship", "get_flagship_evidence"]);
    const contents = requests[1].contents as { parts: Part[] }[];
    assert.deepEqual(contents[1].parts, toolParts);
    assert.equal(contents[2].parts[0].functionResponse?.id, "nav");
    assert.equal((contents[2].parts[1].functionResponse?.response?.result as { name: string }).name, "Moorea");
  } finally { stub.mock.restore(); }
});

test("typed fallback still returns answer, tool trace and actions", async () => {
  const stub = mock.method(gemini().models, "generateContentStream", async () => (async function* () {
    yield chunk([{ text: "Hello " }]); yield chunk([{ text: "there." }]);
  })());
  try { assert.deepEqual(await runAgent("Hello", {}), { answer: "Hello there.", trace: [], actions: [] }); }
  finally { stub.mock.restore(); }
});

test("aborted stream forwards cancellation and never publishes pending UI actions", async () => {
  const controller = new AbortController();
  let n = 0;
  const stub = mock.method(gemini().models, "generateContentStream", async (request: GenerateContentParameters) => {
    assert.equal(request.config?.abortSignal, controller.signal);
    const turn = ++n;
    return (async function* () {
      if (turn === 1) yield chunk([{ functionCall: { name: "go_to_world", args: {} } }]);
      else {
        yield chunk([{ text: "Taking you " }]);
        controller.abort();
        yield chunk([{ text: "back." }]);
      }
    })();
  });
  try {
    const events: AgentEvent[] = [];
    await assert.rejects(async () => {
      for await (const event of streamAgent(question, {}, controller.signal)) events.push(event);
    }, { name: "AbortError" });
    assert.deepEqual(events, [{ type: "text", text: "Taking you " }]);
  } finally { stub.mock.restore(); }
});

test("no retry after partial speech; retries an overloaded model before any chunk", async () => {
  let attempts = 0;
  const busy = () => new ApiError({ message: "busy", status: 503 });
  const stub = mock.method(gemini().models, "generateContentStream", async () => {
    attempts++;
    if (attempts === 1) throw busy();
    return (async function* () { yield chunk([{ text: "Partial" }]); throw busy(); })();
  });
  try {
    const received: (string | undefined)[] = [];
    await assert.rejects(async () => {
      for await (const value of generateStream({ contents: question })) received.push(value.res.text);
    }, { status: 503 });
    assert.equal(attempts, 2);
    assert.deepEqual(received, ["Partial"]);
  } finally { stub.mock.restore(); }
});

test("Speech Engine SDK aborts superseded turns, preserves event IDs, finalizes and handles ping", async () => {
  class Socket extends EventEmitter {
    readyState = 1;
    sent: { type: string; content?: string; event_id?: number; is_final?: boolean }[] = [];
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.emit("close"); }
    receive(value: unknown) { this.emit("message", Buffer.from(JSON.stringify(value))); }
  }
  const ws = new Socket();
  const session = new SpeechEngine.Session(ws);
  const signals: AbortSignal[] = [];
  const pending: Promise<void>[] = [];
  session.on("error", (e) => { throw e; });
  session.on("user_transcript", (_transcript, signal) => {
    signals.push(signal);
    const turn = signals.length;
    pending.push(session.sendResponse((async function* () {
      yield `turn ${turn}`;
      if (turn === 1) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      if (signal.aborted) return;
      yield " complete";
    })()));
  });
  ws.receive({ type: "init", conversation_id: "conv_test" });
  ws.receive({ type: "user_transcript", event_id: 1, user_transcript: [{ role: "user", content: "first" }] });
  await tick();
  assert.equal(ws.sent[0].content, "turn 1"); // Already sent while first generator is still pending.
  ws.receive({ type: "user_transcript", event_id: 2, user_transcript: [{ role: "user", content: "interrupt" }] });
  await Promise.all(pending);
  assert.equal(signals[0].aborted, true);
  assert.equal(ws.sent.some((m) => m.event_id === 1 && m.content === " complete"), false);
  assert.equal(ws.sent.some((m) => m.event_id === 2 && m.is_final && m.content === ""), true);
  ws.receive({ type: "ping" });
  assert.equal(ws.sent.at(-1)?.type, "pong");
  session.close();
  assert.equal(signals[1].aborted, true);
});
