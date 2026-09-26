// Copies the prebuilt Cesium bundle (script, workers, assets, widget CSS) into
// public/cesium so it can be served statically at /cesium/*.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(path.dirname(require.resolve("cesium/package.json")), "Build", "Cesium");
const dest = path.resolve(here, "../public/cesium");
const version = require("cesium/package.json").version;
const stamp = path.join(dest, ".version");

if (fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === version) process.exit(0);
fs.rmSync(dest, { recursive: true, force: true });
for (const dir of ["Assets", "ThirdParty", "Widgets", "Workers"]) {
  fs.cpSync(path.join(src, dir), path.join(dest, dir), { recursive: true });
}
fs.copyFileSync(path.join(src, "Cesium.js"), path.join(dest, "Cesium.js"));
fs.writeFileSync(stamp, version);
console.log(`cesium ${version} copied to public/cesium`);
