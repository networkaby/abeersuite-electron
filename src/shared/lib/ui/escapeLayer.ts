"use client";

/**
 * One rule for the Esc key: **the innermost open thing takes it, and nothing else
 * reacts to the same press.**
 *
 * The mark is the event's own `defaultPrevented`. Radix already calls
 * `preventDefault()` whenever Esc closes one of its layers (dialog, menu, select,
 * popover), so a screen that skips a prevented event never also goes back when Esc
 * only closed a dialog. Hand-made popovers mark the event the same way
 * (`useEscapeLayer`), and a screen that acts marks it too, so two listeners can
 * never both answer one press.
 *
 * The browser fixes the order: window capture (hand-made popovers) → document
 * capture (Radix, topmost layer only) → window bubble (screens, `useEscape`). The
 * mark travels on the event itself, so none of this depends on React having
 * re-rendered between listeners — which is why the old `data-state="open"` guards
 * could not work: by the time a window listener ran, the dialog this very press had
 * closed already read "closed".
 *
 * A form hosted inside a dialog (GlVoucherDialog) is the one case where the content,
 * not Radix, owns Esc: `DialogContent` gives its children a slot, `useEscape` inside
 * it fills the slot instead of listening on window, and `dialogEscape` runs it.
 */

import { createContext } from "react";

/** Esc pressed while typing in a text field — most screens leave those alone. */
export function isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export interface EscapeEntry {
    run: (e: KeyboardEvent) => void;
    inInputs: boolean;
}

/** One per open `DialogContent`; claimed by a `useEscape` rendered inside it. */
export interface EscapeSlot {
    /** Take the dialog's Esc; returns the function that gives it back. */
    claim(entry: EscapeEntry): () => void;
    /** Who holds it now — read at key time. */
    read(): EscapeEntry | null;
}

export function createEscapeSlot(): EscapeSlot {
    let current: EscapeEntry | null = null;
    return {
        claim(entry) {
            current = entry;
            return () => { if (current === entry) current = null; };
        },
        read: () => current,
    };
}

export const EscapeSlotContext = createContext<EscapeSlot | null>(null);

/**
 * `DialogContent`'s `onEscapeKeyDown`. Radix calls it only for the topmost layer.
 *
 *   already marked      → a popover inside took this press; Radix leaves the dialog open
 *   the dialog's own rule (a caller's onEscapeKeyDown) runs next, as before
 *   content owns Esc    → mark it (Radix must not close underneath) and run the content's handler
 *   otherwise           → nothing here; Radix closes the dialog
 */
export function dialogEscape(e: KeyboardEvent, slot: EscapeSlot, own?: (e: KeyboardEvent) => void): void {
    if (e.defaultPrevented) return;
    own?.(e);
    const entry = slot.read();
    if (e.defaultPrevented || !entry) return;
    e.preventDefault();
    if (entry.inInputs || !isTypingTarget(e.target)) entry.run(e);
}
