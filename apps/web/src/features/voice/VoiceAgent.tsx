"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { isoDate } from "@/lib/time";
import { runAction } from "@/lib/navigation";
import { MAP_LAYERS, type UiAction } from "@/lib/voiceActions";
import { useTouchOnly } from "@/lib/ui";
import { strings } from "./i18n";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { bindSpeech, stopSpeaking } from "./speech";

type Status = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

async function postJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

/** Decimal year (flagship timeline) → YYYY-MM-DD for the agent. */
function flagshipIso(t: number) {
  const y = Math.floor(t);
  return new Date(Date.UTC(y, 0, 1) + (t - y) * (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1))).toISOString().slice(0, 10);
}

/** Stale results from a request the viewer already closed or replaced. */
class Cancelled extends Error {}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

export default function VoiceAgent() {
  return <ConversationProvider><VoicePanel /></ConversationProvider>;
}

function pageContext() {
  const s = useStore.getState();
  return {
    view: s.phase === "reef" ? "reef" : s.phase === "flagship" || s.phase === "splat" ? "flagship" : s.phase === "world" ? "world" : "map",
    siteId: s.phase === "reef" ? s.siteId : undefined,
    flagshipId: s.phase === "flagship" || s.phase === "splat" ? s.flagshipId : undefined,
    flagshipDate: (s.phase === "flagship" || s.phase === "splat") && s.flagshipT !== null ? flagshipIso(s.flagshipT) : undefined,
    date: isoDate(s.t), layers: MAP_LAYERS.filter((l) => s.layers[l]), lang: s.lang,
  };
}

/** ElevenLabs owns microphone capture, turn-taking, interruption and playback. */
function VoicePanel() {
  const phase = useStore((s) => s.phase);
  const guide = useStore((s) => s.guide);
  const setGuide = useStore((s) => s.setGuide);
  const lang = useStore((s) => s.lang);
  const [open, setOpen] = useState(false);
  const [work, setWork] = useState<"idle" | "thinking" | "transcribing">("idle");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [awaitingSpeech, setAwaitingSpeech] = useState(false);
  const heardAgent = useRef(false);
  const keyRef = useRef<string | null>(null);
  const pendingNarration = useRef<string | null>(null);
  /** Bumped on close/cancel so in-flight requests know to drop their result. */
  const runRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const touch = useTouchOnly();
  const t = strings(lang, touch);

  function releaseSession() {
    const key = keyRef.current;
    keyRef.current = null;
    setSessionKey(null);
    pendingNarration.current = null;
    heardAgent.current = false;
    setAwaitingSpeech(false);
    if (key) fetch("/api/voice/session", { method: "DELETE", headers: { authorization: `Bearer ${key}` }, keepalive: true }).catch(() => {});
    setWork("idle");
  }
  const conversation = useConversation({
    micMuted,
    onConnect: () => setWork("idle"),
    onDisconnect: () => releaseSession(),
    onError: (message) => { setError(message); conversation.endSession(); releaseSession(); },
    onMessage: ({ source, message }) => {
      if (source === "user") {
        if (message.startsWith("[scene:")) return;
        runRef.current++;
        pendingNarration.current = null;
        setAwaitingSpeech(true);
        setQuestion(message); setAnswer(""); setTools([]); setWork("thinking");
      } else { setAnswer(message); setWork("idle"); }
    },
    onInterruption: () => { runRef.current++; pendingNarration.current = null; setAwaitingSpeech(true); setWork("thinking"); },
    onModeChange: ({ mode }) => {
      if (mode === "speaking") heardAgent.current = true;
      else if (heardAgent.current) { heardAgent.current = false; setAwaitingSpeech(false); }
    },
  });
  const status: Status = conversation.status === "connecting" ? "transcribing" : conversation.isSpeaking ? "speaking" : work !== "idle" ? work
    : conversation.status === "connected" && !micMuted ? "listening" : "idle";

  async function sessionRequest<T>(method: string, body?: unknown, query = "", key = keyRef.current): Promise<T> {
    return postJson<T>(`/api/voice/session${query}`, {
      method, headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function begin(firstMessage?: string) {
    const id = ++runRef.current;
    setWork("transcribing"); setError("");
    setMicMuted(!!firstMessage);
    setAwaitingSpeech(!!firstMessage);
    try {
      const session = await postJson<{ token: string; key: string }>("/api/voice/session", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ context: pageContext() }),
      });
      if (id !== runRef.current) {
        void fetch("/api/voice/session", { method: "DELETE", headers: { authorization: `Bearer ${session.key}` } }).catch(() => {});
        return;
      }
      keyRef.current = session.key;
      setSessionKey(session.key);
      conversation.startSession({
        conversationToken: session.token, connectionType: "webrtc",
        ...(firstMessage ? { overrides: { agent: { firstMessage } } } : {}),
      });
    } catch (e) {
      if (id === runRef.current) {
        setError(e instanceof Error ? e.message : "Voice is unavailable. You can still type a question.");
        releaseSession();
      }
    }
  }

  async function narrate(text: string) {
    if ((conversation.status === "disconnected" || conversation.status === "error") && work === "idle") { await begin(text); return; }
    if (conversation.status !== "connected" || conversation.isSpeaking || awaitingSpeech || work !== "idle") {
      pendingNarration.current = text;
      return;
    }
    const id = runRef.current;
    const { marker } = await sessionRequest<{ marker: string }>("PATCH", { narration: text });
    if (id === runRef.current && keyRef.current) {
      setAwaitingSpeech(true);
      conversation.sendUserMessage(marker);
    }
  }
  const flushNarration = useEffectEvent(() => {
    const text = pendingNarration.current;
    if (!text || !guide || conversation.status !== "connected" || conversation.isSpeaking || awaitingSpeech || work !== "idle") return;
    pendingNarration.current = null;
    void narrate(text).catch(() => {});
  });
  useEffect(() => { flushNarration(); }, [conversation.status, conversation.isSpeaking, awaitingSpeech, work, guide]);
  const speakScene = useEffectEvent(narrate);
  const endSpeech = useEffectEvent(() => halt());
  useEffect(() => bindSpeech((text) => speakScene(text), () => endSpeech()), []);

  // Context and tool actions stay in our app; Speech Engine only carries speech/text.
  useEffect(() => {
    if (!sessionKey) return;
    let active = true;
    let cursor = 0;
    let contextSent = "";
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const current = JSON.stringify(pageContext());
        if (current !== contextSent) {
          await sessionRequest("PATCH", { context: JSON.parse(current) }, "", sessionKey);
          if (!active) return;
          contextSent = current;
        }
        const update = await sessionRequest<{ events: { id: number; result: { trace: { name: string }[]; actions: UiAction[] } }[]; thinking: boolean; error?: string }>("GET", undefined, `?after=${cursor}`, sessionKey);
        if (!active) return;
        setWork(update.thinking ? "thinking" : "idle");
        if (update.error) setError(update.error);
        for (const event of update.events) {
          if (event.id <= cursor) continue;
          cursor = event.id;
          setTools(event.result.trace.map((x) => x.name.replace(/^get_/, "").replaceAll("_", " ")));
          event.result.actions.forEach(runAction);
        }
      } catch (e) {
        if (active) { setError(e instanceof Error ? e.message : "Voice connection failed"); conversation.endSession(); releaseSession(); }
      }
      if (active) timer = setTimeout(poll, 300);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  // SDK controls are stable; key owns the lifetime of this polling loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  async function run(fn: (run: number) => Promise<void>) {
    const id = ++runRef.current;
    setError("");
    try {
      await fn(id);
    } catch (e) {
      if (e instanceof Cancelled || runRef.current !== id) return;
      setError(e instanceof Error ? e.message : String(e));
      setWork("idle");
    }
  }

  async function ask(q: string, id: number) {
    pendingNarration.current = null;
    setQuestion(q);
    setAnswer("");
    setTools([]);
    setWork("thinking");
    if (conversation.status === "connected") {
      await sessionRequest("PATCH", { context: pageContext() });
      if (id === runRef.current) { setAwaitingSpeech(true); conversation.sendUserMessage(q); }
      return;
    }
    const res = await postJson<{ answer: string; trace: { name: string }[]; actions: UiAction[] }>("/api/voice/ask", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: q, ...pageContext() }),
    });
    if (runRef.current !== id) throw new Cancelled();
    setAnswer(res.answer);
    setTools(res.trace.filter((x) => x.name.startsWith("get_") || x.name === "compare_sites").map((x) => x.name.replace(/^get_/, "").replaceAll("_", " ")));
    res.actions.forEach(runAction);
    setWork("idle");
  }

  function halt() {
    runRef.current++;
    conversation.endSession();
    releaseSession();
  }

  function close() { halt(); setOpen(false); }

  function toggleMic() {
    setOpen(true);
    if (conversation.status === "connected" && micMuted) setMicMuted(false);
    else if (conversation.status === "connected" || conversation.status === "connecting" || sessionKey || work === "transcribing") halt();
    else void begin().catch((e) => { setError(e instanceof Error ? e.message : "Voice failed"); setWork("idle"); });
  }

  // V talks from anywhere. Esc closes this panel, or silences the guide, before the scene's own Esc runs.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = (e.target as HTMLElement).closest("input, textarea");
    if (e.key === "Escape" && (open || conversation.status !== "disconnected")) {
      e.preventDefault();
      e.stopPropagation(); // capture phase: keeps Esc from also leaving the reef
      if (open) close();
      else stopSpeaking();
    } else if ((e.key === "v" || e.key === "V") && !typing && !e.repeat) {
      e.preventDefault();
      toggleMic();
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  useEffect(() => {
    const runs = runRef;
    return () => {
      runs.current++;
      const key = keyRef.current;
      if (key) void fetch("/api/voice/session", { method: "DELETE", headers: { authorization: `Bearer ${key}` }, keepalive: true }).catch(() => {});
    };
  }, []);

  const busy = conversation.status === "connecting" || work === "transcribing" || (work === "thinking" && conversation.status !== "connected");
  const hasLog = question || answer || error;

  if (!open) {
    return (
      <div className="voice-agent">
        <button
          className="voice-pill"
          onClick={() => {
            setOpen(true);
            // On touch screens focus would raise the keyboard over the suggestions
            if (!touch) requestAnimationFrame(() => inputRef.current?.focus());
          }}
          aria-expanded={false}
        >
          <MicIcon />
          <span>{t.pill}</span>
          <kbd>V</kbd>
        </button>
      </div>
    );
  }

  return (
    <section className="voice-agent voice-card" aria-label={t.pill} data-status={status} lang={lang}>
      <header className="voice-head">
        <span className="voice-status" aria-live="polite">
          <span className="voice-dot" aria-hidden="true" />
          {t.status[status]}
        </span>
        <span className="voice-controls">
          <button
            role="switch"
            aria-checked={guide}
            className="layer-toggle voice-guide"
            onClick={() => {
              if (guide) stopSpeaking();
              setGuide(!guide);
            }}
          >
            <span>{t.guide}</span>
            <span className="sw" aria-hidden="true" />
          </button>
          <button className="voice-icon-btn" onClick={close} aria-label={t.close} title={t.close}>
            ×
          </button>
        </span>
      </header>

      {hasLog ? (
        <div className="voice-log" aria-live="polite">
          {question && <p className="voice-q">“{question}”</p>}
          {answer && <p className="voice-a">{answer}</p>}
          {error && <p className="voice-err">{error}</p>}
          <div className="voice-meta">
            {tools.length > 0 && (
              <span className="voice-tools">
                {t.checked}: {tools.join(" · ")}
              </span>
            )}
            <span className="voice-actions">
              {answer && status === "idle" && (
                <button className="voice-link" onClick={() => run(() => narrate(answer))}>
                  {t.replay}
                </button>
              )}
              {status === "idle" && (
                <button
                  className="voice-link"
                  onClick={() => {
                    setQuestion("");
                    setAnswer("");
                    setTools([]);
                    setError("");
                  }}
                >
                  {t.clear}
                </button>
              )}
            </span>
          </div>
        </div>
      ) : (
        <div className="voice-suggest">
          {t.suggestions[phase === "reef" ? "reef" : phase === "flagship" || phase === "splat" ? "flagship" : phase === "world" ? "world" : "region"].map((q) => (
            <button key={q} className="voice-chip" disabled={busy} onClick={() => run((id) => ask(q, id))}>
              {q}
            </button>
          ))}
        </div>
      )}

      <form
        className="voice-row"
        onSubmit={(e) => {
          e.preventDefault();
          const q = draft.trim();
          if (!q || busy) return;
          setDraft("");
          run((id) => ask(q, id));
        }}
      >
        <button
          type="button"
          className="voice-mic"
          data-status={status}
          onClick={toggleMic}
          aria-pressed={conversation.status === "connected" && !micMuted}
          aria-label={conversation.status === "connected" && !micMuted ? t.stop : t.talk}
        >
          {status === "speaking" ? <span className="voice-stop" aria-hidden="true" /> : <MicIcon />}
        </button>
        <input
          ref={inputRef}
          className="voice-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t.placeholder}
          aria-label={t.placeholder}
          enterKeyHint="send"
          disabled={busy}
        />
      </form>
    </section>
  );
}
