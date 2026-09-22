// Wire shapes for the register, holidays and leave. Dates are ISO yyyy-mm-dd.

import type { AttendanceStatus, LeaveKind, LeaveStatus } from "@/shared/lib/schemas/hrAttendanceSchema";
import type { SeasonalHours } from "@/shared/lib/hr/seasonalHours";

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
