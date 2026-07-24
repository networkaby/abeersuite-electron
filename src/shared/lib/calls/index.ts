import type { CallDirection, Prisma } from "@/generated/prisma/client";

// A "miscall" = a call where nobody connected. Two flavours, both valuable:
//   • INCOMING unanswered (speechSec 0) — a customer we missed → call them back.
//   • OUTGOING unanswered (durationSec 0) — our call that went unanswered →
//     staff-accountability signal.
// INTERNAL / UNKNOWN never count as a customer miscall.

export function isMissedCall(direction: CallDirection, speechSec: number, durationSec: number): boolean {
    if (direction === "INCOMING") return speechSec === 0;
    if (direction === "OUTGOING") return durationSec === 0;
    return false;
}

/** Prisma filter selecting the miscalls above. Use as-is for "only miscalls",
 *  or wrap in `{ NOT: MISSED_CALL_WHERE }` to exclude them. */
export const MISSED_CALL_WHERE: Prisma.CallWhereInput = {
    OR: [
        { direction: "INCOMING", speechSec: 0 },
        { direction: "OUTGOING", durationSec: 0 },
    ],
};

/** Tri-state miscall filter mode from the `missed` query param. */
export type MissedMode = "all" | "only" | "exclude";

export function parseMissedMode(raw: string | null): MissedMode {
    return raw === "only" || raw === "exclude" ? raw : "all";
}
