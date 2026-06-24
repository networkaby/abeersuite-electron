import type { FullConfig } from "@playwright/test";

/**
 * App-identity guard. Runs once before any project.
 *
 * `reuseExistingServer` means Playwright will attach to whatever is already
 * listening on :3000 — including a DIFFERENT project's dev server. That silently
 * runs the whole suite against the wrong app (this exact thing once made
 * /office/work-flow-inbox look like a 404 when it was really a foreign server
 * responding). This check fails the run loudly instead.
 *
 * Signal: /api/auth/providers is unauthenticated and lists this app's NextAuth
 * providers — `credentials-staff` / `credentials-portal` are specific to this
 * project, so their presence confirms we're talking to the right server.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
    const base = process.env.E2E_BASE_URL || "http://localhost:3000";
    const url = `${base}/api/auth/providers`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);

    let body = "";
    try {
        const res = await fetch(url, { signal: controller.signal });
        body = await res.text();
    } catch (err) {
        throw new Error(
            `E2E identity check: could not reach ${url}. Is the dev server up on ${base}? (${String(err)})`,
        );
    } finally {
        clearTimeout(timer);
    }

    if (!body.includes("credentials-staff")) {
        throw new Error(
            `E2E identity check FAILED: the app serving ${base} is not service-mgmt ` +
                `(no "credentials-staff" provider at /api/auth/providers).\n` +
                `Another project's dev server is probably running on this port — ` +
                `stop it (or free port 3000) and re-run.`,
        );
    }
}
