"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { isoDate } from "@/lib/time";
import { runAction } from "@/lib/navigation";
import { MAP_LAYERS, type UiAction } from "@/lib/voiceActions";
import { STRINGS } from "./i18n";
import { startRecording } from "./recorder";
import { isSpeaking, speak, stopSpeaking } from "./speech";

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

/** Voice loop: mic → /transcribe (Gemini) → /ask (Gemini + data and page tools) → /speak (ElevenLabs). */
export default function VoiceAgent() {
  const phase = useStore((s) => s.phase);
  const guide = useStore((s) => s.guide);
  const setGuide = useStore((s) => s.setGuide);
  const lang = useStore((s) => s.lang);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const stopRef = useRef<(() => Promise<Blob>) | null>(null);
  /** Bumped on close/cancel so in-flight requests know to drop their result. */
  const runRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = STRINGS[lang];

  async function say(text: string, id: number) {
    setStatus("speaking");
    // No language lock: answers come back in whatever language was asked, and the voice detects it.
    await speak(text);
    if (runRef.current === id) setStatus("idle");
  }

  async function run(fn: (run: number) => Promise<void>) {
    const id = ++runRef.current;
    setError("");
    try {
      await fn(id);
    } catch (e) {
      if (e instanceof Cancelled || runRef.current !== id) return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus("idle");
    }
  }

  async function ask(q: string, id: number) {
    setQuestion(q);
    setAnswer("");
    setTools([]);
    setStatus("thinking");
    const s = useStore.getState();
    const res = await postJson<{ answer: string; trace: { name: string }[]; actions: UiAction[] }>("/api/voice/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: q,
        view: s.phase === "reef" ? "reef" : s.phase === "flagship" || s.phase === "splat" ? "flagship" : s.phase === "world" ? "world" : "map",
        siteId: s.phase === "reef" ? s.siteId : undefined,
        flagshipId: s.phase === "flagship" || s.phase === "splat" ? s.flagshipId : undefined,
        flagshipDate: (s.phase === "flagship" || s.phase === "splat") && s.flagshipT !== null ? flagshipIso(s.flagshipT) : undefined,
        date: isoDate(s.t),
        layers: MAP_LAYERS.filter((l) => s.layers[l]),
        lang: s.lang,
      }),
    });
    if (runRef.current !== id) throw new Cancelled();
    setAnswer(res.answer);
    setTools(res.trace.filter((x) => x.name.startsWith("get_") || x.name === "compare_sites").map((x) => x.name.replace(/^get_/, "").replaceAll("_", " ")));
    res.actions.forEach(runAction);
    await say(res.answer, id);
  }

  /** Stop everything in flight: recording, requests, playback. */
  function halt() {
    runRef.current++;
    stopSpeaking();
    const stop = stopRef.current;
    stopRef.current = null;
    stop?.().catch(() => {});
    setStatus("idle");
  }

  function close() {
    halt();
    setOpen(false);
  }

  /** The one main action: start listening, send, or stop speech, depending on state. */
  function toggleMic() {
    setOpen(true);
    if (status === "speaking" || (status === "idle" && isSpeaking())) {
      halt(); // also silences the guide mid-sentence
    } else if (status === "idle") {
      run(async (id) => {
        const stop = await startRecording();
        if (runRef.current !== id) {
          stop().catch(() => {});
          return;
        }
        stopRef.current = stop;
        setStatus("listening");
      });
    } else if (status === "listening" && stopRef.current) {
      const stop = stopRef.current;
      stopRef.current = null;
      run(async (id) => {
        setStatus("transcribing");
        const wav = await stop();
        const { text } = await postJson<{ text: string }>("/api/voice/transcribe", {
          method: "POST",
          headers: { "content-type": "audio/wav" },
          body: wav,
        });
        if (runRef.current !== id) return;
        if (!text) throw new Error(t.notHeard);
        await ask(text, id);
      });
    }
  }

  // V talks from anywhere. Esc closes this panel, or silences the guide, before the scene's own Esc runs.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = (e.target as HTMLElement).closest("input, textarea");
    if (e.key === "Escape" && (open || isSpeaking())) {
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

  // On unmount, drop in-flight work and release the mic. Speech is page-wide and may belong to the guide.
  useEffect(() => {
    const runs = runRef;
    const rec = stopRef;
    return () => {
      runs.current++;
      rec.current?.().catch(() => {});
    };
  }, []);

  const busy = status === "transcribing" || status === "thinking";
  const hasLog = question || answer || error;

  if (!open) {
    return (
      <div className="voice-agent">
        <button
          className="voice-pill"
          onClick={() => {
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
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
                <button className="voice-link" onClick={() => run((id) => say(answer, id))}>
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
            <button key={q} className="voice-chip" disabled={status !== "idle"} onClick={() => run((id) => ask(q, id))}>
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
          if (!q || status !== "idle") return;
          setDraft("");
          run((id) => ask(q, id));
        }}
      >
        <button
          type="button"
          className="voice-mic"
          data-status={status}
          onClick={toggleMic}
          disabled={busy}
          aria-pressed={status === "listening"}
          aria-label={status === "listening" ? t.send : status === "speaking" ? t.stop : t.talk}
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
          disabled={status !== "idle"}
        />
      </form>
    </section>
  );
}
