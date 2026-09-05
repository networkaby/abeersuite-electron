// GET /api/pos/return/search
//
// Two lookup modes, both return the same `FoundInvoice[]` shape so the
// PosReturnDialog UI is uniform:
//
//   ?q=POS-…/SV-…  — voucher-reference substring search (cashier types it)
//   ?customerId=N  — every POS/SALE InvVoucher for that customer account
//                    (used when the customer has lost the original receipt)
//
// Returns POS + SALE InvVouchers only — never SALE_RETURN (no return of a
// return) and never DRAFT/CANCELLED/deleted rows. The `id` and per-line
// `id` in the response point to InvVoucher / InvVoucherLine since the
// 2026-05-24 Invoice→InvVoucher consolidation; the field names are kept
// for client-side API back-compat — the dialog treats them as opaque IDs.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    const url        = new URL(req.url);
    const q          = url.searchParams.get("q")?.trim() ?? "";
    const customerId = url.searchParams.get("customerId");

    if (!q && !customerId) {
        return NextResponse.json({ error: "Pass either q=<invoice#> or customerId=<accountId>" }, { status: 400 });
    }
    if (q && q.length < 2) {
        return NextResponse.json({ error: "Enter at least 2 characters" }, { status: 400 });
    }

    try {
        const vouchers = await prisma.voucherDetail.findMany({
            where: {
                // 5D-8 status/deletedAt + 5D-11 type + party (5D-4) + voucher-number
                // search (5D-6) all resolve via the spine.
                universalVoucher: {
                    type:      { in: ["POS", "SALE"] },
                    status:    "POSTED",
                    deletedAt: null,
                    ...(customerId
                        ? { partyAccountId: Number(customerId) }
                        : { voucherNo: { contains: q, mode: "insensitive" } }),
                },
            },
            orderBy: { universalVoucher: { date: "desc" } },   // 5D-10
            take:    10,
            include: {
                universalVoucher: { select: { partyAccountId: true, voucherNo: true, date: true } },   // 5D-4 party + 5D-6 ref + 5D-10 date
                // SALE_RETURN children of this voucher — for the dialog's "already returned" guard
                refReturns: {
                    where:  { universalVoucher: { status: "POSTED", deletedAt: null } },
                    select: { id: true, totalAmount: true, universalVoucherId: true, universalVoucher: { select: { voucherNo: true } } },
                },
            },
        });
        // 5D-4: resolve party ledger names from each row's spine partyAccountId.
        const partyAcctIds = [...new Set(vouchers.map((v) => v.universalVoucher?.partyAccountId).filter((x): x is number => x != null))];
        const partyAcctById = new Map(
            (partyAcctIds.length === 0 ? [] : await prisma.account.findMany({ where: { id: { in: partyAcctIds } }, select: { id: true, name: true } }))
                .map((a) => [a.id, a]),
        );
        // Phase 5 5C: goods lines hang off the spine — batch-load + group by spine id.
        const uvIds = vouchers.map((v) => v.universalVoucherId).filter((x): x is number => x != null);
        const allLines = await prisma.voucherInventoryLine.findMany({
            where:   { universalVoucherId: { in: uvIds } },
            select:  { id: true, universalVoucherId: true, productId: true, description: true, quantity: true, rate: true, taxRate: true, taxAmount: true, amount: true, product: { select: { id: true, name: true, sku: true } } },
        });
        const linesByUv = new Map<number, typeof allLines>();
        for (const l of allLines) {
            const arr = linesByUv.get(l.universalVoucherId) ?? [];
            arr.push(l); linesByUv.set(l.universalVoucherId, arr);
        }
        const linesFor = (v: { universalVoucherId: number | null }) =>
            v.universalVoucherId != null ? (linesByUv.get(v.universalVoucherId) ?? []) : [];

        // Already-returned qty per product, across every prior POSTED SALE_RETURN
        // of each voucher — POS merges same-product cart lines into one line per
        // sale, so productId unambiguously identifies "the" line within a voucher.
        const returnUvIds = [...new Set(vouchers.flatMap((v) => v.refReturns.map((r) => r.universalVoucherId).filter((id): id is number => id != null)))];
        const returnLines = returnUvIds.length === 0 ? [] : await prisma.voucherInventoryLine.findMany({
            where:  { universalVoucherId: { in: returnUvIds } },
            select: { universalVoucherId: true, productId: true, quantity: true },
        });
        const returnedQtyByUv = new Map<number, Map<number, number>>();
        for (const l of returnLines) {
            const byProduct = returnedQtyByUv.get(l.universalVoucherId) ?? new Map<number, number>();
            byProduct.set(l.productId, (byProduct.get(l.productId) ?? 0) + Number(l.quantity));
            returnedQtyByUv.set(l.universalVoucherId, byProduct);
        }
        const returnedQtyFor = (v: (typeof vouchers)[number], productId: number) =>
            v.refReturns.reduce((sum, r) => {
                const byProduct = r.universalVoucherId != null ? returnedQtyByUv.get(r.universalVoucherId) : undefined;
                return sum + (byProduct?.get(productId) ?? 0);
            }, 0);

        // Gift card drawn on each sale, net of what has already gone back — the
        // dialog offers "back to card" only when there is something left to return.
        // A refund is recorded against whatever caused it, so both the sale's own
        // spine (a cancel) and its SALE_RETURN spines (a credit note) count.
        // Same rule as `giftCardRefundableForSale`, computed in batch for the list.
        const cardSpineIds = [...uvIds, ...returnUvIds];
        const cardTxns = cardSpineIds.length === 0 ? [] : await prisma.giftCardTxn.findMany({
            where:  { universalVoucherId: { in: cardSpineIds }, type: { in: ["REDEEM", "REFUND"] } },
            select: { universalVoucherId: true, giftCardId: true, type: true, amount: true, giftCard: { select: { code: true } } },
        });
        // Every return spine maps back to the sale it came from.
        const saleSpineByReturnSpine = new Map<number, number>();
        for (const v of vouchers) {
            if (v.universalVoucherId == null) continue;
            for (const r of v.refReturns) {
                if (r.universalVoucherId != null) saleSpineByReturnSpine.set(r.universalVoucherId, v.universalVoucherId);
            }
        }
        const cardBySaleSpine = new Map<number, { giftCardId: number; code: string; drawn: number; refunded: number }>();
        for (const t of cardTxns) {
            if (t.universalVoucherId == null) continue;
            const saleSpine = saleSpineByReturnSpine.get(t.universalVoucherId) ?? t.universalVoucherId;
            const amount = Number(t.amount);
            const entry = cardBySaleSpine.get(saleSpine)
                ?? { giftCardId: t.giftCardId, code: t.giftCard.code, drawn: 0, refunded: 0 };
            if (t.type === "REDEEM") { entry.giftCardId = t.giftCardId; entry.code = t.giftCard.code; entry.drawn += Math.abs(amount); }
            else                     { entry.refunded += amount; }
            cardBySaleSpine.set(saleSpine, entry);
        }
        const giftCardFor = (v: { universalVoucherId: number | null }) => {
            const e = v.universalVoucherId != null ? cardBySaleSpine.get(v.universalVoucherId) : undefined;
            if (!e || e.drawn <= 0) return null;
            const refundable = Math.round((e.drawn - e.refunded) * 100) / 100;
            return refundable > 0.005 ? { id: e.giftCardId, code: e.code, refundable: refundable.toFixed(2) } : null;
        };

        return NextResponse.json(vouchers.map((v) => ({
            id:          v.id,
            number:      v.universalVoucher?.voucherNo ?? "",
            issueDate:   v.universalVoucher?.date,   // 5D-10: date on spine
            status:      "PAID", // legacy field — POS sales are always settled at counter; UI uses it as a "OK to return" sentinel
            totalAmount: v.totalAmount.toString(),
            account:     v.universalVoucher?.partyAccountId != null ? (partyAcctById.get(v.universalVoucher.partyAccountId) ?? null) : null,
            giftCard:    giftCardFor(v),
            lines:       linesFor(v).map((l) => ({
                id:            l.id,
                productId:     l.productId,
                description:   l.description ?? "",
                quantity:      l.quantity.toString(),
                returnedQty:   returnedQtyFor(v, l.productId).toString(),
                unitPrice:     l.rate.toString(),
                taxRate:       l.taxRate?.toString() ?? "0",
                taxAmount:     l.taxAmount?.toString() ?? "0",
                amount:        l.amount.toString(),
                product:       l.product,
            })),
            returns: v.refReturns.map((r) => ({
                id:          r.id,
                number:      r.universalVoucher?.voucherNo ?? "",
                totalAmount: r.totalAmount.toString(),
            })),
        })));
    } catch (e) {
        return handleApiError(e, "Failed to search invoices");
    }
}
