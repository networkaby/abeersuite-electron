// Wire shape for "My Info" — one person's own month. Dates are ISO yyyy-mm-dd.
//
// Deliberately built on the register's own `RegisterPerson`, so the self page and
// the office register read a day through the very same `readDay` / `summarise`
// and cannot end up telling two different stories about it.

import type { MonthOvertime } from "@/shared/lib/hr/myDay";
import type { HolidayDto, LeaveRequestDto, RegisterPerson } from "./attendanceTypes";

export interface MyHrPayload {
    /** The month being shown, YYYY-MM. */
    month: string;
    from: string;
    to: string;
    /** The shop's today, so the client never trusts the browser's clock. */
    today: string;
    person: RegisterPerson;
    holidays: HolidayDto[];
    /** My own requests only — pending first, newest first. */
    leaves: LeaveRequestDto[];
    overtime: MonthOvertime;
    staffCode: string | null;
    /** Whether `month` is the one we are living in — a past month has no "today". */
    isCurrentMonth: boolean;
    /** Days lost so far this month — absent counts 1, half counts 0.5. */
    lostDays: number;
}
