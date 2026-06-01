import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { loyaltyAdjustSchema } from "@/shared/lib/schemas/loyaltySchemas";
import { adjustPoints, ratesFromConfig } from "@/modules/loyalty/lib";

// POST /api/loyalty/adjust — manual point grant / deduction by an admin.
export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.LOYALTY_MANAGE);
    if (response) return response;

    const { data, error } = await validateRequest(req, loyaltyAdjustSchema);
    if (error) return error;

    // Guard: the target account must exist (and not be a pure-GL ledger).
    const account = await prisma.account.findUnique({
        where: { id: data.accountId },
        select: { id: true, personId: true, companyId: true },
    });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    if (account.personId == null && account.companyId == null) {
        return NextResponse.json({ error: "Loyalty applies only to customer accounts." }, { status: 422 });
    }

    const cfg = await prisma.loyaltyConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });

    try {
        const result = await prisma.$transaction((tx) =>
            adjustPoints(tx, {
                accountId:   data.accountId,
                delta:       data.delta,
                note:        data.note ?? null,
                createdById: user!.id,
                rates:       ratesFromConfig(cfg),
            }),
        );
        return NextResponse.json(result);
    } catch (e) {
        if (e instanceof Error && e.message.includes("negative")) {
            return NextResponse.json({ error: e.message }, { status: 422 });
        }
        return handleApiError(e, "Failed to adjust loyalty points");
    }
}
