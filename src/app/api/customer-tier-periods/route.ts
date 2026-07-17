import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requireAnyPermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { customerTierPeriodSchema } from "@/shared/lib/schemas/customerTierSchemas";

// GET /api/customer-tier-periods — every period with its levels nested, sorted.
// One call feeds the whole Spend Tiers page. Read-only to any authed user.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const periods = await prisma.customerTierPeriod.findMany({
            orderBy: [{ sortOrder: "asc" }, { fromDay: "asc" }],
            include: { levels: { orderBy: [{ sortOrder: "asc" }, { minSpend: "asc" }] } },
        });
        return NextResponse.json(periods);
    } catch (e) {
        return handleApiError(e, "Failed to fetch tier periods");
    }
}

// POST /api/customer-tier-periods — add a period. Every period runs the SAME ladder
// (Bronze/Silver/Gold/Platinum), so a new one is created with the existing period's
// levels copied in — the admin then just tunes the thresholds for the shorter or
// longer window. Nothing to copy (no period yet) → starts empty and the seed's
// starter levels apply.
export async function POST(req: Request) {
    const { response } = await requireAnyPermission(PERMISSIONS.TIERS_CREATE);
    if (response) return response;
    const { data, error } = await validateRequest(req, customerTierPeriodSchema);
    if (error) return error;
    try {
        // Default sortOrder to the end if not supplied (mirrors /api/customer-tiers).
        const sortOrder = data.sortOrder ?? ((await prisma.customerTierPeriod.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1;
        // The ladder to clone: the first period, which the seed creates.
        const template = await prisma.customerTierPeriod.findFirst({
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            include: { levels: { orderBy: [{ sortOrder: "asc" }, { minSpend: "asc" }] } },
        });
        const period = await prisma.customerTierPeriod.create({
            data: {
                name: data.name,
                fromDay: data.fromDay,
                toDay: data.toDay,
                currentSaleScope: data.currentSaleScope ?? "NONE",
                currentSaleOnly: data.currentSaleOnly ?? false,
                enabled: data.enabled ?? true,
                sortOrder,
                levels: {
                    create: (template?.levels ?? []).map((l) => ({
                        name:        l.name,
                        minSpend:    l.minSpend,
                        discountPct: l.discountPct,
                        enabled:     l.enabled,
                        sortOrder:   l.sortOrder,
                    })),
                },
            },
            include: { levels: { orderBy: [{ sortOrder: "asc" }, { minSpend: "asc" }] } },
        });
        return NextResponse.json(period, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create tier period");
    }
}
