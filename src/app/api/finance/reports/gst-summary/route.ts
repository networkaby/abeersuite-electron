import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { parseRange } from "@/modules/accountancy/lib/period";
import { handleApiError } from "@/shared/lib/api";

// GET /api/finance/reports/gst-summary?from=YYYY-MM-DD&to=YYYY-MM-DD&direction=OUTWARD|INWARD
//   OUTWARD = SALE  (output tax, what you collected from customers)
//   INWARD  = PURCHASE (input tax, your ITC)
//
// Aggregates inventory-voucher lines by tax rate. Once GSTIN/HSN fields are
// added to InvProduct + Customer/Company we can break this down further by
// HSN and party type — for now rate-wise is the daily-useful summary.
export async function GET(req: Request) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const direction = searchParams.get("direction") === "INWARD" ? "INWARD" : "OUTWARD";
    const { from, to } = parseRange(searchParams);

    const invType = direction === "OUTWARD" ? "SALE" : "PURCHASE";

    try {
        const lines = await prisma.invVoucherLine.findMany({
            where: {
                voucher: {
                    type:      invType,
                    status:    "POSTED",
                    deletedAt: null,
                    date:      { gte: from, lte: to },
                },
            },
            select: {
                taxRate:   true,
                taxAmount: true,
                amount:    true,
                quantity:  true,
                rate:      true,
                discountAmt: true,
                voucher:   { select: { id: true, reference: true, date: true, totalAmount: true } },
            },
        });

        // Bucket by tax rate
        type Bucket = {
            rate:         number;
            taxableValue: number;   // (qty × rate) − discount, before tax
            taxAmount:    number;
            grossValue:   number;   // taxable + tax
            invoices:     Set<number>;
        };
        const map = new Map<number, Bucket>();
        for (const l of lines) {
            const rate    = Number(l.taxRate ?? 0);
            const taxable = Number(l.amount) - Number(l.taxAmount); // amount is taxable+tax in this schema
            const tax     = Number(l.taxAmount);
            if (!map.has(rate)) {
                map.set(rate, { rate, taxableValue: 0, taxAmount: 0, grossValue: 0, invoices: new Set() });
            }
            const b = map.get(rate)!;
            b.taxableValue += taxable;
            b.taxAmount    += tax;
            b.grossValue   += Number(l.amount);
            b.invoices.add(l.voucher.id);
        }

        const buckets = Array.from(map.values())
            .map((b) => ({
                rate:          b.rate,
                taxableValue:  b.taxableValue,
                taxAmount:     b.taxAmount,
                grossValue:    b.grossValue,
                invoiceCount:  b.invoices.size,
            }))
            .sort((a, b) => a.rate - b.rate);

        const totals = buckets.reduce(
            (s, b) => ({
                taxableValue: s.taxableValue + b.taxableValue,
                taxAmount:    s.taxAmount    + b.taxAmount,
                grossValue:   s.grossValue   + b.grossValue,
                invoiceCount: s.invoiceCount + b.invoiceCount,
            }),
            { taxableValue: 0, taxAmount: 0, grossValue: 0, invoiceCount: 0 },
        );

        return NextResponse.json({
            from: from.toISOString(),
            to:   to.toISOString(),
            direction, invType,
            buckets, totals,
        });
    } catch (e) {
        return handleApiError(e, "Failed to compute GST summary");
    }
}
