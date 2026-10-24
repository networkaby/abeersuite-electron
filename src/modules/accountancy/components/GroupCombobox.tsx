"use client";

/* eslint-disable react-hooks/refs */
// Searchable picker for account groups. Includes a built-in "No group" entry
// that maps to `null`. Type to filter by name. The dropdown is portaled to
// document.body and anchored to the input's viewport rect so it isn't clipped
// by parent containers with `overflow: hidden` (e.g. table cards).
//
// Pass `depth` on each option to render a "-" / "--" hierarchy marker (parent
// groups at depth 0 get no marker).

import { useState } from "react";
import { createPortal } from "react-dom";
import { useComboboxNav, useDropdownPortal, useValueChange, type DropdownPlacement } from "@/shared/hooks";

export interface GroupOption {
    id: number;
    name: string;
    type?: string;
    /** Nesting level — 0 = primary group (no marker), 1+ = "-" per step. */
    depth?: number;
}

const NO_GROUP_LABEL = "No group";
const PLACEMENT: DropdownPlacement = {
    maxHeight: 288, flipBelow: 140, minHeight: 80,
    size: (rect) => ({ width: Math.max(rect.width, 220), left: rect.left }),
};

type Props = {
    value: number | null;
    onChange: (groupId: number | null) => void;
    groups: GroupOption[];
    placeholder?: string;
    className?: string;
    autoFocus?: boolean;
    /** Show the "No group" entry and allow clearing to null. Default true. */
    allowNone?: boolean;
};

export function GroupCombobox({
    value, onChange, groups,
    placeholder = "Search group…",
    className = "",
    autoFocus = false,
    allowNone = true,
}: Props) {
    const selected = groups.find((g) => g.id === value);
    const selectedLabel = selected ? selected.name : (value === null && allowNone ? NO_GROUP_LABEL : "");

    // The box shows the picked group's name; a new pick (or a renamed group)
    // replaces whatever was typed — while rendering, not after a paint.
    const [query, setQuery] = useState(selectedLabel);
    if (useValueChange(selectedLabel)) setQuery(selectedLabel);

    const q = query.trim().toLowerCase();
    const showAll = !q || q === selectedLabel.toLowerCase();
    const filteredGroups = showAll
        ? groups
        : groups.filter((g) => g.name.toLowerCase().includes(q));
    const showNoGroup = allowNone && (showAll || NO_GROUP_LABEL.toLowerCase().includes(q));

    const items: ({ kind: "none" } | { kind: "group"; group: GroupOption })[] = [
        ...(showNoGroup ? [{ kind: "none" as const }] : []),
        ...filteredGroups.map((g) => ({ kind: "group" as const, group: g })),
    ];

    const commit = (item: typeof items[number]) => {
        if (item.kind === "none") {
            setQuery(NO_GROUP_LABEL);
            onChange(null);
        } else {
            setQuery(item.group.name);
            onChange(item.group.id);
        }
        cb.setOpen(false);
    };

    const cb = useComboboxNav({
        count: items.length,
        onSelect: (i) => {
            const item = items[i];
            if (item) commit(item);
        },
    });

    const { target: portalTarget, pos } = useDropdownPortal(cb.open, cb.wrapperRef, PLACEMENT);

    return (
        <div ref={cb.wrapperRef} className={`relative ${className}`}>
            <input
                ref={cb.inputRef}
                type="text"
                value={query}
                autoFocus={autoFocus}
                placeholder={placeholder}
                className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground"
                onChange={(e) => {
                    setQuery(e.target.value);
                    cb.setHighlighted(0);
                    cb.setOpen(true);
                }}
                onFocus={(e) => {
                    cb.setOpen(true);
                    e.target.select();
                }}
                onBlur={cb.handleBlur}
                onKeyDown={cb.handleKeyDown}
            />

            {cb.open && portalTarget && pos && createPortal(
                <div
                    className="fixed z-[60] mt-0.5 overflow-hidden rounded-lg border border-border bg-popover shadow-xl text-xs"
                    style={{
                        top:   pos.top,
                        left:  pos.left,
                        width: pos.width,
                        maxHeight: pos.maxHeight,
                        transform: pos.flipUp ? "translateY(calc(-100% - 0.25rem))" : undefined,
                    }}
                    onMouseDown={cb.dropdownMouseDown}
                >
                    {items.length === 0 ? (
                        <div className="px-3 py-3 text-muted-foreground text-center">
                            No groups match <span className="font-mono">{query}</span>
                        </div>
                    ) : (
                        <div className="overflow-y-auto" style={{ maxHeight: pos.maxHeight }}>
                            <ul ref={cb.listRef} className="divide-y divide-border">
                                {items.map((item, i) => (
                                    <li
                                        key={item.kind === "none" ? "__none__" : item.group.id}
                                        onMouseDown={() => commit(item)}
                                        className={`cursor-pointer px-3 py-1.5 transition-colors ${
                                            i === cb.highlighted ? "bg-accent" : "hover:bg-accent/60"
                                        }`}
                                    >
                                        {item.kind === "none" ? (
                                            <span className="italic text-muted-foreground">{NO_GROUP_LABEL}</span>
                                        ) : (
                                            <span className="font-medium">
                                                {(item.group.depth ?? 0) > 0 && (
                                                    <span className="mr-1 font-mono text-muted-foreground">
                                                        {"-".repeat(item.group.depth ?? 0)}
                                                    </span>
                                                )}
                                                {item.group.name}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>,
                portalTarget,
            )}
        </div>
    );
}
