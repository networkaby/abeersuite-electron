"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";

/**
 * Generic dropdown/combobox keyboard navigation. Owns `open`, `highlighted`,
 * `dropdownWidth`, and the wrapper/list/input refs. Returns a `handleKeyDown`
 * for ArrowUp/Down/Enter/Escape, plus `handleBlur` (close after 150ms so
 * onMouseDown on a list item can fire first) and `clear`.
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
 *   {cb.open && <ul ref={cb.listRef}>...</ul>}
 */
export function useComboboxNav(opts: {
    count: number;
    onSelect: (index: number) => void;
    onClear?: () => void;
    blurDelayMs?: number;
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
    handleBlur: () => void;
    clear: () => void;
} {
    const { count, onSelect, onClear, blurDelayMs = 150 } = opts;
    const [open, setOpen] = useState(false);
    const [highlighted, setHighlighted] = useState(0);
    const [dropdownWidth, setDropdownWidth] = useState<number | null>(null);
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
            } else if (e.key === "Escape") {
                e.stopPropagation(); // don't bubble to a dialog Esc handler
                setOpen(false);
            }
        },
        [open, highlighted, count, onSelect],
    );

    const handleBlur = useCallback(() => {
        setTimeout(() => setOpen(false), blurDelayMs);
    }, [blurDelayMs]);

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
        handleKeyDown, handleBlur, clear,
    };
}
