import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { resolveAccountId } from "@/modules/crm/lib/customerTimeline";
import { refreshStageSchema } from "@/shared/lib/schemas/reconnectSchema";

const SALE_TYPES = ["SALE", "POS", "ONLINE_INVOICE"] as const;

// POST /api/crm/reconnect/refresh-stage
// Rechecks a customer's real record — any posted sale or repair — and bumps a
// Lead/Prospect straight to Customer. Never downgrades, never touches Inactive
// (that's a deliberate staff call). One-click fix for imported contacts that
// were already transacting before Reconnect existed.
export async function POST(req: Request) {
    const { response } = await requireModuleAccess("crm");
    if (response) return response;
    const { data, error } = await validateRequest(req, refreshStageSchema);
    if (error) return error;

    try {
        const ref = data.personId != null
            ? { kind: "person" as const, id: data.personId }
            : { kind: "company" as const, id: data.companyId! };

        const current = data.personId != null
            ? await prisma.person.findUnique({ where: { id: data.personId }, select: { lifecycleStage: true } })
            : await prisma.company.findUnique({ where: { id: data.companyId! }, select: { lifecycleStage: true } });
        if (!current) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

        if (current.lifecycleStage !== "LEAD" && current.lifecycleStage !== "PROSPECT") {
            return NextResponse.json({ lifecycleStage: current.lifecycleStage, changed: false });
        }

        const accountId = await resolveAccountId(ref);
        const hasTransacted = accountId != null && (await Promise.all([
            prisma.universalVoucher.findFirst({
                where: { partyAccountId: accountId, status: "POSTED", type: { in: [...SALE_TYPES] } },
                select: { id: true },
            }),
            prisma.ticket.findFirst({ where: { accountId, repair: { isNot: null } }, select: { id: true } }),
        ])).some(Boolean);

        if (!hasTransacted) {
            return NextResponse.json({ lifecycleStage: current.lifecycleStage, changed: false });
        }

        if (data.personId != null) {
            await prisma.person.update({ where: { id: data.personId }, data: { lifecycleStage: "CUSTOMER" } });
        } else {
            await prisma.company.update({ where: { id: data.companyId! }, data: { lifecycleStage: "CUSTOMER" } });
        }
        return NextResponse.json({ lifecycleStage: "CUSTOMER", changed: true });
    } catch (e) {
        return handleApiError(e, "Failed to refresh stage");
    }
}
