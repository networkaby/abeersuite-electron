import { z } from "zod";

/** Priority mirrors the Prisma `Priority` enum (tickets.prisma). */
export const taskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

/**
 * Due date arrives from a `<input type="datetime-local">` as an ISO-ish string,
 * or empty/null when cleared. Coerce empty → null, otherwise validate it parses.
 */
const dueDateField = z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || !Number.isNaN(Date.parse(v)), "Invalid due date");

export const createTaskSchema = z.object({
    title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
    description: z.string().trim().max(5000).optional().nullable(),
    category: z.string().trim().max(60).optional().nullable(),
    priority: taskPrioritySchema.optional(),
    // Ownership is a Position (seat) id, not a user. null = unassigned.
    assignedPositionId: z.string().trim().min(1).optional().nullable(),
    dueDate: dueDateField,
    // Optional — defaults to the Administration pipeline (P4) server-side.
    pipelineId: z.string().trim().min(1).optional(),
});

export const updateTaskSchema = z
    .object({
        title: z.string().trim().min(1, "Title is required").max(200).optional(),
        description: z.string().trim().max(5000).optional().nullable(),
        category: z.string().trim().max(60).optional().nullable(),
        priority: taskPrioritySchema.optional(),
        assignedPositionId: z.string().trim().min(1).optional().nullable(),
        dueDate: dueDateField.optional(),
        // Moving a card between kanban columns sets a new TicketStatus id.
        status: z.string().trim().min(1).optional(),
    })
    .refine((d) => Object.keys(d).length > 0, "No fields to update");

export const createTaskCommentSchema = z.object({
    body: z.string().trim().min(1, "Comment cannot be empty").max(5000),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
