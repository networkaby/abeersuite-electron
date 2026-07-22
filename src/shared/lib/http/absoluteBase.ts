// Absolute origin for building callback/return URLs from a request. Prefers an
// explicit env (NEXT_PUBLIC_APP_URL / APP_URL), else derives it from the request
// headers (proxy-aware). Shared by the gateway routes that hand PayU/Cashfree a
// surl/return_url.
export function absoluteBase(req: Request): string {
    const env = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
    if (env) return env.replace(/\/+$/u, "");
    const url = new URL(req.url);
    const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
    return `${proto}://${host}`;
}
