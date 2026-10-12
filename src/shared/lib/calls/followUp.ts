import { unstable_cache } from "next/cache";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { splitExtensions } from "@/shared/lib/counter/idRange";
import { CALL_POPUP_PUBLIC_AFTER_MS } from "@/shared/lib/constants/polling";
import { SALE_TYPES } from "@/modules/bi/lib/marginEngine";

/**
 * Server-side rules for the counter's call follow-up popup (CallFollowUpPopup):
 * which counter sees a call, and when a missed call stops needing a call back.
 * Kept apart from `./index` because these read the database.
 */

/** Invalidated whenever a counter is created or its extension changes. */
export const COUNTER_EXTENSIONS_TAG = "counter-extensions";

/**
 * Every extension an active counter is set to. Counters change a few times a
 * year while the popup asks on every refresh of every counter, so this is
 * cached and dropped by tag on a counter write.
 */
const getCounterExtensions = unstable_cache(
    async () => {
        const rows = await prisma.posCounter.findMany({
            where: { isActive: true, epbxExtension: { not: null } },
            select: { epbxExtension: true },
        });
        return [...new Set(rows.flatMap((r) => splitExtensions(r.epbxExtension)))];
    },
    ["calls:counter-extensions"],
    { tags: [COUNTER_EXTENSIONS_TAG], revalidate: 600 },
);

/**
 * Which calls one counter's popup sees. Its own extension(s) at once; a call
 * that belongs to no counter (no extension, or one no counter is set to) at
 * once; any other counter's call only after CALL_POPUP_PUBLIC_AFTER_MS.
 * `ownExts` empty = a PC bound to no counter, which has no calls of its own.
 */
export async function counterPopupScope(ownExts: string[]): Promise<Prisma.CallWhereInput> {
    const counterExts = await getCounterExtensions();
    if (!counterExts.length) return {}; // no counter has an extension — every call is nobody's
    const or: Prisma.CallWhereInput[] = [
        { occurredAt: { lte: new Date(Date.now() - CALL_POPUP_PUBLIC_AFTER_MS) } },
        // Nobody's: neither side is a counter's extension. `notIn` never matches
        // NULL in SQL, hence the explicit null on each side.
        {
            AND: [
                { OR: [{ toExt: null }, { toExt: { notIn: counterExts } }] },
                { OR: [{ fromExt: null }, { fromExt: { notIn: counterExts } }] },
            ],
        },
    ];
    if (ownExts.length) or.push({ toExt: { in: ownExts } }, { fromExt: { in: ownExts } });
    return { OR: or };
}

type CustomerRef = { kind: "person" | "company"; id: number };
export const customerKey = (c: CustomerRef) => `${c.kind}:${c.id}`;

/**
 * When each customer was last seen at the shop since `since`: a sale or POS
 * bill made to them, or a ticket of any kind (help, deal, repair) opened for
 * them. Keyed by `customerKey`; a customer not seen since then is absent.
 * A missed call from someone seen after it needs no call back.
 */
export async function customerSeenSince(customers: CustomerRef[], since: Date): Promise<Map<string, number>> {
    const seen = new Map<string, number>();
    const personIds = customers.filter((c) => c.kind === "person").map((c) => c.id);
    const companyIds = customers.filter((c) => c.kind === "company").map((c) => c.id);
    if (!personIds.length && !companyIds.length) return seen;

    const bump = (key: string, at: Date | null | undefined) => {
        if (at && at.getTime() > (seen.get(key) ?? 0)) seen.set(key, at.getTime());
    };
    const partyOf = { OR: [{ personId: { in: personIds } }, { companyId: { in: companyIds } }] };
    const keyOfParty = (p: { personId: number | null; companyId: number | null } | null) =>
        p?.personId ? `person:${p.personId}` : p?.companyId ? `company:${p.companyId}` : null;

    const accounts = await prisma.account.findMany({ where: partyOf, select: { id: true, personId: true, companyId: true } });
    const keyByAccount = new Map(accounts.map((a) => [a.id, keyOfParty(a)]));
    const accountIds = accounts.map((a) => a.id);

    const [bills, tickets] = await Promise.all([
        accountIds.length
            ? prisma.universalVoucher.groupBy({
                by: ["partyAccountId"],
                where: { partyAccountId: { in: accountIds }, type: { in: [...SALE_TYPES] }, status: "POSTED", createdAt: { gte: since } },
                _max: { createdAt: true },
            })
            : Promise.resolve([]),
        prisma.ticket.findMany({
            where: {
                createdAt: { gte: since },
                OR: [{ accountId: { in: accountIds } }, { help: partyOf }, { deal: partyOf }],
            },
            select: {
                createdAt: true,
                accountId: true,
                help: { select: { personId: true, companyId: true } },
                deal: { select: { personId: true, companyId: true } },
            },
        }),
    ]);
    for (const b of bills) {
        const key = b.partyAccountId != null ? keyByAccount.get(b.partyAccountId) : null;
        if (key) bump(key, b._max.createdAt);
    }
    for (const t of tickets) {
        const key = (t.accountId != null ? keyByAccount.get(t.accountId) : null) ?? keyOfParty(t.help) ?? keyOfParty(t.deal);
        if (key) bump(key, t.createdAt);
    }
    return seen;
}

/**
 * When the shop last got back to each number — the one line that closes a
 * waiting call AND a waiting message alike, whichever way it was answered:
 *  - a call to/from the number logged with a note or a ticket (its occurredAt);
 *  - a WhatsApp reply a staff member sent, or a Help/Deal ticket raised or
 *    linked from the chat (the NOTE row `ticketFromMessage` leaves, kind
 *    "ticket"). An @mention note only passes the chat on and never counts;
 *  - a Call / Note / Meeting / Task logged on the customer in CRM → Reconnect;
 *  - with `visits`, the customer seen at the shop (customerSeenSince).
 * Anything that happened before the returned time is answered; anything after
 * it is still waiting. `owners` maps a number to its customer (ownersByPhone)
 * — numbers without one are judged on calls and replies only.
 */
export async function lastContactByPhone(
    phones: string[],
    owners: Map<string, CustomerRef>,
    opts: { since?: Date; visits?: boolean } = {},
): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const unique = [...new Set(phones.filter(Boolean))];
    if (!unique.length) return out;
    const bump = (phone: string, at: Date | number | null | undefined) => {
        const t = at instanceof Date ? at.getTime() : at;
        if (t && t > (out.get(phone) ?? 0)) out.set(phone, t);
    };
    const after = opts.since ? { gte: opts.since } : undefined;

    const customers = [...new Map([...owners.values()].map((o) => [customerKey(o), { kind: o.kind, id: o.id }])).values()];
    const phonesOf = new Map<string, string[]>();
    for (const [phone, o] of owners) {
        if (!unique.includes(phone)) continue;
        const k = customerKey(o);
        phonesOf.set(k, [...(phonesOf.get(k) ?? []), phone]);
    }
    const personIds = customers.filter((c) => c.kind === "person").map((c) => c.id);
    const companyIds = customers.filter((c) => c.kind === "company").map((c) => c.id);

    const [calls, messages, logs, seen] = await Promise.all([
        prisma.call.groupBy({
            by: ["phone"],
            where: { phone: { in: unique }, occurredAt: after, OR: [{ note: { not: null } }, { ticketId: { not: null } }] },
            _max: { occurredAt: true },
        }),
        prisma.message.groupBy({
            by: ["phone"],
            where: {
                phone: { in: unique }, occurredAt: after,
                OR: [{ direction: "OUT", sentByUserId: { not: null } }, { direction: "NOTE", kind: "ticket" }],
            },
            _max: { occurredAt: true },
        }),
        personIds.length || companyIds.length
            ? prisma.ticketLog.groupBy({
                by: ["personId", "companyId"],
                where: { ticketId: null, createdAt: after, OR: [{ personId: { in: personIds } }, { companyId: { in: companyIds } }] },
                _max: { createdAt: true },
            })
            : Promise.resolve([]),
        opts.visits && customers.length && opts.since ? customerSeenSince(customers, opts.since) : Promise.resolve(new Map<string, number>()),
    ]);
    for (const g of calls) if (g.phone) bump(g.phone, g._max.occurredAt);
    for (const g of messages) if (g.phone) bump(g.phone, g._max.occurredAt);
    for (const g of logs) {
        const key = g.personId ? `person:${g.personId}` : g.companyId ? `company:${g.companyId}` : null;
        for (const phone of (key && phonesOf.get(key)) || []) bump(phone, g._max.createdAt);
    }
    for (const [key, at] of seen) for (const phone of phonesOf.get(key) ?? []) bump(phone, at);
    return out;
}
