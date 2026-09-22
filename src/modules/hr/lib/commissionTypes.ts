// Wire shapes for Targets & Commission. Dates are ISO yyyy-mm-dd, money paise.

import type { CommissionOutcome, CommissionRule } from "@/shared/lib/hr/commissionScheme";

/** One head of the catalogue as the screens see it. */
export interface CommissionHeadDto {
    id: number;
    name: string;
    description: string | null;
    rule: CommissionRule;
    /** Globally on. An off head reaches nobody, whatever the overrides say. */
    active: boolean;
    /** Role labels this head is for. Empty = everyone. */
    appliesTo: string[];
    sortOrder: number;
}

/** One person's say over one head. */
export interface CommissionOverrideDto {
    userId: number;
    headId: number;
    /** Their own rate (share heads), null = the head's. */
    rateBp: number | null;
    /** Their own bonus (bonus / manual heads), null = the head's. */
    bonusPaise: number | null;
    off: boolean;
}

/** One thing done outside the app, typed in against a MANUAL head. */
export interface CommissionEntryDto {
    id: number;
    userId: number;
    headId: number;
    date: string;
    count: number;
    note: string | null;
}

/** One head as it applies to one person, after their override. */
export interface AppliedHead {
    headId: number;
    name: string;
    /** The head's rule with the person's own figure in place, and — for a MANUAL head — the month's count. */
    rule: CommissionRule;
    /** True when the rule's figure is the person's own, not the head's. */
    overridden: boolean;
    off: boolean;
    /** MANUAL only: the month's entries, newest first. */
    entries?: CommissionEntryDto[];
}

/** A month's sales against the heads that reach a person — the figures the card and the board show. */
export interface CommissionMonth {
    month: string;
    from: string;
    to: string;
    /** Sales counted so far (posted, own, returns taken off). */
    salesPaise: number;
    /** How many bills those sales came from. */
    billCount: number;
    /** Every head that reaches this person (on + their role), off-for-them ones included so the board can switch them back. */
    heads: AppliedHead[];
    /** The sales judged by the heads that are on for them; null when none is. */
    outcome: CommissionOutcome | null;
    /** Working days left in the month, counting today. 0 for a past month. */
    daysLeft: number;
}

/** One person on the Per person tab. */
export interface CommissionBoardRow {
    userId: number;
    name: string;
    avatarUrl: string | null;
    /** The user's role label — the "user kind" a head can be limited to. */
    role: string | null;
    staffCode: string | null;
    thisMonth: CommissionMonth;
}

export interface CommissionBoardPayload {
    month: string;
    today: string;
    heads: CommissionHeadDto[];
    /** Every role label the current staff carry, for the head form's "Applies to". */
    roles: string[];
    rows: CommissionBoardRow[];
    /** Everyone's sales this month, for the header line. */
    teamSalesPaise: number;
}
