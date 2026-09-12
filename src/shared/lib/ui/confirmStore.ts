import type { ReactNode } from "react";

export interface ConfirmRequest {
    /** What is about to happen, in the user's words. Keep it short. */
    title: string;
    /**
     * The consequence, spelled out. This is where the SCOPE goes — the count, the
     * name, the "and everything under it". A confirm that does not say what it is
     * about to destroy is decoration, not a safeguard.
     */
    body?: ReactNode;
    /** Label on the button that goes ahead. Name the action, never "OK". */
    confirmLabel?: string;
    cancelLabel?: string;
    /** Red button for anything that destroys or overwrites. Default true. */
    destructive?: boolean;
}

export interface PendingConfirm extends ConfirmRequest {
    /** Monotonic id, so the host remounts its dialog per request. */
    id: number;
    settle: (ok: boolean) => void;
}

type Listener = (pending: PendingConfirm | null) => void;

let listener: Listener | null = null;
let current: PendingConfirm | null = null;
let nextId = 1;

/** Called by ConfirmHost. Only one host may be mounted. */
export function subscribeConfirm(fn: Listener): () => void {
    listener = fn;
    fn(current);
    return () => {
        if (listener === fn) listener = null;
    };
}

/**
 * Pattern C — the shared gate in front of anything that destroys or overwrites.
 *
 * Small deletes in this app were already guarded. The large writes were not:
 * re-freezing the sale price of every filtered row, PATCHing shop-wide offline
 * policy, dropping a spend-tier period and all its levels, removing a courier
 * service with all its zones. Those went through on one click.
 *
 * Deliberately NOT a hook, and deliberately not something the caller has to
 * render. The dialog is mounted once by `<ConfirmHost />` in the root layout, so
 * guarding a dangerous action is a single `await` at the call site with nothing
 * else to wire up — which is the only way a rule like this actually gets applied
 * everywhere it should be:
 *
 *     const ok = await confirmAction({
 *         title: "Freeze sale price?",
 *         body: `This writes the shown price to ${count} products. It cannot be undone.`,
 *         confirmLabel: `Freeze ${count} prices`,
 *     });
 *     if (!ok) return;
 *
 * Replaces the browser's native `confirm()`, which cannot show a count, cannot be
 * styled, and looks wrong inside the desktop shell.
 *
 * If no host is mounted the promise resolves false — the safe answer. A dangerous
 * action must never proceed just because the UI failed to ask.
 */
export function confirmAction(req: ConfirmRequest): Promise<boolean> {
    if (!listener) {
        console.error("confirmAction called with no <ConfirmHost /> mounted — refusing the action.");
        return Promise.resolve(false);
    }

    // A second request while one is open would strand the first promise.
    current?.settle(false);

    return new Promise<boolean>((resolve) => {
        const pending: PendingConfirm = {
            ...req,
            id: nextId++,
            settle: (ok) => {
                if (current?.id !== pending.id) return;
                current = null;
                listener?.(null);
                resolve(ok);
            },
        };
        current = pending;
        listener?.(pending);
    });
}
