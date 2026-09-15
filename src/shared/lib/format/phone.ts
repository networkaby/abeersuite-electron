// Phone match key — the single normalizer used to match a call to a customer.
//
// Stored phones are free-form (bare 10-digit, +91-prefixed, leading-0 landlines,
// sometimes with spaces/dashes), so we reduce any number to its stable identity:
// the 10-digit Indian subscriber number. Used on both sides of the match —
// writing Call.phone and normalizing a customer's stored phones for the timeline
// lookup — so both collapse to the same key.
//
// The reduction is SHAPE-CHECKED first (readCallerNumber). A capture that is not
// a whole number yields no key at all, rather than ten digits sliced off the end
// of something broken.
//
// Distinct from normalizePortalPhone (auth/portalIdentifier), which keeps the
// country prefix (10–15 digits) for portal-login uniqueness. Don't conflate them.

/**
 * What a captured number actually IS, before anything downstream trusts it.
 *
 * The EPBX delivers an incoming CLI as an analogue signal, digit by digit, and
 * that takes a moment. If staff lift the handset before the last digit lands,
 * the record carries only the digits that had arrived — a PART NUMBER. Seen
 * live: `91600204286` (the 91 country code plus nine of the ten digits) and a
 * five-digit CLI from trunk C001.
 *
 * A part number is NOT a number. It cannot be rung back and it cannot identify
 * anyone, so it must never become a match key: the old last-10 rule turned
 * `91600204286` into the key `1600204286`, a number that does not exist, which
 * then looked real enough to nag the counter in the call popup.
 *
 *   india         — reduces to a full 10-digit subscriber number, however the
 *                   PBX dressed it (bare, behind a trunk 0, behind 91 / +91).
 *   international — 11 to 15 digits that are not the broken India case.
 *   partial       — digits arrived, but too few to be any number.
 *   none          — nothing usable at all.
 */
export type CallerNumberShape = "india" | "international" | "partial" | "none";

export interface CallerNumberFacts {
    shape: CallerNumberShape;
    /** Every digit captured, trunk/STD access zeros stripped. */
    digits: string;
    /** The subscriber number: 10 digits for india, the digits we have for partial. */
    local: string;
}

/** Longest length a real number reaches (E.164). */
const MAX_NUMBER_DIGITS = 15;

/**
 * The single reading of a captured number. Every other helper here, and every
 * screen that has to decide whether a call is actionable, goes through this.
 */
export function readCallerNumber(raw: string | null | undefined): CallerNumberFacts {
    const all = (raw ?? "").replace(/\D/g, "");
    // Drop the trunk/STD access zero(s) the PBX prefixes before interpreting.
    const digits = all.replace(/^0+/, "");
    if (!digits) return { shape: "none", digits: "", local: "" };
    // Exactly ten is a whole number, whatever it starts with — `9163456789` is
    // a real mobile, and reading its first two digits as a country code would
    // chop it in half. So the leading 91 is the COUNTRY CODE at every OTHER
    // length, and what follows is the subscriber number.
    if (digits.length === 10) return { shape: "india", digits, local: digits };
    if (digits.startsWith("91")) {
        const sub = digits.slice(2);
        if (sub.length === 10) return { shape: "india", digits, local: sub };
        // More than ten after the country code is a stray keypress — owner's
        // rule, and junk lands at the END of what was keyed, so keep the FIRST
        // ten. (`normalizeDialedNumber` applies the same rule to a dial string
        // that carries no country code.)
        if (sub.length > 10) return { shape: "india", digits, local: sub.slice(0, 10) };
        // Fewer than ten: a CLI the handset cut off mid-arrival.
        return { shape: "partial", digits, local: sub };
    }
    if (digits.length > 10 && digits.length <= MAX_NUMBER_DIGITS) {
        return { shape: "international", digits, local: digits };
    }
    // Under ten digits, or longer than any number on earth.
    return { shape: "partial", digits, local: digits };
}

/**
 * True when the number is complete enough to ring back and to identify someone.
 * Pass the call's `direction` so an OUTGOING dial string is cleaned of its
 * overflow keypresses first, exactly as formatCallerNumber does.
 */
export function isCallableNumber(raw: string | null | undefined, direction?: string): boolean {
    const src = direction === "OUTGOING" ? normalizeDialedNumber(raw) : raw;
    const shape = readCallerNumber(src).shape;
    return shape === "india" || shape === "international";
}

/**
 * We guess only when the capture is ONE digit short of a whole number.
 *
 * Owner's rule: at nine digits the tenth is missing, so there are ten possible
 * numbers and more than one customer can fit — a real shortlist. Shorter than
 * that happens rarely and the shortlist becomes the phone book, so we don't.
 */
export const PARTIAL_CLI_GUESS_DIGITS = 9;

/**
 * The leading digits to run a "whose number starts like this?" lookup on —
 * empty unless the capture is exactly one digit short (PARTIAL_CLI_GUESS_DIGITS).
 *
 * Usually one candidate. A short capture starting `91` can give TWO, because
 * the truncation is genuinely ambiguous: `916345678` is either the country code
 * plus seven digits, or the whole mobile `9163456789` one digit short. Both
 * readings that are nine digits long are searched.
 *
 * Triage only: a prefix hit is never written to `Call.phone` by itself — staff
 * pick from the shortlist and confirm (PATCH /api/calls/[id] `confirmPhone`).
 */
export function partialCliPrefixes(raw: string | null | undefined): string[] {
    const { shape, digits, local } = readCallerNumber(raw);
    if (shape !== "partial") return [];
    return [local, digits].filter(
        (p, i, all) => p.length === PARTIAL_CLI_GUESS_DIGITS && all.indexOf(p) === i,
    );
}

/**
 * Reduce a raw phone string to its 10-digit match key, or null if it can't yield
 * one — an internal extension, or a part number the PBX cut short.
 */
export function phoneMatchKey(raw: string | null | undefined): string | null {
    const { shape, local } = readCallerNumber(raw);
    if (shape === "india") return local;
    // A foreign number reduces the same way a stored one does, so both sides of
    // the match collapse to the same key.
    if (shape === "international") return local.slice(-10);
    return null;
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
 * A foreign number keeps every digit we captured, prefixed with "+". We
 * deliberately do NOT split it into "+<code> <rest>": guessing a split invents
 * a country code that may not exist.
 *
 * A PART NUMBER — a CLI the handset cut off mid-arrival — gets NO "+" and a
 * trailing ellipsis instead. `91600204286` is nine of India's ten digits, and
 * printing it as "+91600204286" dressed a broken capture up as a valid foreign
 * caller. It now reads "91600204286…", which is the truth.
 *
 * Pass the call's `direction` so an OUTGOING dial string has its overflow
 * keypresses trimmed first (see normalizeDialedNumber) — staff want to see who
 * was called, not the typo. The raw capture stays intact in `Call.rawNumber`.
 */
export function formatCallerNumber(raw: string | null | undefined, direction?: string): string {
    if (!raw) return "—";
    const src = direction === "OUTGOING" ? normalizeDialedNumber(raw) : raw;
    const { shape, digits, local } = readCallerNumber(src);
    switch (shape) {
        case "india": return local;
        case "international": return `+${digits}`;
        case "partial": return `${digits}…`;
        default: return "—";
    }
}
