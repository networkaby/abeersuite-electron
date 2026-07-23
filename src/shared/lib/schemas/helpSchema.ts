import { z } from "zod";

/** Priority mirrors the Prisma `Priority` enum (tickets.prisma). */
export const helpPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

/** Inquiry type — mirrored onto the core Ticket.category tag. Kept a fixed list so
 *  the board can group by it; extend here + in the UI picker together. */
export const helpInquiryTypeSchema = z.enum(["PRICE", "AVAILABILITY", "TECH_INFO", "WARRANTY", "OTHER"]);

/** Terminal disposition — mirrors the Prisma `HelpOutcome` enum. */
export const helpOutcomeSchema = z.enum([
    "NOT_FEASIBLE",
    "CUSTOMER_DECLINED",
    "RESOLVED_INFO",
    "CONVERTED_TO_SERVICE",
    "CONVERTED_TO_SALE",
]);

const emailField = z
    .string()
    .trim()
    .max(320)
    .optional()
    .nullable()
    .refine((v) => !v || z.string().email().safeParse(v).success, "Invalid email");

/** Customer identity shared by create + convert — an existing party, or a new
 *  walk-in captured inline. A help ticket MUST have a customer (someone in
 *  trouble, or someone new), so create enforces at least one of these. */
const partyFields = {
    contactName: z.string().trim().max(200).optional().nullable(),
    phone: z.string().trim().max(40).optional().nullable(),
    email: emailField,
    personId: z.coerce.number().int().positive().optional().nullable(),
    companyId: z.coerce.number().int().positive().optional().nullable(),
};

export const createHelpSchema = z
    .object({
        // Optional — the quick counter form omits it; the board card then falls back
        // to the customer name, and the notes carry the ask. The office full form can
        // add it later.
        subject: z.string().trim().max(300, "Subject is too long").optional().nullable(),
        inquiryType: helpInquiryTypeSchema.default("OTHER"),
        ...partyFields,
        priority: helpPrioritySchema.optional(),
        assignedPositionId: z.string().trim().min(1).optional().nullable(),
        notes: z.string().trim().max(20000).optional().nullable(),
    })
    .superRefine((d, ctx) => {
        if (d.personId != null && d.companyId != null) {
            ctx.addIssue({ code: "custom", message: "Link at most one of person or company", path: ["personId"] });
        }
        // A help ticket must name a customer — an existing party OR a new walk-in name.
        if (d.personId == null && d.companyId == null && !d.contactName?.trim()) {
            ctx.addIssue({ code: "custom", message: "Add a customer — search an existing one or type a new name", path: ["contactName"] });
        }
    });

export const updateHelpSchema = z
    .object({
        subject: z.string().trim().max(300).optional().nullable(),
        inquiryType: helpInquiryTypeSchema.optional(),
        ...partyFields,
        priority: helpPrioritySchema.optional(),
        assignedPositionId: z.string().trim().min(1).optional().nullable(),
        notes: z.string().trim().max(20000).optional().nullable(),
        // Moving a card between kanban columns sets a new TicketStatus id.
        status: z.string().trim().min(1).optional(),
        // Closing the ticket — sets the outcome, moves it to the Closed stage, stamps closedAt.
        outcome: helpOutcomeSchema.optional(),
        // A freeform "advise" note appended to the timeline (kind NOTE).
        logNote: z.string().trim().max(5000).optional(),
    })
    .refine((d) => Object.keys(d).length > 0, "No fields to update")
    .superRefine((d, ctx) => {
        if (d.personId != null && d.companyId != null) {
            ctx.addIssue({ code: "custom", message: "Link at most one of person or company", path: ["personId"] });
        }
    });

/** Convert a help ticket into a real downstream ticket. `deal` needs nothing extra
 *  (the customer comes from the help ticket); `service` needs the device details a
 *  repair ticket requires. */
export const convertHelpSchema = z.discriminatedUnion("target", [
    z.object({
        target: z.literal("deal"),
        title: z.string().trim().max(300).optional().nullable(),
        valuePaise: z.coerce.number().int().nonnegative().optional().nullable(),
    }),
    z.object({
        target: z.literal("service"),
        deviceType: z.string().trim().min(1, "Device type is required"),
        brand: z.string().trim().min(1, "Brand is required"),
        model: z.string().trim().min(1, "Model is required"),
        problem: z.string().trim().min(1, "Problem is required"),
    }),
]);

export type CreateHelpInput = z.infer<typeof createHelpSchema>;
export type UpdateHelpInput = z.infer<typeof updateHelpSchema>;
export type ConvertHelpInput = z.infer<typeof convertHelpSchema>;
