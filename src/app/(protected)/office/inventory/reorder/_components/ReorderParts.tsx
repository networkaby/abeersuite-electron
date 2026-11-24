"use client";

// Small parts of the Reorder report: movement-class badge and filter box.
// Moved out of page.tsx unchanged.

import { useState } from "react";
import { MovementClass, FilterField, NONE_KEY, FIELD_LABELS, NONE_LABELS, CLASS_BADGES } from "./reorderMath";

export function ClassBadge({ movementClass, blip }: { movementClass: MovementClass; blip?: boolean }) {
    const b = CLASS_BADGES[movementClass];
    if (!b) return null;
    return (
        <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${b.cls}`}>
            {b.label}{blip ? " · blip" : ""}
        </span>
    );
}

/// One checklist box inside the Filters panel (Strategies-page pattern):
/// searchable multi-select of unique values derived from the rows, with a
/// "(none)" entry when any row lacks the relation.
export function FilterBox({
    field, values, hasNone, selected, onToggle, onClear,
}: {
    field: FilterField;
    values: string[];
    hasNone: boolean;
    selected: Set<string>;
    onToggle: (field: FilterField, key: string) => void;
    onClear: (field: FilterField) => void;
}) {
    const [query, setQuery] = useState("");
    const items: { key: string; label: string }[] = [
        ...(hasNone ? [{ key: NONE_KEY, label: `(${NONE_LABELS[field].toLowerCase()})` }] : []),
        ...values.map((v) => ({ key: v, label: v })),
    ];
    const q = query.trim().toLowerCase();
    const visible = !q ? items : items.filter((it) => it.label.toLowerCase().includes(q));

    return (
        <div className="rounded-md border border-border bg-background p-2">
            <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-medium text-foreground">{FIELD_LABELS[field]}s</span>
                {selected.size > 0 && (
                    <button type="button" className="text-muted-foreground hover:underline" onClick={() => onClear(field)}>
                        clear ({selected.size})
                    </button>
                )}
            </div>
            <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Filter ${FIELD_LABELS[field].toLowerCase()}s…`}
                className="mb-1.5 h-7 w-full rounded border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <ul className="max-h-44 overflow-auto space-y-1">
                {visible.length === 0 ? (
                    <li className="px-1 py-0.5 text-xs text-muted-foreground">No matches</li>
                ) : visible.map((it) => (
                    <li key={it.key}>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={selected.has(it.key)}
                                onChange={() => onToggle(field, it.key)}
                            />
                            <span className="truncate">{it.label}</span>
                        </label>
                    </li>
                ))}
            </ul>
        </div>
    );
}
