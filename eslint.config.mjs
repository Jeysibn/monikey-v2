import eslint from "@eslint/js";
import typescriptEslint from "typescript-eslint";

const nodeGlobals = Object.fromEntries(
  [
    "console",
    "process",
    "Buffer",
    "URL",
    "fetch",
    "setTimeout",
    "clearTimeout",
  ].map((name) => [name, "readonly"]),
);
const browserGlobals = Object.fromEntries(
  [
    "window",
    "document",
    "navigator",
    "caches",
    "self",
    "performance",
    "PerformanceObserver",
    "HTMLElement",
    "HTMLInputElement",
    "getComputedStyle",
    "URL",
    "fetch",
  ].map((name) => [name, "readonly"]),
);

export default typescriptEslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  eslint.configs.recommended,
  ...typescriptEslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...nodeGlobals, ...browserGlobals },
    },
  },
  {
    files: ["apps/web/public/sw.js"],
    languageOptions: {
      globals: browserGlobals,
    },
  },
);
