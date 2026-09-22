// Wire shapes for leave types and the balance counted against them.

export interface LeaveTypeDto {
    id: number;
    code: string;
    name: string;
    paid: boolean;
    /** Days allowed in a leave year. null = no limit. */
    yearlyQuota: number | null;
    carryForward: boolean;
    carryCap: number | null;
    /** Days of notice this kind must carry. null = follow the shop rule. */
    noticeDays: number | null;
    sortOrder: number;
    active: boolean;
}

export interface LeaveBalance {
    code: string;
    name: string;
    paid: boolean;
    quota: number | null;
    /** Approved days inside the leave year. */
    taken: number;
    /** Asked for and not yet decided — his own outstanding request. */
    pending: number;
    /** quota − taken, floored at zero. null when the kind has no limit. */
    left: number | null;
    /** How far past the quota the approved days already are. 0 when inside it. */
    over: number;
}

export interface LeaveBalancePayload {
    year: { from: string; to: string; label: string };
    balances: LeaveBalance[];
}
