import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const externalFiles = [
  "src/app/(external)/**/*.{ts,tsx}",
  "src/modules/external/**/*.{ts,tsx}",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: externalFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/shared/components/Sidebar",
              message: "External surface must not import staff Sidebar; keep split-ready boundaries.",
            },
            {
              name: "@/shared/components/ButtonBar",
              message: "External surface must not import staff ButtonBar.",
            },
            {
              name: "@/shared/components/QuickTicketButton",
              message: "External surface must not import staff QuickTicketButton.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".claude/**",
    // The replica sync worker. Plain CommonJS Node, run as a child process under
    // ELECTRON_RUN_AS_NODE — it never passes through Next's bundler, so this config's
    // TypeScript/ESM rules do not describe it (every `require` reads as an error).
    // It moved in wholesale from `tools/counter-sync` precisely because it is proven
    // against real data; converting it to ESM to satisfy a linter that does not apply
    // to it would be the rewrite that move avoided. `node --check` covers its syntax.
    "sync-engine/**",
  ]),
]);

export default eslintConfig;
