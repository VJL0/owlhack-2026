"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { siteById } from "@/lib/data";
import { momentText } from "@/lib/narrative";
import { dayToDate } from "@/lib/time";
import type { Lang } from "@/lib/voiceActions";
import { touchOnly } from "@/lib/ui";
import { monthYear, strings } from "./i18n";
import { speak } from "./speech";
import { flagshipById } from "@/lib/flagshipIndex";

const translated = new Map<string, string>();

/** Data captions are written in English; translate once per sentence and keep it. */
async function inLang(text: string, lang: Lang) {
  if (lang === "en") return text;
  const key = `${lang}:${text}`;
  const hit = translated.get(key);
  if (hit) return hit;
  const res = await fetch("/api/voice/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, lang }),
  });
  if (!res.ok) return text; // better English than silence
  const out = ((await res.json()) as { text: string }).text;
  translated.set(key, out);
  return out;
}

/**
 * Describes each scene once, on arrival, after its animation settles.
 * Screen readers always get the text (hidden live region). The spoken guide adds a voice.
 */
export default function Narrator() {
  const phase = useStore((s) => s.phase);
  const siteId = useStore((s) => s.siteId);
  const reefReady = useStore((s) => s.reefReady);
  const flagshipId = useStore((s) => s.flagshipId);
  const crossing = useStore((s) => s.crossing);
  const guide = useStore((s) => s.guide);
  const lang = useStore((s) => s.lang);
  const [line, setLine] = useState("");
  const scene = useRef("");

  // Which scene is settled right now, if any.
  const key =
    phase === "flying"
      ? "flying"
      : phase === "region"
        ? "region"
        : phase === "world"
          ? "world"
          : phase === "flagship" && crossing === "none"
            ? `flagship:${flagshipId}`
            : phase === "splat" && reefReady && crossing === "none"
              ? `splat:${useStore.getState().splatPlot}`
              : phase === "reef" && reefReady && crossing === "none"
                ? `reef:${siteId}`
                : "";

  useEffect(() => {
    if (!key || key === scene.current) return;
    scene.current = key;
    const s = strings(lang, touchOnly());
    const { t } = useStore.getState();

    const build = async () => {
      if (key === "flying") return s.welcome;
      if (key === "region") return s.region(monthYear(dayToDate(t), lang));
      if (key === "world") return s.world;
      if (key.startsWith("splat:")) return s.splatArrive(key.slice(6) === "hb" ? "Host Beach" : "OOTS L");
      if (key.startsWith("flagship:")) {
        const f = flagshipById(key.slice(9));
        return f ? [s.flagshipArrive(f.name, await inLang(f.role, lang)), await inLang(f.blurb, lang)].join(" ") : "";
      }
      const site = siteById(siteId);
      return [s.reefArrive(site.name, site.region), await inLang(momentText(siteId, t).text, lang), s.reefHint].join(" ");
    };

    build().then((text) => {
      if (scene.current !== key) return; // viewer already moved on
      setLine(text);
      if (useStore.getState().guide) speak(text).catch(() => {});
    });
  }, [key, siteId, lang]);

  // Turning the guide on mid-scene: say where we are right away.
  const sayCurrent = useEffectEvent(() => {
    if (line) speak(line).catch(() => {});
  });
  useEffect(() => {
    if (guide) sayCurrent();
  }, [guide]);

  return (
    <p className="sr-only" aria-live="polite">
      {line}
    </p>
  );
}
