import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The vendored engine is plain JS with its own Swift, Rust and Raycast
    // front ends. Not ours to lint, and raycast/ is TypeScript that would
    // otherwise be type-checked into our build.
    "engine/**",
  ]),
]);

export default eslintConfig;
