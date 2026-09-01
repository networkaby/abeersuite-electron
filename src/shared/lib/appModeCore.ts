/**
 * The 4-way build variant contract — deliberately dependency-free.
 *
 * Consumed from places that cannot share a normal module graph:
 *   - `src/shared/lib/appMode.ts` (the Next app's own reader)
 *   - `next.config.ts` (runs outside the app's module graph — see its own comment)
 *   - `scripts/strip-build.ts` and `scripts/counter-build.ts` (run under `tsx`, before
 *     Next or Prisma load anything)
 *
 * `electron/main.ts` is the one consumer that CANNOT import this file — it is compiled
 * by `electron/tsconfig.json`, rooted at `electron/`, and an import reaching outside that
 * root would change the emitted output path (see the `COUNTER_ENV_FILE` comment in
 * main.ts for the same constraint already documented there). main.ts keeps its own
 * small, deliberately duplicated copy of just the pieces it needs.
 *
 * full    = everything. Internal build, hidden from search engines.
 * public  = external only (shop + customer portal). Indexed. Vercel-only in practice.
 * office  = everything minus public routes. Desktop build for admin/management.
 * counter = POS only, minimal. Desktop build for shop-floor tills.
 *
 * ── Two different strip mechanisms, on purpose ──────────────────────────────────
 * `public` is built on Vercel from a fresh, throwaway git clone per build, so
 * `strip-build.ts` can PERMANENTLY delete office-only source — the same reasoning
 * already governed the original public-only script.
 *
 * `office` and `counter` are built by `electron:build`, which runs in a developer's
 * REAL local checkout, not a throwaway clone. Deleting files there would eat someone's
 * working tree on a failed or misconfigured build. `counter-build.ts` already solved
 * this for the office/public split with a rename-out-and-restore wrapper around `next
 * build` (safe, reversible, retries through Windows file locks) — it is extended here
 * to also drop the extra office/vouchers modules a counter has no use for, using the
 * same safe mechanism, never `rmSync`.
 */
export const APP_MODES = ["full", "public", "office", "counter"] as const;
export type AppMode = (typeof APP_MODES)[number];

/**
 * Strict parse: an unrecognised value THROWS rather than silently becoming "full".
 *
 * The old 2-way check (`=== "public" ? "public" : "full"`) meant any typo — including a
 * new mode name misspelled — silently shipped the complete office app. That is exactly
 * backwards for `counter`, where "full app on a till" is the failure this whole variant
 * system exists to prevent. Empty/unset is the one exception, kept as "full" so local dev
 * and the existing Vercel office project need no env change.
 */
export function parseAppMode(raw: string | undefined): AppMode {
    const value = raw?.trim();
    if (!value) return "full";
    if ((APP_MODES as readonly string[]).includes(value)) return value as AppMode;
    throw new Error(
        `Invalid APP_MODE "${raw}". Must be one of: ${APP_MODES.join(", ")} (or unset, which means "full").`
    );
}

export interface AppModeFlags {
    mode: AppMode;
    /** Staff/office UI (office, vouchers, lab) is present in this build. */
    hasOfficeRoutes: boolean;
    /** Shop storefront + customer portal is present in this build. */
    hasPublicRoutes: boolean;
    /** POS-only shop-floor variant — the strictest strip. */
    isCounter: boolean;
    /** Should this deployment invite search engines? Only the public build. */
    indexable: boolean;
}

export function modeFlags(mode: AppMode): AppModeFlags {
    return {
        mode,
        hasOfficeRoutes: mode === "full" || mode === "office" || mode === "counter",
        hasPublicRoutes: mode === "full" || mode === "public",
        isCounter: mode === "counter",
        indexable: mode === "public",
    };
}

/** Per-mode default landing page, used when `LANDING_PAGE` is not set. */
const DEFAULT_LANDING_PAGE: Record<AppMode, string> = {
    full: "/staff/login",
    office: "/staff/login",
    counter: "/staff/login",
    public: "/",
};

/**
 * A same-origin path only. `LANDING_PAGE` is fed straight to `BrowserWindow.loadURL` in
 * Electron — an unvalidated value would let a bad `.env` point the desktop window at an
 * arbitrary external site (`https://evil.com`) or a protocol-relative one that resolves to
 * whatever host the OS default-handles (`//evil.com`). Must start with exactly one `/`.
 */
export function isSafeLandingPage(value: string): boolean {
    if (!value.startsWith("/")) return false;
    if (value.startsWith("//")) return false;
    return true;
}

/**
 * Resolves the landing page for a given mode + env. Falls back to the per-mode default,
 * silently ignoring (not throwing on) an unsafe override — a bad value in `.env.counter`
 * must not crash the app, it must fail safe to the known-good default.
 */
export function resolveLandingPage(mode: AppMode, env: NodeJS.ProcessEnv = process.env): string {
    const raw = env.LANDING_PAGE?.trim();
    if (raw && isSafeLandingPage(raw)) return raw;
    return DEFAULT_LANDING_PAGE[mode];
}

// ── `public` mode — permanent delete, Vercel-only (strip-build.ts) ────────────────────

/** Everything the PUBLIC build is allowed to keep under `src/app/api`. Unchanged from the
 *  original `strip-public-build.mjs`. */
export const PUBLIC_API_ALLOWLIST = new Set(["auth", "portal", "shop", "upload-signature", "legal"]);

/** Whole subtrees that are office-only regardless of what's under `src/app/api`. Unchanged
 *  from the original `strip-public-build.mjs`. */
export const OFFICE_ONLY_APP_PATHS = ["(protected)", "staff", "receipt", "shipping-label", "shipping-slip"];

// ── `office` / `counter` modes — temporary rename, local dev tree (counter-build.ts) ──

/** Top-level `src/app` entries that only exist to serve the public storefront/portal.
 *  Excluded (renamed out, not deleted) for the duration of `next build` whenever the
 *  desktop build has no public routes — mirrors the original counter-build.ts, which
 *  already excluded exactly this set unconditionally. */
export const PUBLIC_ONLY_APP_DIRS = ["(external)"];
export const PUBLIC_ONLY_APP_FILES = ["robots.ts", "sitemap.ts"];
export const PUBLIC_ONLY_API_SEGMENTS = new Set(["shop", "portal", "legal"]);

/**
 * `office/*` and `vouchers/*` module folders a POS till has no use for. First-pass list —
 * derived from reading the route tree, not from a traced import graph. Excluding a route
 * folder for the duration of one build is safe by construction (Sidebar.tsx and nav are
 * data-driven, not component imports — see `src/shared/lib/auth/sidebarModules.ts`), so
 * the worst case of an over-eager entry here is a dead nav link, never a build failure.
 * The first `APP_MODE=counter` build should still be proven in a throwaway worktree and
 * this list adjusted from whatever `next build` reports missing.
 */
export const COUNTER_OFFICE_MODULE_STRIP = [
    "(to-do)", "accountancy", "admin", "administration", "bi", "crm", "customer-retention",
    "customers", "ecommerce", "help", "inventory", "pricing-strategy", "repairing", "social",
    "work-flow-inbox",
].map((m) => `office/${m}`);

export const COUNTER_VOUCHERS_MODULE_STRIP = [
    "(gl)", "branch-transfers", "challans", "grn", "manufacturing-journals", "online-invoices",
    "online-orders", "physical-stock", "purchase-orders", "rejections-in", "rejections-out",
    "sales-orders",
].map((m) => `vouchers/${m}`);

/** office/settings keeps only what a till actually touches: POS service config, the
 *  printer, and the customer-facing QR display — the two things the counter bridge
 *  exists to drive, per `src/shared/lib/bridge/hardwareBridge.ts`. */
export const COUNTER_SETTINGS_KEEP = new Set(["pos-services", "printer-settings", "qr-display-settings"]);

export const COUNTER_API_ALLOWLIST = new Set([
    "auth", "pos", "counter", "parties", "inventory", "pricing-strategy", "accounts",
    "branches", "users", "permissions", "nav", "settings", "health", "search-slno",
]);

// ── COUNTER_PC ───────────────────────────────────────────────────────────────

/**
 * "Is this machine a shop counter running its own replica?", from `COUNTER_PC`.
 *
 * Owner decision: the `.env` spells it `true`/`false`, because `1`/`0` reads as a
 * count, not a yes/no. The older `1`/`0` form is still accepted so machines and
 * scripts already carrying it keep working — `electron/main.ts` has been setting
 * `"1"` from its own provisioning result since before this parser existed.
 *
 * Returns `undefined` for unset OR unrecognised, deliberately: `postgresManager.ts`
 * treats "no opinion from the env" as "ask the per-machine settings file", and a typo
 * must land there rather than silently meaning `false` and disabling the replica.
 */
export function parseCounterPc(raw: string | undefined): boolean | undefined {
    const value = raw?.trim().toLowerCase();
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
    return undefined;
}
