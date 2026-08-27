import { test as setup, expect } from "@playwright/test";
import { staffLogin, admin } from "./helpers";

const AUTH_FILE = "e2e/.auth/admin.json";

/**
 * Logs in once as the seeded admin and persists the session to AUTH_FILE.
 * The "authed" project (e2e/tests/**) reuses this storage state, so individual
 * specs don't repeat the login.
 */
setup("authenticate as admin", async ({ page }) => {
    await staffLogin(page, admin);

    // Sanity: we landed somewhere under /office (not bounced back to login).
    await expect(page).toHaveURL(/\/office(\/|$)/);

    await page.context().storageState({ path: AUTH_FILE });
});
