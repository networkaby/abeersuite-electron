import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { moneyNumber, rupeesToPaise } from "@/shared/lib/format/moneyInr";
import {
    COMMISSION_RETURN_TYPES, COMMISSION_SALE_TYPES, computeCommission, isCommissionKind, parseSlabs,
} from "@/shared/lib/hr/commissionScheme";
import { isoDaysBetween, monthBounds, weekdayOf } from "./attendanceCalendar";
import { dateOnlyFromIso } from "./staffProfileServer";
import type { CommissionMonth, CommissionSchemeDto } from "./commissionTypes";

/**
 * Targets & Commission, server side — the reads the board, My Info and payroll
 * share. The arithmetic itself is in shared/lib/hr/commissionScheme.ts; this
 * file only fetches the sales and picks the scheme in force.
 *
 * WHOSE sale: the voucher's `createdById` — the person who rang the bill. There
 * is no salesman column on a voucher and none is invented here; when the shop
 * wants "sold by" separate from "billed by", that is a voucher field first and
 * a change of one `where` below second.
 *
 * WHAT counts: posted, not deleted, of the sale kinds, less sale returns — the
 * figure a customer actually paid for, the same reading `tierSpend.ts` gives a
 * customer's own spend.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const SCHEME_SELECT = {
    id: true, userId: true, effectiveFrom: true, targetPaise: true, kind: true, rateBp: true,
    slabsJson: true, bonusPaise: true, note: true, createdAt: true,
} satisfies Prisma.CommissionSchemeSelect;

export type SchemeRow = Prisma.CommissionSchemeGetPayload<{ select: typeof SCHEME_SELECT }>;

export const COMMISSION_SCHEMES_INCLUDE = {
    commissionSchemes: { orderBy: { effectiveFrom: "desc" as const }, select: SCHEME_SELECT },
};

export function toCommissionSchemeDto(s: SchemeRow): CommissionSchemeDto {
    return {
        id: s.id,
        userId: s.userId,
        effectiveFrom: toDateOnlyUtc(s.effectiveFrom),
        targetPaise: s.targetPaise,
        kind: isCommissionKind(s.kind) ? s.kind : "NONE",
        rateBp: s.rateBp,
        slabs: parseSlabs(s.slabsJson),
        bonusPaise: s.bonusPaise,
        note: s.note,
        createdAt: s.createdAt.toISOString(),
    };
}

/** The revision in force on a day: the latest that had started by then. `schemes` in any order. */
export function schemeInForce(schemes: readonly CommissionSchemeDto[], iso: string): CommissionSchemeDto | null {
    let best: CommissionSchemeDto | null = null;
    for (const s of schemes) {
        if (s.effectiveFrom <= iso && (!best || s.effectiveFrom > best.effectiveFrom)) best = s;
    }
    return best;
}

export interface SalesTally {
    salesPaise: number;
    billCount: number;
}

/**
 * Each person's own posted sales inside a date range, returns taken off.
 * One query for everyone asked about — never one per head.
 */
export async function salesByUser(db: Db, userIds: readonly number[], fromIso: string, toIso: string): Promise<Map<number, SalesTally>> {
    const out = new Map<number, SalesTally>();
    if (!userIds.length || fromIso > toIso) return out;
    const rows = await db.universalVoucher.findMany({
        where: {
            createdById: { in: [...userIds] },
            status: "POSTED",
            deletedAt: null,
            type: { in: [...COMMISSION_SALE_TYPES, ...COMMISSION_RETURN_TYPES] },
            date: { gte: dateOnlyFromIso(fromIso), lte: dateOnlyFromIso(toIso) },
        },
        select: { createdById: true, type: true, voucherDetail: { select: { totalAmount: true } } },
    });
    for (const r of rows) {
        const amount = r.voucherDetail ? rupeesToPaise(moneyNumber(r.voucherDetail.totalAmount)) : 0;
        const isReturn = (COMMISSION_RETURN_TYPES as readonly string[]).includes(r.type);
        const t = out.get(r.createdById) ?? { salesPaise: 0, billCount: 0 };
        t.salesPaise += isReturn ? -amount : amount;
        if (!isReturn) t.billCount += 1;
        out.set(r.createdById, t);
    }
    return out;
}

/** Working days from `fromIso` to `toIso` inclusive, this person's weekly offs left out. */
function workingDaysLeft(fromIso: string, toIso: string, weeklyOff: readonly number[]): number {
    if (fromIso > toIso) return 0;
    const offs = new Set(weeklyOff);
    return isoDaysBetween(fromIso, toIso).filter((d) => !offs.has(weekdayOf(d))).length;
}

/**
 * One person's month against the scheme in force at its end — the figures the
 * card on My Info and the board row show. `tally` is this month's sales as
 * `salesByUser` returned them (absent = nothing sold).
 */
export function monthFor(
    schemes: readonly CommissionSchemeDto[],
    tally: SalesTally | undefined,
    month: string,
    today: string,
    weeklyOff: readonly number[],
): CommissionMonth {
    const { from, to } = monthBounds(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
    const scheme = schemeInForce(schemes, to);
    const salesPaise = tally?.salesPaise ?? 0;
    const outcome = scheme ? computeCommission(scheme, salesPaise) : null;
    const short = scheme && scheme.targetPaise > 0 ? Math.max(0, scheme.targetPaise - salesPaise) : 0;
    return {
        month, from, to,
        salesPaise,
        billCount: tally?.billCount ?? 0,
        scheme,
        outcome,
        daysLeft: today > to ? 0 : workingDaysLeft(today < from ? from : today, to, weeklyOff),
        shortPaise: short,
    };
}

/**
 * What a payroll period earned — month by month, because a target is a month's
 * and a run is a date range. Each calendar month the period touches is judged
 * on its own: the sales inside the overlap, against the scheme in force at the
 * overlap's last day, with the target scaled to the share of the month the run
 * covers (a run that pays 10 days of a 30-day month asks for a third of the
 * target). The months are then summed.
 */
export async function commissionForUsers(
    db: Db,
    people: readonly { userId: number; schemes: readonly CommissionSchemeDto[] }[],
    fromIso: string,
    toIso: string,
): Promise<Map<number, { commissionPaise: number; basis: string }>> {
    const out = new Map<number, { commissionPaise: number; basis: string }>();
    const withScheme = people.filter((p) => p.schemes.length);
    if (!withScheme.length || fromIso > toIso) return out;

    // The calendar months the period touches, each clipped to the period.
    const segments: { from: string; to: string; monthDays: number }[] = [];
    let cursor = fromIso;
    while (cursor <= toIso) {
        const b = monthBounds(Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7)));
        const to = b.to < toIso ? b.to : toIso;
        segments.push({ from: cursor, to, monthDays: isoDaysBetween(b.from, b.to).length });
        cursor = toDateOnlyUtc(new Date(dateOnlyFromIso(b.to).getTime() + 86_400_000));
    }

    for (const seg of segments) {
        const tallies = await salesByUser(db, withScheme.map((p) => p.userId), seg.from, seg.to);
        const share = isoDaysBetween(seg.from, seg.to).length / seg.monthDays;
        for (const p of withScheme) {
            const scheme = schemeInForce(p.schemes, seg.to);
            if (!scheme) continue;
            const sales = tallies.get(p.userId)?.salesPaise ?? 0;
            const target = Math.round(scheme.targetPaise * share);
            const o = computeCommission(scheme, sales, target);
            if (o.totalPaise <= 0) continue;
            const prev = out.get(p.userId) ?? { commissionPaise: 0, basis: "" };
            const note = `${seg.from.slice(0, 7)}: sold ${formatLakh(sales)}` +
                (target > 0 ? ` of ${formatLakh(target)} target` : "") +
                (o.bonusPaise > 0 ? ", bonus earned" : "");
            out.set(p.userId, {
                commissionPaise: prev.commissionPaise + o.totalPaise,
                basis: prev.basis ? `${prev.basis}; ${note}` : note,
            });
        }
    }
    return out;
}

/** ₹4,20,000 → "₹4.2L", ₹18,500 → "₹18,500" — short enough for a breakup line. */
function formatLakh(paise: number): string {
    const r = paise / 100;
    if (Math.abs(r) >= 100_000) return `₹${Number((r / 100_000).toFixed(2))}L`;
    return `₹${Math.round(r).toLocaleString("en-IN")}`;
}
