"use client";

import { useContext, useEffect, useEffectEvent } from "react";
import { EscapeSlotContext, isTypingTarget } from "@/shared/lib/ui/escapeLayer";

export interface EscapeOptions {
    /** Listen at all (default true). */
    enabled?: boolean;
    /** Also act while the user is typing in a text field (default false). */
    inInputs?: boolean;
}

/**
 * A screen's own Esc — go back, close the form, collapse a selection.
 *
 * It acts only on a press nothing inside it took: an open dialog, menu, select or
 * hand-made popover closes first and marks the event, and this skips a marked one
 * (see src/shared/lib/ui/escapeLayer.ts). One press, one action.
 *
 * Rendered inside a `DialogContent` (a form hosted in a dialog), it owns that
 * dialog's Esc instead of listening on the window.
 */
export function useEscape(handler: (e: KeyboardEvent) => void, { enabled = true, inInputs = false }: EscapeOptions = {}): void {
    const slot = useContext(EscapeSlotContext);
    const run = useEffectEvent((e: KeyboardEvent) => handler(e));

    useEffect(() => {
        if (!enabled) return;
        if (slot) return slot.claim({ run: (e: KeyboardEvent) => run(e), inInputs });
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.defaultPrevented) return;
            if (!inInputs && isTypingTarget(e.target)) return;
            e.preventDefault();
            run(e);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [enabled, inInputs, slot]);
}

/**
 * A hand-made popover or list (not a Radix one) closing on Esc. Listens in the
 * capture phase, so it runs before Radix and before the screen, and marks the press
 * so neither the dialog around it nor the page behind it reacts too.
 */
export function useEscapeLayer(open: boolean, onClose: () => void): void {
    const close = useEffectEvent(() => onClose());

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.defaultPrevented) return;
            e.preventDefault();
            close();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [open]);
}
