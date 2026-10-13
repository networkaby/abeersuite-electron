import "server-only";

import { loadPayRules } from "@/modules/hr/lib/payRulesServer";
import { monthBounds } from "@/modules/hr/lib/attendanceCalendar";
import { attendanceLedgerFor, loadPayRulesContext } from "@/modules/hr/lib/payRulesApply";
import { pendingTotal } from "@/shared/lib/hr/payRules";
import type { MonthOvertime } from "@/shared/lib/hr/myDay";

/**
 * The month's overtime — what the counter's own card shows him.
 *
 * Payroll's own pending-duty walk (`attendanceLedgerFor`), not a second copy:
 * owner, 2026-10-13, *"after no previous duty due, extra counted to overtime"*.
 * A day's extra first makes up the duty pending from earlier days (short duty,
 * late and absence penalties); only what is left is overtime. So the figure on
 * his card and the figure on his payslip are one calculation.
 */
/* The shape lives in shared/lib/hr/myDay.ts — the login screen reads it too. */

export type { MonthOvertime };

export async function monthOvertimeFor(userId: number, todayIso: string): Promise<MonthOvertime> {
    const { from, to } = monthBounds(Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7)));
    const ctx = await loadPayRulesContext(await loadPayRules(), from, to);
    const { effect, days } = await attendanceLedgerFor(ctx, userId, from, to);
    const madeUpMinutes = days.reduce((t, d) => t + d.madeUp, 0);
    return {
        month: todayIso.slice(0, 7),
        surplusMinutes: madeUpMinutes + effect.payableMinutes + effect.weeklyOffMinutes,
        weeklyOffMinutes: effect.weeklyOffMinutes,
        shortfallMinutes: days.reduce((t, d) => t + pendingTotal(d.added), 0),
        madeUpMinutes,
        payableMinutes: effect.payableMinutes,
        owedMinutes: effect.owedMinutes,
    };
}
