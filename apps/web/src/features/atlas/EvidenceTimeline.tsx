import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Change, Dossier, Lane, TimelineEvent } from "@/lib/flagships";
import { EVIDENCE_LABEL, formatYear } from "@/lib/flagships";
import { useStore } from "@/lib/store";
import { useTouchOnly } from "@/lib/ui";
import EvidenceTag from "./EvidenceTag";

const LABEL_W = 176;
const VALUE_W = 132;
const LANE_H = 34;
const AXIS_H = 20;
const EVENT_H = 26;
/** Below this width the lane names and readouts move onto a row above each lane. */
const NARROW = 560;
const HEAD_H = 30;

/** Horizontal and vertical layout for a timeline this wide. */
function geometry(w: number) {
  const narrow = w < NARROW;
  const labelW = narrow ? 0 : LABEL_W;
  const plotW = Math.max(10, w - labelW - (narrow ? 0 : VALUE_W));
  const head = narrow ? HEAD_H : 0;
  return { narrow, labelW, plotW, head, step: LANE_H + head };
}
type Geometry = ReturnType<typeof geometry>;

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

/** Most recent observation at or before t (surveys and counts). */
function lastBefore(lane: Lane, t: number) {
  let best: Lane["points"][number] | null = null;
  for (const p of lane.points) if (p[0] <= t + 1e-6) best = p;
  return best;
}

/** Interpolated value at t (continuous lanes), null outside the record or across a gap > 3 weeks. */
function valueAt(lane: Lane, t: number) {
  const pts = lane.points;
  if (!pts.length || t < pts[0][0] || t > pts[pts.length - 1][0]) return null;
  let i = 0;
  while (i < pts.length - 2 && pts[i + 1][0] < t) i++;
  const a = pts[i];
  const b = pts[i + 1] ?? a;
  if (b[0] - a[0] > 0.06) return null;
  const f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
  return a[1] + (b[1] - a[1]) * f;
}

function fmtValue(lane: Lane, v: number) {
  if (lane.unit.startsWith("%")) return `${v.toFixed(1)}%`;
  if (lane.unit.startsWith("°C at")) return `${v.toFixed(1)} °C`;
  if (lane.unit.startsWith("°C vs")) return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} °C`;
  if (lane.unit.startsWith("°C-weeks")) return `${v.toFixed(1)} DHW`;
  if (lane.unit.startsWith("per manta")) return `${v.toFixed(2)} / tow`;
  if (lane.unit.startsWith("counted")) return `${Math.round(v)} seen`;
  if (lane.unit.startsWith("g per")) return `${v.toFixed(1)} g/m²`;
  if (lane.unit.startsWith("per m²")) return `${v.toFixed(1)} /m²`;
  return v.toFixed(1);
}

function ago(years: number) {
  const months = Math.round(years * 12);
  if (months < 1) return "this month";
  if (months < 24) return `${months} mo before`;
  return `${(years).toFixed(1)} yr before`;
}

const EventMark = ({ e, x }: { e: TimelineEvent; x: number }) => {
  const color =
    e.kind === "cyclone" ? "#b8a8ff" : e.kind === "cots" ? "#c792ea" : e.kind === "bleaching" || e.kind === "heat" ? "#ff8a4c" : e.kind === "survey" ? "#6ff3e3" : "#8e8e93";
  return (
    <g transform={`translate(${x} ${EVENT_H / 2})`} className="ev-mark">
      <title>{`${formatYear(e.t)} · ${e.label}\n${e.detail}\n(${EVIDENCE_LABEL[e.evidence]})`}</title>
      {e.kind === "survey" ? (
        <rect x={-1} y={-7} width={2} height={14} rx={1} fill={color} opacity={0.85} />
      ) : e.kind === "cyclone" ? (
        <path d="M -5 0 A 5 5 0 1 1 0 5 M 5 0 A 5 5 0 1 1 0 -5" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      ) : e.evidence === "reported" ? (
        <rect x={-4.5} y={-4.5} width={9} height={9} rx={2} fill="none" stroke={color} strokeWidth="1.5" />
      ) : (
        <circle r={4} fill={color} />
      )}
      {e.kind === "unknown" && (
        <text y={3.5} textAnchor="middle" fontSize="8" fontWeight="700" fill={color}>
          ?
        </text>
      )}
    </g>
  );
};

/** Everything that does not follow the cursor. */
const Plot = memo(function Plot({ d, geo, x, change }: { d: Dossier; geo: Geometry; x: (t: number) => number; change: Change | null }) {
  const { plotW, labelW } = geo;
  const years = useMemo(() => {
    const [a, b] = d.span;
    const span = b - a;
    // the finest step that keeps year labels at least 44 px apart
    const step = [0.25, 1, 2, 5, 10].find((s) => s >= (span > 30 ? 5 : span > 12 ? 2 : span > 4 ? 1 : 0.25) && (plotW * s) / span >= 44) ?? 10;
    const out: number[] = [];
    for (let y = Math.ceil(a / step) * step; y <= b; y += step) out.push(Math.round(y * 100) / 100);
    return out;
  }, [d.span, plotW]);
  const events = d.events.filter((e) => e.kind !== "heat");
  const top = AXIS_H + EVENT_H;

  return (
    <g>
      {/* year grid and axis */}
      {years.map((y) => (
        <g key={y}>
          <line x1={x(y)} x2={x(y)} y1={AXIS_H - 4} y2={top + d.lanes.length * geo.step} className="tl-grid" />
          <text x={x(y)} y={12} className="tl-year" textAnchor="middle">
            {Number.isInteger(y) ? y : formatYear(y)}
          </text>
        </g>
      ))}

      {/* a selected change: the interval nobody observed between two surveys */}
      {change && (
        <g>
          <rect x={x(change.t0)} y={AXIS_H} width={Math.max(2, x(change.t1) - x(change.t0))} height={EVENT_H + d.lanes.length * geo.step} className="tl-change" />
          <text x={(x(change.t0) + x(change.t1)) / 2} y={AXIS_H + 9} textAnchor="middle" className="tl-change-label">
            not observed
          </text>
        </g>
      )}

      {/* events row */}
      <g transform={`translate(0 ${AXIS_H})`}>
        {events.map((e, i) => (
          <EventMark key={i} e={e} x={x(e.t)} />
        ))}
      </g>

      {/* lanes */}
      {d.lanes.map((lane, li) => {
        const y0 = top + li * geo.step + geo.head;
        const lo = lane.min ?? 0;
        const hi = lane.max;
        const y = (v: number) => y0 + LANE_H - 5 - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (LANE_H - 10);
        const inSpan = lane.points.filter((p) => p[0] >= d.span[0] - 0.05 && p[0] <= d.span[1]);
        const gaps = d.gaps.filter((g) => !g.lane || g.lane === lane.id);
        return (
          <g key={lane.id}>
            <line x1={0} x2={plotW} y1={y0 + LANE_H} y2={y0 + LANE_H} className="tl-lane-rule" transform={`translate(${labelW} 0)`} />
            {gaps.map((g, i) => (
              <rect key={i} x={x(Math.max(d.span[0], g.t0))} y={y0 + 3} width={Math.max(1, x(Math.min(d.span[1], g.t1)) - x(Math.max(d.span[0], g.t0)))} height={LANE_H - 6} className="tl-gap">
                <title>{g.label}</title>
              </rect>
            ))}
            {lane.refs?.map((r) => (
              <g key={r.v}>
                <line x1={labelW} x2={labelW + plotW} y1={y(r.v)} y2={y(r.v)} className="tl-ref" />
              </g>
            ))}
            {lane.others?.map((o) => (
              <path
                key={o.label}
                d={o.points.filter((p) => p[0] >= d.span[0] - 0.05).map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(" ")}
                className="tl-other"
                stroke={lane.color}
              >
                <title>{o.label}</title>
              </path>
            ))}
            {lane.kind === "continuous" && inSpan.length > 1 && (
              <>
                <path
                  d={
                    `M${x(inSpan[0][0]).toFixed(1)} ${y(lo)} ` +
                    inSpan.map((p) => `L${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(" ") +
                    ` L${x(inSpan[inSpan.length - 1][0]).toFixed(1)} ${y(lo)} Z`
                  }
                  fill={lane.color}
                  opacity={0.18}
                />
                <path
                  d={inSpan
                    .map((p, i) => {
                      const jump = i > 0 && p[0] - inSpan[i - 1][0] > 0.06;
                      return `${i === 0 || jump ? "M" : "L"}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`;
                    })
                    .join(" ")}
                  fill="none"
                  stroke={lane.color}
                  strokeWidth={1.3}
                />
              </>
            )}
            {lane.kind === "survey" && (
              <>
                {inSpan.slice(1).map((p, i) => {
                  const a = inSpan[i];
                  const dashed = p[0] - a[0] > 1.25;
                  return <line key={i} x1={x(a[0])} y1={y(a[1])} x2={x(p[0])} y2={y(p[1])} stroke={lane.color} strokeWidth={1.4} strokeDasharray={dashed ? "3 3" : undefined} opacity={dashed ? 0.6 : 0.9} />;
                })}
                {inSpan.map((p, i) => (
                  <g key={i}>
                    {p[2] !== undefined && p[3] !== undefined && <line x1={x(p[0])} x2={x(p[0])} y1={y(p[2])} y2={y(p[3])} stroke={lane.color} strokeWidth={1} opacity={0.45} />}
                    <circle cx={x(p[0])} cy={y(p[1])} r={2.6} fill={lane.color} className="tl-obs" />
                  </g>
                ))}
              </>
            )}
            {lane.kind === "count" &&
              inSpan.map((p, i) => {
                const h = ((Math.min(hi, p[1]) - lo) / (hi - lo)) * (LANE_H - 10);
                return <rect key={i} x={x(p[0]) - 2.5} y={y0 + LANE_H - 5 - h} width={5} height={Math.max(p[1] > 0 ? 1.5 : 0.8, h)} rx={1} fill={lane.color} opacity={p[1] > 0 ? 0.95 : 0.35} />;
              })}
            {lane.id === "dhw" &&
              d.events
                .filter((e) => e.kind === "heat" && e.t >= d.span[0])
                .map((e, i) => (
                  <text key={i} x={x(e.t)} y={y0 + 9} textAnchor="middle" className="tl-peak">
                    {e.label.replace("DHW ", "")}
                  </text>
                ))}
          </g>
        );
      })}
    </g>
  );
});

export default function EvidenceTimeline({ d, change, onPickChange }: { d: Dossier; change: Change | null; onPickChange: (c: Change | null) => void }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const t = useStore((s) => s.flagshipT);
  const setT = useStore((s) => s.setFlagshipT);
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);
  const touch = useTouchOnly();
  const g = useMemo(() => geometry(w), [w]);
  const { labelW, plotW } = g;
  const x = useMemo(() => (tt: number) => labelW + ((tt - d.span[0]) / (d.span[1] - d.span[0])) * plotW, [d.span, labelW, plotW]);
  const fromX = (px: number) => d.span[0] + ((px - labelW) / plotW) * (d.span[1] - d.span[0]);
  const cursor = hover ?? t ?? d.span[1] - 0.001;
  const height = AXIS_H + EVENT_H + d.lanes.length * g.step + 4;

  // Start the cursor on the latest evidence.
  useEffect(() => {
    if (useStore.getState().flagshipT === null) setT(Math.min(d.span[1] - 0.01, Math.max(...d.lanes.flatMap((l) => l.points.map((p) => p[0])))));
  }, [d, setT]);

  const at = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const tt = fromX(e.clientX - r.left);
    return Math.min(d.span[1], Math.max(d.span[0], tt));
  };

  const surveysAtCursor = d.surveys.filter((s) => s.t <= cursor).at(-1);

  return (
    <section className="evidence" aria-label="Evidence timeline">
      <header className="evidence-head">
        <div>
          <h3>Evidence timeline</h3>
          <p>
            Dots are observations, dashes are stretches nobody looked, hatching is a silent instrument.{" "}
            {touch ? "Drag across it to read what was known at any moment." : "Hover or drag to read what was known at any moment."}
          </p>
        </div>
        <div className="evidence-cursor" aria-live="polite">
          <b>{formatYear(cursor)}</b>
          {surveysAtCursor && (
            <span>
              last survey {surveysAtCursor.label.split(",").at(-1)?.trim()} · {ago(cursor - surveysAtCursor.t)}
            </span>
          )}
        </div>
      </header>
      <div ref={ref} className="evidence-body">
        {w > 0 && (
          <svg
            width={w}
            height={height}
            role="img"
            aria-label={`Timeline of ${d.lanes.map((l) => l.label).join(", ")} from ${Math.floor(d.span[0])} to ${Math.floor(d.span[1])}`}
            onPointerMove={(e) => {
              const tt = at(e);
              if (dragging.current) setT(tt);
              else setHover(tt);
            }}
            onPointerLeave={() => {
              setHover(null);
              dragging.current = false;
            }}
            onPointerDown={(e) => {
              dragging.current = true;
              (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
              setT(at(e));
              setHover(null);
              const hit = d.changes.find((c) => at(e) >= c.t0 && at(e) <= c.t1);
              if (hit) onPickChange(hit);
            }}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
          >
            <Plot d={d} geo={g} x={x} change={change} />
            {/* lane labels and readouts */}
            {d.lanes.map((lane, li) => {
              const y0 = AXIS_H + EVENT_H + li * g.step;
              const [line1, line2] = g.narrow ? [12, 25] : [15, 28];
              const obs = lane.kind === "continuous" ? null : lastBefore(lane, cursor);
              const v = lane.kind === "continuous" ? valueAt(lane, cursor) : obs?.[1];
              return (
                <g key={lane.id}>
                  <text x={0} y={y0 + line1} className="tl-lane-name">
                    {lane.label}
                  </text>
                  <text x={0} y={y0 + line2} className="tl-lane-unit">
                    {EVIDENCE_LABEL[lane.evidence]} · {lane.unit}
                  </text>
                  <text x={w} y={y0 + line1} textAnchor="end" className="tl-value" fill={lane.color}>
                    {v === null || v === undefined ? "no data" : fmtValue(lane, v)}
                  </text>
                  <text x={w} y={y0 + line2} textAnchor="end" className="tl-lane-unit">
                    {obs ? `seen ${formatYear(obs[0])}${cursor - obs[0] > 0.1 ? ` · ${ago(cursor - obs[0])}` : ""}` : lane.kind === "continuous" ? "" : "not yet surveyed"}
                  </text>
                </g>
              );
            })}
            <line x1={x(cursor)} x2={x(cursor)} y1={AXIS_H - 2} y2={height - 2} className="tl-cursor" />
            <circle cx={x(cursor)} cy={AXIS_H - 2} r={3} className="tl-cursor-dot" />
          </svg>
        )}
      </div>
      <footer className="evidence-legend">
        {Array.from(new Set(d.lanes.map((l) => l.evidence).concat(d.events.map((e) => e.evidence)))).map((ev) => (
          <EvidenceTag key={ev} kind={ev} />
        ))}
        <span className="legend-item">
          <svg width="16" height="10" aria-hidden="true">
            <path d="M -1 5 A 4 4 0 1 1 3 9 M 9 5 A 4 4 0 1 1 5 1" transform="translate(4 0)" fill="none" stroke="#b8a8ff" strokeWidth="1.4" />
          </svg>
          cyclone (tropical-storm winds within 150 km, or hurricane-force within 350 km)
        </span>
        {d.events.some((e) => e.kind === "survey") && (
          <span className="legend-item">
            <svg width="6" height="12" aria-hidden="true">
              <rect x="2" y="0" width="2" height="12" rx="1" fill="#6ff3e3" />
            </svg>
            3D survey
          </span>
        )}
        {d.events.some((e) => e.evidence === "reported") && (
          <span className="legend-item">
            <svg width="12" height="10" aria-hidden="true">
              <rect x="1.5" y="1" width="8" height="8" rx="2" fill="none" stroke="#8e8e93" strokeWidth="1.4" />
            </svg>
            cause reported by the monitoring program
          </span>
        )}
        <span className="legend-item">
          <svg width="18" height="10" aria-hidden="true">
            <rect width="18" height="10" className="tl-gap" />
          </svg>
          no data
        </span>
      </footer>
    </section>
  );
}
