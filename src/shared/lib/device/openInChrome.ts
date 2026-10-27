/**
 * A link to our own site that the Android app hands to Chrome instead of opening
 * inside itself — for the update and install pages, since the app's WebView
 * cannot download a file.
 *
 * Capacitor keeps a link inside the app only when BOTH its host and its scheme
 * match the app's (Bridge.launchIntent); anything else goes to Chrome. So the
 * link is written as plain `http://` on the same host: Chrome opens it, and
 * Vercel's 308 moves it to https. The apps claim only `https` links
 * (AndroidManifest App Links), so the http link never bounces back into them.
 *
 * Replaces the trailing-dot host (`shop.networkservice.in./app`), which Chrome
 * refuses outright — ERR_CONNECTION_CLOSED, the "stuck loading" update (2026-10-27).
 */
export function chromeLinkTo(site: string, path: string): string {
    return `${site.replace(/^https:/, "http:")}${path}`;
}
