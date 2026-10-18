"use client";

import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    EMPTY_PRODUCT_FILTERS,
    activeFilterCount,
    type ProductFilters,
} from "@/modules/ecommerce/lib/productFilters";

// The Filters button + its expandable panel, shared by Products and the AI
// descriptions screen. Controlled: the page owns the ProductFilters value.

type Key = Exclude<keyof ProductFilters, "query">;

export function ProductFilterButton({ open, filters, onToggle, defaults = EMPTY_PRODUCT_FILTERS }: {
    open: boolean;
    filters: ProductFilters;
    onToggle: () => void;
    defaults?: ProductFilters;
}) {
    const n = activeFilterCount(filters, defaults);
    return (
        <Button type="button" variant={open || n > 0 ? "secondary" : "outline"} onClick={onToggle} className="gap-2">
            <Filter className="size-4" />
            Filters
            {n > 0 ? (
                <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-xs tabular-nums">{n}</span>
            ) : null}
        </Button>
    );
}

export function ProductFilterPanel({
    value,
    onChange,
    options,
    hide = [],
    defaults = EMPTY_PRODUCT_FILTERS,
}: {
    value: ProductFilters;
    onChange: (next: ProductFilters) => void;
    options: { categories: string[]; brands: string[]; groups: string[] };
    /** Filters this screen fixes itself (e.g. description on the AI screen). */
    hide?: Key[];
    /** What Clear goes back to — a screen may start with its own defaults. */
    defaults?: ProductFilters;
}) {
    const set = (k: Key) => (v: string) => onChange({ ...value, [k]: v });
    const show = (k: Key) => !hide.includes(k);
    const choice = (k: Key, label: string, items: [string, string][], width = "w-36") =>
        show(k) ? (
            <div className="grid gap-1.5">
                <label className="text-muted-foreground text-xs">{label}</label>
                <Select value={value[k]} onValueChange={set(k)}>
                    <SelectTrigger className={`h-8 ${width} text-sm`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {items.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
        ) : null;
    const list = (all: string, xs: string[]): [string, string][] => [["all", all], ...xs.map((x): [string, string] => [x, x])];

    return (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-3">
            {choice("category", "Category", list("All categories", options.categories), "w-40")}
            {choice("brand", "Brand", list("All brands", options.brands), "w-40")}
            {choice("group", "Group", list("All groups", options.groups), "w-40")}
            {choice("status", "Shop status", [["all", "Any status"], ["live", "Live"], ["ready", "Ready to publish"], ["needs", "Needs info"]])}
            {choice("stock", "Stock", [["all", "Any stock"], ["in", "In stock"], ["out", "Out of stock"], ["untracked", "Untracked"]])}
            {choice("photos", "Photos", [["all", "Any"], ["has", "Has photo"], ["none", "No photo"]], "w-32")}
            {choice("description", "Description", [["all", "Any"], ["has", "Written"], ["missing", "Missing"]], "w-32")}
            {choice("active", "Active", [["all", "All"], ["active", "Active only"], ["inactive", "Inactive only"]], "w-32")}
            {activeFilterCount(value, defaults) > 0 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...defaults, query: value.query })} className="gap-1">
                    <X className="size-3.5" /> Clear
                </Button>
            ) : null}
        </div>
    );
}
