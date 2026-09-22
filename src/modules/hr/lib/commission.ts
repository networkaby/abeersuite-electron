import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { SalaryLine } from "./salaryLines";

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
 *   • `commissionForPeriod` is what payroll asks. Today it answers "nobody
 *     earned anything", because with no rules on file that is the only honest
 *     answer — a guess here would post money into the books.
 *   • When the Commission page lands, ONLY THE BODY of that function changes.
 *     Payroll, the payslip, the print template and the journal are already
 *     finished and need no edit, because of the second half below.
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
 * ── NOT IMPLEMENTED YET ──────────────────────────────────────────────────────
 * There are no commission rules on file, so nothing can be earned. This returns
 * an empty map, payroll adds no line, and every figure is exactly what it was
 * before commission existed. That is the point: the room is real, the money is
 * not invented.
 *
 * When the Commission page exists, this reads its schemes for the period and
 * returns the result. The arguments it will need are already here.
 */
export async function commissionForPeriod(
    _db: Prisma.TransactionClient,
    _userIds: readonly number[],
    _fromIso: string,
    _toIso: string,
): Promise<Map<number, CommissionResult>> {
    return new Map();
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
