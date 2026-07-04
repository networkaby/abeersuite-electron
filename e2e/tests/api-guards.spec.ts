import { test, expect, request as playwrightRequest } from "@playwright/test";

/**
 * API guard + GL integrity checks — pure API-level specs (no page rendering),
 * so they're fast even under a cold Turbopack compile.
 *
 * Guards: the same endpoint must 401 without a session and 200 with the admin
 * session (the authed project's storage state). This pins the requireAuth /
 * requirePermission wiring — a regression that drops a guard fails loudly here.
 *
 * Integrity: the trial balance must balance (Σ debits === Σ credits to the
 * paisa) whatever dummy data the DB holds — the engine posts both legs of
 * every voucher atomically, so an imbalance means a writer bypassed it.
 */

const PROTECTED_GETS = [
    "/api/accountancy/reports/trial-balance",
    "/api/accountancy/reports/profit-loss",
    "/api/users",
];

test.describe("API guards", () => {
    test("protected APIs reject unauthenticated requests", async ({ baseURL }) => {
        // Under @playwright/test, newContext() inherits the project's options —
        // including the authed storageState — so force an EMPTY cookie jar or
        // this "anonymous" context silently carries the admin session.
        const anon = await playwrightRequest.newContext({
            baseURL,
            storageState: { cookies: [], origins: [] },
        });
        try {
            for (const path of PROTECTED_GETS) {
                const res = await anon.get(path);
                expect(res.status(), `${path} should 401 without a session`).toBe(401);
            }
            // A mutating route must be gated too (POST, no body needed to hit the guard).
            const post = await anon.post("/api/gift-cards/expire-breakage");
            expect(post.status(), "write route should 401 without a session").toBe(401);
        } finally {
            await anon.dispose();
        }
    });

    test("protected APIs accept the admin session", async ({ request }) => {
        for (const path of PROTECTED_GETS) {
            const res = await request.get(path);
            expect(res.status(), `${path} should 200 for admin`).toBe(200);
        }
    });
});

test.describe("GL integrity", () => {
    test("trial balance balances to the paisa", async ({ request }) => {
        const res = await request.get("/api/accountancy/reports/trial-balance");
        expect(res.status()).toBe(200);
        const body = (await res.json()) as { totals?: { debits: number; credits: number } };
        expect(body.totals, "trial balance response carries totals").toBeTruthy();
        const { debits, credits } = body.totals!;
        // Same tolerance the engine's isBalanced() uses.
        expect(Math.abs(debits - credits), `Dr ${debits} vs Cr ${credits}`).toBeLessThan(0.005);
    });
});
