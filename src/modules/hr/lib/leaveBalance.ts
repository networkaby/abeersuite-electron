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
