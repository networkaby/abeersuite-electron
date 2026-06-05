import { test, expect } from "@playwright/test";
import { SUPER_ADMIN, STAFF_HOME, staffLogin } from "./helpers";

/**
 * Unauthenticated flow: the staff login page itself.
 * Runs in the "unauth" project (no stored session).
 */
test.describe("staff login", () => {
    test("renders the login form", async ({ page }) => {
        await page.goto("/staff/login");

        await expect(page.getByText("Service Management")).toBeVisible();
        await expect(page.locator('input[type="email"]')).toBeVisible();
        await expect(page.locator('input[type="password"]')).toBeVisible();
        await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    });

    test("rejects invalid credentials", async ({ page }) => {
        await page.goto("/staff/login");

        await page.locator('input[type="email"]').fill("nobody@networkservice.in");
        await page.locator('input[type="password"]').fill("wrong-password");
        await page.getByRole("button", { name: /sign in/i }).click();

        // First auth POST can trigger a cold compile of the NextAuth route +
        // a remote-pooler round trip — allow generous headroom.
        await expect(page.getByText("Invalid email or password")).toBeVisible({
            timeout: 60_000,
        });
        // Still on the login page — no redirect happened.
        await expect(page).toHaveURL(/\/staff\/login/);
    });

    test("logs in with the env super-admin and lands in the office", async ({ page }) => {
        // Super-admin authenticates without a DB lookup, so this passes even on
        // a freshly reset database. staffLogin passes an explicit callbackUrl to
        // STAFF_HOME (/office) — a lighter landing than the built-in default
        // (/office/core/assignments) for fast, deterministic post-login render.
        await staffLogin(page, SUPER_ADMIN);
        await expect(page).toHaveURL(new RegExp(STAFF_HOME.replace(/\//g, "\\/")));
    });
});
