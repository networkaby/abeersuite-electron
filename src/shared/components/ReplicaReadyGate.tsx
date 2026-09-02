"use client";

import { usePathname } from "next/navigation";
import { useCounterMode } from "@/shared/hooks/useCounterMode";
import { COUNTER_FREE_ROUTES } from "@/shared/components/CounterSetupGuard";

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
 * ── Two messages, because there are two situations ─────────────────────────
 * A replica that is still filling clears on its own in minutes. A replica whose
 * worker has HALTED on schema drift never will: the counter's build is older than
 * the Supabase schema, and only a new build fixes it. Telling that second cashier
 * to wait a few minutes sends them to wait out something that cannot finish, and
 * the office never hears about it. `replicaSchemaOk` separates them.
 *
 * ── Never in front of the wizard or the login screen ───────────────────────
 * A PC with no counter runs no sync worker (electron/main.ts), so its replica is
 * never ready — and the only way out is the setup wizard, which this overlay was
 * covering. That is a deadlock: "preparing this counter" on a PC that has no
 * counter to prepare. Those two routes are the same ones CounterSetupGuard keeps
 * open; nothing on them reads business data, so there is nothing to protect.
 *
 * Otherwise inert: `isCounter` is false on Vercel and on any ordinary laptop, and
 * `useCounterMode` returns null until its first answer, so it never flashes at boot.
 */
export default function ReplicaReadyGate() {
    const status = useCounterMode();
    const pathname = usePathname();

    if (COUNTER_FREE_ROUTES.some((p) => pathname?.startsWith(p))) return null;
    if (!status || !status.isCounter) return null;
    if (status.preference === "live") return null;
    if (status.replicaReady) return null;

    const halted = status.replicaSchemaOk === false;

    return (
        <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="replica-gate-title"
            className="fixed inset-0 z-9999 flex items-center justify-center bg-background/95 px-4 backdrop-blur-sm"
        >
            <div className="max-w-md space-y-3 text-center">
                {halted ? (
                    <div
                        aria-hidden="true"
                        className="mx-auto flex h-8 w-8 items-center justify-center rounded-full border-2 border-destructive text-lg font-semibold text-destructive"
                    >
                        !
                    </div>
                ) : (
                    <div
                        aria-hidden="true"
                        className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground"
                    />
                )}
                <h2 id="replica-gate-title" className="text-lg font-semibold">
                    {halted ? "This counter needs an update" : "Preparing this counter"}
                </h2>
                <p className="text-sm text-muted-foreground">
                    {halted
                        ? "This PC's app is older than the office data, so it has stopped copying rather than save against records it does not fully understand. Billing is paused."
                        : "This PC's local copy of the data is still catching up. Billing is paused until it finishes, so nothing is entered against incomplete records."}
                </p>
                <p className="text-xs text-muted-foreground">
                    {halted
                        ? "Waiting will not clear this screen. Tell the office that this counter needs the latest app installed."
                        : "This screen clears on its own. If it is still here after a few minutes, check that this PC is on the network and tell the office."}
                </p>
            </div>
        </div>
    );
}
