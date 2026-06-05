import { expect, type Page } from "@playwright/test";

/**
 * Shared E2E helpers + credentials.
 *
 * Credentials are read from env first (so CI can override) and fall back to the
 * seeded demo accounts. These fallbacks are DEMO passwords that the seed resets
 * on every run (`ensureDemoUsers()` in bootstrap-seed.ts) — safe to keep here.
 */
export const STAFF = {
    email: process.env.E2E_STAFF_EMAIL || "admin@networkservice.in",
    password: process.env.E2E_STAFF_PASSWORD || "admin123",
};

/** Env super-admin — works even against a wiped DB (no DB lookup on login). */
export const SUPER_ADMIN = {
    email: process.env.SUPER_ADMIN_EMAIL || "superadmin@networkservice.in",
    password: process.env.SUPER_ADMIN_PASSWORD || "superadmin123",
};

/**
 * Where we send staff after login. The login page's built-in default is
 * `/office/core/assignments` (the assignments dashboard — it exists under the
 * `(to-do)` route group). We override it to `/office`, a lighter landing, so the
 * post-login render is fast and deterministic in tests.
 */
export const STAFF_HOME = "/office";

/**
 * Drive the staff login form at /staff/login and wait until authenticated.
 *
 * We wait on the NextAuth callback response (which sets the session cookie)
 * rather than the post-login redirect, so the helper doesn't depend on the
 * heavy office-page compile finishing. Navigation is resolved on "commit" (URL
 * change) for the same reason.
 */
export async function staffLogin(
    page: Page,
    creds: { email: string; password: string } = STAFF,
): Promise<void> {
    await page.goto(`/staff/login?callbackUrl=${encodeURIComponent(STAFF_HOME)}`);
    await expect(page.getByText("Service Management")).toBeVisible();

    // The shadcn <Label>s aren't linked to their inputs (no htmlFor), so target
    // the inputs by type — both are unique on the staff login page.
    await page.locator('input[type="email"]').fill(creds.email);
    await page.locator('input[type="password"]').fill(creds.password);

    const callback = page.waitForResponse(
        (r) => r.url().includes("/api/auth/callback/credentials-staff"),
        { timeout: 90_000 },
    );
    await page.getByRole("button", { name: /sign in/i }).click();
    await callback; // session cookie is now set

    // URL leaves /staff/login → lands on STAFF_HOME. Resolve on commit so we
    // don't block on the heavy office-page first-compile.
    await page.waitForURL((url) => !url.pathname.startsWith("/staff/login"), {
        timeout: 90_000,
        waitUntil: "commit",
    });
}
