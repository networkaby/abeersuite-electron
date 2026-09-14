// VoucherLink helpers (Phase 5 5A) — the loose, FK-free cross-module link child
// of UniversalVoucher. A voucher's connections to DISPOSABLE workflow entities
// (repair ticket, CRM deal, ecommerce order, Orders-board pipeline/stage) live
// here as plain `targetId` strings, so the protected accounting spine holds NO
// foreign key into Ticket / Deal / ShopOrder / Pipeline.
//
// During 5A the legacy InvVoucher.{ticketId,dealId,shopOrderId,orderPipelineId,
// orderStatusId} columns are dual-written into VoucherLink (this helper) until the
// readers cut over (5A-2) and the columns are dropped (5A-3).

import type { Prisma, VoucherLinkKind } from "@/generated/prisma/client";

/**
 * Upsert (or clear) one VoucherLink for a voucher's spine. No-op when the voucher
 * has no spine id yet. A null `targetId` removes the link of that kind.
 * `targetId` is stringified so it spans Int ids (ticket/deal/order) and cuid
 * pipeline/status ids alike.
 */
export async function syncVoucherLink(
    tx: Prisma.TransactionClient,
    universalVoucherId: number | null | undefined,
    kind: VoucherLinkKind,
    targetId: number | string | null | undefined,
): Promise<void> {
    if (universalVoucherId == null) return;
    if (targetId == null) {
        // Delete only when a link actually exists. Callers pass null for every kind a
        // plain voucher does not carry, so a blind deleteMany ran on every fresh sale —
        // and a counter's replica guard refuses any delete, which rolled the whole
        // sale back for a row that was never there.
        const existing = await tx.voucherLink.findUnique({
            where: { universalVoucherId_kind: { universalVoucherId, kind } },
            select: { id: true },
        });
        if (existing) await tx.voucherLink.delete({ where: { id: existing.id } });
        return;
    }
    await tx.voucherLink.upsert({
        where:  { universalVoucherId_kind: { universalVoucherId, kind } },
        create: { universalVoucherId, kind, targetId: String(targetId) },
        update: { targetId: String(targetId) },
    });
}

/** The five workflow links a voucher can carry, as the dual-write sites pass them. */
export type VoucherLinkSet = {
    ticketId?:        number | null;
    dealId?:          number | null;
    shopOrderId?:     number | null;
    orderPipelineId?: string | null;
    orderStatusId?:   string | null;
};

/** Dual-write every provided link for a voucher's spine in one call. Only the keys
 *  present in `links` are touched (so a partial update — e.g. just orderStatusId —
 *  leaves the others alone). */
const LINK_KINDS = [
    ["ticketId",        "TICKET"],
    ["dealId",          "DEAL"],
    ["shopOrderId",     "SHOP_ORDER"],
    ["orderPipelineId", "ORDER_PIPELINE"],
    ["orderStatusId",   "ORDER_STATUS"],
] as const satisfies ReadonlyArray<readonly [keyof VoucherLinkSet, VoucherLinkKind]>;

export async function syncVoucherLinks(
    tx: Prisma.TransactionClient,
    universalVoucherId: number | null | undefined,
    links: VoucherLinkSet,
    /**
     * `fresh` = this spine was created moments ago in this same transaction.
     *
     * It cannot have a link to clear, so a null target on a fresh voucher is
     * nothing to do. Without this, every plain sale paid for two `voucherLink`
     * lookups — one for ORDER_PIPELINE and one for ORDER_STATUS — searching a
     * row that by definition did not exist. Two round trips on the busiest write
     * in the app, for an answer known in advance.
     */
    opts: { fresh?: boolean } = {},
): Promise<void> {
    if (universalVoucherId == null) return;
    for (const [key, kind] of LINK_KINDS) {
        if (!(key in links)) continue;
        const targetId = links[key];
        if (targetId == null && opts.fresh) continue;
        await syncVoucherLink(tx, universalVoucherId, kind, targetId);
    }
}
