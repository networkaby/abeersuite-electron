/**
 * Generic 9-digit collision-free integer Primary Key generator for offline entities.
 * (Tickets, POS Shifts, Mid-shift Cash Movements, etc.)
 *
 * Formula: YY (2 digits FY) * 10,000,000 + Counter (2 digits) * 100,000 + Sequence (5 digits)
 * Fits comfortably in a standard PostgreSQL Int4 (max 2,147,483,647).
 *
 * `counterNumber` (PosCounter.counterNumber) is assigned GLOBALLY unique across
 * every branch at counter-creation time (see /api/pos/counters) — not just
 * unique within its own branch — so two different branches' counters can never
 * mint the same id. No branch component needed in the formula.
 *
 * There is deliberately NO fallback/default for a missing counter — a caller
 * with no real counter context (e.g. an office/server path with no active
 * PosShift) MUST NOT mint one of these ids; it would silently collide into
 * Counter 1's lane. Such callers are expected to have a live-DB autoincrement
 * id instead. See offline-sync design notes.
 *
 * Examples:
 *   - FY 2026, Counter 1, Seq 45  -> 260100045
 *   - FY 2026, Counter 12, Seq 1  -> 261200001
 */

const MAX_COUNTER = 99;
const MAX_SEQ     = 99999;

export function generateNumericId(fyYear: number, counterNumber: number, localSeq: number): number {
    if (!Number.isInteger(counterNumber) || counterNumber < 1 || counterNumber > MAX_COUNTER) {
        throw new Error(`generateNumericId: counterNumber must be 1-${MAX_COUNTER}, got ${counterNumber}`);
    }
    if (!Number.isInteger(localSeq) || localSeq < 1 || localSeq > MAX_SEQ) {
        throw new Error(`generateNumericId: localSeq must be 1-${MAX_SEQ}, got ${localSeq}`);
    }
    const yy = fyYear % 100;
    return yy * 10_000_000 + counterNumber * 100_000 + localSeq;
}

/**
 * Deconstruct a 9-digit numeric ID back into its components (YY, Counter, Seq).
 */
export function parseNumericId(id: number): { fyYear: number; counterNumber: number; seq: number } | null {
    if (!Number.isInteger(id) || id < 100000000 || id > 999999999) {
        return null;
    }
    const yy = Math.floor(id / 10_000_000);
    const cc = Math.floor((id % 10_000_000) / 100_000);
    const seq = id % 100_000;
    return { fyYear: 2000 + yy, counterNumber: cc, seq };
}

// ── Display Label Formatters ──────────────────────────────────────────────────

/** Pipeline / Service Ticket display label (e.g. `TK-260100045`) */
export function formatTicketId(id: number | null | undefined): string {
    return id != null ? `TK-${id}` : "";
}

/** POS Shift display label (e.g. `SH-260100045`) */
export function formatShiftId(id: number | null | undefined): string {
    return id != null ? `SH-${id}` : "";
}

// ── DRY Named Aliases for Domain Clarity ───────────────────────────────────────

export const generateNumericTicketId = generateNumericId;
export const parseNumericTicketId    = parseNumericId;

export const generateNumericShiftId  = generateNumericId;
export const parseNumericShiftId     = parseNumericId;
