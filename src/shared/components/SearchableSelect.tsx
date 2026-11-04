"use client";

// Generic searchable single-select with an absolute-positioned popover (no
// Portal — layers cleanly inside Dialog / sticky toolbars without z-index
// fights). One trigger button, one search input, one filtered list. Use it
// anywhere a Radix Select gets too long to scroll comfortably.
//
// Value type is generic so both id-based pickers (number) and name/string
// filters (string) can share the same widget.
//
// Options can carry:
//   • label — what shows in the open list (may include hierarchy prefix)
//   • leaf  — what shows in the closed trigger (defaults to label)
//   • searchText — what the query matches against (defaults to label)
//
// Search ranks prefix-matches above substring-matches.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { useEscapeLayer } from "@/shared/hooks/useEscape";

/// Room the popover needs below the trigger (search box + list) before it flips up.
const DROP_SPACE_PX = 320;

export interface SearchableSelectOption<V extends string | number> {
    value: V;
    label: string;
    leaf?: string;
    searchText?: string;
}

export interface SearchableSelectProps<V extends string | number> {
    value: V | null;
    options: SearchableSelectOption<V>[];
    onChange: (v: V | null) => void;
    placeholder?: string;
    /** When true (default), shows a small X clear button next to the chevron
     *  and a "— clear —" row at the top of the list. Pages that model
     *  "no filter" as a real option (e.g. "All groups") should pass false. */
    clearable?: boolean;
    /** Extra classes for the trigger button (sizing / typography). */
    triggerClassName?: string;
    /** Optional aria-label for the trigger button. */
    ariaLabel?: string;
    /** When set, shows a pinned "+ New …" row above the list (unaffected by
     *  search). Resolving with a value auto-selects it via onChange. */
    onCreate?: () => Promise<V | null>;
    /** Label for the onCreate row. Defaults to "+ New". */
    createLabel?: string;
}

export function SearchableSelect<V extends string | number>({
    value,
    options,
    onChange,
    placeholder = "— none —",
    clearable = true,
    triggerClassName,
    ariaLabel,
    onCreate,
    createLabel = "+ New",
}: SearchableSelectProps<V>) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [highlight, setHighlight] = useState(0);
    /// Open upwards when the trigger sits too near the bottom of the screen
    /// (e.g. the last row of a dialog) — decided once, on open.
    const [dropUp, setDropUp] = useState(false);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listRef = useRef<HTMLUListElement | null>(null);

    const selected = options.find((o) => o.value === value) ?? null;
    const selectedDisplay = selected ? (selected.leaf ?? selected.label) : "";

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return options;
        const prefix: SearchableSelectOption<V>[] = [];
        const sub: SearchableSelectOption<V>[] = [];
        for (const o of options) {
            const lbl = (o.searchText ?? o.label).toLowerCase();
            if (lbl.startsWith(q)) prefix.push(o);
            else if (lbl.includes(q)) sub.push(o);
        }
        return [...prefix, ...sub];
    }, [options, query]);

    // Close on outside click.
    useEffect(() => {
        if (!open) return;
        function onDoc(e: MouseEvent) {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);
    // Esc closes only this list — not the dialog around it, nor the page behind.
    useEscapeLayer(open, () => setOpen(false));

    // Focus the search input each time the popover opens. (Query + highlight are
    // reset in the toggle/onChange handlers so we don't call setState in an effect.)
    useEffect(() => {
        if (!open) return;
        requestAnimationFrame(() => inputRef.current?.focus());
    }, [open]);

    useEffect(() => {
        if (!open || !listRef.current) return;
        const el = listRef.current.querySelector<HTMLLIElement>(`[data-idx="${highlight}"]`);
        el?.scrollIntoView({ block: "nearest" });
    }, [highlight, open]);

    function commit(v: V) {
        onChange(v);
        setOpen(false);
    }

    async function commitCreate() {
        if (!onCreate) return;
        setOpen(false);
        const v = await onCreate();
        if (v != null) onChange(v);
    }

    return (
        <div ref={wrapRef} className="relative">
            <button
                type="button"
                onClick={() => {
                    if (!open) {
                        setQuery(""); setHighlight(0);
                        const r = wrapRef.current?.getBoundingClientRect();
                        setDropUp(!!r && window.innerHeight - r.bottom < DROP_SPACE_PX && r.top > window.innerHeight - r.bottom);
                    }
                    setOpen((o) => !o);
                }}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={ariaLabel}
                className={
                    "flex h-9 w-full items-center justify-between gap-1 rounded-md border border-input bg-transparent px-3 text-left text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
                    (triggerClassName ?? "")
                }
            >
                <span className={"truncate " + (selected ? "" : "text-muted-foreground")}>
                    {selected ? selectedDisplay : placeholder}
                </span>
                <span className="flex items-center gap-0.5 shrink-0">
                    {clearable && value != null ? (
                        <span
                            role="button"
                            tabIndex={-1}
                            aria-label="Clear"
                            onClick={(e) => { e.stopPropagation(); onChange(null); setOpen(false); }}
                            className="inline-flex items-center justify-center size-4 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                        >
                            <X className="size-3" />
                        </span>
                    ) : null}
                    <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                </span>
            </button>
            {open ? (
                // Popover anchored at the trigger's left but free to grow wider
                // than it (min-w-full guarantees at-least-trigger-width; max-w
                // keeps very long labels from blowing past the viewport edge).
                <div className={`absolute z-50 left-0 ${dropUp ? "bottom-full mb-1" : "mt-1"} min-w-full w-max max-w-[min(28rem,90vw)] rounded-md border border-border bg-popover text-popover-foreground shadow-md`}>
                    <div className="p-1 border-b border-border">
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
                            onKeyDown={(e) => {
                                if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    setHighlight((h) => Math.min(filtered.length - 1, h + 1));
                                } else if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    setHighlight((h) => Math.max(0, h - 1));
                                } else if (e.key === "Enter") {
                                    e.preventDefault();
                                    const pick = filtered[highlight];
                                    if (pick) commit(pick.value);
                                }
                            }}
                            placeholder="Type to search…"
                            className="h-7 w-full rounded border border-input bg-transparent px-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                    </div>
                    <ul ref={listRef} className="max-h-56 overflow-auto py-1" role="listbox">
                        {clearable && value != null ? (
                            <li>
                                <button
                                    type="button"
                                    onClick={() => { onChange(null); setOpen(false); }}
                                    className="block w-full px-2 py-1 text-left text-sm text-muted-foreground hover:bg-muted"
                                >
                                    — clear —
                                </button>
                            </li>
                        ) : null}
                        {onCreate ? (
                            <li>
                                <button
                                    type="button"
                                    onClick={() => { void commitCreate(); }}
                                    className="block w-full px-2 py-1 text-left text-sm text-primary hover:bg-muted"
                                >
                                    {createLabel}
                                </button>
                            </li>
                        ) : null}
                        {filtered.length === 0 ? (
                            <li className="px-2 py-1 text-xs text-muted-foreground italic">No matches</li>
                        ) : (
                            filtered.map((o, i) => {
                                const isHighlighted = i === highlight;
                                const isSelected = o.value === value;
                                return (
                                    <li key={String(o.value)} data-idx={i}>
                                        <button
                                            type="button"
                                            onMouseEnter={() => setHighlight(i)}
                                            onClick={() => commit(o.value)}
                                            className={
                                                "block w-full whitespace-nowrap px-2 py-1 text-left text-sm " +
                                                (isHighlighted ? "bg-muted " : "") +
                                                (isSelected ? "font-medium" : "")
                                            }
                                        >
                                            {o.label}
                                        </button>
                                    </li>
                                );
                            })
                        )}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}
