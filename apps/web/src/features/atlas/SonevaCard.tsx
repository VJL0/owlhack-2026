import type { Dossier } from "@/lib/flagships";
import { enterSplat } from "@/lib/navigation";
import { useStore } from "@/lib/store";
import EvidenceTag from "./EvidenceTag";

interface Change {
  method: string;
  plots: Record<string, { baseline: string; comparisons: { date: string; days: number; changedPct: number; areaM2: number }[] }>;
}
interface Plot {
  id: string;
  name: string;
  notes: string;
  depths: number[];
  surveys: { date: string; images: number }[];
}

const short = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });

/** Change in the reef's 3D surface, set against how much two surveys a few days apart disagree. */
function ChangeBars({ c }: { c: Change["plots"][string] }) {
  const max = 12;
  const noise = c.comparisons[0];
  return (
    <div className="sv-bars" role="img" aria-label={`Surface change against the ${noise.days}-day repeat survey`}>
      {c.comparisons.map((r) => (
        <div key={r.date} className="sv-bar" data-noise={r === noise}>
          <span className="sv-bar-label">
            {short(r.date)} <em>+{r.days} d</em>
          </span>
          <span className="sv-bar-track">
            <i style={{ width: `${(r.changedPct / max) * 100}%` }} />
            <b style={{ left: `${(noise.changedPct / max) * 100}%` }} aria-hidden="true" />
          </span>
          <span className="sv-bar-val">{r.changedPct}%</span>
        </div>
      ))}
    </div>
  );
}

export default function SonevaCard({ d }: { d: Dossier }) {
  const plot = useStore((s) => s.splatPlot);
  const setSplat = useStore((s) => s.setSplat);
  const plots = d.extras.plots as Plot[];
  const splats = d.extras.splats as Record<string, { surveys: { date: string; bytes: number }[] }>;
  const change = d.extras.change as Change | null;
  const has3d = (id: string) => Boolean(splats[id]);
  const p = plots.find((x) => x.id === plot) ?? plots[0];
  const c = change?.plots[p.id];

  return (
    <section className="side-card sv-card">
      <header>
        <h3>Real 3D surveys of one reef</h3>
        <EvidenceTag kind="field" />
      </header>
      <p className="side-sub">
        Each plot was photographed by divers several times and rebuilt as Gaussian splats. The surveys share one frame, so the same colony stays in the same
        place from date to date.
      </p>
      <div className="sv-plots" role="radiogroup" aria-label="Plot">
        {plots.map((x) => (
          <button key={x.id} role="radio" aria-checked={x.id === p.id} onClick={() => setSplat(x.id)} data-3d={has3d(x.id)}>
            <b>{x.name}</b>
            <span>
              {x.surveys.length} surveys{has3d(x.id) ? " · in 3D here" : ""}
            </span>
          </button>
        ))}
      </div>
      <div className="side-actions">
        {has3d(p.id) ? (
          <button className="btn-dive btn-dive-sm" onClick={() => enterSplat(p.id)}>
            Enter {p.name} in 3D
          </button>
        ) : (
          <p className="side-note">This plot is not converted for the web yet; choose one marked “in 3D here”.</p>
        )}
      </div>
      <p className="side-note">
        {p.notes}. Scale bars at {Math.min(...p.depths)}–{Math.max(...p.depths)} m. Surveys: {p.surveys.map((s) => short(s.date)).join(", ")}.
      </p>
      {c && (
        <>
          <h4 className="sv-h4">
            How much of the surface moved more than 10 cm <EvidenceTag kind="derived" compact />
          </h4>
          <ChangeBars c={c} />
          <p className="side-note">
            Compared with {short(c.baseline)}. The first bar, {c.comparisons[0].days} days apart, is the noise floor: two reconstructions of a reef that
            barely changed. Only the excess over that line is a candidate for real change.
          </p>
        </>
      )}
    </section>
  );
}
