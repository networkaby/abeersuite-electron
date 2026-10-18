import { NextResponse, after } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { parseIdParam } from "@/shared/lib/api";
import { hasPermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { isPushConfigured } from "@/shared/lib/push/sendPush";
import { requireCampaignsPage } from "@/modules/campaigns/lib/campaignAccess";
import { sendCampaign } from "@/modules/campaigns/lib/sendCampaign";

/**
 * POST /api/campaigns/:id/send — send it to every customer with notifications
 * on. Needs `campaigns:send` (it reaches everyone at once). The campaign is
 * marked SENT first, in one guarded update, so a double click or two staff
 * pressing together send it once; the pushes go out after the response.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireCampaignsPage();
    if (response) return response;
    if (!hasPermission(user, PERMISSIONS.CAMPAIGNS_SEND)) {
        return NextResponse.json({ error: "You do not have the Send campaigns tick." }, { status: 403 });
    }
    const { id, error } = await parseIdParam(params);
    if (error) return error;

    // A counter PC has no push keys — sending belongs to the office site.
    if (!isPushConfigured()) {
        return NextResponse.json({ error: "Notifications are not set up on this server. Send from the office site." }, { status: 503 });
    }

    const { count } = await prisma.campaign.updateMany({
        where: { id, status: { not: "SENT" }, channel: "PUSH" },
        data: { status: "SENT", sentAt: new Date() },
    });
    if (count === 0) {
        const exists = await prisma.campaign.findUnique({ where: { id }, select: { id: true } });
        return exists
            ? NextResponse.json({ error: "This campaign was already sent." }, { status: 409 })
            : NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    after(() => sendCampaign(id));
    return NextResponse.json({ ok: true });
}
