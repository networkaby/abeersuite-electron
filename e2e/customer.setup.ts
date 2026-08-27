import { test as setup, expect } from "@playwright/test";
import { customerLogin, CUSTOMER, CUSTOMER_HOME } from "./helpers";

const AUTH_FILE = "e2e/.auth/customer.json";

/**
 * Logs in once as the seeded portal customer and persists the session to
 * AUTH_FILE. The "customer" project (e2e/tests-customer/**) reuses this
 * storage state, so individual specs don't repeat the login.
 */
setup("authenticate as customer", async ({ page }) => {
    await customerLogin(page, CUSTOMER);

    await expect(page).toHaveURL(new RegExp(CUSTOMER_HOME.replace(/\//g, "\\/")));

    await page.context().storageState({ path: AUTH_FILE });
});
