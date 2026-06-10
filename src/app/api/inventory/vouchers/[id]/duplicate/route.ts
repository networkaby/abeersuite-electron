import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { invNextRef } from "@/modules/inventory/lib/stock";

// POST /api/inventory/vouchers/[id]/duplicate
//
// Clones a voucher (header + lines) as a fresh DRAFT with a sequential
// invoice number from `invNextRef`. Lines copy product/qty/rate/discount/tax
// as-is so the user can re-post immediately or tweak first. Stock + GL are
// NOT moved — DRAFT vouchers don't post; the user must save/post in the
// edit page to make it real.
//
// Cancelled / soft-deleted sources are allowed (a "make a corrected copy"
// flow is normal). Hard-deleted sources 404 because the row is gone.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response, user } = await requireAuth();
    if (response) return response;

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    try {
        const source = await prisma.invVoucher.findUnique({
            where:   { id },
            include: { lines: true },
        });
        if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

        const created = await prisma.$transaction(async (tx) => {
            const reference = await invNextRef(tx, source.type, user!.id);
            const today = new Date();

            const voucher = await tx.invVoucher.create({
                data: {
                    type:             source.type,
                    reference,
                    branchId:         source.branchId,
                    date:             today,
                    description:      source.description,
                    status:           "DRAFT",
                    accountId:        source.accountId,
                    partyJson:        source.partyJson ?? Prisma.DbNull,
                    partyType:        source.partyType,
                    partyId:          source.partyId,
                    creditPeriodDays: source.creditPeriodDays,
                    placeOfSupply:    source.placeOfSupply,
                    discountPct:      source.discountPct,
                    discountAmt:      source.discountAmt,
                    shippingAmt:      source.shippingAmt,
                    roundOff:         source.roundOff,
                    subtotal:         source.subtotal,
                    taxAmount:        source.taxAmount,
                    totalAmount:      source.totalAmount,
                    showPrices:       source.showPrices,
                    // refNumber / refDate / refVoucherId intentionally null —
                    // a duplicate of a SALE is not a SALE_RETURN.
                    createdById:      user!.id,
                    lines: {
                        create: source.lines.map((l) => ({
                            productId:   l.productId,
                            description: l.description,
                            quantity:    l.quantity,
                            freeQty:     l.freeQty,
                            rate:        l.rate,
                            discountPct: l.discountPct,
                            discountAmt: l.discountAmt,
                            taxRate:     l.taxRate,
                            taxAmount:   l.taxAmount,
                            amount:      l.amount,
                        })),
                    },
                },
                select: { id: true, type: true, reference: true },
            });
            return voucher;
        });

        return NextResponse.json(created);
    } catch (e) {
        return handleApiError(e, "Failed to duplicate voucher");
    }
}
