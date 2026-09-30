import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

// Pricing Strategy → Group pricing. Each customer group's price list (one
// rule per product group: MRP / print price / profit sharing / revenue
// discount) and its benefit ticks — see groupPricing.ts. POS only.
//
// GET → every customer group with its rules + member count, and the product
//       group tree the rule picker draws from (one read for the whole page).

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const [groups, productGroups] = await Promise.all([
            prisma.customerGroup.findMany({
                orderBy: { name: "asc" },
                select: {
                    id: true, name: true, isActive: true,
                    allowTierDiscount: true, allowCoupons: true, allowLoyalty: true,
                    priceRules: { select: { productGroupId: true, priceType: true, pct: true } },
                    _count: { select: { persons: true, companies: true } },
                },
            }),
            prisma.invProductGroup.findMany({
                orderBy: { name: "asc" },
                select: { id: true, name: true, parentId: true, isActive: true },
            }),
        ]);
        return NextResponse.json({
            groups: groups.map((g) => ({
                id: g.id,
                name: g.name,
                isActive: g.isActive,
                allowTierDiscount: g.allowTierDiscount,
                allowCoupons: g.allowCoupons,
                allowLoyalty: g.allowLoyalty,
                members: g._count.persons + g._count.companies,
                rules: g.priceRules.map((r) => ({
                    productGroupId: r.productGroupId,
                    priceType: r.priceType,
                    pct: r.pct == null ? null : Number(r.pct),
                })),
            })),
            productGroups,
        });
    } catch (e) {
        return handleApiError(e, "Failed to load group pricing");
    }
}
