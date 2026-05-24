// Resolves a JournalEntry → URL of its originating source document
// (InvVoucher of trading kind, or null for stand-alone journal entries).
//
// Pre-2026-05-24 this also recognised legacy Invoice rows via the `INV-`
// reference prefix. After the Invoice → InvVoucher consolidation the
// Invoice writers are retired and the fallback has been removed.

import { prisma } from "@/shared/lib/prisma/prismaClient";

export type SourceDoc =
    | { kind: "sale";            id: number; reference: string; url: string }
    | { kind: "pos";             id: number; reference: string; url: string }
    | { kind: "purchase";        id: number; reference: string; url: string }
    | { kind: "estimate";        id: number; reference: string; url: string }
    | { kind: "sale-return";     id: number; reference: string; url: string }
    | { kind: "purchase-return"; id: number; reference: string; url: string };

import type { InvVoucherType } from "@/generated/prisma/client";

const VOUCHER_SEG: Record<InvVoucherType, string> = {
    PURCHASE:         "purchases",
    SALE:             "sales",
    POS:              "pos",
    ESTIMATE:         "estimates",
    SALE_RETURN:      "sale-returns",
    PURCHASE_RETURN:  "purchase-returns",
    MANUFACTURING_JOURNAL: "manufacturing-journals",
    PHYSICAL_STOCK:   "physical-stock",
    BRANCH_TRANSFER:  "branch-transfers",
    GRN:              "grn",
    CHALLAN:          "challans",
    REJECTION_IN:     "rejections-in",
    REJECTION_OUT:    "rejections-out",
    SALES_ORDER:      "sales-orders",
    PURCHASE_ORDER:   "purchase-orders",
};

// All voucher editors live under /vouchers/<seg>/... Trading kinds — SALE,
// PURCHASE, SALE_RETURN, PURCHASE_RETURN, ESTIMATE — re-use their `/new`
// page with a `?voucherId=<id>` query param because there is no separate
// `/[id]` route (see DayBookActionsMenu's `newFormUrl` comment for the
// canonical pattern). POS sales are sale-shape: they edit via the SALES
// form (`/vouchers/sales/new?voucherId=…`) so the operator gets the same
// line/tax/totals UI the SALE form already provides.
const VOUCHER_BASE = "/vouchers";

const EDIT_VIA_NEW_QUERY: ReadonlySet<InvVoucherType> = new Set([
    "SALE", "PURCHASE", "SALE_RETURN", "PURCHASE_RETURN", "ESTIMATE",
]);

function buildEditUrl(type: InvVoucherType, id: number): string {
    // POS edits route to the SALE form — POS is a sale flavour and the
    // sales form handles the shape (party / lines / GST / totals) without
    // change. The POS register at /vouchers/pos is for *ringing up new*
    // counter sales, not editing existing ones.
    if (type === "POS") return `${VOUCHER_BASE}/${VOUCHER_SEG.SALE}/new?voucherId=${id}`;
    const seg = VOUCHER_SEG[type];
    return EDIT_VIA_NEW_QUERY.has(type)
        ? `${VOUCHER_BASE}/${seg}/new?voucherId=${id}`
        : `${VOUCHER_BASE}/${seg}/${id}`;
}

function kindForVoucherType(type: InvVoucherType): SourceDoc["kind"] | null {
    switch (type) {
        case "PURCHASE":        return "purchase";
        case "ESTIMATE":        return "estimate";
        case "SALE_RETURN":     return "sale-return";
        case "PURCHASE_RETURN": return "purchase-return";
        case "SALE":            return "sale";
        case "POS":             return "pos";
        default:                return null; // GRN/CHALLAN/etc. don't surface in the day book
    }
}

/** Single-record resolver — returns SourceDoc for one journal entry id, or null. */
export async function resolveSource(journalEntryId: number): Promise<SourceDoc | null> {
    const v = await prisma.invVoucher.findFirst({
        where: { journalEntryId },
        select: { id: true, type: true, reference: true },
    });
    if (!v) return null;
    const kind = kindForVoucherType(v.type);
    if (!kind) return null;
    return { kind, id: v.id, reference: v.reference, url: buildEditUrl(v.type, v.id) };
}

/** Bulk resolver — efficient for tables/reports listing many JEs. */
export async function resolveSourceBatch(journalEntryIds: number[]): Promise<Map<number, SourceDoc>> {
    const out = new Map<number, SourceDoc>();
    if (journalEntryIds.length === 0) return out;

    const vouchers = await prisma.invVoucher.findMany({
        where: { journalEntryId: { in: journalEntryIds } },
        select: { id: true, type: true, reference: true, journalEntryId: true },
    });
    for (const v of vouchers) {
        if (v.journalEntryId === null) continue;
        const kind = kindForVoucherType(v.type);
        if (!kind) continue;
        out.set(v.journalEntryId, {
            kind, id: v.id, reference: v.reference, url: buildEditUrl(v.type, v.id),
        });
    }
    return out;
}
