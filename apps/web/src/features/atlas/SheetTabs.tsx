import { useRef } from "react";

/**
 * Tabs for a phone sheet that shows one of several panels (WAI-ARIA tabs pattern:
 * arrow keys, Home and End move between tabs). Panels take their props from `tabPanel`.
 */
export default function SheetTabs<V extends string>({
  id,
  label,
  tabs,
  view,
  onView,
}: {
  id: string;
  label: string;
  tabs: [V, string][];
  view: V;
  onView: (v: V) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="sheet-tabs" role="tablist" aria-label={label}>
      {tabs.map(([v, text], i) => (
        <button
          key={v}
          ref={(el) => {
            refs.current[i] = el;
          }}
          id={`${id}-tab-${v}`}
          role="tab"
          aria-selected={view === v}
          aria-controls={`${id}-panel-${v}`}
          tabIndex={view === v ? 0 : -1}
          onClick={() => onView(v)}
          onKeyDown={(e) => {
            const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
            if (to === undefined) return;
            e.preventDefault();
            const n = (to + tabs.length) % tabs.length;
            onView(tabs[n][0]);
            refs.current[n]?.focus();
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Tab panel semantics, only while the tabs are shown. */
export const tabPanel = (id: string, v: string, tabbed: boolean) => ({
  id: `${id}-panel-${v}`,
  ...(tabbed && { role: "tabpanel", "aria-labelledby": `${id}-tab-${v}` }),
});
