import { test } from "@playwright/test";

/**
 * Warm-up project. Visits every heavy authed route once so Turbopack compiles
 * them before the assertion specs run — first-compile on this machine can take
 * 1-2 minutes per route, which blows individual test timeouts. By front-loading
 * the compile here (with `waitUntil: "commit"`, which returns as soon as the
 * server responds), the real specs hit already-compiled routes and run fast.
 *
 * Runs in its own project (storageState = admin) and is a dependency of the
 * "authed" project. Misses are logged, not fatal — a slow route still gets
 * compiled even if the goto times out.
 */
const ROUTES = [
    "/office/accountancy/reports/balance-sheet",
    "/office/accountancy/reports/profit-loss",
    "/office/accountancy/reports/trial-balance",
    "/office/accountancy/reports/day-book",
    "/office/accountancy/vouchers-registers/payments",
    "/vouchers/payments/new",
    "/vouchers/pos",
];

test("warm up heavy authed routes", async ({ page }) => {
    test.setTimeout(900_000); // 15 min — sum of cold compiles on a slow disk.

    for (const route of ROUTES) {
        try {
            await page.goto(route, { waitUntil: "commit", timeout: 200_000 });
            // eslint-disable-next-line no-console
            console.log(`warmed: ${route}`);
        } catch {
            // eslint-disable-next-line no-console
            console.log(`warmup miss (will retry in-spec): ${route}`);
        }
    }
});
