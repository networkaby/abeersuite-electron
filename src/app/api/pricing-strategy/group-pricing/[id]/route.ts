import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { GROUP_PRICE_TYPES, pctPriceType } from "@/modules/pricing-strategy/lib/groupPricing";

// PUT /api/pricing-strategy/group-pricing/[id] — replace one customer group's
// benefit ticks and whole price list in one go (the page saves the group as a
// unit). The CustomerGroup row is always written, so its updatedAt moves and
// the counters' replica re-pulls the group together with its rules.

const ruleSchema = z.object({
    /** null = the "All items" row. */
    productGroupId: z.number().int().positive().nullable(),
    priceType: z.enum(GROUP_PRICE_TYPES),
    pct: z.number().min(0).max(100).nullable(),
});

const saveSchema = z.object({
    allowTierDiscount: z.boolean(),
    allowCoupons: z.boolean(),
    allowLoyalty: z.boolean(),
    rules: z.array(ruleSchema).max(500),
}).superRefine((d, ctx) => {
    const seen = new Set<string>();
    d.rules.forEach((r, i) => {
        const key = String(r.productGroupId);
        if (seen.has(key)) {
            ctx.addIssue({ code: "custom", path: ["rules", i, "productGroupId"], message: r.productGroupId == null ? "Only one All items row" : "That product group already has a rule" });
        }
        seen.add(key);
        if (pctPriceType(r.priceType) && !(r.pct != null && r.pct > 0)) {
            ctx.addIssue({ code: "custom", path: ["rules", i, "pct"], message: "Give the % (more than 0)" });
        }
    });
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireModuleAccess("pricing-strategy");
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isInteger(id) || id <= 0) {
            return NextResponse.json({ error: "Invalid group id" }, { status: 400 });
        }
        const { data, error } = await validateRequest(req, saveSchema);
        if (error) return error;

        const exists = await prisma.customerGroup.findUnique({ where: { id }, select: { id: true } });
        if (!exists) return NextResponse.json({ error: "Customer group not found" }, { status: 404 });

        await prisma.$transaction([
            prisma.customerGroup.update({
                where: { id },
                data: {
                    allowTierDiscount: data.allowTierDiscount,
                    allowCoupons: data.allowCoupons,
                    allowLoyalty: data.allowLoyalty,
                    // Explicit, so a save that changes only the rules still moves it.
                    updatedAt: new Date(),
                },
            }),
            prisma.customerGroupPriceRule.deleteMany({ where: { customerGroupId: id } }),
            prisma.customerGroupPriceRule.createMany({
                data: data.rules.map((r) => ({
                    customerGroupId: id,
                    productGroupId: r.productGroupId,
                    priceType: r.priceType,
                    pct: pctPriceType(r.priceType) ? r.pct : null,
                })),
            }),
        ]);
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to save group pricing");
    }
}
