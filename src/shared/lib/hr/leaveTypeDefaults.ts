// The leave types the shop starts with, and the leave year they are counted in.
//
// These four codes are the ones `LeaveRequest.kind` has always stored, so seeding
// them leaves every existing request valid. They are only the STARTING point: the
// quota is master data from here on, edited on Calendar & Hours, and a reseed must
// never overwrite a number the owner has changed.
//
// Owner, 2026-09-22: casual and sick get a yearly quota; earned is left without one
// until the earned-leave policy is settled; unpaid can never run out, by definition.
// Going over a quota does NOT block — the apply box warns, HR still decides, and the
// days beyond the quota are treated as unpaid.

export interface LeaveTypeDefault {
    code: string;
    name: string;
    paid: boolean;
    /** Days allowed in a leave year. null = no limit. */
    yearlyQuota: number | null;
    /** Days of notice a request must carry. 0 = may be asked for on the day. */
    noticeDays: number;
    sortOrder: number;
}

export const LEAVE_TYPE_DEFAULTS: LeaveTypeDefault[] = [
    { code: "CASUAL", name: "Casual", paid: true,  yearlyQuota: 12,   noticeDays: 3, sortOrder: 1 },
    // Nobody can give three days' notice of a fever, so sick leave carries none.
    { code: "SICK",   name: "Sick",   paid: true,  yearlyQuota: 12,   noticeDays: 0, sortOrder: 2 },
    { code: "EARNED", name: "Earned", paid: true,  yearlyQuota: null, noticeDays: 3, sortOrder: 3 },
    { code: "UNPAID", name: "Unpaid", paid: false, yearlyQuota: null, noticeDays: 3, sortOrder: 4 },
];

/**
 * The leave year runs 1 April → 31 March, the same year the books keep. A quota
 * is spent inside one of these, and 1 April starts everyone at nothing taken.
 */
export const LEAVE_YEAR_START_MONTH = 4;

/** The leave year an ISO date falls in, as its two bounding dates. */
export function leaveYearOf(iso: string): { from: string; to: string; label: string } {
    const year = Number(iso.slice(0, 4));
    const month = Number(iso.slice(5, 7));
    const startYear = month >= LEAVE_YEAR_START_MONTH ? year : year - 1;
    const mm = String(LEAVE_YEAR_START_MONTH).padStart(2, "0");
    // Day 0 of the next year's start month = the day before it. Computed rather
    // than written down, so moving the start month cannot leave a wrong 31 behind.
    const end = new Date(Date.UTC(startYear + 1, LEAVE_YEAR_START_MONTH - 1, 0));
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
        from: `${startYear}-${mm}-01`,
        to: `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`,
        label: `${startYear}–${String(startYear + 1).slice(2)}`,
    };
}
