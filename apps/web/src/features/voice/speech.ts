"use client";

// Narrator and replay share the React SDK session. No Audio element or audio queue.
let narrate: ((text: string) => Promise<void>) | undefined;
let stop: (() => void) | undefined;
export function bindSpeech(say: (text: string) => Promise<void>, end: () => void) {
  narrate = say;
  stop = end;
  return () => { narrate = undefined; stop = undefined; };
}
export async function speak(text: string) {
  await narrate?.(text);
}
export function stopSpeaking() { stop?.(); }
