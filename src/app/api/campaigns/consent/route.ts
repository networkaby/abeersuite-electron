import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError } from "@/shared/lib/api";
import { hasPermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { requireConsentEdit, requireConsentPage } from "@/modules/campaigns/lib/campaignAccess";

/**
 * GET    /api/campaigns/consent?q=&page= — the email unsubscribe list (newest
 *        first, 50 a page, searched by address) and how many customers have app
 *        notifications on. WhatsApp STOP is not recorded yet.
 * DELETE /api/campaigns/consent?email= — take an address off the list, when the
 *        customer asks for offer emails again (`campaigns:consent:edit`).
 */

const PAGE = 50;

export async function GET(req: Request) {
    const { user, response } = await requireConsentPage();
    if (response) return response;

    const params = new URL(req.url).searchParams;
    const q = params.get("q")?.trim().toLowerCase() ?? "";
    const page = Math.max(0, Number(params.get("page")) || 0);
    const where = q ? { email: { contains: q } } : {};

    const [emails, emailTotal, pushCustomers, pushDevices] = await Promise.all([
        prisma.emailOptOut.findMany({ where, orderBy: { createdAt: "desc" }, skip: page * PAGE, take: PAGE }),
        prisma.emailOptOut.count({ where }),
        prisma.pushSubscription.groupBy({ by: ["personId"] }).then((r) => r.length),
        prisma.pushSubscription.count(),
    ]);
    return NextResponse.json(
        { emails, emailTotal, pageSize: PAGE, push: { customers: pushCustomers, devices: pushDevices }, canEdit: hasPermission(user, PERMISSIONS.CAMPAIGNS_CONSENT_EDIT) },
        { headers: { "Cache-Control": "private, max-age=60" } },
    );
}

export async function DELETE(req: Request) {
    const { response } = await requireConsentEdit();
    if (response) return response;

    const email = new URL(req.url).searchParams.get("email")?.trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "Which email?" }, { status: 400 });
    try {
        await prisma.emailOptOut.deleteMany({ where: { email } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to re-subscribe the email");
    }
}
