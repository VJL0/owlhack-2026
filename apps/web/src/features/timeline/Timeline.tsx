"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LIONFISH, SITES, STORMS, THERMAL, siteById, thermalAt } from "@/lib/data";
import { HEAT_STOPS, heatColor } from "@/lib/colors";
import { useStore } from "@/lib/store";
import { T_MAX, T_MIN, dhwLabel, formatDate, ymdToDay } from "./timeUtils";

const H = 112;
const LANE_STORM = 26;
const LANE_LION = 44;
const BASE = 94; // ribbon baseline
const RIBBON = 40; // px for DHW 0 → 20
const DHW_MAX = 20;
const PLAY_DAYS_PER_SEC = 42;

const yFor = (dhw: number) => BASE - (Math.min(dhw, DHW_MAX) / DHW_MAX) * RIBBON;

interface Props {
  mode: "region" | "reef";
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Everything that does not move with the playhead. */
const StaticLayers = memo(function StaticLayers({ w, mode, siteId, onJump }: { w: number; mode: Props["mode"]; siteId: string; onJump: (t: number) => void }) {
  const x = useCallback((t: number) => ((t - T_MIN) / (T_MAX - T_MIN)) * w, [w]);

  const series = useMemo(() => {
    if (mode === "reef") return THERMAL.sites[siteId].dhw;
    return THERMAL.days.map((_, i) => Math.max(...SITES.map((s) => THERMAL.sites[s.id].dhw[i])));
  }, [mode, siteId]);

  const area = useMemo(() => {
    if (!w) return "";
    let d = `M ${x(THERMAL.days[0])} ${BASE}`;
    THERMAL.days.forEach((t, i) => (d += ` L ${x(t).toFixed(1)} ${yFor(series[i]).toFixed(1)}`));
    d += ` L ${x(THERMAL.days[THERMAL.days.length - 1])} ${BASE} Z`;
    return d;
  }, [w, x, series]);

  const line = useMemo(() => {
    if (!w) return "";
    return THERMAL.days.map((t, i) => `${i ? "L" : "M"} ${x(t).toFixed(1)} ${yFor(series[i]).toFixed(1)}`).join(" ");
  }, [w, x, series]);

  const storms = useMemo(() => {
    const list = STORMS.map((s) => {
      const c =
        mode === "reef"
          ? s.closest[siteId]
          : Object.values(s.closest).reduce((a, b) => (b.km < a.km ? b : a));
      return { s, c };
    }).filter(({ c }) => c.km <= 220 && (c.wind >= 34 || c.km <= 100));
    // label the close passes, staggering labels that would collide
    const out: { s: (typeof list)[number]["s"]; c: (typeof list)[number]["c"]; px: number; labelled: boolean; row: number }[] = [];
    const cursor = { lastX: -1e9, row: 0 };
    for (const { s, c } of list) {
      const px = x(c.t);
      const labelled = c.km <= 160 && c.wind >= 34;
      if (labelled) {
        cursor.row = px - cursor.lastX < 58 ? (cursor.row + 1) % 2 : 0;
        cursor.lastX = px;
      }
      out.push({ s, c, px, labelled, row: cursor.row });
    }
    return out;
  }, [mode, siteId, x]);

  const lion = useMemo(
    () => LIONFISH.filter((r) => mode === "region" || r.km[siteId] <= 25).map((r) => x(r.t)),
    [mode, siteId, x],
  );

  const peak = useMemo(() => {
    let i = 0;
    series.forEach((v, k) => (v > series[i] ? (i = k) : null));
    return { x: x(THERMAL.days[i]), y: yFor(series[i]), v: series[i] };
  }, [series, x]);

  if (!w) return null;

  return (
    <>
      {/* CRW thresholds */}
      {[4, 8].map((v) => (
        <g key={v}>
          <line x1={0} x2={w} y1={yFor(v)} y2={yFor(v)} stroke="rgba(169,216,208,0.18)" strokeDasharray="2 4" />
          <text className="tl-threshold-label" x={w + 6} y={yFor(v) + 3}>
            {v}
          </text>
        </g>
      ))}
      <line x1={0} x2={w} y1={BASE} y2={BASE} stroke="rgba(169,216,208,0.22)" />

      <g className="ribbon">
        <path d={area} fill="url(#heat-grad)" opacity={0.85} />
        <path d={line} fill="none" stroke="url(#heat-grad)" strokeWidth={1.2} />
      </g>

      <text className="tl-storm-label" x={peak.x - 10} y={BASE - 6} textAnchor="end">
        2023 marine heatwave, peak {peak.v.toFixed(1)}
      </text>

      {/* lionfish records */}
      <g stroke="#ff5f8f" strokeWidth={1} opacity={0.75}>
        {lion.map((px, i) => (
          <line key={i} x1={px} x2={px} y1={LANE_LION - 4} y2={LANE_LION + 3} />
        ))}
      </g>

      {/* hurricanes: glyph at closest approach, radius by wind at that moment */}
      {storms.map(({ s, c, px, labelled, row }) => {
        const r = 2.5 + (c.wind / 160) * 5.5;
        const alpha = c.km <= 100 ? 1 : c.km <= 160 ? 0.75 : 0.4;
        return (
          <g
            key={s.id}
            transform={`translate(${px} ${LANE_STORM})`}
            opacity={alpha}
            style={{ cursor: "pointer" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onJump(c.t);
            }}
          >
            <title>{`${s.name} (${s.year}): closest approach ${c.km} km at ${c.wind} kt`}</title>
            <circle r={r + 5} fill="transparent" />
            <circle r={r} fill="none" stroke="#b8a8ff" strokeWidth={1.2} />
            <circle r={1.3} fill="#e6e0ff" />
            {labelled && (
              <text className="tl-storm-label" y={-r - 4 - row * 12} textAnchor="middle">
                {s.name}
              </text>
            )}
          </g>
        );
      })}
    </>
  );
});

export default function Timeline({ mode }: Props) {
  const t = useStore((s) => s.t);
  const siteId = useStore((s) => s.siteId);
  const playing = useStore((s) => s.playing);
  const setT = useStore((s) => s.setT);
  const nudgeT = useStore((s) => s.nudgeT);
  const setPlaying = useStore((s) => s.setPlaying);
  const [trackRef, w] = useWidth<HTMLDivElement>();
  const dragging = useRef(false);

  const x = (v: number) => ((v - T_MIN) / (T_MAX - T_MIN)) * w;
  const tFromEvent = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return T_MIN + ((clientX - r.left) / r.width) * (T_MAX - T_MIN);
  };

  // playback
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = useStore.getState();
      if (s.t >= T_MAX) {
        s.setPlaying(false);
        return;
      }
      s.nudgeT(dt * PLAY_DAYS_PER_SEC);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 30.44 : 7;
    const map: Record<string, () => void> = {
      ArrowRight: () => nudgeT(step),
      ArrowLeft: () => nudgeT(-step),
      ArrowUp: () => nudgeT(step),
      ArrowDown: () => nudgeT(-step),
      PageUp: () => nudgeT(365.25),
      PageDown: () => nudgeT(-365.25),
      Home: () => setT(T_MIN),
      End: () => setT(T_MAX),
    };
    if (map[e.key]) {
      e.preventDefault();
      setPlaying(false);
      map[e.key]();
    }
  };

  const thermal = mode === "reef" ? thermalAt(siteId, t) : null;
  const tractMax = mode === "region" ? Math.max(...SITES.map((s) => thermalAt(s.id, t).dhw)) : 0;
  const dhwNow = thermal ? thermal.dhw : tractMax;
  const years = Array.from({ length: 9 }, (_, i) => 2016 + i);
  // Label every other year where a year is narrower than its label (half-width phone timelines)
  const labelled = w / years.length < 34 ? years.filter((_, i) => i % 2 === 0) : years;
  const px = x(t);

  return (
    <div className="timeline" role="group" aria-label="Time travel, 2016 to 2024">
      <button
        className="tl-play"
        onClick={() => {
          if (!playing && t >= T_MAX - 1) setT(T_MIN);
          setPlaying(!playing);
        }}
        aria-label={playing ? "Pause" : "Play through time"}
        title={playing ? "Pause (space)" : "Play (space)"}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <rect x="2" y="1.5" width="2.6" height="9" rx="0.6" fill="currentColor" />
            <rect x="7.4" y="1.5" width="2.6" height="9" rx="0.6" fill="currentColor" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 1.6 L10.4 6 L3 10.4 Z" fill="currentColor" />
          </svg>
        )}
      </button>

      <div className="tl-lanes" aria-hidden="true">
        <span style={{ top: LANE_STORM - 7, color: "#b8a8ff" }}>Hurricanes</span>
        <span style={{ top: LANE_LION - 7, color: "#ff5f8f" }}>Lionfish</span>
        <span style={{ top: BASE - RIBBON / 2 - 12 }}>
          Heat stress
          <em>{mode === "reef" ? siteById(siteId).name : "highest site"}</em>
        </span>
      </div>

      <div
        ref={trackRef}
        className="tl-track"
        role="slider"
        tabIndex={0}
        aria-label="Date"
        aria-valuemin={T_MIN}
        aria-valuemax={Math.round(T_MAX)}
        aria-valuenow={Math.round(t)}
        aria-valuetext={`${formatDate(t)}. ${dhwLabel(dhwNow)}${mode === "region" ? " (highest across the reef)" : ""}`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setPlaying(false);
          setT(tFromEvent(e.clientX));
        }}
        onPointerMove={(e) => dragging.current && setT(tFromEvent(e.clientX))}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <svg aria-hidden="true">
          <defs>
            <linearGradient id="heat-grad" gradientUnits="userSpaceOnUse" x1="0" y1={BASE} x2="0" y2={BASE - RIBBON}>
              {HEAT_STOPS.map(([v, c]) => (
                <stop key={v} offset={v / DHW_MAX} stopColor={c} />
              ))}
            </linearGradient>
          </defs>
          <clipPath id="past">
            <rect x={-40} y={-40} width={Math.max(0, px + 40)} height={H + 40} />
          </clipPath>
          <clipPath id="future">
            <rect x={px} y={-40} width={Math.max(0, w - px + 40)} height={H + 40} />
          </clipPath>
          <g clipPath="url(#future)" opacity={0.32}>
            <StaticLayers w={w} mode={mode} siteId={siteId} onJump={setT} />
          </g>
          <g clipPath="url(#past)">
            <StaticLayers w={w} mode={mode} siteId={siteId} onJump={setT} />
          </g>
          <line x1={px} x2={px} y1={2} y2={BASE + 2} stroke="#6ff3e3" strokeWidth={1.2} />
          <circle cx={px} cy={yFor(dhwNow)} r={4} fill="#010a12" stroke={heatColor(dhwNow)} strokeWidth={2} />
        </svg>
        <div className="tl-head" style={{ left: Math.min(Math.max(px, 70), w - 70) }}>
          {formatDate(t)}
          <span style={{ color: heatColor(dhwNow), marginLeft: 10 }}>{dhwNow.toFixed(1)} DHW</span>
        </div>
        <div className="tl-years" aria-hidden="true">
          {labelled.map((y) => (
            <span key={y} style={{ left: x(ymdToDay(y, 1, 1)) + (x(ymdToDay(y + 1, 1, 1)) - x(ymdToDay(y, 1, 1))) / 2 }}>
              {y}
            </span>
          ))}
        </div>
        <svg aria-hidden="true" style={{ pointerEvents: "none" }}>
          {years.map((y) => (
            <line key={y} x1={x(ymdToDay(y, 1, 1))} x2={x(ymdToDay(y, 1, 1))} y1={BASE} y2={BASE + 5} stroke="rgba(169,216,208,0.3)" />
          ))}
        </svg>
      </div>
    </div>
  );
}
