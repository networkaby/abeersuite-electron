import { readSettlement } from "@/shared/lib/accountancy/settlement";
import { readPartyAddress, readPartyName, readPartyPhone } from "@/shared/lib/accountancy/partySnapshot";

// Revert a live voucher to one of its pre-edit Recycle Bin copies.
//
// It does not write rows itself. The copy is turned into the body the voucher's own
// Edit screen would send, and that body goes through the edit save
// (PATCH /api/inventory/vouchers/[id] or /api/accountancy/vouchers/[id]). Stock,
// ledger lines, balances, the shift-close correction and the fresh pre-edit copy of
// the version being replaced all happen exactly as they do for a hand edit. Same id,
// same number: the bill is changed back, never saved a second time.

type Row = Record<string, unknown>;

const num = (v: unknown): number | undefined => (v == null || v === "" ? undefined : Number(v));
const dateOnly = (v: unknown): string => String(v ?? "").slice(0, 10);

/** Body for PATCH /api/inventory/vouchers/[id], from an INV_VOUCHER copy. */
export function invPatchBodyFromSnapshot(snap: Row): Row {
    const spine = (snap.journalEntry as Row | null) ?? {};
    const isPos = spine.type === "POS" || snap.type === "POS";
    const settlement = readSettlement(snap.settlementJson as never);
    const lines = ((snap.lines as Row[]) ?? []).map((l) => ({
        productId:           Number(l.productId),
        description:         (l.description as string | null) ?? undefined,
        note:                (l.note as string | null) ?? null,
        quantity:            Number(l.quantity),
        freeQty:             num(l.freeQty),
        rate:                num(l.rate),
        mrpPaise:            num(l.mrpPaise) ?? null,
        savedSalePricePaise: num(l.savedSalePricePaise) ?? null,
        discountPct:         num(l.discountPct),
        discountAmt:         num(l.discountAmt),
        taxRate:             num(l.taxRate),
        direction:           (l.direction as "CONSUME" | "PRODUCE" | null) ?? undefined,
    }));
    return {
        date:             dateOnly(spine.date),
        description:      (spine.description as string | null) ?? undefined,
        partyId:          num(snap.partyId),
        partyType:        (snap.partyType as string | null) ?? undefined,
        partyName:        readPartyName(snap.partyJson) ?? undefined,
        partyPhone:       readPartyPhone(snap.partyJson) ?? undefined,
        partyAddress:     readPartyAddress(snap.partyJson) ?? undefined,
        creditPeriodDays: num(snap.creditPeriodDays) ?? null,
        refNumber:        (snap.refNumber as string | null) ?? undefined,
        refDate:          snap.refDate ? dateOnly(snap.refDate) : undefined,
        bomId:            num(snap.bomId) ?? null,
        destinationBranchId: (snap.destinationBranchId as string | null) ?? null,
        showPrices:       (snap.showPrices as boolean | null) ?? undefined,
        shippingAmt:      num(snap.shippingAmt) ?? 0,
        roundOff:         num(snap.roundOff) ?? 0,
        roundOffOn:       typeof snap.roundOffOn === "boolean" ? snap.roundOffOn : undefined,
        // A POS sale's discount already rides each line (see posSaleEdit.ts); sending the
        // header copy too would take it off a second time, after tax.
        discountPct:      isPos ? 0 : num(snap.discountPct) ?? 0,
        discountAmt:      isPos ? 0 : num(snap.discountAmt) ?? 0,
        lines,
        charges: settlement.charges.filter((c) => c.serviceId == null).map((c) => ({
            accountId: c.accountId, amount: c.amount,
            description: c.description ?? undefined, taxAmount: c.taxAmount ?? undefined,
        })),
        services: settlement.charges.filter((c) => c.serviceId != null).map((c) => {
            const quantity = c.quantity && c.quantity > 0 ? c.quantity : 1;
            return { serviceId: c.serviceId!, quantity, unitPrice: c.amount / quantity, description: c.description ?? undefined };
        }),
        tenders: settlement.tenders.map((t) => ({
            accountId: t.accountId, amount: t.amount,
            method: t.method ?? undefined, reference: t.reference ?? undefined,
        })),
    };
}

/** Body for PATCH /api/accountancy/vouchers/[id], from a GL_VOUCHER copy. */
export function glPatchBodyFromSnapshot(snap: Row): Row {
    return {
        date:           dateOnly(snap.date),
        narration:      (snap.narration as string | null) ?? (snap.description as string | null) ?? undefined,
        partyAccountId: num(snap.partyAccountId),
        denomJson:      snap.denomJson ?? null,
        lines: ((snap.lines as Row[]) ?? []).map((l) => ({
            accountId:   Number(l.accountId),
            type:        l.type,
            amount:      Number(l.amount),
            description: (l.description as string | null) ?? undefined,
            method:      (l.method as string | null) ?? undefined,
            reference:   (l.reference as string | null) ?? undefined,
        })),
    };
}
