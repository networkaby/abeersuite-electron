// Request-side validation for editing a leave type.
//
// `code` is absent on purpose — it is what `LeaveRequest.kind` stores, so renaming
// it would orphan every request already filed under it. Name, quota and the rest
// are free to change; the code is not.

import { z } from "zod";

/** A count of days: whole, not negative, and null where it means "no limit". */
const days = z.number().int().min(0).max(365).nullable();

export const leaveTypeSaveSchema = z.object({
    id: z.number().int().positive(),
    name: z.string().trim().min(1).max(40).optional(),
    paid: z.boolean().optional(),
    yearlyQuota: days.optional(),
    carryForward: z.boolean().optional(),
    carryCap: days.optional(),
    noticeDays: days.optional(),
    sortOrder: z.number().int().min(0).max(999).optional(),
    active: z.boolean().optional(),
});
