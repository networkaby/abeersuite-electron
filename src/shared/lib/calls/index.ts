import type { CallDirection, Prisma } from "@/generated/prisma/client";

// A "miscall" = a call where nobody really talked. Two flavours, both valuable:
//   • INCOMING (speechSec) — a customer we missed → call them back.
//   • OUTGOING (durationSec) — our call that went unanswered →
//     staff-accountability signal.
// A call picked up and cut inside MISSED_CALL_UNDER_SEC counts too: nothing was
// said, so the customer still needs a call back.
// INTERNAL / UNKNOWN never count as a customer miscall.

/** Talk time below this many seconds is a miscall. */
export const MISSED_CALL_UNDER_SEC = 2;

export function isMissedCall(direction: CallDirection, speechSec: number, durationSec: number): boolean {
    if (direction === "INCOMING") return speechSec < MISSED_CALL_UNDER_SEC;
    if (direction === "OUTGOING") return durationSec < MISSED_CALL_UNDER_SEC;
    return false;
}

/** Prisma filter selecting the miscalls above. Use as-is for "only miscalls",
 *  or wrap in `{ NOT: MISSED_CALL_WHERE }` to exclude them. */
export const MISSED_CALL_WHERE: Prisma.CallWhereInput = {
    OR: [
        { direction: "INCOMING", speechSec: { lt: MISSED_CALL_UNDER_SEC } },
        { direction: "OUTGOING", durationSec: { lt: MISSED_CALL_UNDER_SEC } },
    ],
};

/** Tri-state miscall filter mode from the `missed` query param. */
export type MissedMode = "all" | "only" | "exclude";

export function parseMissedMode(raw: string | null): MissedMode {
    return raw === "only" || raw === "exclude" ? raw : "all";
}
