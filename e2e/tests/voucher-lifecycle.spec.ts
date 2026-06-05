import { test, expect } from "@playwright/test";

/**
 * Voucher lifecycle smoke — runs as the logged-in admin.
 *
 * Covers the surfaces the lifecycle routes back (cancel/delete/restore/post/
 * hard-delete under /api/{accountancy,inventory}/vouchers/[id]/*): the unified
 * register that lists vouchers, and a GL voucher creation form.
 *
 * The full create → post → cancel → restore cycle is captured as test.fixme with
 * concrete steps — un-fixme and tune selectors after a live verification pass.
 */
test.describe("voucher lifecycle", () => {
    test("voucher register loads", async ({ page }) => {
        // The Payments register (thin GlVoucherList) — a real voucher register
        // backed by the lifecycle routes, but far lighter to compile than the
        // /all combiner (useCombinedVouchers fans out across inventory+GL+JE).
        await page.goto("/office/accountancy/vouchers-registers/payments", {
            waitUntil: "domcontentloaded",
        });

        // Module gate (accountancy:view:org) didn't bounce us.
        await expect(page).toHaveURL(/vouchers-registers\/payments/);
        await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();

        // Register settled — a row table when vouchers exist, or the empty state
        // ("No payments yet." / "0 of 0 rows") on a fresh DB. Data-state-agnostic.
        const register = page
            .locator("table, [role='table']")
            .first()
            .or(page.getByText(/No payments yet|0 of 0 rows/i).first());
        await expect(register).toBeVisible({ timeout: 60_000 });
    });

    test("GL payment voucher form renders", async ({ page }) => {
        // Real route is /vouchers/payments/new (plural, under the (gl) group) —
        // the doc's /vouchers/payment 404s.
        await page.goto("/vouchers/payments/new", { waitUntil: "domcontentloaded" });

        // Standalone full-page GlVoucherPage (no office sidebar). Save affordance present.
        await expect(page.getByRole("button", { name: /^Save$/ })).toBeVisible({
            timeout: 30_000,
        });
        await expect(page.getByText(/Payment/i).first()).toBeVisible();
    });

    // Full lifecycle — un-fixme after a live verification pass.
    test.fixme("create, post, cancel, then restore a payment voucher", async ({ page }) => {
        // 1. Go to /vouchers/payments/new (GlVoucherPage, kind=PAYMENT).
        // 2. Pick the Cr cash/bank ledger (top line) and a Dr expense/party row,
        //    enter an amount so isBalanced() is satisfied → "Save" enables.
        // 3. Save (DRAFT) → POST /api/accountancy/vouchers. Capture the new id
        //    from the URL or the success toast.
        // 4. Post it (LifecycleActions "Post") → /[id]/post. Status badge → POSTED.
        // 5. Cancel (LifecycleActions "Cancel") → /[id]/cancel. Status → CANCELLED.
        // 6. Restore → /[id]/restore. Status returns to its pre-cancel state.
        //    Assert the status badge text at each step.
    });
});
