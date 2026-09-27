import { EVIDENCE_LABEL, type Evidence } from "@/lib/flagships";

const HINT: Record<Evidence, string> = {
  field: "Counted or photographed by divers on the reef",
  sensor: "Measured by an instrument fixed on the reef",
  satellite: "Measured from orbit over a 5 km pixel, not on the reef itself",
  track: "Cyclone position and wind from best-track records",
  reported: "The monitoring program's own attribution of a change",
  derived: "Computed by Reef Atlas from the sources above",
  estimated: "Labelled estimated, not observed, in the supplied dataset",
  model: "A statistical forecast from past heat, back-tested on earlier years; not an observation",
};

/** Says where a number comes from, in words, with the same mark everywhere. */
export default function EvidenceTag({ kind, compact = false }: { kind: Evidence; compact?: boolean }) {
  return (
    <span className="evidence-tag" data-kind={kind} title={HINT[kind]}>
      <i aria-hidden="true" />
      {compact ? null : EVIDENCE_LABEL[kind]}
      {compact && <span className="sr-only">{EVIDENCE_LABEL[kind]}</span>}
    </span>
  );
}
