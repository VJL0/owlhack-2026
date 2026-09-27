// Layout check on emulated phones and tablets, for what the /dev/devices frame
// cannot emulate: touch, hover/pointer media, device pixel ratio and safe-area
// insets. Opens each screen in system Chrome (Playwright device descriptors),
// saves a screenshot and reports:
//   - HUD panels that overlap each other or leave the safe area
//   - controls smaller than 24×24 CSS px (WCAG 2.2 SC 2.5.8)
//   - text inputs under 16px (iOS Safari zooms the page when they get focus)
//   - horizontal page overflow
//
// Usage: pnpm mobile:check [base URL] (default http://localhost:3000, run `pnpm dev` first)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, devices } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:3000";
const out = path.join(os.tmpdir(), "reef-atlas-mobile-check");
fs.mkdirSync(out, { recursive: true });

// Safe-area insets in CSS px for a notched phone (iPhone 15: useyourloaf.com/blog/iphone-15-screen-sizes).
// Full-screen values, the worst case a page with viewport-fit=cover sees.
const NOTCH = { portrait: { top: 59, bottom: 34, left: 0, right: 0 }, landscape: { top: 0, bottom: 21, left: 59, right: 59 } };
const DEVICES = [
  { name: "iPhone SE (3rd gen)" },
  { name: "iPhone 15", insets: NOTCH.portrait },
  { name: "iPhone 15 landscape", insets: NOTCH.landscape },
  { name: "Galaxy S9+" }, // 320 CSS px wide, the WCAG 1.4.10 reflow width
  { name: "iPad Mini" },
];

// Deep links where they exist; world and region are reached by tapping through.
const enter = async (page) => page.getByRole("button", { name: "Enter the Ocean" }).tap();
const SCREENS = [
  { name: "intro", path: "/" },
  { name: "world", path: "/", go: enter },
  { name: "region", path: "/", go: async (page) => (await enter(page), await page.locator(".flagship-row", { hasText: "Florida" }).tap()) },
  { name: "moorea", path: "/#flagship=moorea" },
  { name: "soneva", path: "/#flagship=soneva-fushi" },
  { name: "splat", path: "/#splat=ootsl1" },
  { name: "reef", path: "/#reef=looe-key" },
  { name: "voice", path: "/#flagship=moorea", go: async (page) => page.locator(".voice-pill").tap() },
  { name: "data", path: "/data" },
];

function audit() {
  const vw = innerWidth;
  const vh = innerHeight;
  const env = (side) => {
    const probe = document.createElement("div");
    probe.style.cssText = `position:fixed;padding-top:env(safe-area-inset-${side},0px)`;
    document.body.append(probe);
    const v = parseFloat(getComputedStyle(probe).paddingTop);
    probe.remove();
    return v;
  };
  const safe = { top: env("top"), right: vw - env("right"), bottom: vh - env("bottom"), left: env("left") };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05;
  };
  const label = (el) => {
    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : "";
    const text = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28);
    return `${el.tagName.toLowerCase()}${cls}${text ? ` "${text}"` : ""}`;
  };
  const box = (r) => [r.left, r.top, r.width, r.height].map(Math.round).join(",");

  // HUD panels: boxes positioned against the stage or a .hud overlay (not their own contents)
  const stage = document.querySelector(".stage");
  const panels = [...(stage?.querySelectorAll("*") ?? [])].filter((el) => {
    const cs = getComputedStyle(el);
    if (!["absolute", "fixed"].includes(cs.position) || cs.pointerEvents === "none" || !shown(el)) return false;
    if (el.matches(".hud, .stage-layer, canvas, .globe-vignette, .boot, .sr-only") || el.closest("canvas, .cesium-widget")) return false;
    return el.offsetParent?.matches(".hud, .stage") ?? false;
  });
  const issues = [];
  for (let i = 0; i < panels.length; i++) {
    const a = panels[i].getBoundingClientRect();
    if (a.left < safe.left - 0.5 || a.top < safe.top - 0.5 || a.right > safe.right + 0.5 || a.bottom > safe.bottom + 0.5)
      issues.push(`outside safe area: ${label(panels[i])} [${box(a)}]`);
    for (let j = i + 1; j < panels.length; j++) {
      if (panels[i].contains(panels[j]) || panels[j].contains(panels[i])) continue;
      // the open voice card is a popover over the scene, with its own close button
      if (panels[i].matches(".voice-card") || panels[j].matches(".voice-card")) continue;
      const b = panels[j].getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 1 && h > 1) issues.push(`overlap ${Math.round(w)}×${Math.round(h)}: ${label(panels[i])} / ${label(panels[j])}`);
    }
  }
  // WCAG 2.2 SC 2.5.8: 24×24 CSS px, or a 24 px circle centred on the target that touches
  // no other target and no other undersized target's circle. Links inside a sentence are exempt.
  const controls = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role="slider"], [role="switch"]')]
    .filter((el) => shown(el) && !(el.matches("a") && getComputedStyle(el).display === "inline" && el.closest("p, li")))
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { el, r, cx: r.left + r.width / 2, cy: r.top + r.height / 2, small: r.width < 24 || r.height < 24 };
    });
  const hitsRect = (t, r) => Math.hypot(Math.max(r.left - t.cx, 0, t.cx - r.right), Math.max(r.top - t.cy, 0, t.cy - r.bottom)) < 12;
  for (const t of controls) {
    if (t.small) {
      const crowded = controls.some((o) => o !== t && !o.el.contains(t.el) && !t.el.contains(o.el) && (hitsRect(t, o.r) || (o.small && Math.hypot(o.cx - t.cx, o.cy - t.cy) < 24)));
      if (crowded) issues.push(`target ${Math.round(t.r.width)}×${Math.round(t.r.height)} without 24 px spacing: ${label(t.el)}`);
    }
    if (t.el.matches("input:not([type=range]):not([type=checkbox]), select, textarea") && parseFloat(getComputedStyle(t.el).fontSize) < 16)
      issues.push(`input font ${getComputedStyle(t.el).fontSize} (iOS zooms on focus): ${label(t.el)}`);
  }
  if (document.documentElement.scrollWidth > vw) issues.push(`page scrolls sideways: ${document.documentElement.scrollWidth}px > ${vw}px`);
  return issues;
}

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal"] });
let failures = 0;
for (const d of DEVICES) {
  // Reduced motion skips the camera flights, so every screen settles quickly.
  const context = await browser.newContext({ ...devices[d.name], reducedMotion: "reduce" });
  for (const s of SCREENS) {
    const page = await context.newPage();
    if (d.insets) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: d.insets });
    }
    await page.goto(base + s.path, { waitUntil: "load" });
    await page.waitForSelector(".stage .hud, main", { timeout: 30_000 });
    if (s.go) await s.go(page); // taps wait for their target
    await page.waitForTimeout(4_000);
    const issues = await page.evaluate(audit);
    const file = path.join(out, `${d.name.replace(/\W+/g, "-")}--${s.name}.png`);
    await page.screenshot({ path: file });
    failures += issues.length;
    console.log(`${issues.length ? "✗" : "✓"} ${d.name} · ${s.name}${issues.map((x) => `\n    ${x}`).join("")}`);
    await page.close();
  }
  await context.close();
}
await browser.close();
console.log(`\n${failures} issue(s). Screenshots: ${out}`);
process.exitCode = failures ? 1 : 0;
