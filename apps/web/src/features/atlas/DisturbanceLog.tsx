import type { Dossier } from "@/lib/flagships";
import { useStore } from "@/lib/store";
import EvidenceTag from "./EvidenceTag";

interface Entry {
  year: number;
  type: string;
  code: string;
  tooltip: string;
  description: string;
}

const KIND: Record<string, string> = { s: "Storm", c: "Starfish", b: "Bleaching", m: "Several", u: "Unknown", d: "Disease" };

/** AIMS's own attribution of each change at this reef, including the ones it could not explain. */
export default function DisturbanceLog({ d }: { d: Dossier }) {
  const entries = ((d.extras.disturbances as Entry[]) ?? []).filter((e) => e.type === "MANTA").sort((a, b) => a.year - b.year);
  const unknown = entries.filter((e) => e.code === "u").length;
  const setT = useStore((s) => s.setFlagshipT);
  return (
    <section className="side-card">
      <header>
        <h3>What AIMS says caused each change</h3>
        <EvidenceTag kind="reported" />
      </header>
      <p className="side-sub">
        The monitoring program logs a likely cause after each survey. {unknown} of {entries.length} entries say the cause is unknown.
      </p>
      <ol className="dl-list">
        {entries.map((e, i) => (
          <li key={i} data-code={e.code}>
            <button onClick={() => setT(e.year - 0.2)}>
              <span className="dl-year">{e.year}</span>
              <span className="dl-kind">{KIND[e.code] ?? e.code}</span>
              <span className="dl-desc">{e.tooltip === "unknown" ? e.description : e.tooltip}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="side-note">Survey year as reported by AIMS; the event itself can precede it by months.</p>
    </section>
  );
}
