import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { invNextRef } from "@/modules/inventory/lib/stock";
import { engineCreateSpine } from "@/modules/accountancy/lib/transactionEngine";

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
            where: { id },
            include: { universalVoucher: { select: { partyAccountId: true, description: true } } },   // 5D-4 party + 5D-5 description on spine
        });
        if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });
        // Phase 5 5C: source goods lines hang off the source's spine.
        const sourceLines = await prisma.voucherInventoryLine.findMany({
            where: { universalVoucherId: source.universalVoucherId ?? -1 },
        });

        const created = await prisma.$transaction(async (tx) => {
            const reference = await invNextRef(tx, source.type, user!.id);
            const today = new Date();

            // Phase 5 5.0c/5C: spine FIRST (the document anchor) — the duplicate is
            // a fresh DRAFT; POST attaches its GL lines + flips it.
            const spineId = await engineCreateSpine(tx, {
                type:           source.type,
                date:           today,
                description:    source.universalVoucher?.description ?? source.type,
                voucherNo:    reference,
                partyAccountId: source.universalVoucher?.partyAccountId ?? null,
                userId:         user!.id,
            });
            const voucher = await tx.invVoucher.create({
                data: {
                    type:             source.type,
                    // 5D-6: reference (voucherNo) lives on the spine.
                    branchId:         source.branchId,
                    universalVoucherId: spineId,
                    date:             today,
                    // 5D-5: description lives on the spine (set above).
                    status:           "DRAFT",
                    // 5D-4: party ledger lives on the spine (set above).
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
                    // 5D-2: creator lives on the spine.
                },
                select: { id: true, type: true, universalVoucher: { select: { voucherNo: true } } },   // 5D-6
            });
            // Phase 5 5C: goods lines hang off the new spine.
            await tx.voucherInventoryLine.createMany({
                data: sourceLines.map((l) => ({
                    universalVoucherId: spineId,
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
            });
            return { id: voucher.id, type: voucher.type, reference: voucher.universalVoucher?.voucherNo ?? "" };
        });

        return NextResponse.json(created);
    } catch (e) {
        return handleApiError(e, "Failed to duplicate voucher");
    }
}
