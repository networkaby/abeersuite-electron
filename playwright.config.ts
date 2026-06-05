import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";

/**
 * Playwright E2E config for service-mgmt.
 *
 * - Talks to the Next.js dev server on http://localhost:3000 (matches NEXTAUTH_URL).
 * - `webServer` boots `pnpm dev` automatically, but reuses an already-running
 *   server locally so you can keep your own `pnpm dev` open.
 * - One worker / no parallelism: every spec hits the SAME shared remote Supabase
 *   database, so concurrent mutation specs would race. Reads are cheap; keep it
 *   deterministic.
 * - Credentials come from env (see e2e/helpers.ts) with seeded-demo fallbacks.
 */

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

export default defineConfig({
    testDir: "./e2e",
    // Single shared remote DB → run serially so mutation specs don't race.
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: [["html", { open: "never" }], ["list"]],
    // Reports hit a remote pooled DB and routes cold-compile under Turbopack on
    // a slow/tight disk — the office layout alone took ~50s on first hit. The
    // "warmup" project front-loads compiles; these timeouts are the safety net
    // for the first spec to touch a still-cold route.
    timeout: 360_000,
    expect: { timeout: 20_000 },

    use: {
        baseURL: BASE_URL,
        actionTimeout: 20_000,
        navigationTimeout: 300_000,
        trace: "on-first-retry",
        screenshot: "only-on-failure",
        // Video off: recording every test to disk exhausted the tight D: drive
        // (ENOSPC) mid-run. Screenshots-on-failure are enough for triage.
        video: "off",
    },

    projects: [
        // 1. Authenticate once, persist storage state for the authed specs.
        { name: "setup", testMatch: /auth\.setup\.ts$/ },

        // 2. Unauthenticated flow (login page itself) — no stored session.
        {
            name: "unauth",
            testMatch: /login\.spec\.ts$/,
            use: { ...devices["Desktop Chrome"] },
        },

        // 3. Warm up heavy routes once (compile under Turbopack is slow here).
        {
            name: "warmup",
            testMatch: /warmup\.ts$/,
            dependencies: ["setup"],
            use: {
                ...devices["Desktop Chrome"],
                storageState: "e2e/.auth/admin.json",
            },
        },

        // 4. Everything under e2e/tests/** runs as the logged-in admin, after
        //    warmup so the routes are already compiled.
        {
            name: "authed",
            testMatch: /tests\/.*\.spec\.ts$/,
            dependencies: ["warmup"],
            use: {
                ...devices["Desktop Chrome"],
                storageState: "e2e/.auth/admin.json",
            },
        },
    ],

    webServer: {
        command: "pnpm dev",
        // Probe a lightweight route so readiness doesn't wait on the heavy `/`
        // compile (which pulls the whole office layout). Cold Turbopack compiles
        // are slow on this disk — Next flags it — so give it room.
        url: `${BASE_URL}/staff/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        stdout: "pipe",
        stderr: "pipe",
    },
});
