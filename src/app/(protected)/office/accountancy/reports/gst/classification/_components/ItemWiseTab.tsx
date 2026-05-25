"use client";

// Item-wise view — every product with its own + resolved tax, inline-editable
// cells, plus a pencil that opens the full InvProductDialog on the Tax tab.
// Filters: search, group, source ("only inherited", "only unresolved"), rate.

import { useMemo, useState } from "react";
import { Pencil, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { RateCell, HsnCell, TaxabilityCell, type GstRateOpt } from "./InlineTaxCells";
import type { GstClassificationPayload, ProductRow } from "./types";

interface Props {
    data: GstClassificationPayload;
    canEdit: boolean;
    onSaved: () => void;
    onOpenDialog: (productId: number) => void;
    rateFilter: number | null | undefined; // undefined = not filtered, null = "unresolved"
    hsnFilter: string | null | undefined;  // undefined = not filtered, null = "no HSN"
    onClearFilters: () => void;
}

const SOURCE_OPTIONS = [
    { value: "all",   label: "All sources" },
    { value: "own",   label: "Own only" },
    { value: "group", label: "Inherited from group" },
    { value: "org",   label: "Inherited from org default" },
    { value: "unset", label: "Unresolved (no rate anywhere)" },
] as const;

export function ItemWiseTab({
    data, canEdit, onSaved, onOpenDialog,
    rateFilter, hsnFilter, onClearFilters,
}: Props) {
    const [search, setSearch] = useState("");
    const [groupId, setGroupId] = useState<string>("all");
    const [source, setSource] = useState<(typeof SOURCE_OPTIONS)[number]["value"]>("all");

    const rates: GstRateOpt[] = data.rates.map((r) => ({
        id: r.id, rate: r.rate, label: r.label, isActive: r.isActive,
    }));

    const filtered = useMemo<ProductRow[]>(() => {
        const q = search.trim().toLowerCase();
        return data.products.filter((p) => {
            if (q && !p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
            if (groupId !== "all") {
                if (groupId === "none") { if (p.group != null) return false; }
                else if (String(p.group?.id ?? "") !== groupId) return false;
            }
            if (source === "own"   && p.resolved.gstSource !== "product") return false;
            if (source === "group" && !(typeof p.resolved.gstSource === "object" && p.resolved.gstSource?.kind === "group")) return false;
            if (source === "org"   && p.resolved.gstSource !== "org-default") return false;
            if (source === "unset" && p.resolved.gstSource != null) return false;
            if (rateFilter !== undefined) {
                if (rateFilter === null) {
                    if (p.resolved.gstRateId != null) return false;
                } else if (p.resolved.gstRateId !== rateFilter) return false;
            }
            if (hsnFilter !== undefined) {
                const ph = p.resolved.hsnCode ?? null;
                if (hsnFilter !== ph) return false;
            }
            return true;
        });
    }, [data.products, search, groupId, source, rateFilter, hsnFilter]);

    const activeFilterChip = (() => {
        if (rateFilter !== undefined) {
            if (rateFilter === null) return "Unresolved rate";
            const r = data.rates.find((x) => x.id === rateFilter);
            return r ? `Rate: ${r.label}` : `Rate #${rateFilter}`;
        }
        if (hsnFilter !== undefined) return hsnFilter == null ? "No HSN" : `HSN: ${hsnFilter}`;
        return null;
    })();

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search SKU or name…"
                        className="h-9 pl-8"
                    />
                </div>
                <Select value={groupId} onValueChange={setGroupId}>
                    <SelectTrigger className="h-9 w-44"><SelectValue placeholder="All groups" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All groups</SelectItem>
                        <SelectItem value="none">— ungrouped —</SelectItem>
                        {data.groups.map((g) => (
                            <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
                    <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {SOURCE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {activeFilterChip && (
                    <div className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                        {activeFilterChip}
                        <button type="button" onClick={onClearFilters} className="ml-1 hover:underline">clear</button>
                    </div>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                    {filtered.length} of {data.products.length}
                </span>
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-card">
                <table className="w-full text-sm">
                    <thead className="border-b bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium">SKU</th>
                            <th className="px-3 py-2 text-left font-medium">Name</th>
                            <th className="px-3 py-2 text-left font-medium">Group</th>
                            <th className="px-3 py-2 text-left font-medium">GST rate</th>
                            <th className="px-3 py-2 text-left font-medium">HSN / SAC</th>
                            <th className="px-3 py-2 text-left font-medium">Taxability</th>
                            <th className="px-3 py-2 w-10" />
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.length === 0 ? (
                            <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">No products match.</td></tr>
                        ) : filtered.map((p) => {
                            const patchUrl = `/api/inventory/products/${p.id}`;
                            return (
                                <tr key={p.id} className="group border-b last:border-0 hover:bg-muted/40">
                                    <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                                    <td className="px-3 py-2">
                                        <span className={p.isActive ? "" : "italic text-muted-foreground"}>{p.name}</span>
                                        {!p.isActive && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px]">inactive</span>}
                                    </td>
                                    <td className="px-3 py-2 text-xs text-muted-foreground">{p.group?.name ?? <em>—</em>}</td>
                                    <td className="px-3 py-2">
                                        <RateCell
                                            ownRateId={p.own.gstRateId}
                                            resolvedRate={p.resolved.gstRate}
                                            resolvedSource={p.resolved.gstSource}
                                            rates={rates}
                                            patchUrl={patchUrl}
                                            onSaved={onSaved}
                                            canEdit={canEdit}
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <HsnCell
                                            ownHsn={p.own.hsnCode}
                                            resolvedHsn={p.resolved.hsnCode}
                                            resolvedSource={p.resolved.hsnSource}
                                            patchUrl={patchUrl}
                                            onSaved={onSaved}
                                            canEdit={canEdit}
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <TaxabilityCell
                                            ownTaxability={p.own.taxability}
                                            resolvedTaxability={p.resolved.taxability}
                                            resolvedSource={p.resolved.taxabilitySource}
                                            patchUrl={patchUrl}
                                            onSaved={onSaved}
                                            canEdit={canEdit}
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        {canEdit && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                onClick={() => onOpenDialog(p.id)}
                                                title="Open full product editor on Tax tab"
                                            >
                                                <Pencil className="size-3.5" />
                                            </Button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
