import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { SalaryLine } from "./salaryLines";
import { COMMISSION_PROFILE_SELECT, commissionForUsers, loadGlobalSchemes, modeOf, schemesFor, toCommissionSchemeDto } from "./commissionServer";

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
 *   • `commissionForPeriod` is what payroll asks. It reads each person's dated
 *     schemes (the Targets & Commission page, /office/hr/commission) and hands
 *     back what the period earned; with no scheme on file the answer is the
 *     honest one — nothing.
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
}

/**
 * Commission for everyone on a run, for the period it pays.
 *
 * Returns a map keyed by userId; a person absent from the map earned nothing,
 * which is not the same as earning zero and is why the map is sparse.
 *
 * The Commission page exists now (2026-09-22, /office/hr/commission): each
 * person carries dated schemes, and `commissionForUsers` judges the period
 * month by month against the scheme in force — see commissionServer.ts. What
 * comes back is frozen onto the line by the caller and never recomputed.
 */
export async function commissionForPeriod(
    db: Prisma.TransactionClient,
    userIds: readonly number[],
    fromIso: string,
    toIso: string,
): Promise<Map<number, CommissionResult>> {
    if (!userIds.length) return new Map();
    const [global, profiles] = await Promise.all([
        loadGlobalSchemes(db),
        db.staffProfile.findMany({ where: { userId: { in: [...userIds] } }, select: { userId: true, ...COMMISSION_PROFILE_SELECT } }),
    ]);
    // A person with no HR profile row yet is on GLOBAL - the default the row
    // would carry - so the shop scheme reaches everyone the day it is set.
    const byUser = new Map(profiles.map((p) => [p.userId, p]));
    const people = userIds.map((userId) => {
        const p = byUser.get(userId);
        return { userId, schemes: schemesFor(modeOf(p?.commissionMode), (p?.commissionSchemes ?? []).map(toCommissionSchemeDto), global) };
    });
    const earned = await commissionForUsers(db, people, fromIso, toIso);
    const out = new Map<number, CommissionResult>();
    for (const [userId, e] of earned) out.set(userId, { userId, commissionPaise: e.commissionPaise, basis: e.basis });
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
