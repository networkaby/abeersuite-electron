import { prisma } from "@/shared/lib/prisma/prismaClient";
import { phoneMatchKey } from "@/shared/lib/format";
import { closingForAccounts } from "@/modules/accountancy/lib/aggregateLedger";
import { editFormUrl } from "@/modules/inventory/lib/voucherFormUrls";
import { buildCustomerTimeline, resolveAccountId, type CustomerRef, type TimelineEntry } from "@/modules/crm/lib/customerTimeline";

/**
 * Deal screen — third column: who this customer is, how they buy, how we have
 * talked to them, and a simple Hot / Warm / Cold read. Reuses the Reconnect
 * timeline (sales, deals, calls, WhatsApp, repairs, enquiries) and adds the
 * buying numbers the deal needs. One call per deal; the route caches it.
 */

const SALE_TYPES = ["SALE", "POS", "ONLINE_INVOICE"] as const;
const DAY = 86_400_000;
/** "Regular" = this many bills in the last 12 months. */
export const REGULAR_BILLS_PER_YEAR = 3;
/** "High-value" = this much spent in the last 12 months (rupees). */
export const HIGH_VALUE_RUPEES_PER_YEAR = 25_000;

export type CustomerTier = "New" | "Occasional" | "Regular" | "High-value";
export type LeadScore = "Hot" | "Warm" | "Cold";

export interface DealCustomerHistory {
    linked: boolean;
    tier: CustomerTier;
    score: LeadScore;
    reasons: string[];
    stats: {
        bills: number;
        spent12mPaise: number;
        lastBillAt: string | null;
        /** Average days between bills; null with fewer than two bills. */
        everyDays: number | null;
    };
    /** Positive = the customer owes us. */
    duePaise: number;
    avgDiscountPct: number | null;
    suggestion: string;
    purchases: {
        key: string; at: string; item: string; qty: number; ratePaise: number;
        match: boolean; billNo: string | null; href: string | null;
    }[];
    topCategories: string[];
    comms: {
        counts: { whatsapp: number; calls: number; tickets: number };
        lastContactAt: string | null;
        recent: { key: string; at: string; kind: "whatsapp" | "call" | "ticket" | "note"; title: string; detail: string | null; missed: boolean; ticketId: number | null }[];
    };
    deals: { id: number; title: string; status: string; at: string }[];
}

/** Words in the deal title worth matching against what they bought ("pendrive"). */
function keywords(text: string): string[] {
    return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/^\d+$/.test(w)))];
}

const EMPTY_COMMS = { counts: { whatsapp: 0, calls: 0, tickets: 0 }, lastContactAt: null, recent: [] };

export async function buildDealCustomerHistory(dealId: number): Promise<DealCustomerHistory | null> {
    const deal = await prisma.ticketDeal.findUnique({
        where: { ticketId: dealId },
        select: { personId: true, companyId: true, phone: true, ticket: { select: { title: true, notes: true } } },
    });
    if (!deal) return null;

    const ref: CustomerRef | null = deal.personId ? { kind: "person", id: deal.personId }
        : deal.companyId ? { kind: "company", id: deal.companyId } : null;
    const words = keywords(`${deal.ticket.title ?? ""} ${deal.ticket.notes ?? ""}`);

    if (!ref) {
        return {
            linked: false, tier: "New", score: "Warm", reasons: ["Not linked to a customer yet"],
            stats: { bills: 0, spent12mPaise: 0, lastBillAt: null, everyDays: null },
            duePaise: 0, avgDiscountPct: null, suggestion: "Link this deal to a customer to see their history.",
            purchases: [], topCategories: [], comms: EMPTY_COMMS, deals: [],
        };
    }

    const partyWhere = ref.kind === "person" ? { personId: ref.id } : { companyId: ref.id };
    const accountId = await resolveAccountId(ref);
    const phoneRows = await prisma.phone.findMany({ where: partyWhere, select: { phone: true } });
    const keys = [...new Set([...phoneRows.map((p) => p.phone), deal.phone].map((p) => phoneMatchKey(p)).filter((k): k is string => !!k))];
    const saleWhere = accountId ? { partyAccountId: accountId, status: "POSTED" as const, type: { in: [...SALE_TYPES] } } : null;

    const [timeline, bills, lines, discount, closing, waCount, callCount, repairCount, helpCount] = await Promise.all([
        buildCustomerTimeline(ref, 15),
        saleWhere
            ? prisma.universalVoucher.findMany({ where: saleWhere, select: { date: true, voucherDetail: { select: { totalAmount: true } } }, orderBy: { date: "asc" } })
            : Promise.resolve([]),
        saleWhere
            ? prisma.voucherInventoryLine.findMany({
                where: { universalVoucher: saleWhere },
                orderBy: [{ universalVoucher: { date: "desc" } }, { id: "desc" }],
                take: 40,
                select: {
                    id: true, quantity: true, rate: true,
                    product: { select: { name: true, category: { select: { name: true } } } },
                    universalVoucher: { select: { id: true, type: true, date: true, voucherNo: true } },
                },
            })
            : Promise.resolve([]),
        saleWhere
            ? prisma.voucherInventoryLine.aggregate({ where: { universalVoucher: saleWhere }, _sum: { amount: true, discountAmt: true } })
            : Promise.resolve(null),
        accountId ? closingForAccounts(null, [accountId]) : Promise.resolve(new Map<number, number>()),
        keys.length ? prisma.message.count({ where: { phone: { in: keys }, spam: false, direction: { not: "NOTE" } } }) : Promise.resolve(0),
        keys.length ? prisma.call.count({ where: { phone: { in: keys }, spam: false } }) : Promise.resolve(0),
        accountId ? prisma.ticket.count({ where: { accountId, repair: { isNot: null } } }) : Promise.resolve(0),
        prisma.ticketHelp.count({ where: partyWhere }),
    ]);

    // ── Buying numbers ──────────────────────────────────────────────────────────
    const now = Date.now();
    const yearAgo = now - 365 * DAY;
    const bills12m = bills.filter((b) => b.date.getTime() >= yearAgo);
    const spent12m = bills12m.reduce((s, b) => s + Number(b.voucherDetail?.totalAmount ?? 0), 0);
    const lastBill = bills.at(-1)?.date ?? null;
    const everyDays = bills.length >= 2
        ? Math.round((bills.at(-1)!.date.getTime() - bills[0].date.getTime()) / DAY / (bills.length - 1))
        : null;
    const gross = Number(discount?._sum.amount ?? 0) + Number(discount?._sum.discountAmt ?? 0);
    const avgDiscountPct = gross > 0 && Number(discount?._sum.discountAmt ?? 0) > 0
        ? Math.round((Number(discount!._sum.discountAmt) / gross) * 1000) / 10 : null;
    const due = accountId ? closing.get(accountId) ?? 0 : 0;

    const purchases = lines.slice(0, 8).map((l) => {
        const hay = `${l.product.name} ${l.product.category?.name ?? ""}`.toLowerCase();
        return {
            key: `line:${l.id}`,
            at: l.universalVoucher.date.toISOString(),
            item: l.product.name,
            qty: Number(l.quantity),
            ratePaise: Math.round(Number(l.rate) * 100),
            match: words.some((w) => hay.includes(w)),
            billNo: l.universalVoucher.voucherNo,
            href: editFormUrl(l.universalVoucher.type, l.universalVoucher.id),
        };
    });
    const catCount = new Map<string, number>();
    for (const l of lines) if (l.product.category?.name) catCount.set(l.product.category.name, (catCount.get(l.product.category.name) ?? 0) + 1);
    const topCategories = [...catCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);

    // ── Tier + lead score ───────────────────────────────────────────────────────
    const tier: CustomerTier = bills.length === 0 ? "New"
        : spent12m >= HIGH_VALUE_RUPEES_PER_YEAR ? "High-value"
        : bills12m.length >= REGULAR_BILLS_PER_YEAR ? "Regular" : "Occasional";

    const otherDeals = timeline.entries.filter((e) => e.source === "deal" && e.ref?.id !== dealId);
    const isWon = (e: TimelineEntry) => /won/i.test(e.detail ?? "");
    const isLost = (e: TimelineEntry) => /lost/i.test(e.detail ?? "");
    const contacts = timeline.entries.filter((e) => e.source === "call" || e.source === "message");
    const lastContactAt = contacts[0]?.at ?? null;

    let points = 0;
    const reasons: string[] = [];
    if (bills12m.length > 0) { points += bills12m.length >= REGULAR_BILLS_PER_YEAR ? 2 : 1; reasons.push(`Bought ${bills12m.length} time${bills12m.length === 1 ? "" : "s"} in 12 months`); }
    else if (bills.length === 0) reasons.push("Never bought from us");
    else reasons.push("No bill in the last 12 months");
    if (lastBill && now - lastBill.getTime() <= 90 * DAY) { points += 1; reasons.push(`Last bill ${Math.floor((now - lastBill.getTime()) / DAY)} days ago`); }
    if (purchases.some((p) => p.match)) { points += 1; reasons.push("Bought this kind of item before"); }
    if (lastContactAt && now - new Date(lastContactAt).getTime() <= 7 * DAY) { points += 1; reasons.push("In touch this week"); }
    const won = otherDeals.filter(isWon).length, lost = otherDeals.filter(isLost).length;
    if (won > 0) { points += 1; reasons.push(`${won} earlier deal${won === 1 ? "" : "s"} won`); }
    if (lost >= 2) { points -= 1; reasons.push(`${lost} earlier deals lost`); }
    if (due > 0) { points -= 1; reasons.push("Has dues pending"); }
    // Hot needs more than "bought once + called us today" — that is every new deal.
    const score: LeadScore = points >= 4 ? "Hot" : points >= 1 ? "Warm" : "Cold";

    const lastMatch = purchases.find((p) => p.match);
    const suggestion = tier === "New" ? "New customer — quote the normal price; win them with service."
        : tier === "Occasional" ? "Occasional buyer — a small discount can bring them back."
        : `${tier} buyer — can offer a better price${lastMatch ? ` (last paid ₹${(lastMatch.ratePaise / 100).toLocaleString("en-IN")} for ${lastMatch.item})` : ""}.`;

    // ── Communication feed ──────────────────────────────────────────────────────
    const recent = timeline.entries
        .filter((e) => e.source === "call" || e.source === "message" || e.source === "repair" || e.source === "inquiry" || e.source === "note")
        .slice(0, 6)
        .map((e) => ({
            key: e.key,
            at: e.at,
            kind: (e.source === "message" ? "whatsapp" : e.source === "call" ? "call" : e.source === "note" ? "note" : "ticket") as "whatsapp" | "call" | "ticket" | "note",
            title: e.author ? `${e.title} · ${e.author}` : e.title,
            detail: e.detail ?? null,
            missed: !!e.missed,
            ticketId: e.ref?.kind === "ticket" ? e.ref.id : null,
        }));

    return {
        linked: true,
        tier, score, reasons,
        stats: { bills: bills.length, spent12mPaise: Math.round(spent12m * 100), lastBillAt: lastBill?.toISOString() ?? null, everyDays },
        duePaise: Math.round(due * 100),
        avgDiscountPct,
        suggestion,
        purchases,
        topCategories,
        comms: { counts: { whatsapp: waCount, calls: callCount, tickets: repairCount + helpCount }, lastContactAt, recent },
        deals: otherDeals.slice(0, 5).map((e) => ({ id: e.ref!.id, title: e.title.replace(/^Deal — /, ""), status: e.detail ?? "", at: e.at })),
    };
}
