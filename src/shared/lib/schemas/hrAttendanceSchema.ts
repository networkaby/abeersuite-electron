// Request-side validation for attendance, holidays and leave.

import { z } from "zod";

export const ATTENDANCE_STATUSES = ["PRESENT", "HALF_DAY", "ABSENT", "LEAVE", "WEEKLY_OFF", "HOLIDAY"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_STATUS_META: Record<AttendanceStatus, { label: string; short: string }> = {
    PRESENT:    { label: "Present",    short: "P" },
    HALF_DAY:   { label: "Half day",   short: "½" },
    ABSENT:     { label: "Absent",     short: "A" },
    LEAVE:      { label: "Leave",      short: "L" },
    WEEKLY_OFF: { label: "Weekly off", short: "W" },
    HOLIDAY:    { label: "Holiday",    short: "H" },
};

export const LEAVE_KINDS = ["CASUAL", "SICK", "EARNED", "UNPAID"] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];
export const LEAVE_KIND_LABELS: Record<LeaveKind, string> = {
    CASUAL: "Casual", SICK: "Sick", EARNED: "Earned", UNPAID: "Unpaid",
};

export const LEAVE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/** PUT /api/hr/attendance — mark one day. `status: null` clears the mark. */
export const attendanceMarkSchema = z.object({
    userId: z.number().int().positive(),
    date:   isoDate,
    status: z.enum(ATTENDANCE_STATUSES).nullable(),
    note:   z.string().trim().max(200).nullable().optional(),
});

export const holidayCreateSchema = z.object({
    date:     isoDate,
    name:     z.string().trim().min(1, "A holiday needs a name").max(80),
    branchId: z.string().trim().min(1).nullable().optional(),
});

export const leaveCreateSchema = z.object({
    userId:   z.number().int().positive().optional(),   // HR may file for someone; default = self
    fromDate: isoDate,
    toDate:   isoDate,
    kind:     z.enum(LEAVE_KINDS).default("CASUAL"),
    reason:   z.string().trim().max(300).nullable().optional(),
}).refine((v) => v.toDate >= v.fromDate, { message: "The last day cannot be before the first", path: ["toDate"] });

export const leaveDecisionSchema = z.object({
    status:       z.enum(["APPROVED", "REJECTED", "CANCELLED"]),
    decisionNote: z.string().trim().max(300).nullable().optional(),
});

/* ── The notice a leave must carry ──────────────────────────────────────────
   Pay Rules shows this same number ("Leave must be applied at least N days
   before the leave day"); when that card becomes savable, both should read it
   from there instead of from here. Sick is outside the rule — illness gives no
   notice — and HR filing by hand is outside it too, which is why the check is
   asked for by the caller and not baked into leaveCreateSchema. */
export const LEAVE_NOTICE_DAYS = 3;
export const LEAVE_NOTICE_EXEMPT_KINDS: readonly LeaveKind[] = ["SICK"];

/** The first day a leave of this kind may be asked for, given today. */
export function earliestLeaveDate(kind: LeaveKind, today: string): string {
    const ahead = LEAVE_NOTICE_EXEMPT_KINDS.includes(kind) ? 0 : LEAVE_NOTICE_DAYS;
    const d = new Date(`${today}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + ahead);
    return d.toISOString().slice(0, 10);
}

/** Null when the notice is enough, else the sentence to show the person. */
export function leaveNoticeError(kind: LeaveKind, fromDate: string, today: string): string | null {
    const earliest = earliestLeaveDate(kind, today);
    if (fromDate >= earliest) return null;
    return LEAVE_NOTICE_EXEMPT_KINDS.includes(kind)
        ? "A leave cannot be asked for after the day is gone. Ask HR to file it for you."
        : `${LEAVE_KIND_LABELS[kind]} leave must be applied at least ${LEAVE_NOTICE_DAYS} days before the leave day — the earliest you can ask for is ${earliest}. Only sick leave is outside this rule; for anything urgent, ask HR to file it for you.`;
}
