import { z } from "zod";

/**
 * Reconnect (CRM) — the customer IS the record. No ticket is created while
 * reconnecting; notes/calls hang directly off the customer (Person/Company)
 * as TicketLog rows, and their lifecycle stage is nudged in the same place.
 * A real ticket (a Deal) is only spun off when interest appears.
 */

/** Contact funnel stage — mirrors the Prisma `ContactLifecycle` enum (base.prisma). */
export const lifecycleStageSchema = z.enum(["LEAD", "PROSPECT", "CUSTOMER", "INACTIVE"]);

/** Timeline entry kinds a user can add here (SYSTEM/COMMENT are server-only).
 *  Mirrors the `TicketLogKind` enum (tickets.prisma). */
export const reconnectLogKindSchema = z.enum(["NOTE", "CALL", "MEETING", "TASK"]);

/** datetime-local / ISO string → Date-parseable or null (matches dealSchema). */
const dateField = z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || !Number.isNaN(Date.parse(v)), "Invalid date");

/** One customer = exactly one of person / company. Reused by every write below. */
const customerTarget = {
    personId: z.coerce.number().int().positive().optional().nullable(),
    companyId: z.coerce.number().int().positive().optional().nullable(),
};

const exactlyOneTarget = (d: { personId?: number | null; companyId?: number | null }, ctx: z.RefinementCtx) => {
    const has = (d.personId != null ? 1 : 0) + (d.companyId != null ? 1 : 0);
    if (has !== 1) {
        ctx.addIssue({ code: "custom", message: "Target exactly one customer (person or company)", path: ["personId"] });
    }
};

/** Call direction — only meaningful for kind CALL; stored on the log's `data`. */
export const callDirectionSchema = z.enum(["in", "out"]);

/** POST a note / call / meeting / task onto a customer's own timeline. */
export const addTimelineLogSchema = z
    .object({
        ...customerTarget,
        kind: reconnectLogKindSchema.default("NOTE"),
        body: z.string().trim().min(1, "Cannot be empty").max(5000),
        dueAt: dateField, // only meaningful for TASK
        direction: callDirectionSchema.optional(), // only meaningful for CALL
    })
    .superRefine(exactlyOneTarget);

/** PATCH a customer's lifecycle stage (Lead → Prospect → Customer → …). */
export const updateLifecycleStageSchema = z
    .object({
        ...customerTarget,
        lifecycleStage: lifecycleStageSchema,
    })
    .superRefine(exactlyOneTarget);

/** POST — recheck a customer's real record (any repair/sale) and auto-bump their stage. */
export const refreshStageSchema = z.object({ ...customerTarget }).superRefine(exactlyOneTarget);

/** The kinds of interaction the "has activity of type" filter can look for ("any" = any of them). */
export const activityTypeSchema = z.enum(["any", "sale", "repair", "inquiry", "deal", "note"]);

const dayCount = z.coerce.number().int().min(0).max(3650).optional();
const rupees = z.coerce.number().min(0).max(1e12).optional();
/** Comma-separated positive ints (e.g. warrantyTermIds=3,5,7) → number[]. */
const intList = z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0) : undefined));

/**
 * The candidate-list filter — a flat, open-ended catalog. Every field is optional
 * (presence = the filter is active on the client's checklist); new parameters just
 * append here + get read in the query builder. Grouped: activity · purchase · value
 * · segment. Money is in rupees; every time window is expressed in "days ago".
 */
export const reconnectFilterSchema = z.object({
    // ── Activity ────────────────────────────────────────────────────────────────
    // Recency lens: quiet (had activity, gone silent) | never (cold) | all.
    activity: z.enum(["quiet", "never", "all"]).default("all"),
    // Has (or doesn't have) an interaction of a given type, over a "days ago" window
    // (from = older bound, to = newer bound; omit both = ever). Replaces the old
    // standalone "quiet for N days" filter.
    activityType: activityTypeSchema.optional(),
    activityPresence: z.enum(["has", "not"]).default("has"),
    activityFromDays: dayCount,
    activityToDays: dayCount,
    // Call log: has an incoming / outgoing / any call over a days-ago window.
    callDirection: z.enum(["any", "in", "out"]).optional(),
    callFromDays: dayCount,
    callToDays: dayCount,
    // Miscall lens on the call-log filter: absent = include all calls; "only" =
    // just miscalls (customers we missed); "exclude" = connected calls only.
    callMissed: z.enum(["only", "exclude"]).optional(),

    // ── Sold-to-customer behaviour (NOT supplier procurement) ────────────────────
    // We SOLD them a category / product, over a "days ago" window (a past period /
    // festive season). Omit the window = ever.
    soldCategoryId: z.coerce.number().int().positive().optional(),
    soldProductQ: z.string().trim().max(120).optional(),
    soldFromDays: dayCount,
    soldToDays: dayCount,
    // The exclude side — we did NOT sell them this (e.g. a printer but no ink lately).
    notSoldCategoryId: z.coerce.number().int().positive().optional(),
    notSoldProductQ: z.string().trim().max(120).optional(),
    notSoldFromDays: dayCount,
    notSoldToDays: dayCount,
    // Warranty ending within N days, considering only the chosen warranty terms
    // (empty = every fixed-duration term; pick long terms to ignore short ones).
    warrantyEndingDays: dayCount,
    warrantyTermIds: intList,

    // ── Value (over a "days ago" window; omit window = lifetime) ─────────────────
    revenueMin: rupees,
    revenueMax: rupees,
    revenueFromDays: dayCount, // older bound of the window
    revenueToDays: dayCount, // newer bound (0 / omit = up to now)
    profitMin: rupees,
    profitMax: rupees,
    profitFromDays: dayCount,
    profitToDays: dayCount,

    // ── Segment ──────────────────────────────────────────────────────────────────
    stage: lifecycleStageSchema.optional(),
    groupId: z.coerce.number().int().positive().optional(),
    ownerPositionId: z.string().trim().min(1).optional(),
    kind: z.enum(["person", "company", "all"]).default("all"),
    // Include unsaved callers from the Call table (people who called but aren't
    // a Person/Company yet) so staff can triage them into leads.
    includeUnsaved: z.coerce.boolean().default(false),
    q: z.string().trim().max(200).optional(),

    // How the middle-pane list is ordered.
    sort: z.enum(["quietest", "recent", "nameAsc", "nameDesc"]).default("quietest"),

    // Paging.
    take: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.coerce.number().int().positive().optional(),
});

/**
 * Saved filters (Zoho-style views). The payload is the opaque, surface-specific
 * filter criteria captured by the client (here: the Reconnect checklist state).
 */
export const savedFilterCreateSchema = z.object({
    name: z.string().trim().min(1, "Name is required").max(80),
    isShared: z.boolean().default(false),
    payload: z.record(z.string(), z.unknown()),
});
export const savedFilterUpdateSchema = z
    .object({
        name: z.string().trim().min(1).max(80).optional(),
        isShared: z.boolean().optional(),
        payload: z.record(z.string(), z.unknown()).optional(),
    })
    .refine((d) => Object.keys(d).length > 0, "Nothing to update");

export type AddTimelineLogInput = z.infer<typeof addTimelineLogSchema>;
export type UpdateLifecycleStageInput = z.infer<typeof updateLifecycleStageSchema>;
export type ReconnectFilterInput = z.infer<typeof reconnectFilterSchema>;
export type SavedFilterCreateInput = z.infer<typeof savedFilterCreateSchema>;
