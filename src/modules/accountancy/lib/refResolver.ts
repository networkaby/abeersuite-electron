// Resolves a JournalEntry → URL of its originating source document
// (sales / purchase / estimate voucher, or invoice).  Returns null for
// stand-alone journal entries.

import { prisma } from "@/shared/lib/prisma/prismaClient";

export type SourceDoc =
    | { kind: "sale";     id: number; reference: string; url: string }
    | { kind: "purchase"; id: number; reference: string; url: string }
    | { kind: "estimate"; id: number; reference: string; url: string }
    | { kind: "invoice";  id: number; number: string;    url: string };

import type { InvVoucherType } from "@/generated/prisma/client";

const VOUCHER_SEG: Record<InvVoucherType, string> = {
    PURCHASE:         "purchases",
    SALE:             "sales",
    POS:              "pos",
    ESTIMATE:         "estimates",
    SALE_RETURN:      "sale-returns",
    PURCHASE_RETURN:  "purchase-returns",
    RECEIPT:          "purchases",
    ISSUE:            "sales",
    ADJUSTMENT:       "sales",
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

// All voucher editors live under /vouchers/<seg>/...  GL editors (POS,
// Manufacturing Journal, etc.) have a dedicated `/[id]` page; the four
// trading kinds (SALE / PURCHASE / SALE_RETURN / PURCHASE_RETURN) and
// ESTIMATE re-use their `/new` page with a `?voucherId=<id>` query param
// because there is no separate `/[id]` route (see DayBookActionsMenu's
// `newFormUrl` comment for the canonical pattern).
const VOUCHER_BASE = "/vouchers";

const EDIT_VIA_NEW_QUERY: ReadonlySet<InvVoucherType> = new Set([
    "SALE", "PURCHASE", "SALE_RETURN", "PURCHASE_RETURN", "ESTIMATE",
    "ISSUE", "ADJUSTMENT", "RECEIPT",
]);

function buildEditUrl(type: InvVoucherType, id: number): string {
    const seg = VOUCHER_SEG[type];
    return EDIT_VIA_NEW_QUERY.has(type)
        ? `${VOUCHER_BASE}/${seg}/new?voucherId=${id}`
        : `${VOUCHER_BASE}/${seg}/${id}`;
}

/** Single-record resolver — returns SourceDoc for one journal entry id, or null. */
export async function resolveSource(journalEntryId: number, reference?: string): Promise<SourceDoc | null> {
    const v = await prisma.invVoucher.findFirst({
        where: { journalEntryId },
        select: { id: true, type: true, reference: true },
    });
    if (v) {
        const kind: SourceDoc["kind"] =
            v.type === "PURCHASE" || v.type === "RECEIPT" ? "purchase"
            : v.type === "ESTIMATE" ? "estimate"
            : "sale";
        return { kind, id: v.id, reference: v.reference, url: buildEditUrl(v.type, v.id) };
    }
    if (reference?.startsWith("INV-")) {
        const inv = await prisma.invoice.findFirst({
            where: { number: reference }, select: { id: true, number: true },
        });
        if (inv) return { kind: "invoice", id: inv.id, number: inv.number, url: `/office/accountancy/invoices/${inv.id}` };
    }
    return null;
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
        const kind: SourceDoc["kind"] =
            v.type === "PURCHASE" || v.type === "RECEIPT" ? "purchase"
            : v.type === "ESTIMATE" ? "estimate"
            : "sale";
        out.set(v.journalEntryId, {
            kind, id: v.id, reference: v.reference, url: buildEditUrl(v.type, v.id),
        });
    }
    return out;
}
