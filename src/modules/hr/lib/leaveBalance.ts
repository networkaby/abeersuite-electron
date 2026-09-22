import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { leaveYearOf } from "@/shared/lib/hr/leaveTypeDefaults";
import type { LeaveBalance, LeaveTypeDto } from "./leaveTypes";

/**
 * How much leave of each kind a person has left in a leave year.
 *
 * COMPUTED, never stored — the same rule the chart of accounts follows. A stored
 * balance is one more thing that can drift from the rows it claims to summarise,
 * and this one is bounded: one person, one year, a handful of requests.
 *
 * What counts as "taken" is an APPROVED request whose days fall inside the year.
 * A pending one is shown separately, because a person about to ask for four more
 * days needs to know his own outstanding ask, and HR needs to see it before saying
 * yes twice over. Rejected and cancelled requests count for nothing.
 *
 * A request straddling 31 March is split at the boundary, so each year is charged
 * only for its own days.
 *
 * Going over a quota does NOT block anything (the owner's call): `over` simply says
 * by how much, the apply box warns, and HR still decides. The days beyond the quota
 * are the ones payroll should treat as unpaid.
 */

/** Days of a request that fall inside [from, to], both ends counted. */
function daysInside(fromDate: Date, toDate: Date, from: string, to: string): number {
    const a = toDateOnlyUtc(fromDate);
    const b = toDateOnlyUtc(toDate);
    const start = a > from ? a : from;
    const end = b < to ? b : to;
    if (end < start) return 0;
    const ms = Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`);
    return Math.round(ms / 86_400_000) + 1;
}

export async function leaveBalancesFor(
    userId: number,
    onIso: string,
    tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ year: { from: string; to: string; label: string }; balances: LeaveBalance[] }> {
    const year = leaveYearOf(onIso);
    const [types, requests] = await Promise.all([
        tx.leaveType.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
        tx.leaveRequest.findMany({
            where: {
                userId,
                status: { in: ["APPROVED", "PENDING"] },
                fromDate: { lte: new Date(`${year.to}T00:00:00.000Z`) },
                toDate: { gte: new Date(`${year.from}T00:00:00.000Z`) },
            },
            select: { fromDate: true, toDate: true, kind: true, status: true },
        }),
    ]);

    const taken = new Map<string, number>();
    const pending = new Map<string, number>();
    for (const r of requests) {
        const d = daysInside(r.fromDate, r.toDate, year.from, year.to);
        if (d <= 0) continue;
        const bucket = r.status === "APPROVED" ? taken : pending;
        bucket.set(r.kind, (bucket.get(r.kind) ?? 0) + d);
    }

    const balances = types.map((t): LeaveBalance => {
        const used = taken.get(t.code) ?? 0;
        const waiting = pending.get(t.code) ?? 0;
        return {
            code: t.code,
            name: t.name,
            paid: t.paid,
            quota: t.yearlyQuota,
            taken: used,
            pending: waiting,
            // No quota means no limit, so there is nothing left to run out of.
            left: t.yearlyQuota === null ? null : Math.max(0, t.yearlyQuota - used),
            over: t.yearlyQuota === null ? 0 : Math.max(0, used - t.yearlyQuota),
        };
    });
    return { year, balances };
}

/** Wire shape for the types themselves, for the screen that edits them. */
export function toLeaveTypeDto(t: {
    id: number; code: string; name: string; paid: boolean; yearlyQuota: number | null;
    carryForward: boolean; carryCap: number | null; noticeDays: number | null;
    sortOrder: number; active: boolean;
}): LeaveTypeDto {
    return {
        id: t.id, code: t.code, name: t.name, paid: t.paid, yearlyQuota: t.yearlyQuota,
        carryForward: t.carryForward, carryCap: t.carryCap, noticeDays: t.noticeDays,
        sortOrder: t.sortOrder, active: t.active,
    };
}

/**
 * The approved leave days that are NOT paid, for one person overlapping a range.
 *
 * Two reasons a leave day goes unpaid, and this is the only place that decides:
 *
 *   1. Its kind is not a paid one — UNPAID, today.
 *   2. It is past the yearly quota of a paid kind. The owner's rule is that going
 *      over never blocks the request; it makes those days unpaid instead. Which
 *      days are "over" is settled by DATE: the year's approved days of that kind
 *      are laid out in order and everything after the quota is the part over it.
 *      So a person who has spent his twelve casual days keeps them, and only the
 *      thirteenth onwards is cut — never the other way round.
 *
 * Counted inside the LEAVE YEAR, not inside the payroll period: a quota is a year's
 * worth, so the days already spent before this month are what decide whether this
 * month's are over it. A range touching two leave years is counted in each.
 */
export async function unpaidLeaveDaysFor(
    userId: number,
    fromIso: string,
    toIso: string,
    tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Set<string>> {
    const years = new Map<string, { from: string; to: string }>();
    for (const iso of [fromIso, toIso]) {
        const y = leaveYearOf(iso);
        years.set(y.from, { from: y.from, to: y.to });
    }

    const types = await tx.leaveType.findMany({ select: { code: true, paid: true, yearlyQuota: true } });
    const byCode = new Map(types.map((t) => [t.code, t]));

    const unpaid = new Set<string>();
    for (const year of years.values()) {
        const requests = await tx.leaveRequest.findMany({
            where: {
                userId,
                status: "APPROVED",
                fromDate: { lte: new Date(`${year.to}T00:00:00.000Z`) },
                toDate: { gte: new Date(`${year.from}T00:00:00.000Z`) },
            },
            orderBy: { fromDate: "asc" },
            select: { fromDate: true, toDate: true, kind: true },
        });

        // Every approved day of the year, per kind, in date order.
        const daysByKind = new Map<string, string[]>();
        for (const r of requests) {
            const start = toDateOnlyUtc(r.fromDate) > year.from ? toDateOnlyUtc(r.fromDate) : year.from;
            const end = toDateOnlyUtc(r.toDate) < year.to ? toDateOnlyUtc(r.toDate) : year.to;
            if (end < start) continue;
            const list = daysByKind.get(r.kind) ?? [];
            const d = new Date(`${start}T00:00:00.000Z`);
            const stop = Date.parse(`${end}T00:00:00.000Z`);
            while (d.getTime() <= stop) {
                list.push(d.toISOString().slice(0, 10));
                d.setUTCDate(d.getUTCDate() + 1);
            }
            daysByKind.set(r.kind, list);
        }

        for (const [kind, days] of daysByKind) {
            const type = byCode.get(kind);
            // A kind with no type row is unknown to the shop; it is not going to be
            // docked on a guess, so it is treated as paid until somebody defines it.
            if (!type) continue;
            days.sort();
            const over = type.paid ? (type.yearlyQuota === null ? [] : days.slice(type.yearlyQuota)) : days;
            for (const iso of over) {
                if (iso >= fromIso && iso <= toIso) unpaid.add(iso);
            }
        }
    }
    return unpaid;
}
