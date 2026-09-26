// Wire shapes of HR & People — what /api/hr/staff hands the screens.
// Dates travel as ISO yyyy-mm-dd strings; money as paise.

import type { PositionChipPosition } from "@/shared/components/PositionChip";
import type { SalaryLine } from "./salaryLines";

export type { SalaryLine };

export interface StaffProfileDto {
    staffCode: string | null;
    joinedOn: string | null;
    leftOn: string | null;
    leftReason: string | null;
    employmentType: string;
    weeklyOff: number[];
    /** A full day's duty in minutes; null = the org default (constants/hr.ts). */
    dutyMinutes: number | null;
    /** Office hours "HH:MM" in shop time; null = the shop default. */
    dutyStart: string | null;
    dutyEnd: string | null;
    /** Minutes away before sign-out; null = the default. */
    idleLimitMinutes: number | null;
    fatherName: string | null;
    address: string | null;
    bloodGroup: string | null;
    emergencyName: string | null;
    emergencyPhone: string | null;
    aadhaarLast4: string | null;
    panNumber: string | null;
    uanNumber: string | null;
    esiNumber: string | null;
    bankJson: unknown;
    notes: string | null;
    ledgerAccountId: number | null;
}

export interface StaffSalaryDto {
    id: number;
    effectiveFrom: string;
    /** Days a month this structure buys — one day is gross / this. Default 26. */
    payDays: number;
    lines: SalaryLine[];
    grossPaise: number;
    netPaise: number;
    note: string | null;
    createdAt: string;
}

/** One row of the Staff Directory. */
export interface StaffRow {
    id: number;
    name: string;
    email: string;
    title: string | null;
    role: string | null;
    avatarUrl: string | null;
    phone: string | null;
    createdAt: string;
    positions: PositionChipPosition[];
    branches: { id: string; name: string }[];
    departments: { id: string; name: string }[];
    staffProfile: {
        staffCode: string | null;
        joinedOn: string | null;
        leftOn: string | null;
        employmentType: string;
        ledgerAccountId: number | null;
    } | null;
    /** The revision in force today — null until one is entered. */
    currentSalary: { effectiveFrom: string; grossPaise: number; netPaise: number } | null;
    /** Their own "Salary Payable" account — same shape and same sign rule as
     *  StaffDetail.ledger, so staffLedgerStanding() reads both. Null until the
     *  first save opens the ledger. */
    ledger: { id: number; name: string; balance: number } | null;
}

/** The profile workspace's payload. */
export interface StaffDetail {
    user: {
        id: number;
        name: string;
        email: string;
        title: string | null;
        role: string | null;
        avatarUrl: string | null;
        phone: string | null;
        positions: PositionChipPosition[];
        /** Access, read by the Access tab. Roles are DEFINED in Administration;
         *  HR only chooses one, so this is the current choice, never a catalog. */
        scope: string | null;
        managerId: number | null;
        manager: { id: number; name: string } | null;
        userRole: { id: string; label: string; color: string; rank: number } | null;
    };
    profile: StaffProfileDto | null;
    salaries: StaffSalaryDto[];
    /**
     * Their own account under "Salary Payable". A LIABILITY: a credit balance is
     * salary owed to them, a debit balance is an advance they still hold. There
     * is no expense account here on purpose — salary expense is one org-wide
     * ledger held on the payroll run, not a per-person setting.
     */
    ledger: { id: number; name: string; balance: number; normalBalance: "DEBIT" | "CREDIT" | null } | null;
}
