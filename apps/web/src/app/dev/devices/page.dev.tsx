import { devices } from "playwright-core";

export const metadata = { title: "Device frame | Reef Atlas" };

// Dev-only route (see next.config.ts): /dev/devices?device=iPhone+15&path=/%23flagship%3Dmoorea
// Loads a page of this app in an iframe sized to the device's CSS viewport from
// Playwright's device registry, so width/height media queries and viewport units
// (dvh, svh, vw) resolve as on that device. An iframe does not emulate touch,
// hover/pointer media, device pixel ratio or safe-area insets; run
// `pnpm mobile:check` for those.
export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ device?: string; landscape?: string; path?: string }>;
}) {
  const q = await searchParams;
  const names = Object.keys(devices).filter((n) => !n.endsWith(" landscape"));
  const name = q.device && names.includes(q.device) ? q.device : "iPhone 15";
  const landscape = q.landscape === "1" && `${name} landscape` in devices;
  const device = devices[landscape ? `${name} landscape` : name];
  // Same-origin paths only
  const path = q.path && /^\/(?!\/)/.test(q.path) ? q.path : "/";
  const { width, height } = device.viewport;

  return (
    <main style={{ height: "100dvh", overflow: "auto", padding: 16, fontFamily: "var(--mono)", fontSize: 12 }}>
      <form action="/dev/devices" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <style>{`form select, form input[name=path], form button { border: 1px solid var(--hairline-strong); padding: 4px 8px; }`}</style>
        <select name="device" defaultValue={name} aria-label="Device">
          {names.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <label>
          <input type="checkbox" name="landscape" value="1" defaultChecked={landscape} /> landscape
        </label>
        <input name="path" defaultValue={path} aria-label="Path" size={36} />
        <button type="submit">Load</button>
        <span style={{ color: "var(--aqua)" }}>
          {width}×{height} CSS px · DPR {device.deviceScaleFactor} · {device.hasTouch ? "touch" : "no touch"} (not emulated in a frame)
        </span>
      </form>
      <iframe
        key={`${name}-${landscape}-${path}`}
        src={path}
        title={`${name} preview`}
        width={width}
        height={height}
        allow="microphone; autoplay; fullscreen"
        // An outline, not a border: with the global border-box sizing a border
        // would shrink the frame's viewport below the device's.
        style={{ display: "block", border: 0, outline: "1px solid var(--hairline-strong)", background: "var(--abyss)" }}
      />
    </main>
  );
}
