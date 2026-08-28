/**
 * Generic 9-digit collision-free integer Primary Key generator for offline entities.
 * (Tickets, POS Shifts, Mid-shift Cash Movements, etc.)
 *
 * Formula: YY (2 digits FY) * 10,000,000 + Counter (2 digits) * 100,000 + Sequence (5 digits)
 * Fits comfortably in a standard PostgreSQL Int4 (max 2,147,483,647).
 *
 * Examples:
 *   - FY 2026, Counter 1, Seq 45  -> 260100045
 *   - FY 2026, Counter 12, Seq 1  -> 261200001
 */

export function generateNumericId(fyYear: number, counterNumber: number, localSeq: number): number {
    const yy = fyYear % 100;
    const cc = Math.min(Math.max(counterNumber, 1), 99);
    const seq = Math.min(Math.max(localSeq, 1), 99999);
    return yy * 10_000_000 + cc * 100_000 + seq;
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
