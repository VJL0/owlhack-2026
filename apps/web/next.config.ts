import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The 3D scenes mutate refs and GPU objects every frame; keep React's
  // compiler out of that path.
  reactCompiler: false,
  devIndicators: false,
};

export default nextConfig;
