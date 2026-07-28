import { z } from "zod";
import { taskPrioritySchema } from "./taskSchema";

/** A task never repeats by minute or hour — those units stay worker-retry-only. */
export const recurrenceUnitSchema = z.enum(["day", "week", "month", "year"]);

/** First due date = the permanent anchor. Arrives from `<input type="datetime-local">`. */
const anchorField = z
    .string()
    .trim()
    .min(1, "First due date is required")
    .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid first due date");

export const createTaskRecurrenceSchema = z.object({
    title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
    description: z.string().trim().max(5000).optional().nullable(),
    category: z.string().trim().max(60).optional().nullable(),
    priority: taskPrioritySchema.optional(),
    // Ownership is a Position (seat) id, not a user. null = unassigned.
    assignedPositionId: z.string().trim().min(1).optional().nullable(),

    unit: recurrenceUnitSchema.default("month"),
    every: z.coerce.number().int().min(1, "Must repeat at least every 1").max(60).default(1),
    // null/omitted = endless (rent). A number = fixed instalment count (EMI).
    totalCount: z.coerce.number().int().min(1).max(600).optional().nullable(),
    anchorAt: anchorField,
    leadDays: z.coerce.number().int().min(0).max(90).default(0),

    // Decision support only — never posted to the ledger.
    amountPaise: z.coerce.number().int().min(0).optional().nullable(),
    accountId: z.coerce.number().int().positive().optional().nullable(),

    // Optional — defaults to the Administration pipeline (P4) server-side.
    pipelineId: z.string().trim().min(1).optional(),
});

export const updateTaskRecurrenceSchema = createTaskRecurrenceSchema
    .partial()
    .extend({
        // `.partial()` marks a field optional but does NOT strip its `.default()` —
        // an omitted `unit`/`every`/`leadDays` would still arrive as month/1/0. The
        // PATCH route compares those against the stored row to freeze the schedule,
        // so a defaulted value reads as a CHANGE: pausing a *daily* recurrence (a
        // body of just `{isActive}`) would 400 with "schedule cannot be changed".
        // Redeclare them without defaults so "absent" really means absent.
        unit: recurrenceUnitSchema.optional(),
        every: z.coerce.number().int().min(1).max(60).optional(),
        leadDays: z.coerce.number().int().min(0).max(90).optional(),
        isActive: z.boolean().optional(),
    })
    .refine((d) => Object.keys(d).length > 0, "No fields to update");

export type CreateTaskRecurrenceInput = z.infer<typeof createTaskRecurrenceSchema>;
export type UpdateTaskRecurrenceInput = z.infer<typeof updateTaskRecurrenceSchema>;
