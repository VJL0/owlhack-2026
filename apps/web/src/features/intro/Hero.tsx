"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useStore } from "@/lib/store";
import type { Lang } from "@/lib/voiceActions";
import { browserLang, STRINGS } from "@/features/voice/i18n";

const TITLE = "REEF ATLAS";

export default function Hero() {
  const setPhase = useStore((s) => s.setPhase);
  const setGuide = useStore((s) => s.setGuide);
  const setLang = useStore((s) => s.setLang);
  const reduced = useStore((s) => s.reducedMotion);
  const base = reduced ? 0 : 1.1; // seconds: the reef line draws first

  return (
    <section className="hud" aria-labelledby="hero-title">
      <div className="hero">
        <h1 id="hero-title" className="hero-title" aria-label="Reef Atlas">
          {TITLE.split("").map((ch, i) => (
            <span key={i} aria-hidden="true" style={{ animationDelay: `${base + 0.9 + i * 0.07}s` }}>
              {ch === " " ? " " : ch}
            </span>
          ))}
        </h1>
        <p className="hero-sub" style={{ animationDelay: `${base + 2.3}s` }}>
          Every reef tells a story.
          <br />
          We find the pressures behind it.
        </p>
        <div className="hero-actions" style={{ animationDelay: `${base + 3.0}s` }}>
          <button className="btn-dive" onClick={() => setPhase("flying")} autoFocus>
            Enter the Ocean
          </button>
          <GuideButton
            onEnter={(lang) => {
              // This click is what lets the browser play audio, so the guide can speak at once.
              setLang(lang);
              setGuide(true);
              setPhase("flying");
            }}
          />
          <button className="btn-quiet" onClick={() => setPhase("region")}>
            Skip the flight
          </button>
          <Link className="btn-quiet" href="/data">Explore reef datasets</Link>
        </div>
      </div>
      <p className="hero-credit" style={{ animationDelay: `${base + 3.6}s` }}>
        Florida&rsquo;s Coral Reef, 2016&ndash;2024. Heat stress from NOAA Coral Reef Watch, storm tracks from NOAA HURDAT2,
        lionfish records from USGS.
      </p>
    </section>
  );
}

const noSubscribe = () => () => {};

/** Offered in the browser's language (Spanish or English). Reached with one Tab from the main button. */
function GuideButton({ onEnter }: { onEnter: (lang: Lang) => void }) {
  // English on the server, the browser's language on the client: no hydration mismatch.
  const lang = useSyncExternalStore(noSubscribe, browserLang, () => "en" as Lang);
  const s = STRINGS[lang];
  return (
    <>
      <button className="btn-quiet btn-guide" onClick={() => onEnter(lang)} aria-describedby="guide-hint" lang={lang}>
        {s.enterGuide}
      </button>
      <span id="guide-hint" className="sr-only" lang={lang}>
        {s.enterGuideHint}
      </span>
    </>
  );
}
