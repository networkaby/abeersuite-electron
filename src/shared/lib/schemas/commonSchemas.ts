import { z } from "zod";

/**
 * Reusable Zod fragments. Compose with `.extend({...})` when a route needs
 * additional fields, or `.partial()` for PATCH variants.
 *
 *   const createPersonSchema = phoneEmailSchema.extend({
 *     name: z.string().trim().min(1, "Name is required"),
 *   });
 *
 * Each fragment captures only the fields where every consumer agrees on the
 * constraint. Routes that need a stricter `min`/`max` keep their inline
 * `.extend({ name: z.string().trim().min(1).max(200) })` rather than forcing
 * the base to widen.
 */

/**
 * `label` (required, trimmed) + `color` (optional). Used by ticket-statuses,
 * sub-statuses, and any other settings-style row that carries a Tailwind
 * color-class string for UI display.
 *
 * Routes whose `color` is required (e.g. roles) keep their inline schema.
 */
export const labelColorSchema = z.object({
    label: z.string().trim().min(1, "Label is required"),
    color: z.string().trim().min(1).optional(),
});

/**
 * `phones` + `emails` multi-value contact arrays. The first entry is treated
 * as the primary unless an entry explicitly carries `isPrimary: true` at the
 * write site. Both default to `[]` so callers can destructure without an
 * `undefined` guard.
 */
export const phoneEmailSchema = z.object({
    phones: z.array(z.string().trim().min(1)).optional().default([]),
    emails: z.array(z.string().email()).optional().default([]),
});

/**
 * Indian GSTIN trio. Used by people and (eventually) company GST capture.
 * All three are optional — Zod's `.or(z.literal(""))` keeps the form-empty
 * case happy without throwing.
 */
export const gstSchema = z.object({
    gstin:             z.string().trim().optional().or(z.literal("")),
    gstStateCode:      z.string().trim().optional().or(z.literal("")),
    gstRegType:        z.enum(["REGULAR", "COMPOSITION", "SEZ", "UNREGISTERED"]).optional(),
    /// Default destination state code for couriered B2C sales (Indian GST §10
    /// place-of-supply for movement-involving supplies). Ignored on COUNTER
    /// pickups — those use the branch state regardless of customer address.
    shippingStateCode: z.string().trim().max(2).optional().or(z.literal("")),
});

/**
 * `name` (required, trimmed, ≤ 200 chars) + `isActive` (defaults to `true`).
 * Used by simple inventory master entities (brands, categories, product groups,
 * warranty terms). Routes whose `name` has a different max keep their inline
 * schema.
 */
export const nameIsActiveSchema = z.object({
    name: z.string().trim().min(1).max(200),
    isActive: z.boolean().optional().default(true),
});
