import { test, expect } from "@playwright/test";

/**
 * Authenticated customer portal — runs as the seeded customer (see
 * customer.setup.ts). Read-only smoke checks on the portal home and one
 * inner page.
 */
test.describe("customer portal", () => {
    test("portal home greets the signed-in customer", async ({ page }) => {
        await page.goto("/portal", { waitUntil: "domcontentloaded" });
        await expect(page).toHaveURL(/\/portal/);
        await expect(page.getByText(/welcome back,/i)).toBeVisible();
    });

    test("tickets page loads", async ({ page }) => {
        await page.goto("/portal/tickets", { waitUntil: "domcontentloaded" });
        await expect(page).toHaveURL(/\/portal\/tickets/);
    });
});
