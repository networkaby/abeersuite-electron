/**
 * Rendering `sourceCounterId` — the counter a voucher or a ticket was raised at.
 *
 * Pure and client-safe. Vouchers and tickets carry the same column with the same
 * meaning, so they render through the same two functions here and can never drift
 * into two house styles.
 *
 * ── The branch half ─────────────────────────────────────────────────────────
 * Branch is NEVER stored a second time for this. Counters are unique org-wide, so
 * the counter alone identifies the branch:
 *   • a voucher already carries `branchId` on its own row — nothing to look up
 *   • a ticket has no branch column, so its branch comes off the counter
 * Either way the caller resolves the branch and passes the NUMBER in.
 */

/** What either table's row needs resolved before it can be labelled. */
export interface SourceCounterParts {
    /** Branch.number — the branch half. Null when unknown or not applicable. */
    branchNumber?: number | null;
    /** PosCounter.counterNumber — the counter half. Null = raised at the office. */
    counterNumber?: number | null;
    /** Branch.name, for the long label only. */
    branchName?: string | null;
    /** PosCounter.name, for the long label only. */
    counterName?: string | null;
}

/** Shown when a row was raised at the office, or predates the column. */
export const OFFICE_LABEL = "Office";

/**
 * The short badge for a table cell — `branch-counter`, e.g. `1-24`.
 *
 * Numbers, not names: these sit in register columns that are already tight, and
 * both numbers are unique, so the pair is unambiguous. Pair it with
 * `formatSourceCounterLong()` as the tooltip wherever there is room for one.
 *
 *   branch 1 + counter 24  → "1-24"
 *   counter 24, no branch  → "24"
 *   no counter             → "Office"
 */
export function formatSourceCounter(parts: SourceCounterParts): string {
    const { branchNumber, counterNumber } = parts;
    if (counterNumber == null) return OFFICE_LABEL;
    if (branchNumber == null) return String(counterNumber);
    return `${branchNumber}-${counterNumber}`;
}

/**
 * The spelled-out version for tooltips and printed documents, falling back to
 * whatever half is known: "Head Office · Counter 24".
 */
export function formatSourceCounterLong(parts: SourceCounterParts): string {
    const { branchName, counterName, branchNumber, counterNumber } = parts;
    if (counterNumber == null) return OFFICE_LABEL;
    const counter = counterName ?? `Counter ${counterNumber}`;
    const branch = branchName ?? (branchNumber == null ? null : `Branch ${branchNumber}`);
    return branch ? `${branch} · ${counter}` : counter;
}
