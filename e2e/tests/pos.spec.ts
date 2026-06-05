import { test, expect } from "@playwright/test";

/**
 * POS register smoke test — runs as the logged-in admin.
 *
 * The full "open shift → add product → take payment → posted invoice" flow is
 * deep and data-dependent (needs a seeded counter + sellable products + a clean
 * shift state on the shared DB). That cycle is captured below as test.fixme with
 * concrete steps — un-fixme it and tune the selectors once verified against the
 * live app + seed (`pnpm seed:dummy-all`).
 */
test.describe("POS register", () => {
    test("POS screen loads with shift controls", async ({ page }) => {
        await page.goto("/vouchers/pos", { waitUntil: "domcontentloaded" });

        // Shift status badge resolves to either "No shift" or "Shift #N"
        // (PosScreen.tsx renders "Shift…" while loading, then one of these).
        await expect(page.getByText(/No shift|Shift #\d+/)).toBeVisible({ timeout: 30_000 });
    });

    // Full sale cycle — un-fixme after a live verification pass.
    test.fixme("complete a cash sale and post the invoice", async ({ page }) => {
        await page.goto("/vouchers/pos");

        // 1. Open a shift if none is active.
        //    - click the "Open shift" (Lock icon) button
        //    - ShiftOpenDialog: pick "Counter 1", set vault top-up, click "Open shift"
        //    Note: returns the existing shift with { resumed: true } if one is
        //    already OPEN for this user on the counter — handle both.
        //
        // 2. Pick a customer via PartySearchAndCreate (search a seeded customer).
        //
        // 3. Add a product: type a seeded SKU/name in the product search, pick a
        //    result, confirm it appears as a cart line with qty 1.
        //
        // 4. Checkout: open the payment dialog, choose CASH, tender the full
        //    amount, submit. POST /api/pos/sale requires the OPEN shift.
        //
        // 5. Assert success toast + that the cart resets / a receipt opens.
    });
});
