import { NextResponse } from "next/server";
import crypto from "crypto";
import { facebookAuthUrl, facebookSetupProblem } from "@/modules/campaigns/lib/facebookPage";
import { requireFacebookConnect } from "@/modules/campaigns/lib/campaignAccess";
import { FACEBOOK_STATE_COOKIE } from "@/modules/campaigns/lib/facebookOAuthState";

export const dynamic = "force-dynamic";

/**
 * GET /api/campaigns/facebook/connect — sends the browser to Facebook's sign-in.
 * A random state rides a short cookie, and the callback must bring it back,
 * so nobody can hand us a sign-in they started themselves.
 */
export async function GET(req: Request) {
    const { response } = await requireFacebookConnect();
    if (response) return response;
    const problem = facebookSetupProblem();
    if (problem) return NextResponse.redirect(new URL(`/office/campaigns/channels?facebook=${encodeURIComponent(problem)}`, req.url));

    const state = crypto.randomBytes(24).toString("base64url");
    const res = NextResponse.redirect(facebookAuthUrl(state));
    res.cookies.set(FACEBOOK_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/campaigns/facebook", maxAge: 600 });
    return res;
}
