import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requireAnyPermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { customerTierSchema } from "@/shared/lib/schemas/customerTierSchemas";

// GET /api/customer-tiers — all level rows (sorted, flat across periods). The Spend
// Tiers page reads levels nested under their period via /api/customer-tier-periods;
// this stays for any caller wanting the flat list. Read-only to any authed user.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const tiers = await prisma.customerTier.findMany({ orderBy: [{ sortOrder: "asc" }, { minSpend: "asc" }] });
        return NextResponse.json(tiers);
    } catch (e) {
        return handleApiError(e, "Failed to fetch customer tiers");
    }
}

// POST /api/customer-tiers — add a level inside a period.
export async function POST(req: Request) {
    const { response } = await requireAnyPermission(PERMISSIONS.TIERS_CREATE);
    if (response) return response;
    const { data, error } = await validateRequest(req, customerTierSchema);
    if (error) return error;
    try {
        // sortOrder counts within the period, so a new level lands at the end of its
        // own period rather than the end of the whole table.
        const sortOrder = data.sortOrder ?? ((await prisma.customerTier.aggregate({ where: { periodId: data.periodId }, _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1;
        const tier = await prisma.customerTier.create({
            data: { name: data.name, minSpend: data.minSpend, discountPct: data.discountPct, enabled: data.enabled ?? true, sortOrder, periodId: data.periodId },
        });
        return NextResponse.json(tier, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create customer tier");
    }
}
