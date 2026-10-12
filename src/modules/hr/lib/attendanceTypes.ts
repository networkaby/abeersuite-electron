// Wire shapes for the register, holidays and leave. Dates are ISO yyyy-mm-dd.

import type { AttendanceStatus, LeaveKind, LeaveStatus } from "@/shared/lib/schemas/hrAttendanceSchema";
import type { SeasonalHours } from "@/shared/lib/hr/seasonalHours";
import type { AttendanceReview } from "@/shared/lib/hr/attendanceReview";

export interface AttendanceMark {
    status: AttendanceStatus;
    source: "COUNTER" | "OFFICE";
    firstInAt: string | null;
    lastOutAt: string | null;
    /** Minutes actually worked — idle stretches excluded. 0 on an office mark. */
    workedMinutes: number;
    note: string | null;
}

export interface RegisterPerson {
    id: number;
    name: string;
    avatarUrl: string | null;
    role: string | null;
    joinedOn: string | null;
    leftOn: string | null;
    weeklyOff: number[];
    /**
     * The branches this person belongs to, through the seats they hold. A
     * holiday listed for a branch is a holiday for these people only; one with
     * no branch is for everybody. See `holidayApplies`.
     */
    branchIds: string[];
    /** A full day's duty for this person TODAY, in minutes. See `own*` below. */
    dutyMinutes: number;
    /** Office hours "HH:MM" in shop time — the start decides who is late. */
    dutyStart: string;
    dutyEnd: string;
    /**
     * What this person actually has SET, before any fallback — null where they
     * simply follow the shop.
     *
     * The three fields above are the resolved answer for today, which is fine for
     * a heading and wrong for a register: the shop's opening moves through the
     * year, so a December day and a June day do not owe the same hours. The grid
     * re-resolves per day from these raw values plus `seasonal`, and a person with
     * hours of their own resolves to the same figure every day, as they should.
     */
    ownDutyMinutes: number | null;
    ownDutyStart: string | null;
    ownDutyEnd: string | null;
    /** The shop's seasonal hours, so the grid can work out any day's opening. */
    seasonal: SeasonalHours;
    /** Stored marks by ISO date. Days absent here are read off the calendar. */
    marks: Record<string, AttendanceMark>;
    /** Approved leave days inside the range, by ISO date → kind. */
    leaveDays: Record<string, LeaveKind>;
}

export interface HolidayDto {
    id: number;
    date: string;
    name: string;
    branchId: string | null;
}

export interface RegisterPayload {
    from: string;
    to: string;
    people: RegisterPerson[];
    holidays: HolidayDto[];
}

/**
 * One person on one day, as Employee Activity's day review shows it: what the
 * till measured, what that grades to against THAT day's duty, and the owner's
 * decision on it. Every minute figure is the clock's own, before any decision.
 */
export interface DayReviewRow {
    userId: number;
    name: string;
    avatarUrl: string | null;
    role: string | null;
    /**
     * CLOCK  — the till measured minutes; a decision is wanted.
     * OFFICE — a person marked the day; it already is a decision.
     * IDLE   — a till row with no minutes measured; nothing to decide.
     * NONE   — no row at all; the calendar answers (paid as a normal day).
     */
    kind: "CLOCK" | "OFFICE" | "IDLE" | "NONE";
    /** The stored status, when there is a row. */
    status: AttendanceStatus | null;
    firstInAt: string | null;
    /** The shift close, or failing that the last sign of life. */
    lastOutAt: string | null;
    workedMinutes: number;
    dutyMinutes: number;
    dutyStart: string;
    dutyEnd: string;
    /** What the minutes grade to — PRESENT · HALF_DAY · ABSENT. */
    grade: "PRESENT" | "HALF_DAY" | "ABSENT";
    lateBy: number;
    overtimeMinutes: number;
    shortMinutes: number;
    weeklyOff: boolean;
    holidayName: string | null;
    leaveKind: LeaveKind | null;
    note: string | null;
    review: AttendanceReview | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
}

export interface DayReviewPayload {
    date: string;
    /** Today in shop time. Only days before it can be decided — today is still running. */
    today: string;
    rows: DayReviewRow[];
    /** Every past day with at least one till day waiting, oldest first. */
    waitingDates: string[];
}

export interface LeaveRequestDto {
    id: number;
    userId: number;
    userName: string;
    fromDate: string;
    toDate: string;
    days: number;
    kind: LeaveKind;
    reason: string | null;
    status: LeaveStatus;
    decidedById: number | null;
    decidedAt: string | null;
    decisionNote: string | null;
    createdAt: string;
}
