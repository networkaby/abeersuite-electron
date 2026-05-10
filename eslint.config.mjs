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
  ]),
]);

export default eslintConfig;
