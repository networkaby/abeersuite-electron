import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { moneyNumber, rupeesToPaise } from "@/shared/lib/format/moneyInr";
import {
    COMMISSION_RETURN_TYPES, COMMISSION_SALE_TYPES, computeCommission, isCommissionKind, parseSlabs,
    type CommissionRule,
} from "@/shared/lib/hr/commissionScheme";
import type { PayslipCommissionData } from "@/shared/components/print/PayslipBody";
import { isoDaysBetween, monthBounds, weekdayOf } from "./attendanceCalendar";
import { dateOnlyFromIso } from "./staffProfileServer";
import type { AppliedHead, CommissionHeadDto, CommissionMonth, CommissionOverrideDto } from "./commissionTypes";

/**
 * Targets & Commission, server side — the reads the board, My Info and payroll
 * share. The arithmetic itself is in shared/lib/hr/commissionScheme.ts; this
 * file fetches the heads, the overrides and the sales, and resolves WHICH
 * heads reach a person.
 *
 * WHICH heads: every head that is globally on and reaches the person's role
 * (`appliesTo` empty = everyone), minus the ones switched off for them, with
 * their own rate / bonus in place of the head's where they have one.
 *
 * WHOSE sale: the voucher's `createdById` — the person who rang the bill.
 *
 * WHAT counts: posted, not deleted, of the sale kinds, less sale returns — the
 * figure a customer actually paid for, the same reading `tierSpend.ts` gives.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const HEAD_SELECT = {
    id: true, name: true, description: true, kind: true, targetPaise: true, rateBp: true, slabsJson: true,
    bonusPaise: true, active: true, appliesTo: true, sortOrder: true,
} satisfies Prisma.CommissionHeadSelect;
export type HeadRow = Prisma.CommissionHeadGetPayload<{ select: typeof HEAD_SELECT }>;

const OVERRIDE_SELECT = { userId: true, headId: true, rateBp: true, bonusPaise: true, off: true } satisfies Prisma.CommissionOverrideSelect;

/** Everything the profile carries for a person's role and sales month. Spread into a User select. */
export const COMMISSION_USER_SELECT = {
    role: true,
    userRole: { select: { label: true } },
    staffProfile: { select: { weeklyOff: true, commissionOverrides: { select: OVERRIDE_SELECT } } },
};

export function toHeadDto(h: HeadRow): CommissionHeadDto {
    return {
        id: h.id,
        name: h.name,
        description: h.description,
        rule: {
            kind: isCommissionKind(h.kind) ? h.kind : "PERCENT",
            targetPaise: h.targetPaise,
            rateBp: h.rateBp,
            slabs: parseSlabs(h.slabsJson),
            bonusPaise: h.bonusPaise,
            label: h.name,
        },
        active: h.active,
        appliesTo: h.appliesTo,
        sortOrder: h.sortOrder,
    };
}

/** The whole catalogue, in display order — off heads included; the callers decide. */
export async function loadHeads(db: Db): Promise<CommissionHeadDto[]> {
    const rows = await db.commissionHead.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: HEAD_SELECT });
    return rows.map(toHeadDto);
}

/** The role label a head is matched against: the UserRole's label, else the raw role code. */
export const roleLabelOf = (u: { role: string | null; userRole: { label: string } | null }) => u.userRole?.label ?? u.role;

/** Does this head reach a person of this role? */
export const headAppliesTo = (h: CommissionHeadDto, role: string | null) => h.appliesTo.length === 0 || (!!role && h.appliesTo.includes(role));

/**
 * The heads that reach one person, each with their override applied.
 * Off-for-them heads are kept (flagged) so the board can switch them back;
 * `rulesOf` below drops them.
 */
export function appliedHeadsFor(heads: readonly CommissionHeadDto[], role: string | null, overrides: readonly CommissionOverrideDto[]): AppliedHead[] {
    const out: AppliedHead[] = [];
    for (const h of heads) {
        if (!h.active || !headAppliesTo(h, role)) continue;
        const o = overrides.find((x) => x.headId === h.id);
        let rule: CommissionRule = h.rule;
        let overridden = false;
        if (o?.rateBp != null && (h.rule.kind === "PERCENT" || h.rule.kind === "ABOVE_TARGET")) { rule = { ...rule, rateBp: o.rateBp }; overridden = true; }
        if (o?.bonusPaise != null && h.rule.kind === "BONUS") { rule = { ...rule, bonusPaise: o.bonusPaise }; overridden = true; }
        out.push({ headId: h.id, name: h.name, rule, overridden, off: !!o?.off });
    }
    return out;
}

/** The rules a person is actually judged by. */
export const rulesOf = (applied: readonly AppliedHead[]): CommissionRule[] => applied.filter((a) => !a.off).map((a) => a.rule);

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
 * One person's month against the heads that reach them — the figures the card
 * on My Info and the board row show. `tally` is this month's sales as
 * `salesByUser` returned them (absent = nothing sold).
 */
export function monthFor(
    applied: AppliedHead[],
    tally: SalesTally | undefined,
    month: string,
    today: string,
    weeklyOff: readonly number[],
): CommissionMonth {
    const { from, to } = monthBounds(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
    const rules = rulesOf(applied);
    const salesPaise = tally?.salesPaise ?? 0;
    return {
        month, from, to,
        salesPaise,
        billCount: tally?.billCount ?? 0,
        heads: applied,
        outcome: rules.length ? computeCommission({ rules }, salesPaise) : null,
        daysLeft: today > to ? 0 : workingDaysLeft(today < from ? from : today, to, weeklyOff),
    };
}

/** What a payroll period earned for one person: the total, and the working head by head for the slip. */
export interface PeriodCommission {
    commissionPaise: number;
    /** One line for the breakup: "2026-09: sold ₹1.2L against ₹1L". */
    basis: string;
    breakup: PayslipCommissionData;
}

/**
 * What a payroll period earned — month by month, because a target is a month's
 * and a run is a date range. Each calendar month the period touches is judged
 * on its own: the sales inside the overlap against the person's heads, with
 * every target scaled to the share of the month the run covers (a run that pays
 * 10 days of a 30-day month asks for a third). The months are then summed, and
 * the breakup keeps one line per head per month so the slip can show its working.
 */
export async function commissionForUsers(
    db: Db,
    people: readonly { userId: number; applied: readonly AppliedHead[] }[],
    fromIso: string,
    toIso: string,
): Promise<Map<number, PeriodCommission>> {
    const out = new Map<number, PeriodCommission>();
    const judged = people.map((p) => ({ userId: p.userId, on: p.applied.filter((a) => !a.off) })).filter((p) => p.on.length);
    if (!judged.length || fromIso > toIso) return out;

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
        const tallies = await salesByUser(db, judged.map((p) => p.userId), seg.from, seg.to);
        const scale = isoDaysBetween(seg.from, seg.to).length / seg.monthDays;
        const month = seg.from.slice(0, 7);
        for (const p of judged) {
            const sales = tallies.get(p.userId)?.salesPaise ?? 0;
            const o = computeCommission({ rules: p.on.map((a) => a.rule) }, sales, scale);
            if (o.totalPaise <= 0) continue;
            const prev = out.get(p.userId) ?? { commissionPaise: 0, basis: "", breakup: { salesPaise: 0, months: [] } };
            const note = `${month}: sold ${formatLakh(sales)}` + (o.topTargetPaise > 0 ? ` against ${formatLakh(o.topTargetPaise)}` : "");
            prev.commissionPaise += o.totalPaise;
            prev.basis = prev.basis ? `${prev.basis}; ${note}` : note;
            prev.breakup.salesPaise += sales;
            prev.breakup.months.push({
                month,
                salesPaise: sales,
                heads: o.rules.map((r, i) => ({
                    name: p.on[i].name,
                    terms: r.rule,
                    targetPaise: r.targetPaise,
                    paise: r.paise,
                })).filter((h) => h.paise > 0 || h.targetPaise > 0),
            });
            out.set(p.userId, prev);
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
