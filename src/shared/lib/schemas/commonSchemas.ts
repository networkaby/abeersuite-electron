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
 * workers, and any other settings-style row that carries a Tailwind
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

/**
 * A clock face — "HH:MM" in shop time, never an instant.
 *
 * Office hours are the same shape wherever they are set: a person's own hours on
 * StaffProfile, and the shop's two seasonal openings plus its closing on
 * OrgDefaults. One definition so a time that is valid on the staff page cannot be
 * rejected on the settings page, or the other way round.
 */
/**
 * A staff member's own or emergency mobile — a 10-digit Indian number. Spaces,
 * dashes and a +91 / 0 prefix are forgiven and stripped; blank clears it (null).
 * One rule for the Profile phone and the Personal tab's emergency phone, so the
 * two numbers the ID card prints are always the same shape.
 */
export const STAFF_PHONE_HINT = "98765 43210";
export const staffPhoneSchema = z.string().trim()
    .transform(v => v.replace(/[\s-]/g, "").replace(/^(\+?91|0)(?=\d{10}$)/, ""))
    .refine(v => v === "" || /^[6-9]\d{9}$/.test(v), "A 10-digit mobile number, like 98765 43210")
    .transform(v => v || null)
    .nullable().optional();

export const hhMmSchema = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "A time looks like 10:30");
