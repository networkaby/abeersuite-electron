// Phone match key — the single normalizer used to match a call to a customer.
//
// Stored phones are free-form (bare 10-digit, +91-prefixed, leading-0 landlines,
// sometimes with spaces/dashes), so we reduce any number to its stable identity:
// the LAST 10 digits (an Indian mobile/STD subscriber number). Used on both sides
// of the match — writing Call.phone and normalizing a customer's stored phones
// for the timeline lookup — so both collapse to the same key.
//
// Distinct from normalizePortalPhone (auth/portalIdentifier), which keeps the
// country prefix (10–15 digits) for portal-login uniqueness. Don't conflate them.

/**
 * Reduce a raw phone string to its 10-digit match key, or null if it can't yield
 * one (empty, or fewer than 10 digits — e.g. an internal extension).
 */
export function phoneMatchKey(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 10) return null;
    return digits.slice(-10);
}

/**
 * The stored-format variants a match key could appear as in the free-form
 * `Phone.phone` column, for an index-backed exact-match `IN` lookup (calls →
 * customer). Covers bare 10-digit, leading-0 landline, `91…`, and `+91…`.
 * Does NOT cover values with embedded spaces/dashes — those fall through to
 * "Unknown" (an accepted, triageable residue on the Call Log page).
 */
export function phoneKeyVariants(key: string): string[] {
    return [key, `0${key}`, `91${key}`, `+91${key}`];
}

/**
 * Display formatter for a raw SMDR caller/dialed number (audit trail, not the
 * match key). Indian numbers — the overwhelming majority here — are shown as a
 * bare 10-digit subscriber number, whether the PBX delivered them plain, behind
 * the 91 country code, or behind a trunk/STD access zero.
 *
 * Anything else keeps every digit we captured, prefixed with "+" once it's long
 * enough to be international. We deliberately do NOT split an unrecognised
 * number into "+<code> <rest>": the PBX sometimes delivers a short or malformed
 * CLI (e.g. a 12-digit "091863809999"), and guessing a split there invents a
 * country code that doesn't exist — dressing up bad data as a valid foreign
 * number. Better that a malformed capture stays visibly odd.
 */
export function formatCallerNumber(raw: string | null | undefined): string {
    if (!raw) return "—";
    const digits = raw.replace(/\D/g, "");
    if (!digits) return "—";
    // Drop the trunk/STD access zero(s) the PBX prefixes before interpreting.
    const n = digits.replace(/^0+/, "");
    if (!n) return "—";
    if (n.length === 10) return n;
    if (n.length === 12 && n.startsWith("91")) return n.slice(2);
    return n.length > 10 ? `+${n}` : n;
}
