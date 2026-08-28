"use client";

import { useCounterMode } from "@/shared/hooks/useCounterMode";

/**
 * Covers the app when this counter's replica is not fit to be read.
 *
 * ── The failure it prevents ─────────────────────────────────────────────────
 * A replica that is empty or half-filled does not raise anything. It returns FEWER
 * ROWS — a product list with nothing in it, a ledger missing entries — which a cashier
 * reads as "those records were deleted", not "this database has not caught up". There
 * is no error state to notice, so something has to say it out loud.
 *
 * `electron/waitForReplica.ts` holds the splash for the first sync, which covers the
 * common case. This covers the ones it cannot: a replica that goes unready DURING a
 * session, because an upgrade changed the schema underneath it or the sync worker died.
 *
 * ── Why `preference` is part of the condition ───────────────────────────────
 * Not-ready is the ORDINARY state on a counter running READ_MODE=live: nothing reads
 * the replica, so its contents cannot mislead anyone and there is nothing to block.
 * Gating on readiness alone would put this overlay in front of every such counter,
 * permanently. It only matters once the operator has opted into depending on the
 * replica — which is exactly what a non-`live` preference means.
 *
 * Otherwise inert: `isCounter` is false on Vercel and on any ordinary laptop, and
 * `useCounterMode` returns null until its first answer, so it never flashes at boot.
 */
export default function ReplicaReadyGate() {
    const status = useCounterMode();

    if (!status || !status.isCounter) return null;
    if (status.preference === "live") return null;
    if (status.replicaReady) return null;

    return (
        <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="replica-gate-title"
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 px-4 backdrop-blur-sm"
        >
            <div className="max-w-md space-y-3 text-center">
                <div
                    aria-hidden="true"
                    className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground"
                />
                <h2 id="replica-gate-title" className="text-lg font-semibold">
                    Preparing this counter
                </h2>
                <p className="text-sm text-muted-foreground">
                    This PC&apos;s local copy of the data is still catching up. Billing is paused
                    until it finishes, so nothing is entered against incomplete records.
                </p>
                <p className="text-xs text-muted-foreground">
                    This screen clears on its own. If it is still here after a few minutes, check
                    that this PC is on the network and tell the office.
                </p>
            </div>
        </div>
    );
}
