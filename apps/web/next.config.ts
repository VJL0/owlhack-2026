import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (.next/standalone).
  output: "standalone",
  // Caddy compresses responses (zstd/gzip) in front of the app.
  compress: false,
  poweredByHeader: false,
  // The 3D scenes mutate refs and GPU objects every frame; keep React's
  // compiler out of that path.
  reactCompiler: false,
  devIndicators: false,
};

export default function config(phase: string): NextConfig {
  if (phase !== PHASE_DEVELOPMENT_SERVER) return nextConfig;
  // `page.dev.tsx` files are routes only under `next dev` (e.g. /dev/devices);
  // production builds ignore them.
  return { ...nextConfig, pageExtensions: ["dev.tsx", "tsx", "ts", "jsx", "js"] };
}
