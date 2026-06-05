import { test, expect } from "@playwright/test";

/**
 * Accountancy report smoke tests — runs as the logged-in admin (R1 holds
 * `accountancy:view:org`, so the module gate passes).
 *
 * These are read-only: each report must load without redirecting to /office
 * (the gate) and render its heading + a data region. They exercise the
 * truth-path aggregators (aggregateClosingAsOf / netProfitLoss / aggregateRange)
 * end-to-end against the live DB without asserting specific figures (which drift
 * with seed data).
 */

const REPORTS: { name: string; path: string; heading: RegExp }[] = [
    { name: "Balance Sheet", path: "/office/accountancy/reports/balance-sheet", heading: /Balance Sheet/ },
    { name: "Profit & Loss", path: "/office/accountancy/reports/profit-loss", heading: /Profit & Loss/ },
    { name: "Trial Balance", path: "/office/accountancy/reports/trial-balance", heading: /Trial Balance/ },
    { name: "Day Book", path: "/office/accountancy/reports/day-book", heading: /Day Book/ },
];

for (const report of REPORTS) {
    test(`${report.name} loads and renders`, async ({ page }) => {
        // domcontentloaded (not "load") — these client pages keep the network
        // busy fetching report data, so don't block navigation on the load event.
        await page.goto(report.path, { waitUntil: "domcontentloaded" });

        // Not bounced by the accountancy:view:org gate (which redirects to /office).
        await expect(page).toHaveURL(new RegExp(report.path.replace(/\//g, "\\/")));

        // Heading is present (may also appear in a breadcrumb — first match is fine).
        await expect(page.getByText(report.heading).first()).toBeVisible();

        // The report settled into a data region — a table when there are rows,
        // or a legitimate empty/zero-rows state. Data-state-agnostic, and with
        // headroom for the report API's cold first compile.
        const dataRegion = page
            .locator("table, [role='table']")
            .first()
            .or(page.getByText(/No .*(yet|found)|0 of 0 rows|nothing to show/i).first());
        await expect(dataRegion).toBeVisible({ timeout: 90_000 });
    });
}
