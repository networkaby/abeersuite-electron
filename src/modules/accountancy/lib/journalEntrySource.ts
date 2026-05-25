// Resolves a JournalEntry → URL of its originating source document
// (InvVoucher of trading kind, or null for stand-alone journal entries).
//
// Pre-2026-05-24 this also recognised legacy Invoice rows via the `INV-`
// reference prefix. After the Invoice → InvVoucher consolidation the
// Invoice writers are retired and the fallback has been removed.
//
// URL routing is delegated to `voucherUrls.referenceHref` so the inventory
// edit-URL map lives in exactly one place (VoucherActionsMenu's
// EDIT_FORM_URLS).

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { referenceHref } from "./voucherUrls";
import type { InvVoucherType } from "@/generated/prisma/client";

export type SourceDoc =
    | { kind: "sale";            id: number; reference: string; url: string }
    | { kind: "pos";             id: number; reference: string; url: string }
    | { kind: "purchase";        id: number; reference: string; url: string }
    | { kind: "estimate";        id: number; reference: string; url: string }
    | { kind: "sale-return";     id: number; reference: string; url: string }
    | { kind: "purchase-return"; id: number; reference: string; url: string };

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
    const url = referenceHref("inv", v.id, v.type);
    if (!url) return null;
    return { kind, id: v.id, reference: v.reference, url };
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
        const url = referenceHref("inv", v.id, v.type);
        if (!url) continue;
        out.set(v.journalEntryId, { kind, id: v.id, reference: v.reference, url });
    }
    return out;
}
