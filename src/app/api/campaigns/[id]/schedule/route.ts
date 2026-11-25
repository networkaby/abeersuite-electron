import { NextResponse } from "next/server";
import { prisma, prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { hasPermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { CAMPAIGN_SELECT, campaignScheduleSchema, scheduleTimeError } from "@/modules/campaigns/lib/campaign";
import { requireCampaignsPage } from "@/modules/campaigns/lib/campaignAccess";

/**
 * POST /api/campaigns/:id/schedule — { at: ISO } puts the campaign on the schedule
 * (or moves its time); { at: null } takes it off, back to Ready. The 30-minute
 * communications job sends it at the first run on or after `at`
 * (runScheduledCampaigns). Needs `campaigns:send`, like Send now.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireCampaignsPage();
    if (response) return response;
    if (!hasPermission(user, PERMISSIONS.CAMPAIGNS_SEND)) {
        return NextResponse.json({ error: "You do not have the Send campaigns tick." }, { status: 403 });
    }
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;
    const { data, error } = await validateRequest(req, campaignScheduleSchema);
    if (error) return error;

    const at = data.at ? new Date(data.at) : null;
    if (at) {
        const bad = scheduleTimeError(at);
        if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    }

    try {
        const { count } = await prisma.campaign.updateMany({
            where: at ? { id, status: { not: "SENT" }, channel: "PUSH" } : { id, status: "SCHEDULED" },
            data: at ? { status: "SCHEDULED", scheduledAt: at } : { status: "READY", scheduledAt: null },
        });
        if (count === 0) {
            const row = await prismaWhereSaved().campaign.findUnique({ where: { id }, select: { status: true } });
            if (!row) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
            return NextResponse.json(
                { error: row.status === "SENT" ? "This campaign was already sent." : "This campaign is not scheduled." },
                { status: 409 },
            );
        }
        return NextResponse.json(await prismaWhereSaved().campaign.findUnique({ where: { id }, select: CAMPAIGN_SELECT }));
    } catch (e) {
        return handleApiError(e, "Failed to schedule the campaign");
    }
}
