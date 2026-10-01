"use client";

/**
 * Whether a form really differs from where the user started — the "Unsaved
 * changes" question, answered by comparing values instead of watching events.
 *
 * The voucher forms used to flip a ref on any `change` event bubbling out of
 * the form. That was wrong both ways: a pick from a ledger / party / product
 * list or a date box fires no `change`, so Esc left without asking and the work
 * was lost; and typing a letter and deleting it again left the flag set, so it
 * asked about nothing.
 *
 * Here the caller passes a snapshot of what the user enters (never display-only
 * values such as a fetched stock figure), and the form is "changed" while that
 * snapshot differs from its STARTING point. The starting point is taken at the
 * user's first press inside the form — pointer or key, caught before the target
 * sees it — so everything the screen fills in by itself before then (an edit
 * prefill, a duplicate, the last-used cash ledger, a settle-a-bill preload) is
 * where the user started, not a change. Spread `startProps` on the form's root;
 * React carries the press up through portals, so a dropdown counts too.
 *
 * After a save that resets the form for the next voucher, call `markClean()`:
 * the next press takes the starting point again.
 */

import { useCallback, useState } from "react";

export function useFormChanges(snapshot: unknown): {
    changed: boolean;
    markClean: () => void;
    startProps: { onPointerDownCapture: () => void; onKeyDownCapture: () => void };
} {
    const current = JSON.stringify(snapshot);
    const [start, setStart] = useState<string | null>(null);

    const begin = () => { if (start === null) setStart(current); };
    const markClean = useCallback(() => setStart(null), []);

    return {
        changed: start !== null && current !== start,
        markClean,
        startProps: { onPointerDownCapture: begin, onKeyDownCapture: begin },
    };
}
