"use client";

// One voice for the whole page, so the guide and the agent never talk over each other.
// "interrupt" (answers) cuts off whatever is playing; "queue" (scene narration) waits its turn.

import type { Lang } from "@/lib/voiceActions";

type Item = { text: string; lang?: Lang; resolve: () => void; reject: (e: unknown) => void };

let audio: HTMLAudioElement | null = null;
let current: Item | null = null;
const queue: Item[] = [];

function finish(err?: unknown) {
  const item = current;
  current = null;
  if (item && err) item.reject(err);
  else item?.resolve();
  playNext();
}

function playNext() {
  if (current || !queue.length) return;
  current = queue.shift()!;
  audio ??= new Audio();
  audio.onended = () => finish();
  audio.onerror = () => finish(new Error("Could not play the spoken answer."));
  const lang = current.lang ? `lang=${current.lang}&` : "";
  audio.src = `/api/voice/speak?${lang}text=${encodeURIComponent(current.text)}`;
  // Before the first click the browser refuses to play; drop the line quietly.
  audio.play().catch((e) => finish(e instanceof DOMException && e.name === "NotAllowedError" ? undefined : e));
}

/**
 * Resolves when this line finishes or is stopped; rejects if playback fails.
 * `lang` locks pronunciation for our own scripted lines; omit it for free text so the voice detects the language.
 */
export function speak(text: string, lang?: Lang, mode: "interrupt" | "queue" = "interrupt"): Promise<void> {
  if (mode === "interrupt") stopSpeaking();
  return new Promise((resolve, reject) => {
    queue.push({ text, lang, resolve, reject });
    playNext();
  });
}

export const isSpeaking = () => current !== null;

/** Stop the current line and drop everything queued. Pending promises resolve. */
export function stopSpeaking() {
  for (const item of queue.splice(0)) item.resolve();
  if (current) {
    audio?.pause();
    const item = current;
    current = null;
    item.resolve();
  }
}
