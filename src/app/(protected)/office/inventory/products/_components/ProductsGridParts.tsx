"use client";

// Small parts of the products grid: sort header, column chooser, column
// filter, cell select and bulk apply. Moved out of page.tsx unchanged.

import { useEffect, useMemo, useRef, useState } from "react";
import { Filter, ChevronDown, X, Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEscapeLayer } from "@/shared/hooks";
import { Opt, Patch, SortField, FilterField, ColId, COLUMNS, optLabel } from "./productsTypes";

/// Clickable header cell — cycles null → asc → desc → null on each click and
/// shows a tiny arrow when sort is active on this column.
export function SortHead({
    field, sort, onSort, children, align = "left",
}: {
    field: SortField;
    sort: { field: SortField; dir: "asc" | "desc" } | null;
    onSort: (f: SortField) => void;
    children: React.ReactNode;
    align?: "left" | "right";
}) {
    const active = sort?.field === field;
    const arrow = !active ? "↕" : sort!.dir === "asc" ? "↑" : "↓";
    return (
        <button
            type="button"
            onClick={() => onSort(field)}
            className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""} hover:text-primary`}
        >
            <span>{children}</span>
            <span className={`text-xs ${active ? "text-primary" : "text-muted-foreground/60"}`}>{arrow}</span>
        </button>
    );
}

/// Columns show/hide chooser — a checklist of every toggleable data column.
/// Choices persist per browser (handled by the parent). Structural columns
/// (row #, select box, actions) are never listed here.
export function ColumnChooser({
    visible, onToggle, onReset,
}: {
    visible: Set<ColId>;
    onToggle: (id: ColId, on: boolean) => void;
    onReset: () => void;
}) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!open) return;
        function onDocClick(e: MouseEvent) {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, [open]);
    // Esc closes only this popover, not the page (see useEscape).
    useEscapeLayer(open, () => setOpen(false));

    const hiddenCount = COLUMNS.length - visible.size;
    return (
        <div ref={wrapRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                title="Show / hide columns"
            >
                <Columns3 className="size-4" /> Columns
                {hiddenCount > 0 ? <span className="ml-0.5 rounded bg-muted px-1 text-[10px]">{hiddenCount} hidden</span> : null}
                <ChevronDown className="size-3.5" />
            </button>
            {open ? (
                <div className="absolute right-0 z-30 mt-1 min-w-52 rounded-md border border-border bg-popover text-popover-foreground shadow-md">
                    <div className="flex items-center justify-between px-2 pt-2 text-xs">
                        <span className="text-muted-foreground">Columns</span>
                        <button type="button" className="hover:underline" onClick={onReset}>reset</button>
                    </div>
                    <ul className="max-h-72 overflow-auto p-2 space-y-1">
                        {COLUMNS.map((c) => (
                            <li key={c.id}>
                                <label className="flex items-center gap-2 text-sm cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={visible.has(c.id)}
                                        onChange={(e) => onToggle(c.id, e.target.checked)}
                                    />
                                    <span className="truncate">{c.label}</span>
                                </label>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}

/// Per-column multi-select filter. Renders a funnel button that opens a
/// checklist of unique values from the master list (plus "(none)" for a
/// relation that may be empty). The server applies it over every product. For booleanField (isActive), shows ✓ / inactive.
export function ColFilter({
    field, options, colFilters, onToggle, onClear, booleanField = false,
    boolLabels, fixedItems, align = "left", onCreate, createLabel, noneOption = true,
}: {
    field: FilterField;
    options: Opt[];
    colFilters: Map<FilterField, Set<string>>;
    onToggle: (f: FilterField, key: string) => void;
    onClear: (f: FilterField) => void;
    booleanField?: boolean;
    /** Labels for the true/false rows of a booleanField. Defaults to Active/Inactive. */
    boolLabels?: { trueLabel: string; falseLabel: string };
    /** Fixed option list (e.g. stock buckets) — replaces the master-derived list. */
    fixedItems?: { key: string; label: string }[];
    /** Popover edge. Right-most columns (Stock / Active) open right-aligned so
     *  the panel doesn't clip past the viewport edge. */
    align?: "left" | "right";
    onCreate?: () => Promise<number | null>;
    createLabel?: string;
    /** Offer "(none)" — off for a required relation (unit). The page holds one
     *  page of rows, so it cannot ask "does any product lack this?" itself. */
    noneOption?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    useEffect(() => {
        if (!open) return;
        function onDocClick(e: MouseEvent) {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, [open]);
    // Esc closes only this popover, not the page (see useEscape).
    useEscapeLayer(open, () => setOpen(false));

    // Focus the search input each time the popover opens. (Query is reset in the
    // toggle handler so we don't call setState inside this effect.)
    useEffect(() => {
        if (!open) return;
        requestAnimationFrame(() => inputRef.current?.focus());
    }, [open]);

    const active = (colFilters.get(field)?.size ?? 0) > 0;
    const selected = colFilters.get(field) ?? new Set<string>();

    // Build the option list. fixedItems (stock buckets) and booleanField
    // (isActive) use fixed lists; everything else derives from the master rows.
    const items: { key: string; label: string }[] = fixedItems
        ? fixedItems
        : booleanField
            ? [{ key: "true", label: boolLabels?.trueLabel ?? "Active" }, { key: "false", label: boolLabels?.falseLabel ?? "Inactive" }]
            : (() => {
                const list = options.map((o) => ({ key: String(o.id), label: optLabel(o) }));
                if (noneOption) list.unshift({ key: "__none__", label: "(none)" });
                return list;
            })();

    // Filter by query (substring, case-insensitive). Empty query → all items.
    const q = query.trim().toLowerCase();
    const visibleItems = !q ? items : items.filter((it) => it.label.toLowerCase().includes(q));

    return (
        <div ref={wrapRef} className="relative">
            <button
                type="button"
                onClick={() => { if (!open) setQuery(""); setOpen((o) => !o); }}
                aria-label="Filter column"
                title={active ? `Filter (${selected.size})` : "Filter"}
                className={`inline-flex items-center justify-center size-5 rounded hover:bg-muted ${active ? "text-primary" : "text-muted-foreground/60"}`}
            >
                <Filter className="size-3.5" />
            </button>
            {open ? (
                <div className={`absolute z-20 mt-1 ${align === "right" ? "right-0" : "left-0"} min-w-56 rounded-md border border-border bg-popover text-popover-foreground shadow-md`}>
                    <div className="flex items-center justify-between px-2 pt-2 text-xs">
                        <span className="text-muted-foreground">Filter</span>
                        {active ? (
                            <button type="button" className="hover:underline" onClick={() => onClear(field)}>
                                clear
                            </button>
                        ) : null}
                    </div>
                    {!booleanField && !fixedItems ? (
                        <div className="px-2 pt-1">
                            <input
                                ref={inputRef}
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search…"
                                className="h-7 w-full rounded border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />
                        </div>
                    ) : null}
                    {onCreate ? (
                        <div className="px-2 pt-1">
                            <button
                                type="button"
                                onClick={async () => {
                                    const id = await onCreate();
                                    if (id != null) onToggle(field, String(id));
                                }}
                                className="block w-full rounded px-2 py-1 text-left text-sm text-primary hover:bg-muted"
                            >
                                + New {createLabel ?? "item"}
                            </button>
                        </div>
                    ) : null}
                    <ul className="max-h-60 overflow-auto p-2 space-y-1">
                        {visibleItems.map((it) => (
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
                        {visibleItems.length === 0 ? (
                            <li className="text-xs text-muted-foreground italic">
                                {items.length === 0 ? "no values" : "no matches"}
                            </li>
                        ) : null}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}

/// Searchable combobox cell. Closed state is just a button (cheap — keeps the
/// grid lean at 100+ rows × 5 dropdowns); opening one cell mounts a small
/// floating popover with a search input + filtered list. Native <select> was
/// the previous take but it can't substring-search a 250-brand list — only
/// first-letter jump.
///
/// onCreate (when supplied) shows a "+ New …" action at the top of the open
/// list. Choosing it calls onCreate (which prompts + POSTs + refreshes masters)
/// and selects the new id on success.
export function CellSelect({
    value,
    options,
    onChange,
    clearable = true,
    onCreate,
    createLabel = "+ New",
    placeholder = "—",
    openUp = false,
}: {
    value: number | null;
    options: Opt[];
    onChange: (v: number | null) => void;
    clearable?: boolean;
    onCreate?: () => Promise<number | null>;
    createLabel?: string;
    placeholder?: string;
    /// Bulk bar sits at the bottom of the viewport — open the list upward there.
    openUp?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [highlight, setHighlight] = useState(0);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listRef = useRef<HTMLUListElement | null>(null);

    const selected = options.find((o) => o.id === value) ?? null;
    const selectedLabel = selected ? optLabel(selected) : "";

    // Filtered + ranked options. Empty query → all options.
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return options;
        // Prefix matches first, then substring matches.
        const prefix: Opt[] = [];
        const sub: Opt[] = [];
        for (const o of options) {
            const lbl = optLabel(o).toLowerCase();
            if (lbl.startsWith(q)) prefix.push(o);
            else if (lbl.includes(q)) sub.push(o);
        }
        return [...prefix, ...sub];
    }, [options, query]);

    // Close on outside click; Esc closes only this popover, not the page.
    useEffect(() => {
        if (!open) return;
        function onDoc(e: MouseEvent) {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);
    useEscapeLayer(open, () => setOpen(false));

    // Focus the input each time the popover opens. (Query + highlight are reset in
    // the toggle/onChange handlers so we don't call setState inside this effect.)
    useEffect(() => {
        if (!open) return;
        // Focus on next tick so the input is mounted.
        requestAnimationFrame(() => inputRef.current?.focus());
    }, [open]);

    // Scroll the highlighted item into view on arrow nav.
    useEffect(() => {
        if (!open || !listRef.current) return;
        const el = listRef.current.querySelector<HTMLLIElement>(`[data-idx="${highlight}"]`);
        el?.scrollIntoView({ block: "nearest" });
    }, [highlight, open]);

    function commit(o: Opt) {
        onChange(o.id);
        setOpen(false);
    }
    function commitClear() {
        onChange(null);
        setOpen(false);
    }
    async function commitNew() {
        if (!onCreate) return;
        setOpen(false);
        const id = await onCreate();
        if (id != null) onChange(id);
    }

    return (
        <div ref={wrapRef} className="relative">
            <button
                type="button"
                onClick={() => { if (!open) { setQuery(""); setHighlight(0); } setOpen((o) => !o); }}
                className="flex h-8 w-full items-center justify-between gap-1 rounded-md border border-input bg-transparent px-2 text-left text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <span className={"truncate " + (selectedLabel ? "" : "text-muted-foreground")}>
                    {selectedLabel || placeholder}
                </span>
                <span className="flex items-center gap-0.5 shrink-0">
                    {clearable && value != null ? (
                        <span
                            role="button"
                            tabIndex={-1}
                            aria-label="Clear"
                            onClick={(e) => { e.stopPropagation(); commitClear(); }}
                            className="inline-flex items-center justify-center size-4 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                        >
                            <X className="size-3" />
                        </span>
                    ) : null}
                    <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                </span>
            </button>
            {open ? (
                <div className={"absolute z-30 left-0 right-0 rounded-md border border-border bg-popover text-popover-foreground shadow-md min-w-56 " + (openUp ? "bottom-full mb-1" : "mt-1")}>
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
                                    if (pick) commit(pick);
                                }
                            }}
                            placeholder="Type to search…"
                            className="h-7 w-full rounded border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                    </div>
                    <ul ref={listRef} className="max-h-64 overflow-auto py-1" role="listbox">
                        {clearable ? (
                            <li>
                                <button
                                    type="button"
                                    onClick={commitClear}
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
                                    onClick={commitNew}
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
                                const isSelected = o.id === value;
                                return (
                                    <li key={o.id} data-idx={i}>
                                        <button
                                            type="button"
                                            onMouseEnter={() => setHighlight(i)}
                                            onClick={() => commit(o)}
                                            className={
                                                "block w-full px-2 py-1 text-left text-sm " +
                                                (isHighlighted ? "bg-muted " : "") +
                                                (isSelected ? "font-medium" : "")
                                            }
                                        >
                                            {optLabel(o)}
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

/// Bulk-apply toolbar cell — same searchable CellSelect as the grid cells, with
/// a paired Apply button so a stray pick doesn't write. Picking "— clear —"
/// arms a blank-out (clearPending) instead of selecting an id.
export function BulkApply({
    label,
    options,
    field,
    onApply,
    clearable = true,
    onCreate,
}: {
    label: string;
    options: Opt[];
    field: keyof Patch;
    onApply: (field: keyof Patch, raw: string) => void;
    clearable?: boolean;
    onCreate?: () => Promise<number | null>;
}) {
    const [v, setV] = useState<number | null>(null);
    const [clearPending, setClearPending] = useState(false);
    return (
        <div className="flex items-center gap-1">
            <div className="w-36">
                <CellSelect
                    value={v}
                    options={options}
                    clearable={clearable}
                    onCreate={onCreate}
                    createLabel={`+ New ${label.toLowerCase()}`}
                    placeholder={clearPending ? "— clear —" : label}
                    openUp
                    onChange={(id) => {
                        setV(id);
                        setClearPending(id == null);
                    }}
                />
            </div>
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={v == null && !clearPending}
                onClick={() => {
                    if (v == null && !clearPending) return;
                    onApply(field, clearPending ? "" : String(v));
                    setV(null);
                    setClearPending(false);
                }}
            >
                Apply
            </Button>
        </div>
    );
}
