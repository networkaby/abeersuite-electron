import { CUSTOMER_SALE_VOUCHER_TYPES } from "@/shared/lib/constants/accounting";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { isMissedCall } from "@/shared/lib/calls";
import { phoneMatchKey } from "@/shared/lib/format";
import { formatDate } from "@/shared/lib/format/formatDate";

/**
 * Reconnect — the customer's own unified timeline.
 *
 * The customer (Person or Company) IS the record. This merges everything that
 * ever happened to them into one time-sorted feed — sales, repairs, inquiries,
 * deals, and the notes/calls logged directly on them (TicketLog with a
 * personId/companyId, no ticket). From that feed we also derive a few
 * ready-to-say "talking points" so the caller opens warm.
 *
 * Two customer keys are in play (see codeOwnedCatalog / Account): sales + repairs
 * key on Account.id; inquiries + deals + notes key on personId/companyId. We
 * resolve the account up front and fan out.
 */

export type CustomerRef = { kind: "person" | "company"; id: number };

export type TimelineSource = "sale" | "payment" | "repair" | "inquiry" | "deal" | "note" | "call" | "message" | "meeting" | "task";

export interface TimelineEntry {
    /** Stable per-source key, e.g. "sale:1042". */
    key: string;
    /** ISO timestamp used for sorting + display. */
    at: string;
    source: TimelineSource;
    /** Headline line. */
    title: string;
    /** Optional secondary line (items, device, subject…). */
    detail?: string;
    amountPaise?: number;
    /** Where this came from, so the UI can deep-link. */
    ref?: { kind: "ticket" | "voucher"; id: number };
    /** Display name of who logged a note/call. */
    author?: string;
    /** Call direction (only on `call` entries). */
    direction?: "in" | "out";
    /** True for a miscall (incoming unanswered / outgoing unanswered) — the UI
     *  renders these with a distinct (red / amber) style. */
    missed?: boolean;
}

export interface TalkingPoint {
    /** A short, sayable opener grounded in real history. */
    line: string;
    /** Which timeline entry it was derived from (for UI context). */
    fromKey: string;
}

export interface CustomerTimeline {
    entries: TimelineEntry[];
    talkingPoints: TalkingPoint[];
    lastActivityAt: string | null;
}

/** Itemised customer sales — carry product lines ("you bought a laptop"). */
const SALE_TYPES = CUSTOMER_SALE_VOUCHER_TYPES;

/** Resolve the customer's ledger Account id (both Person & Company have exactly one). */
export async function resolveAccountId(ref: CustomerRef): Promise<number | null> {
    const account = await prisma.account.findFirst({
        where: ref.kind === "person" ? { personId: ref.id } : { companyId: ref.id },
        select: { id: true },
    });
    return account?.id ?? null;
}

/** "m:ss" (or "s sec" under a minute) — compact call length for the timeline. */
function callDurationLabel(sec: number): string {
    if (!sec || sec < 0) return "0s";
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${String(s).padStart(2, "0")}s`;
}

function actorName(author: unknown): string | undefined {
    if (author && typeof author === "object" && "name" in author) {
        const n = (author as { name?: unknown }).name;
        if (typeof n === "string" && n.trim()) return n;
    }
    return undefined;
}

/** Pull the call direction out of a TicketLog's `data` JSON, if present. */
function callDirection(data: unknown): "in" | "out" | undefined {
    if (data && typeof data === "object" && "direction" in data) {
        const d = (data as { direction?: unknown }).direction;
        if (d === "in" || d === "out") return d;
    }
    return undefined;
}

/** dd Mon — compact human date for talking points. */
function shortDate(iso: string): string {
    const d = new Date(iso);
    return formatDate(d);
}

/** "3 weeks ago" style relative age, Indian-English simple. */
function agoLabel(iso: string): string {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 14) return `${days} days ago`;
    if (days < 60) return `${Math.round(days / 7)} weeks ago`;
    if (days < 365) return `${Math.round(days / 30)} months ago`;
    return `${Math.round(days / 365)} year(s) ago`;
}

/**
 * Build one customer's full timeline + talking points.
 * `limit` caps each source before the merge (default 20).
 */
export async function buildCustomerTimeline(ref: CustomerRef, limit = 20): Promise<CustomerTimeline> {
    const accountId = await resolveAccountId(ref);
    const personId = ref.kind === "person" ? ref.id : undefined;
    const companyId = ref.kind === "company" ? ref.id : undefined;
    const partyWhere = ref.kind === "person" ? { personId } : { companyId };

    // ── Fan out across every source (each scoped to this one customer) ──────────
    // Any posted, non-deleted voucher on the account = a financial touch. Sales carry
    // product lines; receipts/others show as a plain payment entry.
    const salesWhere: Prisma.UniversalVoucherWhereInput | null = accountId
        ? { partyAccountId: accountId, status: "POSTED" }
        : null;

    // Auto-captured PBX calls have no customer FK — they're matched by phone.
    // Resolve this customer's numbers to match keys, then grab their (non-spam)
    // calls. A call logged before the customer existed lights up here retroactively.
    const phoneRows = await prisma.phone.findMany({ where: partyWhere, select: { phone: true } });
    const callKeys = Array.from(
        new Set(phoneRows.map((p) => phoneMatchKey(p.phone)).filter((k): k is string => !!k)),
    );

    const [sales, repairs, inquiries, deals, logs, calls, messages] = await Promise.all([
        salesWhere
            ? prisma.universalVoucher.findMany({
                where: salesWhere,
                orderBy: { date: "desc" },
                take: limit,
                select: {
                    id: true,
                    type: true,
                    date: true,
                    voucherNo: true,
                    voucherDetail: { select: { totalAmount: true } },
                    inventoryLines: {
                        take: 6,
                        select: { quantity: true, product: { select: { name: true } } },
                    },
                },
            })
            : Promise.resolve([]),
        accountId
            ? prisma.ticket.findMany({
                where: { accountId, repair: { isNot: null } },
                orderBy: { createdAt: "desc" },
                take: limit,
                select: {
                    id: true,
                    createdAt: true,
                    ticketStatus: { select: { label: true } },
                    repair: {
                        select: {
                            receivedBackAt: true,
                            device: { select: { type: true, brand: true, model: true, problem: true } },
                        },
                    },
                },
            })
            : Promise.resolve([]),
        prisma.ticketHelp.findMany({
            where: partyWhere,
            orderBy: { ticket: { createdAt: "desc" } },
            take: limit,
            select: {
                subject: true,
                inquiryType: true,
                ticket: { select: { id: true, createdAt: true, ticketStatus: { select: { label: true } } } },
            },
        }),
        prisma.ticketDeal.findMany({
            where: partyWhere,
            orderBy: { ticket: { createdAt: "desc" } },
            take: limit,
            select: {
                valuePaise: true,
                ticket: { select: { id: true, title: true, createdAt: true, ticketStatus: { select: { label: true } } } },
            },
        }),
        prisma.ticketLog.findMany({
            where: partyWhere,
            orderBy: { createdAt: "desc" },
            take: limit,
            select: { id: true, kind: true, note: true, author: true, createdAt: true, data: true },
        }),
        callKeys.length
            ? prisma.call.findMany({
                where: { phone: { in: callKeys }, spam: false },
                orderBy: { occurredAt: "desc" },
                take: limit,
                select: {
                    id: true,
                    direction: true,
                    occurredAt: true,
                    note: true,
                    durationSec: true,
                    speechSec: true,
                },
            })
            : Promise.resolve([]),
        // Customer messages (WhatsApp …) — matched by phone, the same as calls.
        callKeys.length
            ? prisma.message.findMany({
                where: { phone: { in: callKeys }, spam: false, direction: { not: "NOTE" }, ticketId: null }, // ticket-linked chats live in ticket history; staff @mention notes are internal
                orderBy: { occurredAt: "desc" },
                take: limit,
                select: { id: true, channel: true, direction: true, body: true, occurredAt: true, ticketId: true },
            })
            : Promise.resolve([]),
    ]);

    const entries: TimelineEntry[] = [];

    for (const v of sales) {
        const isSale = (SALE_TYPES as readonly string[]).includes(v.type);
        const items = v.inventoryLines.map((l) => l.product.name).filter(Boolean);
        const label = items.length ? items.slice(0, 3).join(", ") + (items.length > 3 ? "…" : "") : undefined;
        entries.push({
            key: `voucher:${v.id}`,
            at: v.date.toISOString(),
            source: isSale ? "sale" : "payment",
            title: isSale ? (v.type === "POS" ? "Counter sale" : v.type === "ONLINE_INVOICE" ? "Online order" : "Sale") : "Payment",
            detail: isSale ? label : undefined,
            amountPaise: v.voucherDetail?.totalAmount != null ? Math.round(Number(v.voucherDetail.totalAmount) * 100) : undefined,
            ref: { kind: "voucher", id: v.id },
        });
    }

    for (const t of repairs) {
        const d = t.repair?.device;
        const dev = d ? [d.brand, d.type].filter(Boolean).join(" ") : "device";
        entries.push({
            key: `repair:${t.id}`,
            at: (t.repair?.receivedBackAt ?? t.createdAt).toISOString(),
            source: "repair",
            title: `Service — ${dev}`,
            detail: [d?.problem, t.ticketStatus?.label].filter(Boolean).join(" · ") || undefined,
            ref: { kind: "ticket", id: t.id },
        });
    }

    for (const h of inquiries) {
        entries.push({
            key: `inquiry:${h.ticket.id}`,
            at: h.ticket.createdAt.toISOString(),
            source: "inquiry",
            title: `Enquiry — ${h.inquiryType}`,
            detail: [h.subject, h.ticket.ticketStatus?.label].filter(Boolean).join(" · ") || undefined,
            ref: { kind: "ticket", id: h.ticket.id },
        });
    }

    for (const dl of deals) {
        entries.push({
            key: `deal:${dl.ticket.id}`,
            at: dl.ticket.createdAt.toISOString(),
            source: "deal",
            title: dl.ticket.title ? `Deal — ${dl.ticket.title}` : "Deal",
            detail: dl.ticket.ticketStatus?.label ?? undefined,
            amountPaise: dl.valuePaise ?? undefined,
            ref: { kind: "ticket", id: dl.ticket.id },
        });
    }

    for (const l of logs) {
        const source: TimelineSource =
            l.kind === "CALL" ? "call" : l.kind === "MEETING" ? "meeting" : l.kind === "TASK" ? "task" : "note";
        const dir = l.kind === "CALL" ? callDirection(l.data) : undefined;
        entries.push({
            key: `log:${l.id}`,
            at: l.createdAt.toISOString(),
            source,
            title: l.kind === "CALL"
                ? (dir === "in" ? "Call — incoming" : dir === "out" ? "Call — outgoing" : "Call")
                : l.kind === "MEETING" ? "Meeting" : l.kind === "TASK" ? "Task" : "Note",
            detail: l.note ?? undefined,
            author: actorName(l.author),
            direction: dir,
        });
    }

    // Auto-captured PBX calls (Call table, matched by phone). Rendered as "call"
    // entries alongside the manual TicketLog calls above.
    for (const c of calls) {
        const incoming = c.direction === "INCOMING";
        const outgoing = c.direction === "OUTGOING";
        const missed = isMissedCall(c.direction, c.speechSec, c.durationSec);
        const summary = missed
            ? (incoming ? "Missed call" : "No answer")
            : incoming
                ? `Answered (${callDurationLabel(c.speechSec || c.durationSec)})`
                : `Called (${callDurationLabel(c.durationSec)})`;
        entries.push({
            key: `call:${c.id}`,
            at: c.occurredAt.toISOString(),
            source: "call",
            title: incoming ? "Call — incoming" : outgoing ? "Call — outgoing" : "Call",
            detail: c.note ? c.note : summary,
            direction: incoming ? "in" : outgoing ? "out" : undefined,
            missed,
        });
    }

    for (const m of messages) {
        const channel = m.channel === "EMAIL" ? "Email" : "WhatsApp";
        entries.push({
            key: `message:${m.id}`,
            at: m.occurredAt.toISOString(),
            source: "message",
            title: m.direction === "IN" ? `${channel} — from customer` : `${channel} — sent`,
            detail: m.body,
            direction: m.direction === "IN" ? "in" : "out",
            ref: m.ticketId ? { kind: "ticket", id: m.ticketId } : undefined,
        });
    }

    entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

    return {
        entries,
        talkingPoints: deriveTalkingPoints(entries),
        lastActivityAt: entries[0]?.at ?? null,
    };
}

/**
 * Turn the raw timeline into a few sayable openers. Deliberately simple + honest —
 * each line points back at a real entry, so the caller can trust it. Extend by
 * adding more rules here; order = priority (most trust-building first).
 */
export function deriveTalkingPoints(entries: TimelineEntry[]): TalkingPoint[] {
    const points: TalkingPoint[] = [];

    const lastRepair = entries.find((e) => e.source === "repair");
    if (lastRepair) {
        const dev = lastRepair.title.replace(/^Service — /, "");
        points.push({
            line: `We serviced your ${dev} ${agoLabel(lastRepair.at)} (${shortDate(lastRepair.at)}). Is it working properly now?`,
            fromKey: lastRepair.key,
        });
    }

    const lastSale = entries.find((e) => e.source === "sale" && e.detail);
    if (lastSale?.detail) {
        points.push({
            line: `You bought ${lastSale.detail} ${agoLabel(lastSale.at)}. How is it working out?`,
            fromKey: lastSale.key,
        });
    }

    const lastInquiry = entries.find((e) => e.source === "inquiry");
    if (lastInquiry) {
        const subj = lastInquiry.detail?.split(" · ")[0];
        points.push({
            line: subj
                ? `You had asked about "${subj}" ${agoLabel(lastInquiry.at)}. Did you get what you needed?`
                : `You had an enquiry ${agoLabel(lastInquiry.at)}. Did we sort it out for you?`,
            fromKey: lastInquiry.key,
        });
    }

    // Dormancy nudge — only when nothing better and there IS a last touch.
    const last = entries[0];
    if (points.length === 0 && last) {
        points.push({
            line: `We haven't been in touch since ${shortDate(last.at)} (${agoLabel(last.at)}). Just checking in — how are things?`,
            fromKey: last.key,
        });
    }

    return points.slice(0, 3);
}
