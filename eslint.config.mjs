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
  {
    // A packaged counter loads its .env inside electron/main.ts (`loadCounterEnv`),
    // which runs AFTER every module main.ts imports has been loaded. A top-level
    // `process.env` read in any of them sees the setting empty on a real till and
    // works fine in dev — the worst kind of bug. Read settings inside a function.
    files: ["electron/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']:not(:function MemberExpression)",
          message: "No top-level process.env in electron/: a packaged counter loads its .env after module load (see main.ts). Read it inside a function.",
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
    // Standalone mobile Capacitor app shells and build outputs; not part of the Next.js workspace.
    "phone-app/**",
    "shop-app-native/**",
    // Local scratch / temporary scripts (mirrors .gitignore).
    "**/_tmp_*",
  ]),
]);

export default eslintConfig;
