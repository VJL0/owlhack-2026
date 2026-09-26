import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The reef scene follows the React Three Fiber model: GPU objects created in
    // useMemo are mutated every frame inside useFrame. These React Compiler
    // rules assume immutable render values, and the compiler is disabled here.
    files: ["src/features/reef/**/*.tsx"],
    rules: {
      "react-hooks/immutability": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/cesium/**",
  ]),
]);

export default eslintConfig;
