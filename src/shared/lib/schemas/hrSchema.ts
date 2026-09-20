// Request-side validation for HR & People.
//
// One PATCH body covers the whole staff profile — every field optional, so each
// form (the Job tab, the person's own "Personal & bank" section) sends only what
// it owns and nothing else is touched. `null` clears a field.

import { z } from "zod";
import { partyBankSchema } from "./partyBankSchema";

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
    "staffCode", "joinedOn", "leftOn", "leftReason", "employmentType", "weeklyOff", "expenseAccountId",
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
    expenseAccountId: z.number().int().positive().nullable().optional(),
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
    lines:         z.array(salaryLineSchema).min(1, "At least one line"),
    note:          optText(300),
});

export type StaffSalaryCreate = z.infer<typeof staffSalaryCreateSchema>;
