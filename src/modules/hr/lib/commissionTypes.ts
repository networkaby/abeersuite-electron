// Wire shapes for Targets & Commission. Dates are ISO yyyy-mm-dd, money paise.

import type { CommissionMode, CommissionOutcome, CommissionSchemeTerms } from "@/shared/lib/hr/commissionScheme";

/** One scheme revision as the screens see it. `userId` null = the shop's global scheme. */
export interface CommissionSchemeDto extends CommissionSchemeTerms {
    id: number;
    userId: number | null;
    effectiveFrom: string;
    note: string | null;
    createdAt: string;
}

/** A month's sales against the scheme that applies — the figures the card and the board show. */
export interface CommissionMonth {
    month: string;
    from: string;
    to: string;
    /** Sales counted so far (posted, own, returns taken off). */
    salesPaise: number;
    /** How many bills those sales came from. */
    billCount: number;
    /** Where the scheme came from: the shop's, the person's own, or switched off. */
    mode: CommissionMode;
    /** The scheme those sales were judged by, or null when none applies. */
    scheme: CommissionSchemeDto | null;
    outcome: CommissionOutcome | null;
    /** Working days left in the month, counting today. 0 for a past month. */
    daysLeft: number;
}

/** One person on the Targets & Commission board. */
export interface CommissionBoardRow {
    userId: number;
    name: string;
    avatarUrl: string | null;
    /** The user's role label — the "user kind" a head can be limited to. */
    role: string | null;
    staffCode: string | null;
    mode: CommissionMode;
    /** The person's OWN scheme in force today (null when they have none, whatever the mode). */
    own: CommissionSchemeDto | null;
    /** Every own revision, newest first. */
    history: CommissionSchemeDto[];
    thisMonth: CommissionMonth;
}

export interface CommissionBoardPayload {
    month: string;
    today: string;
    /** The shop's scheme in force today, and all its revisions newest first. */
    global: CommissionSchemeDto | null;
    globalHistory: CommissionSchemeDto[];
    rows: CommissionBoardRow[];
    /** Everyone's sales this month, for the "team" line at the top. */
    teamSalesPaise: number;
}
