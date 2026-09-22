import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { SalaryLine } from "./salaryLines";
import type { PayslipCommissionData } from "@/shared/components/print/PayslipBody";
import { COMMISSION_USER_SELECT, appliedHeadsFor, commissionForUsers, loadHeads, roleLabelOf } from "./commissionServer";

/**
 * Commission — the seam, not the sums.
 *
 * Owner, 2026-09-22: *"make room for commission in hr module, commission
 * calculation will be in commission page where verity of commission may be
 * created. that later part."*
 *
 * So HR decides NOTHING about commission. It does not know who earns it, what a
 * target is, what a slab is, or which bill counts. All of that belongs to a
 * Commission page that does not exist yet, where the varieties of commission
 * will be created. This file is the single door between the two, and it is
 * deliberately the whole of the contract:
 *
 *   • `commissionForPeriod` is what payroll asks. It reads the heads and each
 *     person's overrides (the Targets & Commission page, /office/hr/commission)
 *     and hands back what the period earned; with no head on the answer is
 *     the honest one — nothing.
 *   • Payroll, the payslip, the print template and the journal never changed
 *     for it, because of the second half below.
 *
 * The second half is `commissionLine`. A commission is not a new kind of money:
 * it is an EARNING pay head like Basic or Overtime. Once it is one, every
 * total, every slip and the journal itself carry it with no special case. The
 * `commissionPaise` column on the line is only a denormalised copy so a sheet
 * can show the commission part without parsing the JSON — exactly why
 * `grossPaise` sits beside `linesJson` today.
 *
 * The one rule this file DOES own, and the Commission page must respect: a
 * commission is frozen onto the payroll line when the run generates. A rule
 * edited next month can never rewrite what was already paid.
 */

/** The pay head a commission becomes. One name, so a payslip reads the same every month. */
export const COMMISSION_LINE_NAME = "Commission";

/** What one person earned in commission over a period, in paise. */
export interface CommissionResult {
    userId: number;
    /** Never negative — a clawback is a deduction and would be its own head. */
    commissionPaise: number;
    /**
     * Why it came to that, for the breakup under a person's row. Free text owned
     * by the Commission page ("₹4,20,000 sold · 1% to 1L, 1.5% above"). Null
     * while there are no rules.
     */
    basis: string | null;
    /** The working head by head, frozen onto the line for the slip. */
    breakup: PayslipCommissionData | null;
}

/**
 * Commission for everyone on a run, for the period it pays.
 *
 * Returns a map keyed by userId; a person absent from the map earned nothing,
 * which is not the same as earning zero and is why the map is sparse.
 *
 * The Commission page exists (/office/hr/commission): a catalogue of heads,
 * each on or off and for every role or a few, and a per-person override on any
 * of them. `commissionForUsers` judges the period month by month against the
 * heads that reach each person — see commissionServer.ts. What comes back is
 * frozen onto the line by the caller, head by head, and never recomputed.
 */
export async function commissionForPeriod(
    db: Prisma.TransactionClient,
    userIds: readonly number[],
    fromIso: string,
    toIso: string,
): Promise<Map<number, CommissionResult>> {
    if (!userIds.length) return new Map();
    const [heads, users] = await Promise.all([
        loadHeads(db),
        db.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, ...COMMISSION_USER_SELECT } }),
    ]);
    if (!heads.some((h) => h.active)) return new Map();
    const people = users.map((u) => ({
        userId: u.id,
        applied: appliedHeadsFor(heads, roleLabelOf(u), u.staffProfile?.commissionOverrides ?? []),
    }));
    const earned = await commissionForUsers(db, people, fromIso, toIso);
    const out = new Map<number, CommissionResult>();
    for (const [userId, e] of earned) out.set(userId, { userId, commissionPaise: e.commissionPaise, basis: e.basis, breakup: e.breakup });
    return out;
}

/**
 * The earning head a commission becomes, or null when there is none.
 *
 * Zero earns no line: a payslip that lists "Commission ₹0" every month for a
 * person who is not on any scheme is noise, and the column already says 0.
 */
export function commissionLine(commissionPaise: number): SalaryLine | null {
    if (!commissionPaise || commissionPaise <= 0) return null;
    return { name: COMMISSION_LINE_NAME, kind: "EARNING", amountPaise: Math.round(commissionPaise) };
}
