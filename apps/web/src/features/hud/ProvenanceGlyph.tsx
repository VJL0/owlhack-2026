import type { Provenance } from "@/lib/data";
import { PROVENANCE_LABEL } from "@/lib/pressures";

/**
 * Shape encodes what kind of number this is, so nothing relies on colour alone:
 * filled = observed, half = derived, dashed ring = model output, hatched = simulated.
 */
export default function ProvenanceGlyph({ kind, size = 9, title = true }: { kind: Provenance; size?: number; title?: boolean }) {
  const r = size / 2 - 0.75;
  const c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden={!title} role={title ? "img" : undefined} style={{ flex: "none" }}>
      {title && <title>{PROVENANCE_LABEL[kind]}</title>}
      {kind === "observed" && <circle cx={c} cy={c} r={r} fill="currentColor" />}
      {kind === "derived" && (
        <>
          <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth="1" />
          <path d={`M ${c} ${c - r} A ${r} ${r} 0 0 0 ${c} ${c + r} Z`} fill="currentColor" />
        </>
      )}
      {kind === "model" && <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="1.6 1.4" />}
      {kind === "simulated" && (
        <>
          <defs>
            <clipPath id={`clip-${size}`}>
              <circle cx={c} cy={c} r={r} />
            </clipPath>
          </defs>
          <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth="1" />
          <g clipPath={`url(#clip-${size})`} stroke="currentColor" strokeWidth="1">
            {[-size, -size / 2, 0, size / 2, size].map((o) => (
              <line key={o} x1={o} y1={size} x2={o + size} y2={0} />
            ))}
          </g>
        </>
      )}
    </svg>
  );
}
