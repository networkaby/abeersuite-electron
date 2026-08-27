import { test, expect } from "@playwright/test";

/**
 * Public storefront routes — no session, no auth gate. Runs in the "public"
 * project. Read-only smoke checks: the page must render (not 404/500) and
 * carry the storefront's title, which every (store)/(shop) layout sets.
 */
test.describe("public storefront", () => {
    test("home page renders", async ({ page }) => {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page).toHaveTitle(/Network Service/i);
    });

    test("shop page renders", async ({ page }) => {
        await page.goto("/shop", { waitUntil: "domcontentloaded" });
        await expect(page).toHaveURL(/\/shop/);
        await expect(page).toHaveTitle(/Shop/i);
    });
});
