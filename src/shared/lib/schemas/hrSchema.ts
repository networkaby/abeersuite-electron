// Request-side validation for HR & People.
//
// One PATCH body covers the whole staff profile — every field optional, so each
// form (the Job tab, the person's own "Personal & bank" section) sends only what
// it owns and nothing else is touched. `null` clears a field.

import { z } from "zod";
import { partyBankSchema } from "./partyBankSchema";
import { hhMmSchema } from "./commonSchemas";
import { COMMISSION_KINDS } from "../hr/commissionScheme";

export const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "HELPER", "CONTRACT"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
    FULL_TIME: "Full time",
    PART_TIME: "Part time",
    HELPER:    "Helper",
    CONTRACT:  "Contract",
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const optText = (max: number) => z.string().trim().max(max).nullable().optional();

/** The job-side fields — only HR (hr:staff:edit) may send these. */
export const STAFF_JOB_KEYS = [
    "staffCode", "joinedOn", "leftOn", "leftReason", "employmentType", "weeklyOff", "dutyMinutes", "dutyStart", "dutyEnd", "idleLimitMinutes",
] as const;

/** The personal-side fields — a person may also send these about themselves. */
export const STAFF_PERSONAL_KEYS = [
    "fatherName", "address", "bloodGroup", "emergencyName", "emergencyPhone",
    "aadhaarLast4", "panNumber", "uanNumber", "esiNumber", "bankJson", "notes",
] as const;

export const staffProfilePatchSchema = z.object({
    // job
    staffCode:        z.string().trim().max(20).nullable().optional(),
    joinedOn:         isoDate.nullable().optional(),
    leftOn:           isoDate.nullable().optional(),
    leftReason:       optText(300),
    employmentType:   z.enum(EMPLOYMENT_TYPES).optional(),
    weeklyOff:        z.array(z.number().int().min(0).max(6)).max(7).optional(),
    /** A full day's duty in MINUTES. Null falls back to the org default. Capped at
     *  24h because it is typed in hours and a slip of the finger must not grade a
     *  whole month absent — every day would fall under the 40% half-day line. */
    dutyMinutes:      z.number().int().min(30).max(24 * 60).nullable().optional(),
    /** Office hours as "HH:MM" in shop time — a clock face, never an instant. */
    dutyStart:        hhMmSchema.nullable().optional()
        .or(z.literal("").transform(() => null)),
    dutyEnd:          hhMmSchema.nullable().optional()
        .or(z.literal("").transform(() => null)),
    /** Minutes away before this person is signed out. Capped at the session
     *  backstop — a longer figure is a promise the session would break first. */
    idleLimitMinutes: z.number().int().min(5).max(6 * 60).nullable().optional(),
    // personal
    fatherName:       optText(120),
    address:          optText(500),
    bloodGroup:       optText(8),
    emergencyName:    optText(120),
    emergencyPhone:   optText(20),
    aadhaarLast4:     z.string().trim().regex(/^\d{4}$/, "The last 4 digits of the Aadhaar number").nullable().optional()
        .or(z.literal("").transform(() => null)),
    panNumber:        z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "A PAN looks like ABCDE1234F").nullable().optional()
        .or(z.literal("").transform(() => null)),
    uanNumber:        z.string().trim().regex(/^\d{12}$/, "A UAN is 12 digits").nullable().optional()
        .or(z.literal("").transform(() => null)),
    esiNumber:        optText(17),
    bankJson:         partyBankSchema.nullable().optional(),
    notes:            optText(2000),
});

export type StaffProfilePatch = z.infer<typeof staffProfilePatchSchema>;

export const salaryLineSchema = z.object({
    name:        z.string().trim().min(1, "Line name is required").max(60),
    kind:        z.enum(["EARNING", "DEDUCTION"]),
    amountPaise: z.number().int().nonnegative(),
});

export type SalaryLineInput = z.infer<typeof salaryLineSchema>;

export const staffSalaryCreateSchema = z.object({
    effectiveFrom: isoDate,
    /** Days a month the salary buys — the government's 26 unless told otherwise. */
    payDays:       z.number().int().min(1, "At least one day").max(31, "A month has no more than 31 days").optional(),
    lines:         z.array(salaryLineSchema).min(1, "At least one line"),
    note:          optText(300),
});

export type StaffSalaryCreate = z.infer<typeof staffSalaryCreateSchema>;

// ── Targets & Commission ──────────────────────────────────────────────────────
// A dated scheme per person, revised like a salary. The arithmetic and the kind
// list live in shared/lib/hr/commissionScheme.ts; this only checks the body.

const paise = (max: number) => z.number().int().min(0).max(max);

export const commissionSlabSchema = z.object({
    fromPaise: paise(1_000_000_000_000),
    rateBp:    z.number().int().min(0).max(10_000, "A rate cannot be above 100%"),
});

export const commissionSchemeCreateSchema = z.object({
    userId:        z.number().int().positive(),
    effectiveFrom: isoDate,
    targetPaise:   paise(1_000_000_000_000),
    kind:          z.enum(COMMISSION_KINDS),
    rateBp:        z.number().int().min(0).max(10_000, "A rate cannot be above 100%"),
    slabs:         z.array(commissionSlabSchema).max(10).default([]),
    bonusPaise:    paise(100_000_000_000),
    note:          optText(300),
}).superRefine((v, ctx) => {
    if ((v.kind === "PERCENT" || v.kind === "ABOVE_TARGET") && v.rateBp <= 0) {
        ctx.addIssue({ code: "custom", path: ["rateBp"], message: "Enter the rate" });
    }
    if (v.kind === "ABOVE_TARGET" && v.targetPaise <= 0) {
        ctx.addIssue({ code: "custom", path: ["targetPaise"], message: "Sales above WHAT target — set one" });
    }
    if (v.kind === "SLABS") {
        if (!v.slabs.length) ctx.addIssue({ code: "custom", path: ["slabs"], message: "Add at least one slab" });
        for (let i = 1; i < v.slabs.length; i++) {
            if (v.slabs[i].fromPaise <= v.slabs[i - 1].fromPaise) {
                ctx.addIssue({ code: "custom", path: ["slabs", i, "fromPaise"], message: "Each slab must start above the one before" });
                break;
            }
        }
    }
    if (v.bonusPaise > 0 && v.targetPaise <= 0) {
        ctx.addIssue({ code: "custom", path: ["targetPaise"], message: "A bonus needs a target to reach" });
    }
});

export type CommissionSchemeCreate = z.infer<typeof commissionSchemeCreateSchema>;

// ── Payroll ───────────────────────────────────────────────────────────────────
//
// A run pays a date RANGE — from the day after the last run ended, up to the
// day you are standing on — so there is no month here to validate.

/** Generate the run for a period. The posting date defaults to `periodTo`. */
export const payrollRunCreateSchema = z.object({
    periodFrom:  isoDate,
    periodTo:    isoDate,
    postingDate: isoDate.optional(),
    note:        optText(300),
});

export type PayrollRunCreate = z.infer<typeof payrollRunCreateSchema>;

/** Editing a draft run: hold someone back, or change the date / note. */
export const payrollRunPatchSchema = z.object({
    postingDate: isoDate.optional(),
    note:        optText(300),
    /** Line ids to include / exclude. Only lines the generator could pay may be included. */
    include:     z.array(z.number().int().positive()).optional(),
    exclude:     z.array(z.number().int().positive()).optional(),
});

export type PayrollRunPatch = z.infer<typeof payrollRunPatchSchema>;

/**
 * Pay several staff at once. Amounts are paise and people are named by USER id,
 * never by account id — the route resolves each person's own ledger itself, so
 * a crafted request cannot debit some other account.
 */
export const payrollPaySchema = z.object({
    sourceAccountId: z.number().int().positive(),
    date:            isoDate,
    note:            optText(300),
    lines: z.array(z.object({
        userId:      z.number().int().positive(),
        amountPaise: z.number().int().positive(),
    })).min(1, "Pick at least one person"),
});

export type PayrollPay = z.infer<typeof payrollPaySchema>;
