import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { whatsappWaiting } from "@/modules/campaigns/lib/postServer";

/**
 * GET /api/mobile/posts — the staff app's Posts screen: every post still waiting
 * for a WhatsApp channel (Channel / Status), due ones first, then the coming
 * ones, then those with no time. Google and the rest are shared from the office.
 */
export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.MOBILE_POSTS_SHARE);
    if (response) return response;
    return NextResponse.json({ posts: (await whatsappWaiting()).posts });
}
