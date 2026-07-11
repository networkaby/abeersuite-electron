import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requireAnyPermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { customerTierSchema } from "@/shared/lib/schemas/customerTierSchemas";

// GET /api/customer-tiers — all spend-tier rows (sorted). Read-only to any authed
// user (POS reads it via the snapshot too); edits require tiers:create / tiers:manage.
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

// POST /api/customer-tiers — add a tier.
export async function POST(req: Request) {
    const { response } = await requireAnyPermission(PERMISSIONS.TIERS_CREATE);
    if (response) return response;
    const { data, error } = await validateRequest(req, customerTierSchema);
    if (error) return error;
    try {
        // Default sortOrder to the end if not supplied.
        const sortOrder = data.sortOrder ?? ((await prisma.customerTier.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1;
        const tier = await prisma.customerTier.create({
            data: { name: data.name, minSpend: data.minSpend, discountPct: data.discountPct, enabled: data.enabled ?? true, sortOrder },
        });
        return NextResponse.json(tier, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create customer tier");
    }
}
