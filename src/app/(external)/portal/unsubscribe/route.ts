import { checkUnsubscribeToken, optOut } from "@/shared/lib/email/unsubscribe";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";

export const dynamic = "force-dynamic";

/**
 * /portal/unsubscribe?e=<email>&t=<signature> — the link at the foot of every
 * marketing email. GET (a click) and POST (Gmail / Outlook one-click, from the
 * List-Unsubscribe header) both opt the address out. No sign-in: the signature
 * proves the link came from us for that address.
 */
async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const email = url.searchParams.get("e") ?? "";
    const token = url.searchParams.get("t") ?? "";
    const ok = !!email && !!token && checkUnsubscribeToken(email, token);
    if (ok) await optOut(email);
    const shop = getOrganisation().brandName;
    const msg = ok
        ? `You are unsubscribed. ${shop} will not send you offers or cart reminders any more. Bills, receipts and repair updates still come by email.`
        : "This unsubscribe link is not valid.";
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head><body style="font-family:Arial,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#111"><h1 style="font-size:20px">${ok ? "Unsubscribed" : "Link not valid"}</h1><p>${msg.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p></body></html>`;
    return new Response(html, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export const GET = handle;
export const POST = handle;
