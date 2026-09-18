// Voucher-duplicate handoff: stashed by the 3-dot ⋮ → Duplicate handler,
// consumed by the matching `/new` form on mount. Pure client-side, no DB
// row is created until the user explicitly hits Save. Refreshing the page
// or navigating away discards the stash (`consume` clears the key).
//
// One-shot: the consumer reads + immediately deletes so a subsequent refresh
// starts blank.

const KEY = "voucher:duplicate-source";

/** A line shape that's a superset of what every consumer needs. Unused fields
 *  are simply ignored by hosts that don't care about them. */
export interface DuplicateLine {
    accountId?:   number | null;
    type?:        "DEBIT" | "CREDIT";
    amount?:      number | string;
    description?: string | null;
    // Inventory line fields (TradingVoucherPage):
    productId?:   number;
    quantity?:    number | string;
    rate?:        number | string;
    freeQty?:     number | string | null;
    discountPct?: number | string;
    discountAmt?: number | string;
    taxRate?:     number | string;
    taxAmount?:   number | string;
    [extra: string]: unknown;
}

export interface DuplicatePayload {
    /** Kind of the SOURCE voucher (must match the `/new` form's kind for the
     *  consume to succeed; mismatched kinds return null). */
    kind:            string;
    /** Today's date in YYYY-MM-DD — set by the producer at stash time. */
    date:            string;
    /** Narration / description copied from the source. */
    narration?:      string | null;
    /** GL voucher party-account, for CREDIT_NOTE / DEBIT_NOTE. */
    partyAccountId?: number | null;
    /** Inventory party-snapshot fields (TradingVoucherPage). */
    party?: {
        name:    string | null;
        type:    string | null;
        id:      number | null;
        phone:   string | null;
        address: string | null;
    };
    lines:           DuplicateLine[];
    /** Free-form extras the producer wants the consumer to read (e.g.
     *  inventory's payment-mode default, GL voucher description prefix). */
    extras?: Record<string, unknown>;
}

export function stashDuplicate(payload: DuplicatePayload): void {
    if (typeof window === "undefined") return;
    try {
        sessionStorage.setItem(KEY, JSON.stringify(payload));
    } catch {
        // sessionStorage can throw under quota / private mode — fail silently;
        // the worst case is the new form starts blank (same as create).
    }
}

/** Read + remove the stash. Returns null when there's nothing, or when the
 *  stashed kind doesn't match the consumer's expected kind. */
export function consumeDuplicate(expectedKind: string): DuplicatePayload | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = sessionStorage.getItem(KEY);
        if (!raw) return null;
        sessionStorage.removeItem(KEY);
        const parsed = JSON.parse(raw) as DuplicatePayload;
        if (parsed.kind !== expectedKind) return null;
        return parsed;
    } catch {
        return null;
    }
}

/** Is there a stash waiting for this kind? Reads WITHOUT removing, so it is
 *  safe to call during render — which is the point: a form has to know it was
 *  opened from Duplicate / Book it BEFORE its own start-up steps run, or one
 *  of them overwrites the prefill. `consumeDuplicate` cannot answer that,
 *  because by the time it has answered the stash is gone. */
export function peekDuplicate(expectedKind: string): DuplicatePayload | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = sessionStorage.getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as DuplicatePayload;
        return parsed.kind === expectedKind ? parsed : null;
    } catch {
        return null;
    }
}

/** Today's YYYY-MM-DD in the user's local timezone, for stash producers. */
export function todayLocalISO(): string {
    const d = new Date();
    return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
    ].join("-");
}
