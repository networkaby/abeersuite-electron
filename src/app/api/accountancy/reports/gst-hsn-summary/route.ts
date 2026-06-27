import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { parseRange } from "@/modules/accountancy/lib/period";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// GET /api/accountancy/reports/gst-hsn-summary?from=YYYY-MM-DD&to=YYYY-MM-DD&direction=OUTWARD|INWARD
// HSN-wise rollup of posted inventory voucher lines. Lines whose product has
// no HSN code fall into a "(no HSN)" bucket so the user notices the gap.
export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const direction = searchParams.get("direction") === "INWARD" ? "INWARD" : "OUTWARD";
    const { from, to } = parseRange(searchParams);

    const invType = direction === "OUTWARD" ? "SALE" : "PURCHASE";

    try {
        const lines = await prisma.voucherInventoryLine.findMany({
            where: {
                // Phase 5 5C: goods lines hang off the spine (type/status/date on it).
                universalVoucher: {
                    type:      invType,
                    status:    "POSTED",
                    deletedAt: null,
                    date:      { gte: from, lte: to },
                },
            },
            select: {
                quantity:  true,
                taxRate:   true,
                taxAmount: true,
                amount:    true,
                universalVoucherId: true,
                product:   { select: { hsnCode: true, name: true } },
            },
        });

        type Bucket = {
            hsn:          string;
            taxRate:      number;
            taxableValue: number;
            taxAmount:    number;
            grossValue:   number;
            quantity:     number;
            sampleNames:  Set<string>;
            invoices:     Set<number>;
        };
        const map = new Map<string, Bucket>();

        for (const l of lines) {
            const hsn  = l.product.hsnCode?.trim() || "(no HSN)";
            const rate = Number(l.taxRate ?? 0);
            const key  = `${hsn}|${rate.toFixed(2)}`;
            if (!map.has(key)) {
                map.set(key, {
                    hsn, taxRate: rate,
                    taxableValue: 0, taxAmount: 0, grossValue: 0,
                    quantity: 0,
                    sampleNames: new Set(),
                    invoices:    new Set(),
                });
            }
            const b = map.get(key)!;
            const taxable = Number(l.amount) - Number(l.taxAmount);
            b.taxableValue += taxable;
            b.taxAmount    += Number(l.taxAmount);
            b.grossValue   += Number(l.amount);
            b.quantity     += Number(l.quantity);
            b.invoices.add(l.universalVoucherId);
            if (b.sampleNames.size < 3 && l.product.name) b.sampleNames.add(l.product.name);
        }

        const buckets = Array.from(map.values())
            .map((b) => ({
                hsn:          b.hsn,
                taxRate:      b.taxRate,
                taxableValue: b.taxableValue,
                taxAmount:    b.taxAmount,
                grossValue:   b.grossValue,
                quantity:     b.quantity,
                sampleNames:  Array.from(b.sampleNames),
                invoiceCount: b.invoices.size,
            }))
            .sort((a, b) => {
                if (a.hsn === "(no HSN)") return 1;
                if (b.hsn === "(no HSN)") return -1;
                return a.hsn.localeCompare(b.hsn) || a.taxRate - b.taxRate;
            });

        const totals = buckets.reduce(
            (s, b) => ({
                taxableValue: s.taxableValue + b.taxableValue,
                taxAmount:    s.taxAmount    + b.taxAmount,
                grossValue:   s.grossValue   + b.grossValue,
                quantity:     s.quantity     + b.quantity,
            }),
            { taxableValue: 0, taxAmount: 0, grossValue: 0, quantity: 0 },
        );

        const noHsnCount = buckets
            .filter((b) => b.hsn === "(no HSN)")
            .reduce((s, b) => s + b.invoiceCount, 0);

        return NextResponse.json({
            from: from.toISOString(),
            to:   to.toISOString(),
            direction, invType,
            buckets, totals, noHsnCount,
        });
    } catch (e) {
        return handleApiError(e, "Failed to compute HSN summary");
    }
}
