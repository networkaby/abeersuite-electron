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
        await tx.voucherLink.deleteMany({ where: { universalVoucherId, kind } });
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
export async function syncVoucherLinks(
    tx: Prisma.TransactionClient,
    universalVoucherId: number | null | undefined,
    links: VoucherLinkSet,
): Promise<void> {
    if (universalVoucherId == null) return;
    if ("ticketId"        in links) await syncVoucherLink(tx, universalVoucherId, "TICKET",         links.ticketId);
    if ("dealId"          in links) await syncVoucherLink(tx, universalVoucherId, "DEAL",           links.dealId);
    if ("shopOrderId"     in links) await syncVoucherLink(tx, universalVoucherId, "SHOP_ORDER",     links.shopOrderId);
    if ("orderPipelineId" in links) await syncVoucherLink(tx, universalVoucherId, "ORDER_PIPELINE", links.orderPipelineId);
    if ("orderStatusId"   in links) await syncVoucherLink(tx, universalVoucherId, "ORDER_STATUS",   links.orderStatusId);
}
