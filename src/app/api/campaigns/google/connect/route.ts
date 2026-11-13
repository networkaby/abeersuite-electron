import { NextResponse } from "next/server";
import crypto from "crypto";
import { googleAuthUrl, googleSetupProblem } from "@/modules/campaigns/lib/googleBusiness";
import { requireGoogleConnect } from "@/modules/campaigns/lib/campaignAccess";
import { GOOGLE_STATE_COOKIE } from "@/modules/campaigns/lib/googleOAuthState";

export const dynamic = "force-dynamic";

/**
 * GET /api/campaigns/google/connect — sends the browser to Google's sign-in.
 * A random state rides a short cookie, and the callback must bring it back,
 * so nobody can hand us a sign-in they started themselves.
 */
export async function GET(req: Request) {
    const { response } = await requireGoogleConnect();
    if (response) return response;
    const problem = await googleSetupProblem();
    if (problem) return NextResponse.redirect(new URL(`/office/campaigns/channels?google=${encodeURIComponent(problem)}`, req.url));

    const state = crypto.randomBytes(24).toString("base64url");
    const res = NextResponse.redirect(await googleAuthUrl(state));
    res.cookies.set(GOOGLE_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/campaigns/google", maxAge: 600 });
    return res;
}
