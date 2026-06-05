import { z } from "zod";

/** Priority mirrors the Prisma `Priority` enum (tickets.prisma). */
export const leadPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

/** Activity kinds a user can add (SYSTEM is server-only). */
export const activityKindSchema = z.enum(["NOTE", "CALL", "MEETING", "TASK"]);

/** datetime-local / ISO string → Date-parseable or null. */
const dateField = z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || !Number.isNaN(Date.parse(v)), "Invalid date");

const emailField = z
    .string()
    .trim()
    .max(320)
    .optional()
    .nullable()
    .refine((v) => !v || z.string().email().safeParse(v).success, "Invalid email");

export const createDealSchema = z
    .object({
        title: z.string().trim().min(1, "Title is required").max(300, "Title is too long"),
        contactName: z.string().trim().max(200).optional().nullable(),
        phone: z.string().trim().max(40).optional().nullable(),
        email: emailField,
        companyName: z.string().trim().max(200).optional().nullable(),
        personId: z.coerce.number().int().positive().optional().nullable(),
        companyId: z.coerce.number().int().positive().optional().nullable(),
        valuePaise: z.coerce.number().int().nonnegative().optional().nullable(),
        source: z.string().trim().max(80).optional().nullable(),
        priority: leadPrioritySchema.optional(),
        assignedPositionId: z.string().trim().min(1).optional().nullable(),
        nextFollowUpAt: dateField,
        notes: z.string().trim().max(20000).optional().nullable(),
    })
    .superRefine((d, ctx) => {
        if (d.personId != null && d.companyId != null) {
            ctx.addIssue({ code: "custom", message: "Link at most one of person or company", path: ["personId"] });
        }
    });

export const updateDealSchema = z
    .object({
        title: z.string().trim().min(1).max(300).optional(),
        contactName: z.string().trim().max(200).optional().nullable(),
        phone: z.string().trim().max(40).optional().nullable(),
        email: emailField,
        companyName: z.string().trim().max(200).optional().nullable(),
        personId: z.coerce.number().int().positive().optional().nullable(),
        companyId: z.coerce.number().int().positive().optional().nullable(),
        valuePaise: z.coerce.number().int().nonnegative().optional().nullable(),
        source: z.string().trim().max(80).optional().nullable(),
        priority: leadPrioritySchema.optional(),
        assignedPositionId: z.string().trim().min(1).optional().nullable(),
        nextFollowUpAt: dateField.optional(),
        lostReason: z.string().trim().max(500).optional().nullable(),
        // Moving a card between kanban columns sets a new TicketStatus id.
        status: z.string().trim().min(1).optional(),
        notes: z.string().trim().max(20000).optional().nullable(),
    })
    .refine((d) => Object.keys(d).length > 0, "No fields to update");

export const createActivitySchema = z.object({
    kind: activityKindSchema,
    body: z.string().trim().min(1, "Cannot be empty").max(5000),
    dueAt: dateField, // only meaningful for TASK
});

export const updateActivitySchema = z.object({
    done: z.boolean(),
});

export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
