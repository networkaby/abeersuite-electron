import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { pricingItemUpdateSchema } from "@/shared/lib/schemas/pricingSchemas";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireModuleAccess("pricing-strategy");
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id) || id <= 0) {
            return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        }
        const { data, error } = await validateRequest(req, pricingItemUpdateSchema);
        if (error) return error;

        // Enforce MRP cap on manual price entries. If MRP is set on the product
        // and the caller is trying to write a higher effectiveSalePricePaise, refuse.
        if (data.effectiveSalePricePaise != null && data.effectiveSalePricePaise > 0) {
            const existing = await prisma.invProduct.findUnique({
                where:  { id },
                select: { mrpPaise: true },
            });
            if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
            if (existing.mrpPaise != null && existing.mrpPaise > 0 && data.effectiveSalePricePaise > existing.mrpPaise) {
                return NextResponse.json(
                    {
                        error: `Manual price (₹${(data.effectiveSalePricePaise / 100).toFixed(2)}) exceeds MRP (₹${(existing.mrpPaise / 100).toFixed(2)}). Sell price cannot be above MRP.`,
                    },
                    { status: 400 },
                );
            }
        }

        // Setting effectiveSalePricePaise explicitly flips priceOverridden=true unless the
        // caller is explicitly clearing the override (priceOverridden=false).
        const overrideFlag =
            data.priceOverridden !== undefined
                ? data.priceOverridden
                : data.effectiveSalePricePaise !== undefined
                  ? true
                  : undefined;

        // openingRatePaise lands on two columns:
        //   • openingRate (Decimal rupees) — the Tally-style master entry
        //   • openingValue (Decimal rupees) — qty × rate, recomputed if qty known
        // PR 3 dropped the costPaise cache — cost is now derived from the
        // ledger walk (which picks up openingRate as a synthetic first lot).
        let openingPatch: Record<string, unknown> = {};
        if (data.openingRatePaise !== undefined) {
            const existing = await prisma.invProduct.findUnique({
                where:  { id },
                select: { openingStock: true },
            });
            if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
            const rateRupees = data.openingRatePaise != null ? data.openingRatePaise / 100 : null;
            const stock = existing.openingStock != null ? Number(existing.openingStock) : null;
            openingPatch = {
                openingRate:  rateRupees,
                openingValue: rateRupees != null && stock != null ? stock * rateRupees : null,
            };
        }

        const row = await prisma.invProduct.update({
            where: { id },
            data: {
                ...(data.costMethod      !== undefined ? { costMethod:    data.costMethod } : {}),
                ...(data.marginPercent   !== undefined ? { marginPercent: data.marginPercent != null ? data.marginPercent.toString() : null } : {}),
                ...(overrideFlag         !== undefined ? { priceOverridden: overrideFlag } : {}),
                ...(data.effectiveSalePricePaise      !== undefined ? { effectiveSalePricePaise:    data.effectiveSalePricePaise } : {}),
                ...(data.mrpPaise        !== undefined ? { mrpPaise:      data.mrpPaise } : {}),
                ...openingPatch,
            },
            select: {
                id:               true,
                costMethod:       true,
                marginPercent:    true,
                priceOverridden:  true,
                effectiveSalePricePaise:       true,
                mrpPaise:         true,
                openingRate:      true,
                openingStock:     true,
                openingValue:     true,
            },
        });
        // Margin %, cost method and MRP all feed the materialized
        // effectiveSalePricePaise (COMPUTED = cost × margin; STRATEGY = engine;
        // both MRP-capped). Re-materialize now so POS/shop reflect the edit
        // immediately instead of waiting for the next Save or voucher. Best-effort
        // — never fail the save on a recompute error (it heals on the next voucher).
        // priceOverridden / SAVED rows are skipped inside recompute.
        try {
            await recomputePricesForProducts([id]);
        } catch { /* best-effort; price heals on next voucher */ }

        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to update pricing item");
    }
}
