import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { saveFacebookConnection } from "@/modules/campaigns/lib/facebookPage";
import { staffName } from "@/modules/campaigns/lib/postServer";
import { requireFacebookConnect } from "@/modules/campaigns/lib/campaignAccess";
import { FACEBOOK_STATE_COOKIE } from "@/modules/campaigns/lib/facebookOAuthState";

export const dynamic = "force-dynamic";

/**
 * GET /api/campaigns/facebook/callback?code&state — Facebook sends the browser
 * back here after Allow. Saves the connection and returns to Channels, which
 * then asks which page to post to. Always on the office site: that is the
 * redirect URL the Meta app allows.
 */
export async function GET(req: Request) {
    const { user, response } = await requireFacebookConnect();
    if (response) return response;

    const url = new URL(req.url);
    const back = (msg: string) => {
        const res = NextResponse.redirect(new URL(`/office/campaigns/channels?facebook=${encodeURIComponent(msg)}`, req.url));
        res.cookies.delete({ name: FACEBOOK_STATE_COOKIE, path: "/api/campaigns/facebook" });
        return res;
    };

    const denied = url.searchParams.get("error");
    if (denied) return back(denied === "access_denied" ? "Facebook access was not allowed." : `Facebook: ${url.searchParams.get("error_description") || denied}`);

    const state = url.searchParams.get("state") ?? "";
    const saved = (await cookies()).get(FACEBOOK_STATE_COOKIE)?.value ?? "";
    const same = state.length > 0 && state.length === saved.length && crypto.timingSafeEqual(Buffer.from(state), Buffer.from(saved));
    if (!same) return back("The sign-in expired or was started elsewhere — press Connect again on the office website.");

    const code = url.searchParams.get("code");
    if (!code) return back("Facebook sent no sign-in code.");
    try {
        const error = await saveFacebookConnection(code, { id: user.id, name: await staffName(user.id) });
        return back(error ?? "connected");
    } catch (e) {
        console.error("[facebook] connect failed", e);
        return back("Could not save the Facebook connection.");
    }
}
