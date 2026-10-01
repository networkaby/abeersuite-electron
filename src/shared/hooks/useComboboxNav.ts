"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, MouseEvent, RefObject } from "react";
import { useEscapeLayer } from "./useEscape";

/**
 * Generic dropdown/combobox keyboard navigation. Owns `open`, `highlighted`,
 * `dropdownWidth`, and the wrapper/list/input refs. Returns a `handleKeyDown`
 * for ArrowUp/Down/Enter, plus `handleBlur`, `dropdownMouseDown` and `clear`.
 * Esc closes the open list through `useEscapeLayer` — before a dialog around it
 * or the page behind it can see the press.
 *
 * Closing on blur, without a timer. The dropdown puts `dropdownMouseDown` on
 * its outermost element, so a press anywhere in it — a row, "+ create", the
 * scrollbar — never takes focus off the input. A blur therefore always means
 * the user really left, and the list closes at once. (It used to close 150 ms
 * after ANY blur, so dragging the scrollbar, or clicking back into the box
 * quickly, shut the list under the mouse.)
 *
 * Consumers handle their own Tab behaviour (some commit selection on Tab,
 * others just close) by wrapping the returned `handleKeyDown` and inspecting
 * `e.key === "Tab"` before delegating.
 *
 * Auto-resets `highlighted` to 0 whenever `count` changes.
 *
 * Usage:
 *   const cb = useComboboxNav({ count: filtered.length, onSelect: i => pick(filtered[i]) });
 *   <input
 *     ref={cb.inputRef}
 *     onFocus={() => cb.setOpen(true)}
 *     onBlur={cb.handleBlur}
 *     onKeyDown={cb.handleKeyDown}
 *   />
 *   {cb.open && <div onMouseDown={cb.dropdownMouseDown}><ul ref={cb.listRef}>...</ul></div>}
 */
export function useComboboxNav(opts: {
    count: number;
    onSelect: (index: number) => void;
    onClear?: () => void;
}): {
    open: boolean;
    setOpen: (v: boolean) => void;
    highlighted: number;
    setHighlighted: (i: number) => void;
    dropdownWidth: number | null;
    setDropdownWidth: (v: number | null) => void;
    wrapperRef: RefObject<HTMLDivElement | null>;
    inputRef: RefObject<HTMLInputElement | null>;
    listRef: RefObject<HTMLUListElement | null>;
    handleKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
    handleBlur: (e?: FocusEvent<HTMLInputElement>) => void;
    dropdownMouseDown: (e: MouseEvent) => void;
    clear: () => void;
} {
    const { count, onSelect, onClear } = opts;
    const [open, setOpen] = useState(false);
    const [highlighted, setHighlighted] = useState(0);
    const [dropdownWidth, setDropdownWidth] = useState<number | null>(null);
    // Esc closes only the list — not a dialog around it, nor the page behind.
    useEscapeLayer(open, () => setOpen(false));
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listRef = useRef<HTMLUListElement | null>(null);

    // Reset highlight when the filtered list shrinks/grows under it.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setHighlighted(0);
    }, [count]);

    // Scroll highlighted item into view.
    useEffect(() => {
        const item = listRef.current?.children[highlighted] as HTMLElement | undefined;
        item?.scrollIntoView({ block: "nearest" });
    }, [highlighted]);

    const handleKeyDown = useCallback(
        (e: KeyboardEvent<HTMLInputElement>) => {
            if (!open) {
                if (e.key !== "Escape" && e.key !== "Tab") setOpen(true);
                return;
            }
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlighted(Math.min(highlighted + 1, count - 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlighted(Math.max(highlighted - 1, 0));
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (highlighted < count) onSelect(highlighted);
            }
        },
        [open, highlighted, count, onSelect],
    );

    // Focus moving to something inside the box (its clear button) is not leaving.
    const handleBlur = useCallback((e?: FocusEvent<HTMLInputElement>) => {
        const next = e?.relatedTarget as Node | null | undefined;
        if (next && wrapperRef.current?.contains(next)) return;
        setOpen(false);
    }, []);

    // On the dropdown's outermost element. preventDefault keeps focus in the
    // input (rows select on mousedown, the scrollbar just scrolls); the
    // dropdown is portalled, so stopPropagation keeps the press from reading
    // as an outside click to a dialog the box sits in.
    const dropdownMouseDown = useCallback((e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const clear = useCallback(() => {
        setOpen(false);
        onClear?.();
        inputRef.current?.focus();
    }, [onClear]);

    return {
        open, setOpen,
        highlighted, setHighlighted,
        dropdownWidth, setDropdownWidth,
        wrapperRef, inputRef, listRef,
        handleKeyDown, handleBlur, dropdownMouseDown, clear,
    };
}
