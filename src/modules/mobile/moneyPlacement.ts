import { EPS } from "@/modules/accountancy/lib/billLinkPlan";
import { round2 } from "@/shared/lib/format/moneyInr";

export type Placement = {
    /** Bill id → what this payment puts on it (a part on the last one it reaches). */
    placed: Map<number, number>;
    /** What no ticked bill could take — left with the party as an advance. */
    advance: number;
};

/**
 * Put `amount` on the `ticked` bills in the order given (the caller passes
 * `autoLinkOrder` — the order the settling step itself fills them), each in
 * full until the money runs out, the last one in part. Whatever is left after
 * every ticked bill is full is the advance.
 *
 * Pure arithmetic, so the screen, the confirm step and the save all read the
 * same figures.
 */
export function placeOnBills(
    bills: readonly { id: number; outstanding: number }[],
    ticked: ReadonlySet<number>,
    amount: number,
): Placement {
    const placed = new Map<number, number>();
    let left = round2(amount);
    for (const b of bills) {
        if (!ticked.has(b.id) || left <= EPS) continue;
        const put = round2(Math.min(b.outstanding, left));
        if (put > EPS) placed.set(b.id, put);
        left = round2(left - put);
    }
    return { placed, advance: left > EPS ? left : 0 };
}
