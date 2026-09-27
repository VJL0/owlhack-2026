import { build } from "esbuild";
await build({
  entryPoints: ["src/server/speech/server.ts"], outfile: "dist/speech.cjs",
  bundle: true, platform: "node", target: "node24", format: "cjs",
  // This bundle only runs on the server; Next's server-only marker resolves to its empty server export.
  conditions: ["react-server"], external: ["bufferutil", "utf-8-validate"],
});
