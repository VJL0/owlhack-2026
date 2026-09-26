"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, Effect, ToneMappingMode } from "postprocessing";
import { Uniform } from "three";
import { U } from "./env";

// Heat shimmer: a faint refractive wobble that grows with heat stress.
// (postprocessing forbids the CONVOLUTION attribute on UV-transforming effects.)
const shimmerFrag = /* glsl */ `
uniform float strength;
uniform float time;
void mainUv(inout vec2 uv) {
  float s = strength;
  uv.x += (sin(uv.y * 46.0 + time * 1.7) * 0.0011 + sin(uv.y * 131.0 - time * 2.6) * 0.0004) * s;
  uv.y += cos(uv.x * 38.0 + time * 1.3) * 0.0008 * s;
}`;

class ShimmerEffect extends Effect {
  constructor() {
    super("ShimmerEffect", shimmerFrag, {
      uniforms: new Map<string, Uniform>([
        ["strength", new Uniform(0)],
        ["time", new Uniform(0)],
      ]),
    });
  }
}

export default function Effects({ quality }: { quality: "high" | "low" }) {
  const shimmer = useMemo(() => new ShimmerEffect(), []);
  useEffect(() => () => shimmer.dispose(), [shimmer]);
  useFrame(({ clock }) => {
    shimmer.uniforms.get("strength")!.value = Math.max(0, U.uHeat.value - 0.25) * 1.6;
    shimmer.uniforms.get("time")!.value = clock.elapsedTime;
  });
  return (
    <EffectComposer multisampling={quality === "high" ? 4 : 0}>
      <primitive object={shimmer} />
      <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.62} luminanceSmoothing={0.2} radius={0.72} />
      {/* grain and vignette belong in display space, after tone mapping */}
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Vignette offset={0.22} darkness={0.72} />
      <Noise blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.22} />
    </EffectComposer>
  );
}
