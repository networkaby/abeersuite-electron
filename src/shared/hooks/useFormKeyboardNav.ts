// Tally-style keyboard navigation for data-entry forms.
//
// Returns a `containerRef` and an `onKeyDown` handler to attach to a form root.
// Behaviour:
//   • Enter (no modifiers) in any focusable input/select → advance focus to the
//     next focusable input/select under containerRef. Skip <textarea> (newlines)
//     and <button> (native click). Auto-select the new field's content so the
//     user can retype immediately.
//   • Ctrl+Enter or Ctrl+A → preventDefault + call `onSave()`. Ctrl+A also kills
//     browser select-all on this form — that's the caller's explicit choice.
//   • Anything else is ignored.
//
// The handler runs in the bubble phase, so field-level Enter handlers (combobox
// pick, date commit) fire first. We don't check `defaultPrevented`; advancing
// focus after a successful pick / commit is the desired outcome.

import { useCallback, useRef } from "react";

/** Selector for focusable form controls. Excludes buttons by design — Tally
 *  reaches Save through a shortcut, not via Enter walking onto the button. */
const FOCUSABLE_SELECTOR = [
    'input:not([type="hidden"]):not([disabled]):not([tabindex="-1"])',
    "select:not([disabled]):not([tabindex=\"-1\"])",
    '[tabindex]:not([tabindex="-1"]):not([disabled])',
].join(", ");

function isVisible(el: HTMLElement): boolean {
    // `offsetParent` is null for `display: none` ancestors. Fixed-position
    // elements also report null, but the voucher form doesn't use them inside
    // the field tour, so this is a fine approximation for our scope.
    return el.offsetParent !== null;
}

export function useFormKeyboardNav({ onSave }: { onSave: () => void }): {
    containerRef: React.RefObject<HTMLDivElement | null>;
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
} {
    const containerRef = useRef<HTMLDivElement | null>(null);

    const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
        // ── Save shortcuts: Ctrl+Enter or Ctrl+A ──────────────────────────
        if ((e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.key === "a" || e.key === "A")) {
            e.preventDefault();
            onSave();
            return;
        }

        // ── Enter → advance focus ─────────────────────────────────────────
        if (e.key !== "Enter") return;
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

        const target = e.target as HTMLElement;
        if (!target) return;
        const tag = target.tagName;
        if (tag === "TEXTAREA") return;   // keep newline behaviour
        if (tag === "BUTTON")  return;    // keep native Enter = click

        const container = containerRef.current;
        if (!container) return;

        const focusables = Array.from(
            container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter(isVisible);
        const idx = focusables.indexOf(target);
        // When `target` is in the focusables list, advance to the next one.
        // When it isn't — e.g. the field's tabIndex just flipped to -1 in
        // response to its own value change (Tax % when filled) — fall back
        // to the first focusable that comes after `target` in document
        // order. Without this, the user gets stuck on the just-edited cell.
        let next: HTMLElement | undefined;
        if (idx >= 0) {
            if (idx >= focusables.length - 1) return;
            next = focusables[idx + 1];
        } else {
            next = focusables.find((f) =>
                Boolean(target.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING),
            );
            if (!next) return;
        }
        // Run after the current input's own Enter handler (commit / combobox
        // pick) so its state updates land before focus moves. A microtask
        // (queueMicrotask) is enough; setTimeout(0) would re-queue past
        // layout work and feel sluggish.
        queueMicrotask(() => {
            next.focus();
            if (next instanceof HTMLInputElement && /^(text|number|search|tel|url|email|password)?$/.test(next.type || "text")) {
                next.select();
            }
        });
    }, [onSave]);

    return { containerRef, onKeyDown };
}
