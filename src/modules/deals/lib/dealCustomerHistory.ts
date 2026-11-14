import { prisma } from "@/shared/lib/prisma/prismaClient";
import { phoneMatchKey } from "@/shared/lib/format";
import { CUSTOMER_SALE_VOUCHER_TYPES } from "@/shared/lib/constants/accounting";
import { closingForAccounts } from "@/modules/accountancy/lib/aggregateLedger";
import { editFormUrl } from "@/modules/inventory/lib/voucherFormUrls";
import { buildCustomerTimeline, resolveAccountId, type CustomerRef, type TimelineEntry } from "@/modules/crm/lib/customerTimeline";

/**
 * Deal screen — third column: who this customer is, how they buy, how we have
 * talked to them, and a simple Hot / Warm / Cold read. Reuses the Reconnect
 * timeline (sales, deals, calls, WhatsApp, repairs, enquiries) and adds the
 * buying numbers the deal needs. One call per deal; the route caches it.
 */

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
        key: string; at: string; item: string; qty: number;
        /** What the customer paid for this line — after discount, GST included. */
        paidPaise: number;
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

/** Lower-case words, doubled letters squeezed and a plural "s" dropped ("Pendrrives" → "pendrive"). */
function words(text: string): string[] {
    return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
        .map((w) => w.replace(/(.)\1+/g, "$1").replace(/(?<=.{4})s$/, ""));
}

/** Words in the deal title / notes worth matching against what they bought. */
function keywords(text: string): string[] {
    return [...new Set(words(text).filter((w) => w.length >= 4 && !/^\d+$/.test(w)))];
}

/** Edit distance with swaps (Damerau–Levenshtein, optimal string alignment). */
function editDistance(a: string, b: string): number {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
    }
    return d[a.length][b.length];
}

/**
 * Does a deal keyword name this product, allowing spelling mistakes?
 * Product words are also tried two at a time joined ("pen drive" ↔ "pendrive").
 * Allowed mistakes (first letter must match): 1 from 6 letters, 2 from 8;
 * a short form at the start also counts ("mous" → "mouse", 4+ letters).
 */
function sameKind(keys: string[], productText: string): boolean {
    const w = words(productText);
    const pool = [...w, ...w.slice(1).map((x, i) => w[i] + x)].filter((x) => x.length >= 3);
    return keys.some((k) => pool.some((p) => {
        if (p === k) return true;
        if (Math.min(p.length, k.length) >= 4 && (p.startsWith(k) || k.startsWith(p))) return true;
        // Spelling slips keep the first letter; short words need an exact match
        // (cable ≠ table, mouse ≠ house).
        const long = Math.max(k.length, p.length);
        if (p[0] !== k[0] || long < 6 || Math.abs(p.length - k.length) > 2) return false;
        return editDistance(k, p) <= (long >= 8 ? 2 : 1);
    }));
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
    const titleKeys = keywords(`${deal.ticket.title ?? ""} ${deal.ticket.notes ?? ""}`);

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
    const saleWhere = accountId ? { partyAccountId: accountId, status: "POSTED" as const, type: { in: [...CUSTOMER_SALE_VOUCHER_TYPES] } } : null;

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
                    id: true, quantity: true, amount: true,
                    product: { select: { name: true, category: { select: { name: true } } } },
                    universalVoucher: { select: { id: true, type: true, date: true, voucherNo: true } },
                },
            })
            : Promise.resolve([]),
        saleWhere
            ? prisma.voucherInventoryLine.aggregate({ where: { universalVoucher: saleWhere }, _sum: { amount: true, discountAmt: true, taxAmount: true } })
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
    // Discount is on the pre-GST price: taxable (amount − GST) + discount = list value.
    const gross = Number(discount?._sum.amount ?? 0) - Number(discount?._sum.taxAmount ?? 0) + Number(discount?._sum.discountAmt ?? 0);
    const avgDiscountPct = gross > 0 && Number(discount?._sum.discountAmt ?? 0) > 0
        ? Math.round((Number(discount!._sum.discountAmt) / gross) * 1000) / 10 : null;
    const due = accountId ? closing.get(accountId) ?? 0 : 0;

    const purchases = lines.slice(0, 8).map((l) => {
        return {
            key: `line:${l.id}`,
            at: l.universalVoucher.date.toISOString(),
            item: l.product.name,
            qty: Number(l.quantity),
            paidPaise: Math.round(Number(l.amount) * 100),
            match: sameKind(titleKeys, `${l.product.name} ${l.product.category?.name ?? ""}`),
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
        : `${tier} buyer — can offer a better price${lastMatch ? ` (last paid ₹${Math.round(lastMatch.paidPaise / Math.max(lastMatch.qty, 1) / 100).toLocaleString("en-IN")} each for ${lastMatch.item})` : ""}.`;

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
