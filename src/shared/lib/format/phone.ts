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
 * Clean an OUTGOING dial string before it is keyed or displayed.
 *
 * A dial string records what was actually KEYED, so junk lands at the END — an
 * extra keypress after the number (seen live: `99544037635`, i.e. 9954403763
 * plus a stray `5`; the exchange routes on the first 10 and connects anyway, so
 * these calls are real, not errors). An INCOMING CLI is the opposite: its junk
 * is a LEADING prefix (`0919954403763`). phoneMatchKey's last-10 rule strips a
 * leading prefix perfectly but slides one digit off the end of a dial string,
 * producing a key that matches no customer — which is why a callback failed to
 * land on the same customer as the incoming call it was answering.
 *
 * So: strip trunk-access zeros and a leading 91, and ONLY when what remains is
 * an 11-digit Indian mobile (starts 6-9) — a 10-digit number plus one stray
 * keypress — keep the FIRST 10. Anything else is returned exactly as captured.
 * A 00-prefixed international call is legitimately longer than 10 digits, and
 * trimming it would invent a number instead of leaving a bad capture visible —
 * the same restraint formatCallerNumber already exercises.
 *
 * Never write this over `Call.rawNumber`: that column is the audit record of
 * what the PBX sent, misdial included.
 */
export function normalizeDialedNumber(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, "");
    if (!digits) return null;
    const n = digits.replace(/^0+/, "");
    const local = n.length === 12 && n.startsWith("91") ? n.slice(2) : n;
    if (local.length === 11 && /^[6-9]/.test(local)) return local.slice(0, 10);
    // Not the overflow case — hand back the original digits so every other
    // number keeps behaving exactly as it did before this function existed.
    return digits;
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
 *
 * Pass the call's `direction` so an OUTGOING dial string has its overflow
 * keypresses trimmed first (see normalizeDialedNumber) — staff want to see who
 * was called, not the typo. The raw capture stays intact in `Call.rawNumber`.
 */
export function formatCallerNumber(raw: string | null | undefined, direction?: string): string {
    if (!raw) return "—";
    const src = direction === "OUTGOING" ? normalizeDialedNumber(raw) : raw;
    const digits = (src ?? "").replace(/\D/g, "");
    if (!digits) return "—";
    // Drop the trunk/STD access zero(s) the PBX prefixes before interpreting.
    const n = digits.replace(/^0+/, "");
    if (!n) return "—";
    if (n.length === 10) return n;
    if (n.length === 12 && n.startsWith("91")) return n.slice(2);
    return n.length > 10 ? `+${n}` : n;
}
