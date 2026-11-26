// Freeze each sale line's warranty term at save time (VoucherInventoryLine.
// warrantyTermId), so a reprint shows the warranty the item was SOLD with even
// after the product moves to another term. Only the customer sale bills carry
// it — every other voucher type gets its rows back untouched.
//
// An edit re-creates the lines; pass the old lines as `keep` so a line whose
// product was already on the bill keeps its sale-day term instead of picking
// up today's.

import type { Prisma } from "@/generated/prisma/client";
import { CUSTOMER_SALE_VOUCHER_TYPES } from "@/shared/lib/constants/accounting";
import { prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";

type Db = Pick<Prisma.TransactionClient, "invProduct">;

export function carriesWarranty(voucherType: string | null | undefined): boolean {
    return voucherType != null && (CUSTOMER_SALE_VOUCHER_TYPES as readonly string[]).includes(voucherType);
}

/** productId → the term the bill already froze for it (first line wins). */
export function keptWarrantyTerms(
    lines: readonly { productId: number; warrantyTermId: number | null }[],
): Map<number, number | null> {
    const m = new Map<number, number | null>();
    for (const l of lines) if (!m.has(l.productId)) m.set(l.productId, l.warrantyTermId);
    return m;
}

export async function stampWarrantyTerms<T extends { productId: number }>(
    db: Db,
    voucherType: string | null | undefined,
    rows: T[],
    keep?: Map<number, number | null>,
): Promise<(T & { warrantyTermId?: number | null })[]> {
    if (!carriesWarranty(voucherType) || rows.length === 0) return rows;
    const need = [...new Set(rows.map((r) => r.productId).filter((id) => !keep?.has(id)))];
    const current = need.length === 0
        ? new Map<number, number | null>()
        : new Map((await db.invProduct.findMany({
            where: { id: { in: need } },
            select: { id: true, warrantyTermId: true },
        })).map((p) => [p.id, p.warrantyTermId]));
    return rows.map((r) => ({
        ...r,
        warrantyTermId: keep?.has(r.productId) ? keep.get(r.productId)! : (current.get(r.productId) ?? null),
    }));
}

/** The fields a bill's Warranty section reads off a frozen term. */
export const WARRANTY_PRINT_SELECT = {
    name: true, durationDays: true, warrantyType: true, sellerDays: true, extraCondition: true,
} as const;

/**
 * productId → the term frozen on a saved bill's lines (null when none). Rides
 * the POS sale reply so the counter slip groups the cart exactly as a reprint
 * of the same bill will.
 */
export async function saleWarrantyTerms(universalVoucherId: number) {
    // Read where the sale was written (a live-mode counter writes to Supabase).
    const lines = await prismaWhereSaved().voucherInventoryLine.findMany({
        where: { universalVoucherId },
        select: { productId: true, warrantyTerm: { select: WARRANTY_PRINT_SELECT } },
        orderBy: { id: "asc" },
    });
    const out: Record<number, (typeof lines)[number]["warrantyTerm"]> = {};
    for (const l of lines) if (!(l.productId in out)) out[l.productId] = l.warrantyTerm;
    return out;
}
