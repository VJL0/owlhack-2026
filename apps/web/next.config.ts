import type { NextConfig } from "next";

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

export default nextConfig;
