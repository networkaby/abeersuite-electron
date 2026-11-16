import { prisma } from "@/shared/lib/prisma/prismaClient";
import { receiptHref, voucherSourceForType } from "@/modules/accountancy/lib/voucherUrls";

// Office links for what a customer message is about — staff open these from
// the Messages chat. The customer's own short link (/portal/b/…) asks for a
// customer sign-in, so staff never use it.

/** A message's billKind whose billRefId is a TICKET id, not a voucher:
 *  repair / deal / help messages, staff's own templates, and a built-in
 *  template sent from a ticket (recorded as TICKET:<kind>). */
export function isTicketBillKind(kind: string): boolean {
    return kind.startsWith("REPAIR_") || kind === "DEAL_CREATED" || kind === "HELP_CREATED"
        || kind.startsWith("TICKET:") || kind.startsWith("CUSTOM_");
}

/** A due reminder's billRefId is the party's account id. */
const isDueKind = (kind: string) => kind === "DUE_SOFT" || kind === "DUE_FIRM";

/** The office page of one ticket, by its flavour. */
export function officeTicketHref(t: { id: number; repair: unknown; deal: unknown }): string {
    return t.repair ? `/office/repairing/tickets/${t.id}`
        : t.deal ? `/office/crm/deals?deal=${t.id}`
            : `/office/help?ticket=${t.id}`;
}

const TICKET_FLAVOUR = { id: true, repair: { select: { ticketId: true } }, deal: { select: { ticketId: true } } } as const;

/** Office links for a thread's bill messages and ticket chips, keyed
 *  `bill:<kind>:<refId>` and `ticket:<id>`. Three small queries at most. */
export async function officeLinksFor(rows: { billKind: string | null; billRefId: number | null; ticketId: number | null }[]): Promise<Map<string, string>> {
    const links = new Map<string, string>();
    const ticketIds = new Set<number>();
    const uvIds = new Set<number>();
    for (const r of rows) {
        if (r.ticketId != null) ticketIds.add(r.ticketId);
        if (!r.billKind || r.billRefId == null) continue;
        if (isTicketBillKind(r.billKind)) ticketIds.add(r.billRefId);
        else if (isDueKind(r.billKind)) links.set(`bill:${r.billKind}:${r.billRefId}`, `/office/accountancy/account/${r.billRefId}`);
        else if (r.billKind !== "PAY_REQUEST") uvIds.add(r.billRefId);
    }
    const [tickets, uvs] = await Promise.all([
        ticketIds.size ? prisma.ticket.findMany({ where: { id: { in: [...ticketIds] } }, select: TICKET_FLAVOUR }) : [],
        uvIds.size ? prisma.universalVoucher.findMany({
            where: { id: { in: [...uvIds] } },
            select: { id: true, type: true, voucherDetail: { select: { id: true } } },
        }) : [],
    ]);
    const ticketHref = new Map(tickets.map((t) => [t.id, officeTicketHref(t)]));
    const uvHref = new Map(uvs.map((uv) => {
        const source = voucherSourceForType(uv.type);
        // An inventory voucher prints by its VoucherDetail id; GL / journal by the spine id.
        const rawId = source === "inv" ? uv.voucherDetail?.id : uv.id;
        return [uv.id, rawId != null ? receiptHref(source, rawId, uv.type, "pdf") : null] as const;
    }));
    for (const id of ticketIds) {
        const href = ticketHref.get(id);
        if (href) links.set(`ticket:${id}`, href);
    }
    for (const r of rows) {
        if (!r.billKind || r.billRefId == null) continue;
        const href = isTicketBillKind(r.billKind) ? ticketHref.get(r.billRefId) : uvHref.get(r.billRefId);
        if (href) links.set(`bill:${r.billKind}:${r.billRefId}`, href);
    }
    return links;
}
