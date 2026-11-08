/**
 * Floating UI that must stay usable while a modal dialog is open — the
 * WhatsApp popup cards and chat button. Spread `overDialogsProps` on each
 * floating root. Three things a Radix modal does to the rest of the page are
 * undone for marked areas:
 *
 *  1. body gets pointer-events:none → globals.css re-enables `[data-over-dialogs]`.
 *  2. a click outside closes the dialog → DialogContent ignores marked targets.
 *  3. its FocusScope pulls focus back → `installOverDialogsFocusGuard` below.
 *
 * (3) leans on Radix internals: FocusScope listens for focusin / focusout on
 * `document`. A window capture listener runs before those and stops the event
 * when focus enters a marked area, so the trap never sees it. If a Radix
 * upgrade moves those listeners to the capture phase this stops working —
 * typing in a popup over a ticket is the thing to re-test.
 */
export const OVER_DIALOGS_ATTR = "data-over-dialogs";
export const overDialogsProps = { [OVER_DIALOGS_ATTR]: "" } as const;

export function isOverDialogs(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest(`[${OVER_DIALOGS_ATTR}]`);
}

let installed = false;

/** Idempotent; called by every DialogContent mount. */
export function installOverDialogsFocusGuard(): void {
    if (installed || typeof window === "undefined") return;
    installed = true;
    window.addEventListener("focusin", (e) => {
        if (isOverDialogs(e.target)) e.stopImmediatePropagation();
    }, true);
    window.addEventListener("focusout", (e) => {
        if (isOverDialogs(e.relatedTarget)) e.stopImmediatePropagation();
    }, true);
}
