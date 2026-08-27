import { test, expect } from "@playwright/test";
import { CUSTOMER, CUSTOMER_HOME, customerLogin } from "./helpers";

/**
 * Unauthenticated flow: the customer login page itself (/login).
 * Runs in the "customer-unauth" project (no stored session).
 */
test.describe("customer login", () => {
    test("renders the login form, defaulting to OTP", async ({ page }) => {
        await page.goto("/login");

        await expect(page.getByText(/welcome back/i)).toBeVisible();
        await expect(page.getByRole("button", { name: /mobile or email otp/i })).toBeVisible();
        await expect(page.getByRole("button", { name: /^password$/i })).toBeVisible();
    });

    test("rejects invalid password-login credentials", async ({ page }) => {
        await page.goto("/login");
        await page.getByRole("button", { name: /^password$/i }).click();

        await page.locator("#login-identifier").fill("0000000000");
        await page.locator("#login-password").fill("wrong-password");
        await page.getByRole("button", { name: /^sign in$/i }).click();

        await expect(page.getByText(/invalid mobile\/email or password/i)).toBeVisible({
            timeout: 60_000,
        });
        await expect(page).toHaveURL(/\/login/);
    });

    test("logs in with the seeded customer and lands in the portal", async ({ page }) => {
        await customerLogin(page, CUSTOMER);
        await expect(page).toHaveURL(new RegExp(CUSTOMER_HOME.replace(/\//g, "\\/")));
    });
});
