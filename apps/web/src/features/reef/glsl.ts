// Shared GLSL: uniforms, noise, caustics and underwater light.
// Hash functions follow Dave Hoskins' "Hash without Sine" (MIT).

export const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uCamPos;
uniform float uFogDensity;
uniform vec3 uWaterDeep;
uniform vec3 uWaterShallow;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uHeat;
uniform float uStorm;
uniform float uDim;
uniform float uSurfaceY;
uniform vec4 uBoats[10];

vec3 safeNormalize(vec3 v) {
  float l = dot(v, v);
  return l > 1e-12 ? v * inversesqrt(l) : vec3(0.0, 1.0, 0.0);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}

// Voronoi border distance (F2 - F1) with animated feature points.
float cellEdge(vec2 p, float t) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash22(i + g);
      o = 0.5 + 0.42 * sin(t + 6.2831 * o);
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return d2 - d1;
}

// Two drifting cell networks; where their bright borders cross, light focuses.
float caustics(vec2 p, float t) {
  vec2 w = vec2(fbm(p * 0.35 + t * 0.05), fbm(p * 0.35 - t * 0.04 + 7.0)) * 1.4;
  float a = cellEdge(p + w, t * 0.9);
  float b = cellEdge(p * 1.62 + w * 1.3 + 3.7, t * 1.25);
  float la = smoothstep(0.2, 0.0, a);
  float lb = smoothstep(0.16, 0.0, b);
  return la * 0.55 + lb * 0.4 + la * lb * 1.6;
}

// Shadows of hulls passing overhead, softened with depth.
float sunVis(vec3 wpos) {
  float depth = max(uSurfaceY - wpos.y, 0.0);
  float s = 1.0;
  for (int i = 0; i < 10; i++) {
    vec4 b = uBoats[i];
    if (b.z <= 0.0) continue;
    vec2 d = (wpos.xz - b.xy) / (b.zw + depth * 0.14);
    s *= 1.0 - 0.55 * smoothstep(1.3, 0.15, dot(d, d));
  }
  return s;
}

float causticsAt(vec3 wpos, vec3 n) {
  float depth = max(uSurfaceY - wpos.y, 0.0);
  float c = caustics(wpos.xz * 0.42, uTime * 0.55);
  return c * smoothstep(-0.15, 0.85, n.y) * exp(-depth * 0.05) * (1.0 - uStorm * 0.85) * sunVis(wpos);
}

vec3 waterColorFor(vec3 dir) {
  float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(uWaterDeep, uWaterShallow, smoothstep(0.2, 1.0, up));
  float sun = pow(max(dot(dir, uSunDir), 0.0), 6.0);
  c += uSunColor * sun * 0.22 * (1.0 - uStorm * 0.7);
  return c;
}

// Beer-Lambert style absorption (red goes first) then scattering toward water colour.
vec3 applyWater(vec3 col, vec3 wpos) {
  vec3 d = wpos - uCamPos;
  float dist = length(d);
  float depth = max(uSurfaceY - wpos.y, 0.0);
  vec3 absorb = exp(-vec3(0.2, 0.06, 0.04) * (dist * 0.5 + depth * 0.3));
  col *= absorb;
  float f = 1.0 - exp(-pow(max(uFogDensity * dist, 0.0), 1.3));
  vec3 outc = mix(col, waterColorFor(normalize(d)), clamp(f, 0.0, 1.0));
  // one bad pixel would be smeared across the frame by bloom
  if (any(isnan(outc)) || any(isinf(outc))) outc = vec3(0.0);
  return outc;
}
`;

export const OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;
