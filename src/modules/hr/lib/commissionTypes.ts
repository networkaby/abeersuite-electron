// Wire shapes for Targets & Commission. Dates are ISO yyyy-mm-dd, money paise.

import type { CommissionOutcome, CommissionSchemeTerms } from "@/shared/lib/hr/commissionScheme";

/** One scheme revision as the screens see it. */
export interface CommissionSchemeDto extends CommissionSchemeTerms {
    id: number;
    userId: number;
    effectiveFrom: string;
    note: string | null;
    createdAt: string;
}

/** A month's sales against a scheme — the figures the card and the board show. */
export interface CommissionMonth {
    month: string;
    from: string;
    to: string;
    /** Sales counted so far (posted, own, returns taken off). */
    salesPaise: number;
    /** How many bills those sales came from. */
    billCount: number;
    /** The scheme those sales were judged by, or null when none was in force. */
    scheme: CommissionSchemeDto | null;
    outcome: CommissionOutcome | null;
    /** Working days left in the month, counting today. 0 for a past month. */
    daysLeft: number;
    /** Sales still needed to reach the target; 0 when met or no target. */
    shortPaise: number;
}

/** One person on the Targets & Commission board. */
export interface CommissionBoardRow {
    userId: number;
    name: string;
    avatarUrl: string | null;
    staffCode: string | null;
    /** The scheme in force today. */
    current: CommissionSchemeDto | null;
    /** Every revision, newest first. */
    history: CommissionSchemeDto[];
    thisMonth: CommissionMonth;
}

export interface CommissionBoardPayload {
    month: string;
    today: string;
    rows: CommissionBoardRow[];
    /** Everyone's sales this month, for the "team" line at the top. */
    teamSalesPaise: number;
}
