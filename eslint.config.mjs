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
    // A leading underscore is how this codebase says "named on purpose, used on
    // purpose nowhere" — a destructure that exists only to keep a key OUT of the
    // rest object, a signature that must match an interface, a caught error we do
    // not read. Without this the rule flags exactly the cases the convention was
    // invented for, and the only way to quieten it is a disable comment.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
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
    "node_modules/**",
    "**/node_modules/**",
    ".git/**",
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "dist-app/**",
    "dist-electron/**",
    "src/generated/**",
    "playwright-report/**",
    "test-results/**",
    ".pg-download-cache/**",
    ".cursor/**",
    ".kilo/**",
    ".freebuff/**",
    "scratch/**",
    ".gemini/**",
    "next-env.d.ts",
    ".claude/**",
    // The replica sync worker. Plain CommonJS Node, run as a child process under
    // ELECTRON_RUN_AS_NODE — it never passes through Next's bundler, so this config's
    // TypeScript/ESM rules do not describe it (every `require` reads as an error).
    // It moved in wholesale from `tools/counter-sync` precisely because it is proven
    // against real data; converting it to ESM to satisfy a linter that does not apply
    // to it would be the rewrite that move avoided. `node --check` covers its syntax.
    "sync-engine/**",
    // Same reasoning as sync-engine: the thermal printer bridge is plain CommonJS moved
    // in wholesale from the standalone combined-bridge service, run as a child process.
    "hardware-bridge/**",
    // Native mobile projects (Android Gradle build artifacts and CJS scripts)
    "phone-app/**",
    "shop-app-native/**",
  ]),
]);

export default eslintConfig;
