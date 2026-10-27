import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { saveGoogleConnection } from "@/modules/campaigns/lib/googleBusiness";
import { staffName } from "@/modules/campaigns/lib/postServer";
import { requireGoogleConnect } from "@/modules/campaigns/lib/campaignAccess";
import { GOOGLE_STATE_COOKIE } from "@/modules/campaigns/lib/googleOAuthState";

export const dynamic = "force-dynamic";

/**
 * GET /api/campaigns/google/callback?code&state — Google sends the browser
 * back here after Allow. Saves the connection and returns to Channels, which
 * then asks which listing to post to. Always on the office site: that is the
 * redirect URL the OAuth client allows.
 */
export async function GET(req: Request) {
    const { user, response } = await requireGoogleConnect();
    if (response) return response;

    const url = new URL(req.url);
    const back = (msg: string) => {
        const res = NextResponse.redirect(new URL(`/office/campaigns/channels?google=${encodeURIComponent(msg)}`, req.url));
        res.cookies.delete({ name: GOOGLE_STATE_COOKIE, path: "/api/campaigns/google" });
        return res;
    };

    const denied = url.searchParams.get("error");
    if (denied) return back(denied === "access_denied" ? "Google access was not allowed." : `Google: ${denied}`);

    const state = url.searchParams.get("state") ?? "";
    const saved = (await cookies()).get(GOOGLE_STATE_COOKIE)?.value ?? "";
    const same = state.length > 0 && state.length === saved.length && crypto.timingSafeEqual(Buffer.from(state), Buffer.from(saved));
    if (!same) return back("The sign-in expired or was started elsewhere — press Connect again on the office website.");

    const code = url.searchParams.get("code");
    if (!code) return back("Google sent no sign-in code.");
    try {
        const error = await saveGoogleConnection(code, { id: user.id, name: await staffName(user.id) });
        return back(error ?? "connected");
    } catch (e) {
        console.error("[google] connect failed", e);
        return back("Could not save the Google connection.");
    }
}
